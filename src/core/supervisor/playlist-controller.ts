import type { Logger } from 'pino';
import type { PlaylistConfig, StreamerConfig } from '../config/schema.js';
import { StreamerSchema, resolveStreamKey } from '../config/schema.js';
import type { StatusSnapshot, StreamState } from '../events.js';
import type { StreamerStore } from '../store/streamer-store.js';
import type { AsyncLock } from '../../utils/process.js';
import {
  NotFoundError,
  StreamerOfflineError,
  ValidationError,
  toErrorMessage,
} from '../../utils/errors.js';
import { incMetric } from '../metrics.js';
import { QUEUE_PLAYLIST_ID } from './queue-controller.js';

export interface PlaylistRunState {
  playlist: PlaylistConfig;
  index: number;
}

export interface PlaylistStartOptions {
  key: string;
  playlist: PlaylistRunState;
  /** Start offset for local videos (seconds). */
  seekSeconds?: number;
}

export interface PlaylistControllerDeps {
  store: StreamerStore;
  logger: Logger;
  lock: AsyncLock;
  isShuttingDown(): boolean;
  /** Resolves a store playlist or the synthetic regie queue. */
  resolvePlaylist(id: string): PlaylistConfig | null;
  startStreamer(streamer: StreamerConfig, options: PlaylistStartOptions): Promise<StatusSnapshot>;
  startFile(file: string, options: PlaylistStartOptions): Promise<StatusSnapshot>;
  startScreen(type: 'startup' | 'pause'): Promise<StatusSnapshot>;
  /** Key used for local videos inside the regie queue (current sink or target). */
  resolveQueueKey(): string;
  /** True when the running entry should restart instead of advancing (#94). */
  repeatCurrent?(): boolean;
  /** Called after an entry actually started; used for the queue history (#94). */
  onEntryStart?(playlistId: string, channel: string): void;
  /** Snapshot for callers that need to return the unchanged state. */
  buildStatus?(): StatusSnapshot;
  stopAll(): Promise<StatusSnapshot>;
  transition(state: StreamState, reason?: string): void;
  emitStatus(): void;
  emitAll(): void;
  setLastError(message: string | null): void;
}

/**
 * Owns playlist state, timers and entry selection. The supervisor keeps the
 * stream lifecycle; this controller only decides which channel is next.
 */
export class PlaylistController {
  private readonly deps: PlaylistControllerDeps;
  private state: PlaylistRunState | null = null;
  private advanceTimer?: NodeJS.Timeout;
  private endTimer?: NodeJS.Timeout;
  private endAt: number | null = null;
  private advancePending = false;
  /** "Hold" keeps the run state but stops all automatic progression (#94). */
  private held = false;

  constructor(deps: PlaylistControllerDeps) {
    this.deps = deps;
  }

  get current(): PlaylistRunState | null {
    return this.state;
  }

  isHeld(): boolean {
    return this.held;
  }

  /** Stops auto-advance without losing the current entry (#94). */
  hold(): void {
    this.held = true;
    this.clearTimers();
  }

  /** Undoes `hold`, re-arming the end timer of the running playlist. */
  release(): void {
    this.held = false;
    if (this.state) {
      this.endAt = this.endTimestamp(this.state.playlist);
      this.scheduleEndLocked();
    }
  }

  get isAdvancePending(): boolean {
    return this.advancePending;
  }

  async play(id: string, startIndex = 0, seekSeconds?: number): Promise<StatusSnapshot> {
    return this.deps.lock.run(async () => {
      const playlist = this.deps.resolvePlaylist(id);
      if (!playlist) throw new NotFoundError(`Playlist "${id}" wurde nicht gefunden`);
      this.clearTimers();
      this.endAt = this.endTimestamp(playlist);
      return this.startEntryLocked(playlist, Math.max(0, Math.trunc(startIndex)), seekSeconds);
    });
  }

  async next(): Promise<StatusSnapshot> {
    return this.deps.lock.run(async () => {
      if (!this.state) throw new ValidationError('Es ist keine Playlist aktiv');
      return this.advanceLocked('manual');
    });
  }

  async previous(): Promise<StatusSnapshot> {
    return this.deps.lock.run(async () => {
      const state = this.state;
      if (!state) throw new ValidationError('Es ist keine Playlist aktiv');
      const playlist = this.deps.resolvePlaylist(state.playlist.id) ?? state.playlist;
      let index = state.index - 1;
      if (index < 0) index = playlist.wrap ? playlist.channels.length - 1 : 0;
      return this.startEntryLocked(playlist, index);
    });
  }

  async tune(streamerId: string): Promise<StatusSnapshot> {
    return this.deps.lock.run(async () => {
      const state = this.state;
      if (!state) throw new ValidationError('Es ist keine Playlist aktiv');
      const playlist = this.deps.resolvePlaylist(state.playlist.id) ?? state.playlist;
      const wanted = streamerId.replace(/^@+/, '').toLowerCase();
      const index = playlist.channels.findIndex((channel) => {
        if (channel.startsWith('screen:')) return false;
        if (channel.startsWith('file:')) {
          const file = channel.slice('file:'.length).replace(/^@+/, '').toLowerCase();
          return file === wanted || channel.replace(/^@+/, '').toLowerCase() === wanted;
        }
        const resolved = this.resolveChannel(channel);
        return (
          resolved.id === streamerId ||
          resolved.tiktok.replace(/^@+/, '').toLowerCase() === wanted ||
          channel.replace(/^@+/, '').toLowerCase() === wanted
        );
      });
      if (index < 0) throw new NotFoundError(`Kanal "${streamerId}" ist nicht in der Playlist`);
      return this.startEntryLocked(playlist, index);
    });
  }

  /** Called by the supervisor whenever a non-playlist or playlist stream starts. */
  activate(state: PlaylistRunState | null): void {
    this.state = state;
    if (!state) {
      this.clearTimers();
      return;
    }
    this.advancePending = false;
    if (this.endAt === null) this.endAt = this.endTimestamp(state.playlist);
    this.scheduleEndLocked();
  }

  detach(): void {
    this.state = null;
    this.clearTimers();
  }

  scheduleAdvance(): void {
    if (!this.state || !this.state.playlist.auto_advance || this.held) return;
    if (this.advanceTimer) return;
    const delay = Math.max(0, this.state.playlist.advance_delay_seconds) * 1000;
    this.advancePending = true;
    this.deps.transition('reconnecting');
    this.deps.emitStatus();
    this.deps.logger.info(
      { playlist: this.state.playlist.id, delaySeconds: delay / 1000 },
      'Playlist wechselt zum nächsten Kanal',
    );
    this.advanceTimer = setTimeout(() => {
      this.advanceTimer = undefined;
      this.advancePending = false;
      this.deps.transition('starting');
      this.deps.emitStatus();
      void this.deps.lock.run(async () => {
        if (!this.state || this.deps.isShuttingDown()) return;
        incMetric('playlist_advances_total');
        try {
          await this.advanceLocked('offline');
        } catch (error) {
          this.deps.setLastError(toErrorMessage(error));
          this.deps.transition('error');
          this.deps.emitAll();
        }
      });
    }, delay);
  }

  /** Called by the supervisor when a local video reaches its end. */
  async advanceAfterFile(): Promise<StatusSnapshot | null> {
    return this.deps.lock.run(async () => {
      if (!this.state) return null;
      return this.advanceLocked('offline');
    });
  }

  clearTimers(): void {
    if (this.advanceTimer) clearTimeout(this.advanceTimer);
    if (this.endTimer) clearTimeout(this.endTimer);
    this.advanceTimer = undefined;
    this.endTimer = undefined;
    this.advancePending = false;
    this.endAt = null;
  }

  /** Keeps the run index pointing at the same entry after a live queue edit. */
  setIndex(index: number): void {
    if (!this.state) return;
    this.state = { ...this.state, index: Math.max(0, Math.trunc(index)) };
  }

  resolveChannel(channel: string): StreamerConfig {
    const existing = this.deps.store.findForChannel(channel);
    if (existing) return existing;
    const handle = channel.replace(/^@+/, '');
    const id = handle
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
    return StreamerSchema.parse({
      id: id || `channel-${Date.now()}`,
      name: handle,
      tiktok: handle,
      quality: 'best',
      enabled: true,
    });
  }

  private async startEntryLocked(
    playlist: PlaylistConfig,
    startIndex: number,
    seekSeconds?: number,
  ): Promise<StatusSnapshot> {
    const { channels } = playlist;
    if (channels.length === 0) throw new ValidationError('Die Playlist enthält keine Kanäle');
    let index = startIndex;
    let tried = 0;
    let lastError: string | null = null;
    while (tried < channels.length) {
      if (index >= channels.length) {
        if (playlist.wrap && tried > 0) {
          index = 0;
        } else {
          break;
        }
      }
      const channel = channels[index]!;
      if (channel === 'screen:pause' || channel === 'screen:startup') {
        const type = channel === 'screen:pause' ? 'pause' : 'startup';
        tried += 1;
        try {
          const status = await this.deps.startScreen(type);
          this.deps.onEntryStart?.(playlist.id, channel);
          this.activate({ playlist, index });
          this.deps.emitAll();
          return status;
        } catch (error) {
          lastError = toErrorMessage(error);
          this.deps.logger.warn(
            { playlist: playlist.id, screen: type, err: lastError },
            'Screen-Eintrag konnte nicht gestartet werden',
          );
          index += 1;
          continue;
        }
      }
      if (channel.startsWith('file:')) {
        const file = channel.slice('file:'.length).trim();
        const queueKey = playlist.id === QUEUE_PLAYLIST_ID ? this.deps.resolveQueueKey() : '';
        const key = resolveStreamKey(playlist).key || queueKey || resolveStreamKey({}).key;
        tried += 1;
        if (!file || !key) {
          index += 1;
          continue;
        }
        try {
          const status = await this.deps.startFile(file, {
            key,
            playlist: { playlist, index },
            seekSeconds: index === startIndex ? seekSeconds : undefined,
          });
          this.deps.onEntryStart?.(playlist.id, channel);
          return status;
        } catch (error) {
          lastError = toErrorMessage(error);
          this.deps.logger.warn(
            { playlist: playlist.id, file, err: lastError },
            'Lokales Playlist-Video konnte nicht gestartet werden',
          );
          index += 1;
          continue;
        }
      }
      const streamer = this.resolveChannel(channel);
      const playlistKey = resolveStreamKey(playlist).key;
      const streamerKey = resolveStreamKey(streamer).key;
      // Explicitly marked own streams keep their own YouTube key even inside
      // a playlist with a shared key.
      const key = streamer.own_stream && streamerKey ? streamerKey : playlistKey || streamerKey;
      tried += 1;
      if (!streamer.enabled || !key) {
        index += 1;
        continue;
      }
      try {
        const status = await this.deps.startStreamer(streamer, {
          key,
          playlist: { playlist, index },
        });
        this.deps.onEntryStart?.(playlist.id, channel);
        return status;
      } catch (error) {
        lastError = toErrorMessage(error);
        this.deps.logger.warn(
          { playlist: playlist.id, channel: streamer.id, err: lastError },
          'Playlist-Eintrag konnte nicht gestartet werden',
        );
        if (!(error instanceof StreamerOfflineError)) throw error;
        index += 1;
      }
    }
    await this.deps.stopAll();
    this.deps.setLastError(lastError ?? 'Kein Streamer der Playlist ist verfügbar');
    this.deps.transition('error');
    this.deps.emitAll();
    throw new StreamerOfflineError(lastError ?? 'Kein Streamer der Playlist ist verfügbar');
  }

  private async advanceLocked(reason: 'manual' | 'offline' | 'end_after'): Promise<StatusSnapshot> {
    const state = this.state;
    if (!state) throw new ValidationError('Es ist keine Playlist aktiv');
    // Automatic advances (offline/end) pause while the operator holds (#94).
    if (this.held && reason !== 'manual') {
      this.deps.logger.info(
        { playlist: state.playlist.id },
        'Playlist hält – kein automatischer Wechsel',
      );
      this.deps.emitStatus();
      return this.deps.buildStatus?.() ?? this.deps.stopAll();
    }
    const playlist = this.deps.resolvePlaylist(state.playlist.id) ?? state.playlist;
    if (reason === 'end_after') return this.deps.stopAll();
    if (this.advanceTimer) clearTimeout(this.advanceTimer);
    this.advanceTimer = undefined;
    this.advancePending = false;
    // Loop "one": restart the current entry instead of advancing.
    if (this.deps.repeatCurrent?.()) {
      return this.startEntryLocked(playlist, state.index);
    }
    const nextIndex = state.index + 1;
    if (nextIndex >= playlist.channels.length && !playlist.wrap) {
      this.deps.logger.info({ playlist: playlist.id }, 'Playlist beendet');
      return this.deps.stopAll();
    }
    return this.startEntryLocked(
      playlist,
      nextIndex >= playlist.channels.length ? 0 : nextIndex,
    );
  }

  /** Optional daily end time ("HH:MM") or duration after the playlist starts. */
  private endTimestamp(playlist: PlaylistConfig): number | null {
    const time = playlist.end_time?.trim();
    if (time) {
      const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time);
      if (match) {
        const target = new Date();
        target.setHours(Number(match[1]), Number(match[2]), 0, 0);
        if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1);
        return target.getTime();
      }
    }
    if (playlist.end_after_minutes && playlist.end_after_minutes > 0) {
      return Date.now() + playlist.end_after_minutes * 60_000;
    }
    return null;
  }

  private scheduleEndLocked(): void {
    if (this.endTimer) clearTimeout(this.endTimer);
    this.endTimer = undefined;
    if (!this.endAt) return;
    const delay = Math.max(0, this.endAt - Date.now());
    this.endTimer = setTimeout(() => {
      this.endTimer = undefined;
      void this.deps.lock.run(async () => {
        if (!this.state || this.deps.isShuttingDown()) return;
        this.deps.logger.info({ playlist: this.state.playlist.id }, 'Playlist-Endzeit erreicht');
        await this.deps.stopAll();
      });
    }, delay);
  }
}
