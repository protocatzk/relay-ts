import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { SettingsSchema } from '../src/core/config/schema.js';
import type { MediaConfig } from '../src/core/config/loader.js';
import { buildSinkCommand } from '../src/core/source/ffmpeg.js';
import {
  SOUNDBOARD_FRAME_BYTES,
  SoundboardEngine,
} from '../src/core/soundboard/engine.js';
import {
  detectAudioMagic,
  normalizeSoundFilename,
} from '../src/core/soundboard/store.js';
import type { SoundEntry } from '../src/core/soundboard/types.js';

const logger = pino({ level: 'silent' });

function makeMediaConfig(): MediaConfig {
  return {
    ffmpegBin: 'ffmpeg',
    ytdlpBin: 'yt-dlp',
    ffmpegLogLevel: 'warning',
    youtubeRtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
    youtubeBackup: false,
  } as unknown as MediaConfig;
}

function makeFakeStore(entries: SoundEntry[], pcmById: Record<string, Buffer>) {
  return {
    list: () => entries.map((e) => ({ ...e })),
    get: (id: string) => entries.find((e) => e.id === id),
    findByNameOrId: (q: string) =>
      entries.find((e) => e.id === q || e.name.toLowerCase() === q.toLowerCase()),
    getPcm: async (id: string) => {
      const buf = pcmById[id];
      if (!buf) throw new Error('missing pcm');
      return buf;
    },
    setCacheMb: vi.fn(),
  } as unknown as ConstructorParameters<typeof SoundboardEngine>[0]['store'];
}

function makeConstantPcm(amplitude: number, frames = 20): Buffer {
  const buf = Buffer.alloc(frames * SOUNDBOARD_FRAME_BYTES);
  for (let i = 0; i < buf.length; i += 2) {
    buf.writeInt16LE(amplitude, i);
  }
  return buf;
}

describe('Soundboard validation', () => {
  it('detects allowed audio magic bytes and rejects invalid payloads', () => {
    const wav = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'ascii');
    const ogg = Buffer.from('OggS\x00\x02\x00\x00\x00\x00\x00\x00', 'ascii');
    const flac = Buffer.from('fLaC\x00\x00\x00\x22\x10\x00\x10\x00', 'ascii');
    const mp3 = Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00\x00\x00', 'ascii');
    const m4a = Buffer.from('\x00\x00\x00\x20ftypM4A \x00\x00\x00', 'ascii');
    const junk = Buffer.from('not-audio-at-all', 'ascii');

    expect(detectAudioMagic(wav)).toBe('wav');
    expect(detectAudioMagic(ogg)).toBe('ogg');
    expect(detectAudioMagic(flac)).toBe('flac');
    expect(detectAudioMagic(mp3)).toBe('mp3');
    expect(detectAudioMagic(m4a)).toBe('m4a');
    expect(detectAudioMagic(junk)).toBeNull();
  });

  it('normalizes uploaded audio filenames and rejects unsupported extensions', () => {
    expect(normalizeSoundFilename('Air Horn (Loud)!.MP3')).toBe('air-horn-loud.mp3');
    expect(normalizeSoundFilename('chill_beat.opus')).toBe('chill-beat.opus');
    expect(normalizeSoundFilename('script.exe')).toBeNull();
  });
});

describe('SoundboardEngine mixer', () => {
  it('emits silence frames when idle and mixes multiple SFX with limiter clamping', async () => {
    const s1: SoundEntry = {
      id: 's1',
      name: 'Horn',
      file: 's1.wav',
      kind: 'sfx',
      duration: 1,
      gain_db: 0,
      color: '#22d3ee',
      hotkey: '1',
      created_at: new Date().toISOString(),
    };
    const s2: SoundEntry = { ...s1, id: 's2', name: 'Boom', hotkey: '2' };
    const store = makeFakeStore([s1, s2], {
      s1: makeConstantPcm(20000, 10),
      s2: makeConstantPcm(20000, 10),
    });

    const settings = SettingsSchema.parse({}).soundboard;
    settings.enabled = true;
    const engine = new SoundboardEngine({ store, settings, logger });

    const idleFrame = engine.mixFrame();
    expect(idleFrame.byteLength).toBe(SOUNDBOARD_FRAME_BYTES);
    expect(idleFrame.readInt16LE(0)).toBe(0);

    await engine.play('s1');
    await engine.play('s2');
    // Skip first frame (fade-in starts at 0) and inspect steady-state clamped sample.
    engine.mixFrame();
    const mixed = engine.mixFrame();
    expect(mixed.readInt16LE(SOUNDBOARD_FRAME_BYTES - 4)).toBe(32767);

    engine.stop('all');
    expect(engine.getState().playing).toHaveLength(0);
  });

  it('writes continuous frames to an attached sink pipe without restarting', async () => {
    const s1: SoundEntry = {
      id: 's1',
      name: 'Ping',
      file: 's1.wav',
      kind: 'sfx',
      duration: 0.5,
      gain_db: 0,
      color: '#22d3ee',
      hotkey: '1',
      created_at: new Date().toISOString(),
    };
    const store = makeFakeStore([s1], { s1: makeConstantPcm(1000, 5) });
    const settings = SettingsSchema.parse({}).soundboard;
    settings.enabled = true;
    const engine = new SoundboardEngine({ store, settings, logger });

    const pipe = new PassThrough();
    const chunks: Buffer[] = [];
    pipe.on('data', (chunk: Buffer) => chunks.push(chunk));

    engine.attach(pipe);
    await new Promise((r) => setTimeout(r, 70));
    await engine.play('s1');
    await new Promise((r) => setTimeout(r, 50));
    engine.detach();

    const totalBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    expect(totalBytes).toBeGreaterThanOrEqual(SOUNDBOARD_FRAME_BYTES * 2);
  });
});

describe('buildSinkCommand with soundboard pipe:5', () => {
  it('keeps legacy args unchanged when soundboardInput is omitted', () => {
    const settings = SettingsSchema.parse({});
    const args = buildSinkCommand({
      media: makeMediaConfig(),
      settings,
      key: 'test-key',
      relay: { host: '127.0.0.1', port: 4000 },
    });

    expect(args).not.toContain('pipe:5');
    expect(args).toContain('-af');
    expect(args).toContain('0:a:0?');
  });

  it('adds pipe:5 and sidechaincompress ducking when soundboardInput is enabled', () => {
    const settings = SettingsSchema.parse({});
    const args = buildSinkCommand({
      media: makeMediaConfig(),
      settings,
      key: 'test-key',
      relay: { host: '127.0.0.1', port: 4000 },
      soundboardInput: { fd: 5, ducking: true, duckDb: -12 },
    });

    expect(args).toContain('pipe:5');
    expect(args).toContain('-filter_complex');
    expect(args).not.toContain('-af');
    const fc = args[args.indexOf('-filter_complex') + 1]!;
    expect(fc).toContain('sidechaincompress');
    expect(fc).toContain('amix=inputs=2:normalize=0:duration=first');
    expect(fc).toContain('[aout]');
    expect(args).toContain('[aout]');
  });

  it('uses amix without sidechaincompress when ducking is disabled', () => {
    const settings = SettingsSchema.parse({});
    const args = buildSinkCommand({
      media: makeMediaConfig(),
      settings,
      key: 'test-key',
      relay: { host: '127.0.0.1', port: 4000 },
      soundboardInput: { fd: 5, ducking: false, duckDb: -12 },
    });

    const fc = args[args.indexOf('-filter_complex') + 1]!;
    expect(fc).not.toContain('sidechaincompress');
    expect(fc).toContain('[orig][board]amix=inputs=2:normalize=0:duration=first');
  });
});
