import { extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ValidationError } from '../../utils/errors.js';

export type PauseAssetKind = 'image' | 'video' | 'font';

export interface PauseAssetInfo {
  kind: PauseAssetKind;
  extension: string;
  mime: string;
  animated: boolean;
  warning?: string;
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.avif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.m4v']);
const FONT_EXTENSIONS = new Set(['.ttf', '.otf']);

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.m4v': 'video/x-m4v',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

const ANIMATED_SVG = /<(animate|animateTransform|animateMotion|set)\b|@keyframes|animation\s*:/i;

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  return bytes.every((byte, index) => buffer[index] === byte);
}

function isSvg(buffer: Buffer): boolean {
  const start = buffer.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  return start.startsWith('<svg') || (start.startsWith('<?xml') && start.includes('<svg'));
}

export function inspectPauseAsset(buffer: Buffer, filename: string): PauseAssetInfo {
  const extension = extname(filename).toLowerCase();
  if (!extension) {
    throw new ValidationError('Datei ohne Endung wird nicht akzeptiert');
  }
  const mime = MIME_BY_EXTENSION[extension];
  if (!mime) {
    throw new ValidationError(`Dateityp ${extension} wird nicht unterstützt`);
  }

  if (FONT_EXTENSIONS.has(extension)) {
    const ttf =
      startsWith(buffer, [0x00, 0x01, 0x00, 0x00]) ||
      startsWith(buffer, [0x4f, 0x54, 0x54, 0x4f]) ||
      startsWith(buffer, [0x74, 0x72, 0x75, 0x65]) ||
      startsWith(buffer, [0x74, 0x74, 0x63, 0x66]);
    if (!ttf) throw new ValidationError('Die Datei ist keine gültige TTF-/OTF-Schrift');
    return { kind: 'font', extension, mime, animated: false };
  }

  if (extension === '.svg') {
    if (!isSvg(buffer)) throw new ValidationError('Die Datei ist kein gültiges SVG');
    const animated = ANIMATED_SVG.test(buffer.toString('utf8'));
    return {
      kind: 'image',
      extension,
      mime,
      animated,
      ...(animated
        ? {
            warning:
              'Animiertes SVG wird als statisches Bild verwendet. Für Animation WebM/GIF/MP4 hochladen.',
          }
        : {}),
    };
  }

  if (VIDEO_EXTENSIONS.has(extension)) {
    const mp4 = buffer.subarray(4, 8).toString('ascii') === 'ftyp';
    const webm = startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3]);
    if (!mp4 && !webm) throw new ValidationError('Die Datei ist kein gültiges Video');
    return { kind: 'video', extension, mime, animated: true };
  }

  if (!IMAGE_EXTENSIONS.has(extension) && extension !== '.gif') {
    throw new ValidationError(`Dateityp ${extension} wird nicht unterstützt`);
  }

  if (extension === '.png' && !startsWith(buffer, [0x89, 0x50, 0x4e, 0x47])) {
    throw new ValidationError('Die Datei ist kein gültiges PNG');
  }
  if ((extension === '.jpg' || extension === '.jpeg') && !startsWith(buffer, [0xff, 0xd8, 0xff])) {
    throw new ValidationError('Die Datei ist kein gültiges JPEG');
  }
  if (extension === '.gif') {
    const header = buffer.subarray(0, 6).toString('ascii');
    if (header !== 'GIF87a' && header !== 'GIF89a') {
      throw new ValidationError('Die Datei ist kein gültiges GIF');
    }
  }
  if (extension === '.webp') {
    const riff = buffer.subarray(0, 4).toString('ascii');
    const webp = buffer.subarray(8, 12).toString('ascii');
    if (riff !== 'RIFF' || webp !== 'WEBP') {
      throw new ValidationError('Die Datei ist kein gültiges WebP');
    }
  }
  if (extension === '.bmp' && !startsWith(buffer, [0x42, 0x4d])) {
    throw new ValidationError('Die Datei ist kein gültiges BMP');
  }

  return {
    kind: 'image',
    extension,
    mime,
    animated: extension === '.gif' || extension === '.webp',
  };
}

export function safePauseAssetName(extension: string): string {
  return `pause-${Date.now()}-${randomBytes(6).toString('hex')}${extension}`;
}

export function isSafePauseFilename(filename: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(filename) && !filename.includes('..');
}

export function mimeForPauseAsset(filename: string): string {
  return MIME_BY_EXTENSION[extname(filename).toLowerCase()] ?? 'application/octet-stream';
}
