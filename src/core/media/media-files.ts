import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ensureDir } from '../../utils/fs.js';
import { runCommand } from '../../utils/process.js';

export const MEDIA_EXTENSIONS = ['.mp4', '.webm', '.mov', '.mkv', '.m4v'] as const;

export interface MediaFileInfo {
  filename: string;
  path: string;
  size: number;
  modified_at: string;
}

export interface MediaProbe {
  isH264: boolean;
  codec: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
}

export interface MediaFileWithMeta extends MediaFileInfo {
  duration: number | null;
  width: number | null;
  height: number | null;
  is_h264: boolean | null;
  codec: string | null;
  thumbnail_url: string;
}

const probeCache = new Map<string, MediaProbe>();

export function mediaDirectory(dataDir: string): string {
  return join(dataDir, 'media');
}

export function mediaThumbsDirectory(dataDir: string): string {
  return join(mediaDirectory(dataDir), '.thumbs');
}

export function isSafeMediaFilename(filename: string): boolean {
  const name = basename(filename);
  if (name !== filename) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return false;
  return MEDIA_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension));
}

export function mediaFilePath(dataDir: string, filename: string): string | null {
  if (!isSafeMediaFilename(filename)) return null;
  return join(mediaDirectory(dataDir), filename);
}

/**
 * Normalizes an uploaded filename into a safe `data/media` name: lowercased,
 * accents stripped, non-alphanumerics collapsed to dashes, extension preserved.
 * Returns null when the extension is not an allowed media format.
 */
export function safeMediaNameFromOriginal(originalName: string): string | null {
  const name = basename(originalName).trim();
  const dot = name.lastIndexOf('.');
  const extension = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  if (!(MEDIA_EXTENSIONS as readonly string[]).includes(extension)) return null;
  const base = (dot >= 0 ? name.slice(0, dot) : name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!base) return null;
  return `${base}${extension}`;
}

export function listMediaFiles(dataDir: string): MediaFileInfo[] {
  const directory = mediaDirectory(dataDir);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((filename) => isSafeMediaFilename(filename))
    .map((filename) => {
      const path = join(directory, filename);
      const stat = statSync(path);
      return {
        filename,
        path,
        size: stat.size,
        modified_at: new Date(stat.mtimeMs).toISOString(),
      };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename, 'de'));
}

/** Inspect the first video stream; falls back cleanly on probe errors. */
export async function probeMediaFile(ffmpegBin: string, path: string): Promise<MediaProbe> {
  const ffprobe = ffmpegBin.replace(/ffmpeg([^/]*)$/, 'ffprobe$1');
  try {
    const result = await runCommand(
      ffprobe,
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name,width,height:format=duration',
        '-of',
        'json',
        path,
      ],
      { timeoutMs: 15_000 },
    );
    if (result.code !== 0) {
      return { isH264: false, codec: null, width: null, height: null, duration: null };
    }
    const parsed = JSON.parse(result.stdout) as {
      streams?: Array<{ codec_name?: string; width?: number; height?: number }>;
      format?: { duration?: string };
    };
    const stream = parsed.streams?.[0];
    const codec = stream?.codec_name ? stream.codec_name.toLowerCase() : null;
    const rawDuration = Number(parsed.format?.duration);
    return {
      isH264: codec === 'h264',
      codec,
      width: typeof stream?.width === 'number' ? stream.width : null,
      height: typeof stream?.height === 'number' ? stream.height : null,
      duration: Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null,
    };
  } catch {
    return { isH264: false, codec: null, width: null, height: null, duration: null };
  }
}

export async function probeMediaCached(
  ffmpegBin: string,
  path: string,
  size: number,
  modifiedAt: string,
): Promise<MediaProbe> {
  const cacheKey = `${path}|${size}|${modifiedAt}`;
  const cached = probeCache.get(cacheKey);
  if (cached) return cached;
  const probed = await probeMediaFile(ffmpegBin, path);
  probeCache.set(cacheKey, probed);
  if (probeCache.size > 500) {
    const firstKey = probeCache.keys().next().value;
    if (firstKey) probeCache.delete(firstKey);
  }
  return probed;
}

export async function listMediaFilesWithMeta(
  dataDir: string,
  ffmpegBin: string,
): Promise<MediaFileWithMeta[]> {
  const files = listMediaFiles(dataDir);
  const results: MediaFileWithMeta[] = [];
  for (const file of files) {
    const probe = await probeMediaCached(ffmpegBin, file.path, file.size, file.modified_at);
    const hasProbe = probe.codec !== null || probe.duration !== null || probe.height !== null;
    results.push({
      ...file,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      is_h264: hasProbe ? probe.isH264 : null,
      codec: probe.codec,
      thumbnail_url: `/api/media/${encodeURIComponent(file.filename)}/thumbnail`,
    });
  }
  return results;
}

export function mediaThumbnailPath(
  dataDir: string,
  filename: string,
  size: number,
  mtimeMs: number,
): string {
  const safeStamp = `${size}-${Math.trunc(mtimeMs)}`;
  return join(mediaThumbsDirectory(dataDir), `${filename}.${safeStamp}.jpg`);
}

/** Generate and cache a 160 px JPEG thumbnail (frame at 1 s, fallback to 0 s). */
export async function ensureMediaThumbnail(
  dataDir: string,
  ffmpegBin: string,
  filename: string,
): Promise<string | null> {
  const source = mediaFilePath(dataDir, filename);
  if (!source || !existsSync(source)) return null;
  const stat = statSync(source);
  const thumbsDir = mediaThumbsDirectory(dataDir);
  ensureDir(thumbsDir);
  const target = mediaThumbnailPath(dataDir, filename, stat.size, stat.mtimeMs);
  if (existsSync(target) && statSync(target).size > 0) return target;

  const tryExtract = async (seekSeconds: string): Promise<boolean> => {
    try {
      const res = await runCommand(
        ffmpegBin,
        [
          '-y',
          '-loglevel',
          'error',
          '-ss',
          seekSeconds,
          '-i',
          source,
          '-frames:v',
          '1',
          '-vf',
          'scale=160:-2',
          '-q:v',
          '5',
          target,
        ],
        { timeoutMs: 12_000 },
      );
      return res.code === 0 && existsSync(target) && statSync(target).size > 0;
    } catch {
      return false;
    }
  };

  if (await tryExtract('1')) return target;
  if (await tryExtract('0')) return target;
  if (existsSync(target)) {
    try {
      unlinkSync(target);
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function cleanupMediaThumbnails(dataDir: string, filename: string): void {
  const thumbsDir = mediaThumbsDirectory(dataDir);
  if (!existsSync(thumbsDir)) return;
  const prefix = `${filename}.`;
  try {
    for (const entry of readdirSync(thumbsDir)) {
      if (entry.startsWith(prefix)) {
        try {
          unlinkSync(join(thumbsDir, entry));
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
}

export function clearMediaProbeCache(): void {
  probeCache.clear();
}
