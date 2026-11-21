import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { LoadedConfig } from './config/loader.js';
import { availableVideoEncoders, currentVideoEncoder, type VideoEncoder } from './media/encoders.js';
import { metricsSnapshot, type MetricsSnapshot } from './metrics.js';
import type { LogEntry, LogRing } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

export interface DirectoryStorageStats {
  exists: boolean;
  bytes: number;
  files: number;
}

export interface FilesystemStorageStats {
  total_bytes: number;
  free_bytes: number;
  available_bytes: number;
}

export interface DiagnosticsSnapshot {
  collected_at: string;
  version: string;
  node_version: string;
  platform: string;
  pid: number;
  uptime_seconds: number;
  memory: {
    rss_bytes: number;
    heap_used_bytes: number;
    heap_total_bytes: number;
  };
  tools: {
    ffmpeg: string | null;
    ytdlp: string | null;
  };
  encoder: {
    active: VideoEncoder;
    available: VideoEncoder[];
  };
  ports: {
    http: number;
    relay_host: string;
    relay: number;
    playback: number;
  };
  storage: {
    media: DirectoryStorageStats;
    logs: DirectoryStorageStats;
    backups: DirectoryStorageStats;
    data: DirectoryStorageStats;
    filesystem: FilesystemStorageStats | null;
  };
  metrics: MetricsSnapshot;
  recent_errors: LogEntry[];
}

interface ToolVersionCache {
  key: string;
  expiresAt: number;
  ffmpeg: string | null;
  ytdlp: string | null;
}

let versionCache: ToolVersionCache | null = null;
const VERSION_CACHE_TTL_MS = 5 * 60 * 1000;

/** Recursively measure bytes and file count for a directory without throwing on missing paths. */
export function measureDirectory(dir: string, maxDepth = 4): DirectoryStorageStats {
  if (!existsSync(dir)) return { exists: false, bytes: 0, files: 0 };
  let bytes = 0;
  let files = 0;

  function walk(current: string, depth: number): void {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (depth < maxDepth) walk(full, depth + 1);
      } else if (entry.isFile()) {
        try {
          bytes += statSync(full).size;
          files += 1;
        } catch {
          /* ignore disappearing files */
        }
      }
    }
  }

  walk(dir, 0);
  return { exists: true, bytes, files };
}

const FS_CACHE_TTL_MS = 15_000;
interface FsCacheEntry {
  expiresAt: number;
  stats: FilesystemStorageStats | null;
}
const fsCache = new Map<string, FsCacheEntry>();

export function clearFilesystemUsageCache(): void {
  fsCache.clear();
}

export function filesystemUsage(
  path: string,
  options?: { maxAgeMs?: number; force?: boolean },
): FilesystemStorageStats | null {
  const maxAge = options?.maxAgeMs ?? FS_CACHE_TTL_MS;
  const now = Date.now();
  if (!options?.force) {
    const cached = fsCache.get(path);
    if (cached && cached.expiresAt > now) {
      return cached.stats;
    }
  }
  try {
    const stat = statfsSync(path);
    const blockSize = Number(stat.bsize);
    const result: FilesystemStorageStats = {
      total_bytes: Number(stat.blocks) * blockSize,
      free_bytes: Number(stat.bfree) * blockSize,
      available_bytes: Number(stat.bavail) * blockSize,
    };
    fsCache.set(path, { expiresAt: now + maxAge, stats: result });
    return result;
  } catch {
    fsCache.set(path, { expiresAt: now + maxAge, stats: null });
    return null;
  }
}

async function probeBinaryVersion(bin: string, args: string[]): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: 3000,
      maxBuffer: 64 * 1024,
    });
    const firstLine = `${stdout}\n${stderr}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return firstLine ? firstLine.slice(0, 140) : null;
  } catch {
    return null;
  }
}

export async function probeToolVersions(
  ffmpegBin: string,
  ytdlpBin: string,
  force = false,
): Promise<{ ffmpeg: string | null; ytdlp: string | null }> {
  const key = `${ffmpegBin}|${ytdlpBin}`;
  const now = Date.now();
  if (!force && versionCache && versionCache.key === key && versionCache.expiresAt > now) {
    return { ffmpeg: versionCache.ffmpeg, ytdlp: versionCache.ytdlp };
  }
  const [ffmpeg, ytdlp] = await Promise.all([
    probeBinaryVersion(ffmpegBin, ['-version']),
    probeBinaryVersion(ytdlpBin, ['--version']),
  ]);
  versionCache = {
    key,
    expiresAt: now + VERSION_CACHE_TTL_MS,
    ffmpeg,
    ytdlp,
  };
  return { ffmpeg, ytdlp };
}

export function clearDiagnosticsCache(): void {
  versionCache = null;
}

export async function collectDiagnostics(params: {
  config: LoadedConfig;
  version: string;
  ring: LogRing;
  forceProbe?: boolean;
}): Promise<DiagnosticsSnapshot> {
  const { config, version, ring, forceProbe } = params;
  const tools = await probeToolVersions(config.media.ffmpegBin, config.media.ytdlpBin, forceProbe);
  const mem = process.memoryUsage();
  const rootBackups = join(config.paths.root, 'backups');
  const dataBackups = join(config.paths.dataDir, 'backups');
  const backupsDir = existsSync(rootBackups) ? rootBackups : dataBackups;

  return {
    collected_at: new Date().toISOString(),
    version,
    node_version: process.version,
    platform: `${process.platform} ${process.arch}`,
    pid: process.pid,
    uptime_seconds: Math.round(process.uptime()),
    memory: {
      rss_bytes: mem.rss,
      heap_used_bytes: mem.heapUsed,
      heap_total_bytes: mem.heapTotal,
    },
    tools,
    encoder: {
      active: currentVideoEncoder(),
      available: availableVideoEncoders(),
    },
    ports: {
      http: config.server.port,
      relay_host: config.media.relayHost,
      relay: config.media.relayPort,
      playback: config.media.relayPort + 1,
    },
    storage: {
      media: measureDirectory(join(config.paths.dataDir, 'media')),
      logs: measureDirectory(config.paths.logsDir),
      backups: measureDirectory(backupsDir),
      data: measureDirectory(config.paths.dataDir),
      filesystem: filesystemUsage(config.paths.dataDir),
    },
    metrics: metricsSnapshot(),
    recent_errors: ring.list({ level: 'error', limit: 25 }).reverse(),
  };
}
