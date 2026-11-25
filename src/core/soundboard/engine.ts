import type { Logger } from 'pino';
import type { SoundboardSettings } from '../config/schema.js';
import type { SoundboardStore } from './store.js';
import type {
  MusicLoopMode,
  SoundboardState,
  SoundEntry,
  SoundPlayingEntry,
  SoundStopScope,
} from './types.js';

export const SOUNDBOARD_SAMPLE_RATE = 48_000;
export const SOUNDBOARD_CHANNELS = 2;
export const SOUNDBOARD_BYTES_PER_SAMPLE = 2;
export const SOUNDBOARD_FRAME_MS = 20;
export const SOUNDBOARD_FRAME_SAMPLES = (SOUNDBOARD_SAMPLE_RATE * SOUNDBOARD_FRAME_MS) / 1000; // 960 stereo frames
export const SOUNDBOARD_FRAME_BYTES =
  SOUNDBOARD_FRAME_SAMPLES * SOUNDBOARD_CHANNELS * SOUNDBOARD_BYTES_PER_SAMPLE; // 3840 bytes

const FADE_SAMPLES = (SOUNDBOARD_SAMPLE_RATE * 10) / 1000; // 10 ms fade
const CROSSFADE_SAMPLES = (SOUNDBOARD_SAMPLE_RATE * 300) / 1000; // 300 ms music crossfade
const SILENCE_FRAME = Buffer.alloc(SOUNDBOARD_FRAME_BYTES);

interface ActiveSlot {
  entry: SoundEntry;
  pcm: Buffer;
  byteOffset: number;
  startedAt: string;
  gainOverrideDb?: number;
  fadeInRemaining: number;
  fadeOutTotal: number;
  fadeOutRemaining: number;
  stopping: boolean;
}

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Real-time 48kHz stereo s16le PCM mixer feeding ffmpeg pipe:5.
 * Continuously emits 20 ms frames (silence when idle) with backpressure protection.
 */
export class SoundboardEngine {
  private readonly store: SoundboardStore;
  private readonly logger: Logger;
  private settings: SoundboardSettings;
  private readonly onStateChange?: (state: SoundboardState) => void;

  private sfxSlots: ActiveSlot[] = [];
  private musicSlot: ActiveSlot | null = null;
  private musicCrossfadeOut: ActiveSlot | null = null;
  private musicPaused = false;
  private musicLoop: MusicLoopMode = 'all';

  private stream: NodeJS.WritableStream | null = null;
  private timer: NodeJS.Timeout | null = null;
  private backpressured = false;
  private backpressureSince = 0;
  private nextTickAt = 0;

  constructor(options: {
    store: SoundboardStore;
    settings: SoundboardSettings;
    logger: Logger;
    onStateChange?: (state: SoundboardState) => void;
  }) {
    this.store = options.store;
    this.settings = { ...options.settings };
    this.logger = options.logger;
    this.onStateChange = options.onStateChange;
  }

  updateSettings(settings: SoundboardSettings): void {
    this.settings = { ...settings };
    this.store.setCacheMb(settings.cache_mb);
    this.emitState();
  }

  get attached(): boolean {
    return this.stream !== null;
  }

  attach(stream: NodeJS.WritableStream): void {
    this.detach();
    this.stream = stream;
    this.backpressured = false;
    this.backpressureSince = 0;
    this.nextTickAt = Date.now();

    const onDrain = () => {
      this.backpressured = false;
    };
    const onClose = () => {
      if (this.stream === stream) this.detach();
    };
    stream.on('drain', onDrain);
    stream.on('close', onClose);
    stream.on('error', onClose);

    this.timer = setInterval(() => {
      this.tick();
    }, SOUNDBOARD_FRAME_MS);
    this.timer.unref?.();
    this.emitState();
  }

  detach(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stream = null;
    this.backpressured = false;
    this.emitState();
  }

  async play(
    id: string,
    options?: { gain_db?: number; target?: 'sfx' | 'music' },
  ): Promise<SoundEntry> {
    const entry = this.store.get(id);
    if (!entry) throw new Error(`Sound "${id}" nicht gefunden`);
    const pcm = await this.store.getPcm(id);
    const target = options?.target ?? entry.kind;

    if (target === 'music') {
      if (this.musicSlot && !this.musicPaused) {
        this.musicSlot.stopping = true;
        this.musicSlot.fadeOutTotal = CROSSFADE_SAMPLES;
        this.musicSlot.fadeOutRemaining = CROSSFADE_SAMPLES;
        this.musicCrossfadeOut = this.musicSlot;
      }
      this.musicSlot = {
        entry,
        pcm,
        byteOffset: 0,
        startedAt: new Date().toISOString(),
        gainOverrideDb: options?.gain_db,
        fadeInRemaining: this.musicCrossfadeOut ? CROSSFADE_SAMPLES : FADE_SAMPLES,
        fadeOutTotal: FADE_SAMPLES,
        fadeOutRemaining: FADE_SAMPLES,
        stopping: false,
      };
      this.musicPaused = false;
    } else {
      while (this.sfxSlots.length >= this.settings.max_concurrent) {
        this.sfxSlots.shift();
      }
      this.sfxSlots.push({
        entry,
        pcm,
        byteOffset: 0,
        startedAt: new Date().toISOString(),
        gainOverrideDb: options?.gain_db,
        fadeInRemaining: FADE_SAMPLES,
        fadeOutTotal: FADE_SAMPLES,
        fadeOutRemaining: FADE_SAMPLES,
        stopping: false,
      });
    }
    this.emitState();
    return entry;
  }

  stop(scope: SoundStopScope = 'all'): void {
    let changed = false;
    if (scope === 'sfx' || scope === 'all') {
      for (const slot of this.sfxSlots) {
        if (!slot.stopping) {
          slot.stopping = true;
          slot.fadeOutTotal = FADE_SAMPLES;
          slot.fadeOutRemaining = FADE_SAMPLES;
          changed = true;
        }
      }
    }
    if ((scope === 'music' || scope === 'all') && this.musicSlot) {
      this.musicSlot.stopping = true;
      this.musicSlot.fadeOutTotal = FADE_SAMPLES;
      this.musicSlot.fadeOutRemaining = FADE_SAMPLES;
      this.musicCrossfadeOut = this.musicSlot;
      this.musicSlot = null;
      this.musicPaused = false;
      changed = true;
    }
    if (changed) this.emitState();
  }

  async nextMusic(): Promise<SoundEntry | null> {
    const tracks = this.store.list().filter((s) => s.kind === 'music');
    if (tracks.length === 0) return null;
    const currentId = this.musicSlot?.entry.id;
    const idx = currentId ? tracks.findIndex((t) => t.id === currentId) : -1;
    const nextTrack = tracks[(idx + 1) % tracks.length]!;
    return this.play(nextTrack.id, { target: 'music' });
  }

  toggleMusicPause(paused?: boolean): boolean {
    if (!this.musicSlot) return false;
    this.musicPaused = paused ?? !this.musicPaused;
    this.emitState();
    return this.musicPaused;
  }

  setMusicLoop(mode: MusicLoopMode): void {
    this.musicLoop = mode;
    this.emitState();
  }

  setVolume(patch: {
    master_gain_db?: number;
    sfx_gain_db?: number;
    music_gain_db?: number;
  }): void {
    if (patch.master_gain_db !== undefined) {
      this.settings.master_gain_db = Math.max(-40, Math.min(12, patch.master_gain_db));
    }
    if (patch.sfx_gain_db !== undefined) {
      this.settings.sfx_gain_db = Math.max(-40, Math.min(12, patch.sfx_gain_db));
    }
    if (patch.music_gain_db !== undefined) {
      this.settings.music_gain_db = Math.max(-40, Math.min(12, patch.music_gain_db));
    }
    this.emitState();
  }

  onSoundsChanged(): void {
    const existingIds = new Set(this.store.list().map((s) => s.id));
    let changed = false;
    for (const slot of this.sfxSlots) {
      if (!existingIds.has(slot.entry.id)) {
        slot.stopping = true;
        changed = true;
      }
    }
    if (this.musicSlot && !existingIds.has(this.musicSlot.entry.id)) {
      this.musicSlot = null;
      this.musicPaused = false;
      changed = true;
    }
    if (changed) this.emitState();
    else this.onStateChange?.(this.getState());
  }

  getState(): SoundboardState {
    const playing: SoundPlayingEntry[] = this.sfxSlots
      .filter((s) => !s.stopping)
      .map((s) => ({
        id: s.entry.id,
        name: s.entry.name,
        kind: s.entry.kind,
        started_at: s.startedAt,
        position: Math.round((s.byteOffset / (SOUNDBOARD_SAMPLE_RATE * 4)) * 100) / 100,
        duration: s.entry.duration,
      }));

    const music = this.musicSlot
      ? {
          id: this.musicSlot.entry.id,
          name: this.musicSlot.entry.name,
          paused: this.musicPaused,
          loop: this.musicLoop,
          position:
            Math.round((this.musicSlot.byteOffset / (SOUNDBOARD_SAMPLE_RATE * 4)) * 100) / 100,
          duration: this.musicSlot.entry.duration,
        }
      : null;

    return {
      enabled: this.settings.enabled,
      attached: this.attached,
      playing,
      music,
      master_gain_db: this.settings.master_gain_db,
      sfx_gain_db: this.settings.sfx_gain_db,
      music_gain_db: this.settings.music_gain_db,
      ducking: this.settings.ducking,
      duck_db: this.settings.duck_db,
      sounds: this.store.list(),
    };
  }

  /** Mixes one 20ms PCM frame (exposed publicly for deterministic unit testing). */
  mixFrame(): Buffer {
    const hasMusic = Boolean(this.musicSlot && !this.musicPaused);
    if (this.sfxSlots.length === 0 && !hasMusic && !this.musicCrossfadeOut) {
      return SILENCE_FRAME;
    }

    const mix = new Float32Array(SOUNDBOARD_FRAME_SAMPLES * SOUNDBOARD_CHANNELS);
    const masterLinear = dbToLinear(this.settings.master_gain_db);
    const sfxCatLinear = dbToLinear(this.settings.sfx_gain_db);
    const musicCatLinear = dbToLinear(this.settings.music_gain_db);

    let stateChanged = false;

    const nextSfx: ActiveSlot[] = [];
    for (const slot of this.sfxSlots) {
      const gain = masterLinear * sfxCatLinear * dbToLinear(slot.gainOverrideDb ?? slot.entry.gain_db);
      const finished = this.mixSlotInto(slot, mix, gain);
      if (finished) {
        stateChanged = true;
      } else {
        nextSfx.push(slot);
      }
    }
    this.sfxSlots = nextSfx;

    if (this.musicCrossfadeOut) {
      const gain =
        masterLinear *
        musicCatLinear *
        dbToLinear(this.musicCrossfadeOut.gainOverrideDb ?? this.musicCrossfadeOut.entry.gain_db);
      if (this.mixSlotInto(this.musicCrossfadeOut, mix, gain)) {
        this.musicCrossfadeOut = null;
      }
    }

    if (this.musicSlot && !this.musicPaused) {
      const gain =
        masterLinear *
        musicCatLinear *
        dbToLinear(this.musicSlot.gainOverrideDb ?? this.musicSlot.entry.gain_db);
      const finished = this.mixSlotInto(this.musicSlot, mix, gain);
      if (finished) {
        this.handleMusicFinished();
        stateChanged = true;
      }
    }

    const out = Buffer.allocUnsafe(SOUNDBOARD_FRAME_BYTES);
    for (let i = 0; i < mix.length; i += 1) {
      // Soft limiter / clamp to Int16 range to prevent harsh digital clipping.
      let sample = mix[i]!;
      if (sample > 32767) sample = 32767;
      else if (sample < -32768) sample = -32768;
      out.writeInt16LE(sample | 0, i * 2);
    }

    if (stateChanged) this.emitState();
    return out;
  }

  private mixSlotInto(slot: ActiveSlot, mix: Float32Array, gain: number): boolean {
    const totalBytes = slot.pcm.byteLength;
    for (let s = 0; s < SOUNDBOARD_FRAME_SAMPLES; s += 1) {
      if (slot.byteOffset + 4 > totalBytes) {
        return true;
      }
      let env = 1;
      if (slot.fadeInRemaining > 0) {
        const totalFade = slot.entry.kind === 'music' && this.musicCrossfadeOut ? CROSSFADE_SAMPLES : FADE_SAMPLES;
        env *= 1 - slot.fadeInRemaining / Math.max(1, totalFade);
        slot.fadeInRemaining -= 1;
      }
      if (slot.stopping) {
        if (slot.fadeOutRemaining <= 0) return true;
        env *= slot.fadeOutRemaining / Math.max(1, slot.fadeOutTotal);
        slot.fadeOutRemaining -= 1;
      }

      const l = slot.pcm.readInt16LE(slot.byteOffset);
      const r = slot.pcm.readInt16LE(slot.byteOffset + 2);
      const idx = s * 2;
      mix[idx] = mix[idx]! + l * gain * env;
      mix[idx + 1] = mix[idx + 1]! + r * gain * env;
      slot.byteOffset += 4;
    }
    return slot.stopping && slot.fadeOutRemaining <= 0;
  }

  private handleMusicFinished(): void {
    const finished = this.musicSlot;
    this.musicSlot = null;
    if (!finished) return;
    if (this.musicLoop === 'one') {
      void this.play(finished.entry.id, { target: 'music' }).catch((err) => {
        this.logger.warn({ err: String(err) }, 'Musik-Loop fehlgeschlagen');
      });
    } else if (this.musicLoop === 'all') {
      void this.nextMusic().catch((err) => {
        this.logger.warn({ err: String(err) }, 'Nächster Musiktitel fehlgeschlagen');
      });
    }
  }

  private tick(): void {
    const stream = this.stream;
    if (!stream) return;

    const now = Date.now();
    if (this.backpressured) {
      if (now - this.backpressureSince < 200) return;
      // Resync after prolonged backpressure instead of blocking the event loop.
      this.backpressured = false;
      this.nextTickAt = now;
    }

    // Catch up at most 2 frames per tick so transient timer jitter stays smooth.
    let frames = 0;
    while (this.nextTickAt <= now && frames < 2) {
      const frame = this.mixFrame();
      const ok = stream.write(frame);
      this.nextTickAt += SOUNDBOARD_FRAME_MS;
      frames += 1;
      if (!ok) {
        this.backpressured = true;
        this.backpressureSince = now;
        break;
      }
    }
    if (now - this.nextTickAt > 200) {
      this.nextTickAt = now;
    }
  }

  private emitState(): void {
    this.onStateChange?.(this.getState());
  }
}
