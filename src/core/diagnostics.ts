import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync, statfsSync } from 'node:fs';
import { cpus, freemem, loadavg, totalmem } from 'node:os';
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

export interface SystemHardwareSpecs {
  cpu_model: string;
  cpu_cores: number;
  cpu_load_1m: number;
  cpu_load_5m: number;
  cpu_load_15m: number;
  total_memory_bytes: number;
  free_memory_bytes: number;
  used_memory_bytes: number;
}

export interface SystemRecommendation {
  id: string;
  level: 'info' | 'recommendation' | 'warning';
  title: string;
  message: string;
  action_url?: string;
}

export function buildSystemHardwareSpecs(): SystemHardwareSpecs {
  const cpuList = cpus();
  const [load1m = 0, load5m = 0, load15m = 0] = loadavg();
  const total = totalmem();
  const free = freemem();
  return {
    cpu_model: cpuList[0]?.model || 'Unbekannt',
    cpu_cores: cpuList.length || 1,
    cpu_load_1m: Math.round(load1m * 100) / 100,
    cpu_load_5m: Math.round(load5m * 100) / 100,
    cpu_load_15m: Math.round(load15m * 100) / 100,
    total_memory_bytes: total,
    free_memory_bytes: free,
    used_memory_bytes: Math.max(0, total - free),
  };
}

export function buildSystemRecommendations(params: {
  specs: SystemHardwareSpecs;
  activeEncoder: VideoEncoder;
  availableEncoders: VideoEncoder[];
  filesystem: FilesystemStorageStats | null;
  videoEncoderSetting?: string;
  videoPreset?: string;
}): SystemRecommendation[] {
  const recommendations: SystemRecommendation[] = [];
  const { specs, activeEncoder, availableEncoders, filesystem, videoEncoderSetting } = params;

  // 1. Hardware Encoder check
  const hardwareEncoders = availableEncoders.filter(
    (e) => e === 'h264_nvenc' || e === 'h264_qsv' || e === 'h264_amf',
  );
  if (hardwareEncoders.length > 0 && activeEncoder === 'libx264' && videoEncoderSetting === 'libx264') {
    recommendations.push({
      id: 'hardware-encoder-available',
      level: 'recommendation',
      title: 'Hardware-Encoder verfügbar',
      message: `Erkannte Hardware-Encoder: ${hardwareEncoders.join(', ')}. Aktuell ist der CPU-Encoder libx264 konfiguriert. Die Aktivierung von Hardware-Encoding (z. B. 'auto' oder '${hardwareEncoders[0]}') entlastet die CPU deutlich.`,
      action_url: '/system/settings',
    });
  }

  // 2. High CPU Load check (normalized 1m load > 85% of cores)
  const normalizedLoad1m = specs.cpu_load_1m / Math.max(1, specs.cpu_cores);
  if (normalizedLoad1m > 0.85) {
    recommendations.push({
      id: 'high-cpu-load',
      level: 'warning',
      title: 'Hohe CPU-Dauerlast',
      message: `CPU-Dauerlast liegt bei ${Math.round(normalizedLoad1m * 100)} %. Falls Re-Encoding oder Software-Encoding aktiv ist, empfiehlt sich ein schnelleres Preset (z. B. 'veryfast') oder ein Hardware-Encoder.`,
      action_url: '/system/settings',
    });
  }

  // 3. Free RAM check (< 1 GB free when system has > 2 GB)
  const ONE_GB = 1024 * 1024 * 1024;
  if (specs.free_memory_bytes < ONE_GB && specs.total_memory_bytes > 2 * ONE_GB) {
    const freeMb = Math.round(specs.free_memory_bytes / (1024 * 1024));
    recommendations.push({
      id: 'low-free-ram',
      level: 'warning',
      title: 'Knapper Arbeitsspeicher',
      message: `Nur noch ${freeMb} MB freier Arbeitsspeicher verfügbar. Es wird empfohlen, den Delay-Puffer oder die Chat-Historie zu begrenzen.`,
      action_url: '/system/settings',
    });
  }

  // 4. Filesystem Storage check (< 15% available)
  if (filesystem && filesystem.total_bytes > 0) {
    const freeRatio = filesystem.available_bytes / filesystem.total_bytes;
    if (freeRatio < 0.15) {
      const freePercent = Math.round(freeRatio * 100);
      recommendations.push({
        id: 'low-disk-space',
        level: 'warning',
        title: 'Knapper Festplattenspeicher',
        message: `Nur noch ${freePercent} % Speicherplatz auf der Daten-Partition frei. Bitte alte Recordings oder Logs bereinigen.`,
        action_url: '/system/settings',
      });
    }
  }

  if (recommendations.length === 0) {
    recommendations.push({
      id: 'optimal-status',
      level: 'info',
      title: 'System optimal konfiguriert',
      message: 'Hardware-Ressourcen, Speicher und Encoder-Einstellungen befinden sich im optimalen Bereich.',
    });
  }

  return recommendations;
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
  specs: SystemHardwareSpecs;
  recommendations: SystemRecommendation[];
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
  const fsStats = filesystemUsage(config.paths.dataDir);
  const activeEncoder = currentVideoEncoder();
  const availableEncoders = availableVideoEncoders();
  const specs = buildSystemHardwareSpecs();
  const recommendations = buildSystemRecommendations({
    specs,
    activeEncoder,
    availableEncoders,
    filesystem: fsStats,
    videoEncoderSetting: config.settings.video.encoder,
    videoPreset: config.settings.video.preset,
  });

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
    specs,
    recommendations,
    tools,
    encoder: {
      active: activeEncoder,
      available: availableEncoders,
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
      filesystem: fsStats,
    },
    metrics: metricsSnapshot(),
    recent_errors: ring.list({ level: 'error', limit: 25 }).reverse(),
  };
}
