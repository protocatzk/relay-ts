import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Logger } from 'pino';
import type { MediaConfig } from '../config/loader.js';
import type { RecordingSettings, Settings } from '../config/schema.js';
import type { MpegTsRelay } from '../relay/relay-server.js';
import { filesystemUsage } from '../diagnostics.js';
import { ensureDir } from '../../utils/fs.js';
import { ManagedProcess } from '../../utils/process.js';

export interface RecordingFileInfo {
  filename: string;
  size: number;
  modified_at: string;
  active: boolean;
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
      return {
        filename,
        size: stat.size,
        modified_at: new Date(stat.mtimeMs).toISOString(),
        active: filename === activeFilename,
      };
    })
    .sort((a, b) => Date.parse(b.modified_at) - Date.parse(a.modified_at));
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

  constructor(options: RecordingControllerOptions) {
    this.options = options;
  }

  updateSettings(settings: Settings): void {
    this.options.settings = settings;
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
    this.options.logger.info({ filename }, 'MKV-Aufzeichnung gestartet');
  }

  async stop(): Promise<void> {
    this.detach();
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
    const storage = evaluateRecordingStorage(this.options.dataDir, cfg, this.currentFilename);
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
}
