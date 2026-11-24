import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Logger } from 'pino';
import type { PlaylistConfig } from '../config/schema.js';
import type { QueueEntryKind, QueueSnapshot } from '../events.js';
import { mediaFilePath } from '../media/media-files.js';
import type { StreamerStore } from '../store/streamer-store.js';
import { readJsonFile, writeJsonFile } from '../../utils/fs.js';
import { ValidationError } from '../../utils/errors.js';

/** Reserved synthetic playlist id. Starts with `_`, so it cannot collide with
 * a user-created playlist (those must start with a-z0-9). */
export const QUEUE_PLAYLIST_ID = '__regie__';

const MAX_QUEUE_ENTRIES = 200;
const MAX_HISTORY = 20;
const QUEUE_FILE_VERSION = 3;

export interface QueueEntry {
  id: string;
  channel: string;
  duration_seconds?: number | null;
}

/** Last known position of the active queue video, used to resume after restarts. */
export interface QueuePlayback {
  channel: string;
  position_seconds: number;
  duration_seconds: number;
  updated_at: string;
}

type QueueLoopMode = 'off' | 'all' | 'one';

export interface QueueHistoryEntry {
  channel: string;
  label: string;
  played_at: string;
}

interface QueueFile {
  version: number;
  entries: QueueEntry[];
  playback: QueuePlayback | null;
  /** Legacy boolean from version 2; migrated into `loop_mode` on load. */
  loop?: boolean;
  loop_mode?: QueueLoopMode;
  history?: QueueHistoryEntry[];
}

export interface QueueControllerDeps {
  path: string | null;
  dataDir: string;
  store: StreamerStore;
  logger: Logger;
}

/**
 * Persistent, live-editable queue behind the dashboard "Regie" panel. It stores
 * playlist-compatible channel strings (`file:…`, a streamer id, `screen:pause`
 * or `screen:startup`) and is fed to the PlaylistController as a synthetic
 * playlist.
 */
export class QueueController {
  private readonly deps: QueueControllerDeps;
  private entries: QueueEntry[] = [];
  private playback: QueuePlayback | null = null;
  private loopMode: QueueLoopMode = 'off';
  private historyEntries: QueueHistoryEntry[] = [];
  private loaded = false;

  constructor(deps: QueueControllerDeps) {
    this.deps = deps;
  }

  get(): QueueEntry[] {
    this.load();
    return [...this.entries];
  }

  isLoop(): boolean {
    return this.loopModeValue() === 'all';
  }

  loopModeValue(): QueueLoopMode {
    this.load();
    return this.loopMode;
  }

  /** Legacy boolean API: keeps `setLoop(true)` as "loop all" (#94). */
  setLoop(enabled: boolean): void {
    this.setLoopMode(enabled ? 'all' : 'off');
  }

  setLoopMode(mode: QueueLoopMode): void {
    this.load();
    this.loopMode = mode === 'one' ? 'one' : mode === 'all' ? 'all' : 'off';
    this.persist();
  }

  channels(): string[] {
    return this.get().map((entry) => entry.channel);
  }

  /** Synthetic playlist consumed by the existing PlaylistController. */
  playlist(): PlaylistConfig {
    return {
      id: QUEUE_PLAYLIST_ID,
      name: 'Regie-Queue',
      channels: this.channels(),
      auto_advance: true,
      wrap: this.isLoop(),
      advance_delay_seconds: 5,
    };
  }

  snapshot(playing: boolean, index: number | null): QueueSnapshot {
    return {
      entries: this.get().map((entry) => ({
        id: entry.id,
        channel: entry.channel,
        kind: kindOf(entry.channel),
        label: this.labelOf(entry.channel),
        duration_seconds: entry.duration_seconds ?? null,
      })),
      playing,
      index,
      loop: this.isLoop(),
      loop_mode: this.loopModeValue(),
    };
  }

  add(channel: string, durationSeconds?: number | null): QueueEntry {
    this.load();
    if (this.entries.length >= MAX_QUEUE_ENTRIES) {
      throw new ValidationError(`Die Regie-Queue ist auf ${MAX_QUEUE_ENTRIES} Einträge begrenzt`);
    }
    const entry: QueueEntry = {
      id: randomUUID(),
      channel: this.normalize(channel),
      ...(normalizeDuration(durationSeconds) !== null
        ? { duration_seconds: normalizeDuration(durationSeconds) }
        : {}),
    };
    this.entries.push(entry);
    this.persist();
    return entry;
  }

  insertAt(channel: string, index: number, durationSeconds?: number | null): QueueEntry {
    this.load();
    if (this.entries.length >= MAX_QUEUE_ENTRIES) {
      throw new ValidationError(`Die Regie-Queue ist auf ${MAX_QUEUE_ENTRIES} Einträge begrenzt`);
    }
    const entry: QueueEntry = {
      id: randomUUID(),
      channel: this.normalize(channel),
      ...(normalizeDuration(durationSeconds) !== null
        ? { duration_seconds: normalizeDuration(durationSeconds) }
        : {}),
    };
    const target = Math.max(0, Math.min(this.entries.length, Math.trunc(index)));
    this.entries.splice(target, 0, entry);
    this.persist();
    return entry;
  }

  updateEntry(id: string, patch: { duration_seconds?: number | null }): boolean {
    this.load();
    const entry = this.entries.find((item) => item.id === id);
    if (!entry) return false;
    if ('duration_seconds' in patch) {
      const normalized = normalizeDuration(patch.duration_seconds);
      if (normalized === null) delete entry.duration_seconds;
      else entry.duration_seconds = normalized;
    }
    this.persist();
    return true;
  }

  duplicate(id: string): QueueEntry | null {
    this.load();
    if (this.entries.length >= MAX_QUEUE_ENTRIES) {
      throw new ValidationError(`Die Regie-Queue ist auf ${MAX_QUEUE_ENTRIES} Einträge begrenzt`);
    }
    const index = this.entries.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const source = this.entries[index]!;
    const copy: QueueEntry = {
      id: randomUUID(),
      channel: source.channel,
      ...(source.duration_seconds !== undefined ? { duration_seconds: source.duration_seconds } : {}),
    };
    this.entries.splice(index + 1, 0, copy);
    this.persist();
    return copy;
  }

  remove(id: string): boolean {
    this.load();
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index < 0) return false;
    this.entries.splice(index, 1);
    this.persist();
    return true;
  }

  move(id: string, to: number): boolean {
    this.load();
    const from = this.entries.findIndex((entry) => entry.id === id);
    if (from < 0) return false;
    const target = Math.max(0, Math.min(this.entries.length - 1, Math.trunc(to)));
    if (from === target) return true;
    const [entry] = this.entries.splice(from, 1);
    this.entries.splice(target, 0, entry!);
    this.persist();
    return true;
  }

  /** Last played entries, newest first (#94). */
  history(): QueueHistoryEntry[] {
    this.load();
    return [...this.historyEntries];
  }

  /** Records a started entry; duplicates in a row are collapsed. */
  recordHistory(channel: string): void {
    this.load();
    const label = this.labelOf(channel);
    const last = this.historyEntries[0];
    if (last && last.channel === channel) return;
    this.historyEntries = [
      { channel, label, played_at: new Date().toISOString() },
      ...this.historyEntries,
    ].slice(0, MAX_HISTORY);
    this.persist();
  }

  /** Replaces the whole queue; used by "Playlist in die Queue laden" (#94). */
  replaceAll(channels: string[]): void {
    this.load();
    this.entries = channels
      .map((channel) => channel.trim())
      .filter((channel) => channel.length > 0)
      .slice(0, MAX_QUEUE_ENTRIES)
      .map((channel) => ({ id: randomUUID(), channel }));
    this.playback = null;
    this.persist();
  }

  /** Appends channels without touching the running entry (#94). */
  appendMany(channels: string[]): void {
    this.load();
    const room = MAX_QUEUE_ENTRIES - this.entries.length;
    if (room <= 0) {
      throw new ValidationError(`Die Regie-Queue ist auf ${MAX_QUEUE_ENTRIES} Einträge begrenzt`);
    }
    const next = channels
      .map((channel) => channel.trim())
      .filter((channel) => channel.length > 0)
      .slice(0, room)
      .map((channel) => ({ id: randomUUID(), channel }));
    this.entries.push(...next);
    this.persist();
  }

  clear(): void {
    this.load();
    this.entries = [];
    this.playback = null;
    this.persist();
  }

  getPlayback(): QueuePlayback | null {
    this.load();
    return this.playback ? { ...this.playback } : null;
  }

  setPlayback(playback: QueuePlayback | null): void {
    this.load();
    if (!playback && !this.playback) return;
    if (
      playback &&
      this.playback &&
      playback.channel === this.playback.channel &&
      playback.duration_seconds === this.playback.duration_seconds &&
      Math.abs(playback.position_seconds - this.playback.position_seconds) < 2
    ) {
      return;
    }
    this.playback = playback;
    this.persist();
  }

  clearPlayback(): void {
    this.load();
    if (!this.playback) return;
    this.playback = null;
    this.persist();
  }

  entryIdAt(index: number): string | null {
    return this.get()[index]?.id ?? null;
  }

  indexOfId(id: string): number {
    return this.get().findIndex((entry) => entry.id === id);
  }

  private normalize(channel: string): string {
    const value = channel.trim();
    if (!value) throw new ValidationError('Kanal darf nicht leer sein');
    if (value.startsWith('file:')) {
      const file = value.slice('file:'.length).trim();
      const path = mediaFilePath(this.deps.dataDir, file);
      if (!path || !existsSync(path)) {
        throw new ValidationError(`Lokales Video "${file}" wurde nicht gefunden`);
      }
      return `file:${file}`;
    }
    if (value === 'screen:pause' || value === 'screen:startup') return value;
    const streamer = this.deps.store.findForChannel(value);
    if (!streamer) throw new ValidationError(`Streamer "${value}" wurde nicht gefunden`);
    return streamer.id;
  }

  private labelOf(channel: string): string {
    if (channel.startsWith('file:')) return channel.slice('file:'.length);
    if (channel === 'screen:pause') return 'Pausenscreen';
    if (channel === 'screen:startup') return 'Startbildschirm';
    return this.deps.store.findForChannel(channel)?.name ?? channel;
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.deps.path) return;
    const raw = readJsonFile<QueueFile | null>(this.deps.path, null);
    if (!raw || !Array.isArray(raw.entries)) return;
    // Version 2 is still accepted so the loop boolean can be migrated (#94).
    if (raw.version !== 1 && raw.version !== 2 && raw.version !== QUEUE_FILE_VERSION) return;
    this.entries = raw.entries
      .filter(
        (entry): entry is QueueEntry =>
          Boolean(entry) &&
          typeof entry.id === 'string' &&
          typeof entry.channel === 'string' &&
          entry.channel.trim().length > 0,
      )
      .slice(0, MAX_QUEUE_ENTRIES)
      .map((entry) => {
        const duration = normalizeDuration(entry.duration_seconds);
        return duration !== null
          ? { id: entry.id, channel: entry.channel, duration_seconds: duration }
          : { id: entry.id, channel: entry.channel };
      });
    // Migration: version 2 stored a boolean, version 3 stores the mode.
    this.loopMode =
      raw.loop_mode === 'all' || raw.loop_mode === 'one'
        ? raw.loop_mode
        : raw.loop === true
          ? 'all'
          : 'off';
    this.historyEntries = Array.isArray(raw.history)
      ? raw.history
          .filter(
            (entry): entry is QueueHistoryEntry =>
              Boolean(entry) &&
              typeof entry.channel === 'string' &&
              typeof entry.label === 'string' &&
              typeof entry.played_at === 'string',
          )
          .slice(0, MAX_HISTORY)
      : [];
    const playback = (raw as { playback?: QueuePlayback | null }).playback;
    if (
      playback &&
      typeof playback.channel === 'string' &&
      Number.isFinite(playback.position_seconds)
    ) {
      this.playback = {
        channel: playback.channel,
        position_seconds: Math.max(0, playback.position_seconds),
        duration_seconds:
          Number.isFinite(playback.duration_seconds) && playback.duration_seconds > 0
            ? playback.duration_seconds
            : 0,
        updated_at:
          typeof playback.updated_at === 'string'
            ? playback.updated_at
            : new Date().toISOString(),
      };
    }
  }

  private persist(): void {
    if (!this.deps.path) return;
    try {
      writeJsonFile(this.deps.path, {
        version: QUEUE_FILE_VERSION,
        entries: this.entries,
        playback: this.playback,
        loop_mode: this.loopMode,
        history: this.historyEntries,
      } satisfies QueueFile);
    } catch (error) {
      this.deps.logger.warn(
        { err: (error as Error).message },
        'Regie-Queue konnte nicht gespeichert werden',
      );
    }
  }
}

function kindOf(channel: string): QueueEntryKind {
  if (channel.startsWith('file:')) return 'file';
  if (channel.startsWith('screen:')) return 'screen';
  return 'streamer';
}

function normalizeDuration(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(86_400, Math.round(value));
}
