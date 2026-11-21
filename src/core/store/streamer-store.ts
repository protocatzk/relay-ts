import { statSync } from 'node:fs';
import type { Logger } from 'pino';
import {
  PlaylistSchema,
  PlaylistUpdateSchema,
  StreamerSchema,
  StreamerUpdateSchema,
  formatZodError,
  resolveStreamKey,
  type PlaylistConfig,
  type StreamerConfig,
} from '../config/schema.js';
import { ConfigError, ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { readYamlFile, writeYamlFile } from '../../utils/fs.js';
import { deepMerge } from '../../utils/format.js';

interface StreamersDocument {
  streamers: StreamerConfig[];
  playlists: PlaylistConfig[];
  settings?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

export interface StreamerView {
  id: string;
  name: string;
  tiktok: string;
  quality: StreamerConfig['quality'];
  auto_start: boolean;
  preferred: boolean;
  priority: number;
  enabled: boolean;
  own_stream: boolean;
  video_mode: StreamerConfig['video_mode'];
  youtube_key_set: boolean;
  youtube_key_source: 'streamer' | 'env' | 'none';
  status: { online: boolean | null; active: boolean };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function stripLegacyOverlays<T extends object>(value: T): T {
  const copy = { ...value } as Record<string, unknown>;
  delete copy.overlays;
  return copy as T;
}

export class StreamerStore {
  private readonly path: string;
  private readonly logger: Logger;
  private doc: StreamersDocument;
  private mtimeMs = 0;

  constructor(path: string, initial: { streamers: StreamerConfig[]; playlists: PlaylistConfig[] }, logger: Logger) {
    this.path = path;
    this.logger = logger;
    const legacy = initial.streamers.some((streamer) => 'overlays' in streamer);
    this.doc = {
      streamers: initial.streamers.map((streamer) => stripLegacyOverlays(streamer)),
      playlists: clone(initial.playlists),
    };
    this.rememberMtime();
    if (legacy) {
      this.logger.warn(
        'Per-Streamer-Overlays sind veraltet und werden ignoriert; die globale Overlay-Konfiguration gilt.',
      );
      this.persist();
    }
  }

  private rememberMtime(): void {
    try {
      this.mtimeMs = statSync(this.path).mtimeMs;
    } catch {
      this.mtimeMs = 0;
    }
  }

  /** Force a reload from disk (e.g. after a backup restore). */
  reload(): boolean {
    this.mtimeMs = 0;
    return this.reloadIfChanged();
  }

  /** Pick up manual YAML edits without restarting the service. */
  reloadIfChanged(): boolean {
    try {
      const mtime = statSync(this.path).mtimeMs;
      if (mtime === this.mtimeMs) return false;
      const raw = (readYamlFile(this.path) ?? {}) as Record<string, unknown>;
      const streamers = Array.isArray(raw.streamers)
        ? raw.streamers.map((item) => stripLegacyOverlays(StreamerSchema.parse(item)))
        : [];
      const playlists = Array.isArray(raw.playlists)
        ? raw.playlists.map((item) => PlaylistSchema.parse(item))
        : [];
      this.doc = {
        streamers,
        playlists,
        settings: (raw.settings as Record<string, unknown> | undefined) ?? undefined,
        extra: Object.fromEntries(
          Object.entries(raw).filter(([key]) => !['streamers', 'playlists', 'settings'].includes(key)),
        ),
      };
      this.mtimeMs = mtime;
      this.logger.info({ streamers: streamers.length, playlists: playlists.length }, 'Konfiguration neu geladen');
      return true;
    } catch (error) {
      this.logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'Konfiguration konnte nicht neu geladen werden',
      );
      return false;
    }
  }

  list(): StreamerConfig[] {
    this.reloadIfChanged();
    return clone(this.doc.streamers);
  }

  get(id: string): StreamerConfig | undefined {
    this.reloadIfChanged();
    const streamer = this.doc.streamers.find((item) => item.id === id);
    return streamer ? clone(streamer) : undefined;
  }

  require(id: string): StreamerConfig {
    const streamer = this.get(id);
    if (!streamer) throw new NotFoundError(`Streamer "${id}" wurde nicht gefunden`);
    return streamer;
  }

  playlists(): PlaylistConfig[] {
    this.reloadIfChanged();
    return clone(this.doc.playlists);
  }

  playlist(id: string): PlaylistConfig | undefined {
    return this.playlists().find((item) => item.id === id);
  }

  createPlaylist(input: unknown): PlaylistConfig {
    this.reloadIfChanged();
    const parsed = PlaylistSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(`Ungültige Playlist: ${formatZodError(parsed.error)}`, parsed.error.issues);
    }
    const playlist = parsed.data;
    if (this.doc.playlists.some((item) => item.id === playlist.id)) {
      throw new ConflictError(`Playlist-ID "${playlist.id}" ist bereits vergeben`);
    }
    this.doc.playlists.push(playlist);
    this.persist();
    return clone(playlist);
  }

  updatePlaylist(id: string, patch: unknown): PlaylistConfig {
    this.reloadIfChanged();
    const index = this.doc.playlists.findIndex((item) => item.id === id);
    if (index < 0) throw new NotFoundError(`Playlist "${id}" wurde nicht gefunden`);
    const current = this.doc.playlists[index]!;
    if (patch && typeof patch === 'object' && 'id' in patch && (patch as { id?: unknown }).id !== undefined) {
      throw new ValidationError('Die Playlist-ID kann nicht geändert werden');
    }
    const parsedPatch = PlaylistUpdateSchema.safeParse(patch ?? {});
    if (!parsedPatch.success) {
      throw new ValidationError(
        `Ungültige Playlist-Daten: ${formatZodError(parsedPatch.error)}`,
        parsedPatch.error.issues,
      );
    }
    const merged = deepMerge(clone(current), parsedPatch.data);
    if (
      parsedPatch.data &&
      typeof parsedPatch.data === 'object' &&
      'end_after_minutes' in parsedPatch.data &&
      parsedPatch.data.end_after_minutes === null
    ) {
      merged.end_after_minutes = null;
    }
    if (
      parsedPatch.data &&
      typeof parsedPatch.data === 'object' &&
      'end_time' in parsedPatch.data &&
      parsedPatch.data.end_time === null
    ) {
      merged.end_time = null;
    }
    const parsed = PlaylistSchema.safeParse(merged);
    if (!parsed.success) {
      throw new ValidationError(`Ungültige Playlist: ${formatZodError(parsed.error)}`, parsed.error.issues);
    }
    this.doc.playlists[index] = parsed.data;
    this.persist();
    return clone(parsed.data);
  }

  removePlaylist(id: string): void {
    this.reloadIfChanged();
    const before = this.doc.playlists.length;
    this.doc.playlists = this.doc.playlists.filter((item) => item.id !== id);
    if (this.doc.playlists.length === before) {
      throw new NotFoundError(`Playlist "${id}" wurde nicht gefunden`);
    }
    this.persist();
  }

  create(input: unknown): StreamerConfig {
    this.reloadIfChanged();
    const parsed = StreamerSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(`Ungültiger Streamer: ${formatZodError(parsed.error)}`, parsed.error.issues);
    }
    const streamer = parsed.data;
    if (this.doc.streamers.some((item) => item.id === streamer.id)) {
      throw new ConflictError(`Streamer-ID "${streamer.id}" ist bereits vergeben`);
    }
    this.doc.streamers.push(streamer);
    this.persist();
    return clone(streamer);
  }

  update(id: string, patch: unknown): StreamerConfig {
    this.reloadIfChanged();
    const index = this.doc.streamers.findIndex((item) => item.id === id);
    if (index < 0) throw new NotFoundError(`Streamer "${id}" wurde nicht gefunden`);
    const current = this.doc.streamers[index]!;
    if (patch && typeof patch === 'object' && 'id' in patch && (patch as { id?: unknown }).id !== undefined) {
      throw new ValidationError('Die Streamer-ID kann nicht geändert werden');
    }
    const parsedPatch = StreamerUpdateSchema.safeParse(patch ?? {});
    if (!parsedPatch.success) {
      throw new ValidationError(
        `Ungültige Streamer-Daten: ${formatZodError(parsedPatch.error)}`,
        parsedPatch.error.issues,
      );
    }
    const merged = deepMerge(clone(current), parsedPatch.data);
    const parsed = StreamerSchema.safeParse(merged);
    if (!parsed.success) {
      throw new ValidationError(`Ungültiger Streamer: ${formatZodError(parsed.error)}`, parsed.error.issues);
    }
    this.doc.streamers[index] = parsed.data;
    this.persist();
    return clone(parsed.data);
  }

  remove(id: string): void {
    this.reloadIfChanged();
    const before = this.doc.streamers.length;
    this.doc.streamers = this.doc.streamers.filter((item) => item.id !== id);
    if (this.doc.streamers.length === before) {
      throw new NotFoundError(`Streamer "${id}" wurde nicht gefunden`);
    }
    this.persist();
  }

  findForChannel(channel: string): StreamerConfig | undefined {
    const normalized = channel.replace(/^@+/, '').toLowerCase();
    const list = this.list();
    return (
      list.find((item) => item.id.toLowerCase() === normalized) ??
      list.find((item) => item.tiktok.replace(/^@+/, '').toLowerCase() === normalized) ??
      list.find(
        (item) =>
          item.name.replace(/^@+/, '').toLowerCase() === normalized ||
          item.tiktok.toLowerCase().includes(normalized),
      )
    );
  }

  view(streamer: StreamerConfig, activeId: string | null = null, online: boolean | null = null): StreamerView {
    const key = resolveStreamKey(streamer);
    return {
      id: streamer.id,
      name: streamer.name,
      tiktok: streamer.tiktok,
      quality: streamer.quality,
      auto_start: streamer.auto_start,
      preferred: streamer.preferred,
      priority: streamer.priority,
      enabled: streamer.enabled,
      own_stream: streamer.own_stream,
      video_mode: streamer.video_mode,
      youtube_key_set: key.source !== 'none',
      youtube_key_source: key.source,
      status: {
        online,
        active: activeId === streamer.id,
      },
    };
  }

  private persist(): void {
    const document: Record<string, unknown> = {
      ...(this.doc.extra ?? {}),
      streamers: this.doc.streamers.map((streamer) => stripLegacyOverlays(streamer)),
      playlists: this.doc.playlists,
    };
    if (this.doc.settings && Object.keys(this.doc.settings).length > 0) {
      document.settings = this.doc.settings;
    }
    try {
      writeYamlFile(this.path, document);
      this.rememberMtime();
    } catch (error) {
      throw new ConfigError(
        `Konfiguration konnte nicht gespeichert werden: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
