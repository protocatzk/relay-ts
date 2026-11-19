import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
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
  height: number | null;
}

export function mediaDirectory(dataDir: string): string {
  return join(dataDir, 'media');
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

/** Inspect the first video stream; falls back to re-encoding on probe errors. */
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
        'stream=codec_name,height',
        '-of',
        'json',
        path,
      ],
      { timeoutMs: 15_000 },
    );
    if (result.code !== 0) return { isH264: false, height: null };
    const parsed = JSON.parse(result.stdout) as {
      streams?: Array<{ codec_name?: string; height?: number }>;
    };
    const stream = parsed.streams?.[0];
    return {
      isH264: stream?.codec_name?.toLowerCase() === 'h264',
      height: typeof stream?.height === 'number' ? stream.height : null,
    };
  } catch {
    return { isH264: false, height: null };
  }
}
