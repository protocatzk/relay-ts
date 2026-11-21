import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Logger } from 'pino';
import type { MediaConfig } from '../config/loader.js';
import type { RecordingSettings, Settings } from '../config/schema.js';
import type { MpegTsRelay } from '../relay/relay-server.js';
import { filesystemUsage } from '../diagnostics.js';
import { ensureDir } from '../../utils/fs.js';
import { ManagedProcess, runCommand } from '../../utils/process.js';
import { AppError, NotFoundError, ValidationError } from '../../utils/errors.js';
import {
  addRecordingMarker,
  readRecordingMarkers,
  type MarkerSource,
  type RecordingMarker,
} from './recording-markers.js';
import {
  ensureMediaThumbnail,
  mediaDirectory,
  probeMediaFile,
  safeMediaNameFromOriginal,
  type MediaFileWithMeta,
} from '../media/media-files.js';

export interface RecordingFileInfo {
  filename: string;
  size: number;
  modified_at: string;
  active: boolean;
  markers_count: number;
}

export interface RecordingStatus {
  enabled: boolean;
  active: boolean;
  filename: string | null;
  started_at: string | null;
  bytes: number;
  disk_warning: string | null;
  last_error: string | null;
}

export interface RecordingStorageSummary {
  total_bytes: number;
  file_count: number;
  max_total_mb: number;
  min_free_mb: number;
  disk_warning: string | null;
  filesystem: {
    total_bytes: number;
    free_bytes: number;
    available_bytes: number;
  } | null;
}

export interface ClipOptions {
  sourceFilename: string;
  startSeconds: number;
  endSeconds?: number;
  targetFilename?: string;
  toMedia?: boolean;
}

export interface ClipResult {
  filename: string;
  path: string;
  size: number;
  duration: number | null;
  to_media: boolean;
  media_file?: MediaFileWithMeta;
}

const MAX_STDIN_BACKLOG_BYTES = 8 * 1024 * 1024;

export function recordingsDirectory(dataDir: string): string {
  return join(dataDir, 'recordings');
}

export function isSafeRecordingFilename(filename: string): boolean {
  const name = basename(filename);
  if (name !== filename) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.mkv$/.test(name);
}

export function recordingFilePath(dataDir: string, filename: string): string | null {
  if (!isSafeRecordingFilename(filename)) return null;
  return join(recordingsDirectory(dataDir), filename);
}

export function listRecordings(dataDir: string, activeFilename: string | null = null): RecordingFileInfo[] {
  const dir = recordingsDirectory(dataDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => isSafeRecordingFilename(name))
    .map((filename) => {
      const stat = statSync(join(dir, filename));
      const markers = readRecordingMarkers(dataDir, filename);
      return {
        filename,
        size: stat.size,
        modified_at: new Date(stat.mtimeMs).toISOString(),
        active: filename === activeFilename,
        markers_count: markers.length,
      };
    })
    .sort((a, b) => Date.parse(b.modified_at) - Date.parse(a.modified_at));
}

export async function listRecordingsAsync(
  dataDir: string,
  activeFilename: string | null = null,
): Promise<RecordingFileInfo[]> {
  const dir = recordingsDirectory(dataDir);
  if (!existsSync(dir)) return [];
  try {
    const names = await readdir(dir);
    const safeNames = names.filter((name) => isSafeRecordingFilename(name));
    const files = await Promise.all(
      safeNames.map(async (filename) => {
        try {
          const s = await stat(join(dir, filename));
          const markers = readRecordingMarkers(dataDir, filename);
          return {
            filename,
            size: s.size,
            modified_at: new Date(s.mtimeMs).toISOString(),
            active: filename === activeFilename,
            markers_count: markers.length,
          };
        } catch {
          return null;
        }
      }),
    );
    return files
      .filter((file): file is RecordingFileInfo => file !== null)
      .sort((a, b) => Date.parse(b.modified_at) - Date.parse(a.modified_at));
  } catch {
    return [];
  }
}

export function evaluateRecordingStorage(
  dataDir: string,
  config: RecordingSettings,
  activeFilename: string | null = null,
): RecordingStorageSummary {
  const dir = recordingsDirectory(dataDir);
  ensureDir(dir);
  const files = listRecordings(dataDir, activeFilename);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const fs = filesystemUsage(dir);

  let warning: string | null = null;
  if (fs && config.min_free_mb > 0 && fs.available_bytes < config.min_free_mb * 1024 * 1024) {
    warning = `Wenig freier Speicherplatz (< ${config.min_free_mb} MB verfügbar)`;
  } else if (config.max_total_mb > 0 && totalBytes >= config.max_total_mb * 1024 * 1024) {
    warning = `Aufzeichnungs-Limit erreicht (${config.max_total_mb} MB)`;
  }

  return {
    total_bytes: totalBytes,
    file_count: files.length,
    max_total_mb: config.max_total_mb,
    min_free_mb: config.min_free_mb,
    disk_warning: warning,
    filesystem: fs,
  };
}

export async function evaluateRecordingStorageAsync(
  dataDir: string,
  config: RecordingSettings,
  activeFilename: string | null = null,
): Promise<RecordingStorageSummary> {
  const dir = recordingsDirectory(dataDir);
  ensureDir(dir);
  const files = await listRecordingsAsync(dataDir, activeFilename);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const fs = filesystemUsage(dir);

  let warning: string | null = null;
  if (fs && config.min_free_mb > 0 && fs.available_bytes < config.min_free_mb * 1024 * 1024) {
    warning = `Wenig freier Speicherplatz (< ${config.min_free_mb} MB verfügbar)`;
  } else if (config.max_total_mb > 0 && totalBytes >= config.max_total_mb * 1024 * 1024) {
    warning = `Aufzeichnungs-Limit erreicht (${config.max_total_mb} MB)`;
  }

  return {
    total_bytes: totalBytes,
    file_count: files.length,
    max_total_mb: config.max_total_mb,
    min_free_mb: config.min_free_mb,
    disk_warning: warning,
    filesystem: fs,
  };
}

/** Delete oldest inactive recordings until total size is below `max_total_mb`. */
export function enforceRecordingLimits(
  dataDir: string,
  config: RecordingSettings,
  activeFilename: string | null = null,
): string[] {
  if (!config.auto_delete || config.max_total_mb <= 0) return [];
  const limitBytes = config.max_total_mb * 1024 * 1024;
  const files = listRecordings(dataDir, activeFilename);
  let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes <= limitBytes) return [];

  // Oldest first
  const candidates = [...files].reverse().filter((file) => !file.active);
  const removed: string[] = [];
  for (const file of candidates) {
    if (totalBytes <= limitBytes) break;
    const full = recordingFilePath(dataDir, file.filename);
    if (!full || !existsSync(full)) continue;
    try {
      unlinkSync(full);
      totalBytes -= file.size;
      removed.push(file.filename);
    } catch {
      /* ignore */
    }
  }
  return removed;
}

export function buildRecordingArgs(media: MediaConfig, outputPath: string): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    media.ffmpegLogLevel,
    '-fflags',
    '+genpts+discardcorrupt',
    '-f',
    'mpegts',
    '-i',
    'pipe:0',
    '-map',
    '0:v:0?',
    '-map',
    '0:a:0?',
    '-c',
    'copy',
    '-f',
    'matroska',
    outputPath,
  ];
}

export interface RecordingControllerOptions {
  dataDir: string;
  media: MediaConfig;
  settings: Settings;
  relay: MpegTsRelay;
  logger: Logger;
}

/**
 * Fault-isolated MKV stream recorder (`-c copy`, no re-encode).
 * Writes to `data/recordings/<timestamp>-<label>.mkv` and enforces disk limits
 * so a full disk never disrupts live streaming.
 */
export class RecordingController {
  private readonly options: RecordingControllerOptions;
  private process?: ManagedProcess;
  private unsubscribe?: () => void;
  private diskTimer?: NodeJS.Timeout;
  private currentFilename: string | null = null;
  private startedAt: string | null = null;
  private lastError: string | null = null;
  private cachedStorageSummary: { storage: RecordingStorageSummary; expiresAt: number } | null = null;

  constructor(options: RecordingControllerOptions) {
    this.options = options;
  }

  updateSettings(settings: Settings): void {
    this.options.settings = settings;
    this.cachedStorageSummary = null;
  }

  get active(): boolean {
    return Boolean(this.process?.running && this.currentFilename);
  }

  get filename(): string | null {
    return this.currentFilename;
  }

  start(label = 'stream'): void {
    const cfg = this.options.settings.recording;
    if (!cfg.enabled) return;
    if (this.process?.running) return;

    const dir = recordingsDirectory(this.options.dataDir);
    ensureDir(dir);
    enforceRecordingLimits(this.options.dataDir, cfg, null);
    const storage = evaluateRecordingStorage(this.options.dataDir, cfg, null);
    if (storage.disk_warning) {
      this.lastError = storage.disk_warning;
      this.options.logger.warn({ warning: storage.disk_warning }, 'Aufzeichnung übersprungen (Speicherlimit)');
      return;
    }

    const safeLabel =
      label
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'stream';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${stamp}-${safeLabel}.mkv`;
    const outputPath = join(dir, filename);

    this.lastError = null;
    this.currentFilename = filename;
    this.startedAt = new Date().toISOString();

    const proc = new ManagedProcess({
      name: 'recording-mkv',
      command: this.options.media.ffmpegBin,
      args: buildRecordingArgs(this.options.media, outputPath),
      logger: this.options.logger,
      stdinMode: 'pipe',
      onLine: (line, stream) => {
        if (stream === 'stderr' && line.toLowerCase().includes('error')) {
          this.lastError = line;
        }
      },
      onExit: () => {
        this.detach();
        if (this.process === proc) {
          this.process = undefined;
          this.currentFilename = null;
          this.startedAt = null;
        }
      },
    });
    this.process = proc;
    proc.start();

    const stdin = proc.stdin;
    if (stdin) {
      stdin.on('error', () => {
        /* ignore EPIPE */
      });
      this.unsubscribe = this.options.relay.subscribe((chunk) => {
        if (!stdin.writable || stdin.destroyed) return;
        if (stdin.writableLength > MAX_STDIN_BACKLOG_BYTES) return;
        try {
          stdin.write(chunk);
        } catch {
          /* never disrupt relay */
        }
      });
    }

    this.diskTimer = setInterval(() => {
      const check = evaluateRecordingStorage(
        this.options.dataDir,
        this.options.settings.recording,
        this.currentFilename,
      );
      if (check.disk_warning) {
        enforceRecordingLimits(
          this.options.dataDir,
          this.options.settings.recording,
          this.currentFilename,
        );
        const recheck = evaluateRecordingStorage(
          this.options.dataDir,
          this.options.settings.recording,
          this.currentFilename,
        );
        if (recheck.disk_warning) {
          this.lastError = recheck.disk_warning;
          this.options.logger.warn(
            { warning: recheck.disk_warning },
            'Aufzeichnung wegen Speicherlimit gestoppt',
          );
          void this.stop();
        }
      }
    }, 30_000);
    this.diskTimer.unref?.();
    this.cachedStorageSummary = null;
    this.options.logger.info({ filename }, 'MKV-Aufzeichnung gestartet');
  }

  async stop(): Promise<void> {
    this.detach();
    this.cachedStorageSummary = null;
    const proc = this.process;
    const filename = this.currentFilename;
    this.process = undefined;
    this.currentFilename = null;
    this.startedAt = null;
    if (proc) {
      try {
        proc.stdin?.end();
      } catch {
        /* ignore */
      }
      await proc.stop();
      if (filename) this.options.logger.info({ filename }, 'MKV-Aufzeichnung beendet');
    }
  }

  async syncWithSettings(sessionActive: boolean, label = 'stream'): Promise<void> {
    if (!sessionActive || !this.options.settings.recording.enabled) {
      await this.stop();
      return;
    }
    if (!this.active) this.start(label);
  }

  status(): RecordingStatus {
    const cfg = this.options.settings.recording;
    let bytes = 0;
    if (this.currentFilename) {
      const path = recordingFilePath(this.options.dataDir, this.currentFilename);
      if (path && existsSync(path)) {
        try {
          bytes = statSync(path).size;
        } catch {
          bytes = 0;
        }
      }
    }
    const now = Date.now();
    let storage: RecordingStorageSummary;
    if (this.cachedStorageSummary && this.cachedStorageSummary.expiresAt > now) {
      storage = this.cachedStorageSummary.storage;
    } else {
      storage = evaluateRecordingStorage(this.options.dataDir, cfg, this.currentFilename);
      this.cachedStorageSummary = { storage, expiresAt: now + 15_000 };
    }
    return {
      enabled: cfg.enabled,
      active: this.active,
      filename: this.currentFilename,
      started_at: this.startedAt,
      bytes,
      disk_warning: storage.disk_warning,
      last_error: this.lastError,
    };
  }

  private detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.diskTimer) clearInterval(this.diskTimer);
    this.diskTimer = undefined;
  }

  addMarker(input: { label?: string; source?: MarkerSource }): RecordingMarker | null {
    if (!this.active || !this.currentFilename || !this.startedAt) return null;
    const offset = Math.max(0, (Date.now() - Date.parse(this.startedAt)) / 1000);
    const marker = addRecordingMarker(this.options.dataDir, this.currentFilename, {
      offset_seconds: offset,
      label: input.label,
      source: input.source,
    });
    this.options.logger.info(
      { filename: this.currentFilename, markerId: marker.id, label: marker.label, offset },
      'Aufzeichnungs-Marker gesetzt',
    );
    return marker;
  }

  async createClip(options: ClipOptions): Promise<ClipResult> {
    return remuxRecordingClip({
      ffmpegBin: this.options.media.ffmpegBin,
      dataDir: this.options.dataDir,
      logger: this.options.logger,
      ...options,
    });
  }
}

export async function remuxRecordingClip(options: {
  ffmpegBin: string;
  dataDir: string;
  sourceFilename: string;
  startSeconds: number;
  endSeconds?: number;
  targetFilename?: string;
  toMedia?: boolean;
  logger?: Logger;
}): Promise<ClipResult> {
  const sourcePath = recordingFilePath(options.dataDir, options.sourceFilename);
  if (!sourcePath || !existsSync(sourcePath)) {
    throw new NotFoundError(`Aufzeichnung „${options.sourceFilename}“ nicht gefunden`);
  }

  const start = Math.max(0, options.startSeconds);
  let duration: number | undefined;
  if (options.endSeconds !== undefined) {
    if (options.endSeconds <= start) {
      throw new ValidationError('Endzeitpunkt muss nach dem Startzeitpunkt liegen');
    }
    duration = options.endSeconds - start;
  }

  const toMedia = Boolean(options.toMedia);
  const outDir = toMedia
    ? mediaDirectory(options.dataDir)
    : recordingsDirectory(options.dataDir);
  ensureDir(outDir);

  if (options.targetFilename) {
    if (
      options.targetFilename.includes('/') ||
      options.targetFilename.includes('\\') ||
      options.targetFilename.includes('..')
    ) {
      throw new ValidationError('Ungültiger Name für den Clip (keine Pfadtrennzeichen oder .. erlaubt)');
    }
  }

  let targetName = (options.targetFilename ?? '').trim();
  if (targetName) {
    targetName = basename(targetName);
    if (!/\.(mp4|mkv)$/i.test(targetName)) {
      targetName = `${targetName}.mp4`;
    }
  } else {
    const base = options.sourceFilename.replace(/\.mkv$/i, '');
    const endPart = options.endSeconds !== undefined ? `-${Math.round(options.endSeconds)}s` : '';
    targetName = `clip-${base}-${Math.round(start)}s${endPart}.mp4`;
  }

  const sanitized =
    safeMediaNameFromOriginal(targetName) ??
    targetName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  if (!/^[a-z0-9][a-z0-9._-]*\.(mp4|mkv)$/i.test(sanitized)) {
    throw new ValidationError('Ungültiger Name für den Clip');
  }

  let finalName = sanitized;
  let counter = 2;
  while (existsSync(join(outDir, finalName))) {
    const dot = sanitized.lastIndexOf('.');
    const ext = dot >= 0 ? sanitized.slice(dot) : '.mp4';
    const raw = dot >= 0 ? sanitized.slice(0, dot) : sanitized;
    finalName = `${raw}-${counter}${ext}`;
    counter += 1;
  }

  const outputPath = join(outDir, finalName);
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    start.toFixed(3),
    ...(duration !== undefined ? ['-t', duration.toFixed(3)] : []),
    '-i',
    sourcePath,
    '-c',
    'copy',
    '-avoid_negative_ts',
    'make_zero',
    outputPath,
  ];

  options.logger?.info(
    { source: options.sourceFilename, target: finalName, start, duration },
    'Clip-Remux gestartet',
  );
  const res = await runCommand(options.ffmpegBin, args, { timeoutMs: 120_000 });
  if (res.code !== 0 || !existsSync(outputPath)) {
    throw new AppError(
      'clip_failed',
      `FFmpeg-Remux fehlgeschlagen: ${res.stderr || 'Unbekannter Fehler'}`,
    );
  }

  const stat = statSync(outputPath);
  let mediaFile: MediaFileWithMeta | undefined;
  let probedDuration: number | null = duration ?? null;

  if (toMedia) {
    try {
      const probe = await probeMediaFile(options.ffmpegBin, outputPath);
      if (probe.duration) probedDuration = probe.duration;
      await ensureMediaThumbnail(options.dataDir, options.ffmpegBin, finalName);
      mediaFile = {
        filename: finalName,
        path: outputPath,
        size: stat.size,
        modified_at: new Date(stat.mtimeMs).toISOString(),
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        is_h264: probe.isH264,
        codec: probe.codec,
        thumbnail_url: `/api/media/${encodeURIComponent(finalName)}/thumbnail`,
      };
    } catch {
      /* ignore thumbnail/probe errors */
    }
  }

  return {
    filename: finalName,
    path: outputPath,
    size: stat.size,
    duration: probedDuration,
    to_media: toMedia,
    ...(mediaFile ? { media_file: mediaFile } : {}),
  };
}
