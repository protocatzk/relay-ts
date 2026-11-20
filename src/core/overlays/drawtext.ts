import { existsSync } from 'node:fs';
import type { Settings } from '../config/schema.js';

export type OverlayPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const FONT_CANDIDATES = [
  '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
  '/usr/share/fonts/noto/NotoSans-Regular.ttf',
  '/usr/share/fonts/liberation-sans/LiberationSans-Regular.ttf',
];

export function resolveFont(explicit?: string): string | null {
  if (explicit && existsSync(explicit)) return explicit;
  for (const candidate of FONT_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Escape text for drawtext option values inside single quotes. */
export function escapeDrawtext(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

export function escapePath(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');
}

export function positionExpressions(
  position: OverlayPosition,
  margin = 32,
  offsetX = 0,
  offsetY = 0,
): { x: string; y: string } {
  const dx = offsetX === 0 ? '' : offsetX > 0 ? `+${offsetX}` : `${offsetX}`;
  const dy = offsetY === 0 ? '' : offsetY > 0 ? `+${offsetY}` : `${offsetY}`;
  switch (position) {
    case 'top-right':
      return { x: `w-tw-${margin}${dx}`, y: `${margin}${dy}` };
    case 'bottom-left':
      return { x: `${margin}${dx}`, y: `h-th-${margin}${dy}` };
    case 'bottom-right':
      return { x: `w-tw-${margin}${dx}`, y: `h-th-${margin}${dy}` };
    case 'top-left':
    default:
      return { x: `${margin}${dx}`, y: `${margin}${dy}` };
  }
}

export function clockFilter(settings: Settings, fontFile: string): string | null {
  const config = settings.overlays.clock;
  if (!config.enabled) return null;
  const { x, y } = positionExpressions(
    config.position,
    config.margin,
    config.offset_x,
    config.offset_y,
  );
  // Three layers of escaping are required: filtergraph, option parser and
  // drawtext's localtime argument parser. The argument separator needs one
  // backslash, colons inside the strftime format need three.
  const format = config.format.replace(/:/g, '\\\\\\:');
  return (
    `drawtext=fontfile='${escapePath(fontFile)}':` +
    `text='%{localtime\\:${format}}':` +
    `fontsize=${config.font_size}:fontcolor=${config.font_color}:` +
    `box=${config.show_box ? 1 : 0}:boxcolor=${config.box_color}:boxborderw=10:x=${x}:y=${y}`
  );
}

export function textFilter(
  settings: Settings,
  fontFile: string,
  textFile: string,
): string | null {
  const config = settings.overlays.text;
  if (!config.enabled || !config.text.trim()) return null;
  const { x, y } = positionExpressions(
    config.position,
    config.margin,
    config.offset_x,
    config.offset_y,
  );
  const xExpression = config.marquee
    ? `w-mod(t*${config.speed}\\,w+tw)`
    : x;
  return (
    `drawtext=fontfile='${escapePath(fontFile)}':` +
    `textfile='${escapePath(textFile)}':reload=1:expansion=none:` +
    `fontsize=${config.font_size}:fontcolor=${config.font_color}:` +
    `box=${config.show_box ? 1 : 0}:boxcolor=${config.box_color}:boxborderw=10:` +
    `x=${xExpression}:y=${y}`
  );
}

export function chatFilter(
  settings: Settings,
  fontFile: string,
  chatFile: string,
): string | null {
  const config = settings.overlays.chat;
  if (!config.enabled) return null;
  const { x, y } = positionExpressions(
    config.position,
    32,
    config.offset_x,
    config.offset_y,
  );
  return (
    `drawtext=fontfile='${escapePath(fontFile)}':` +
    `textfile='${escapePath(chatFile)}':reload=1:expansion=none:` +
    `fontsize=${config.font_size}:fontcolor=${config.font_color}:` +
    `box=1:boxcolor=${config.box_color}:boxborderw=12:line_spacing=6:` +
    `x=${x}:y=${y}`
  );
}

export function earningsFilter(
  settings: Settings,
  fontFile: string,
  earningsFile: string,
): string | null {
  const config = settings.earnings;
  if (!config.overlay_enabled) return null;
  const { x, y } = positionExpressions(
    config.overlay_position,
    config.overlay_margin,
    config.overlay_offset_x,
    config.overlay_offset_y,
  );
  return (
    `drawtext=fontfile='${escapePath(fontFile)}':` +
    `textfile='${escapePath(earningsFile)}':reload=1:expansion=none:` +
    `fontsize=${config.overlay_font_size}:fontcolor=${config.overlay_font_color}:` +
    `box=${config.overlay_show_box ? 1 : 0}:boxcolor=${config.overlay_box_color}:boxborderw=10:` +
    `line_spacing=6:x=${x}:y=${y}`
  );
}

export function formatVersionOverlayText(
  config: Settings['overlays']['version'],
  version: string,
): string {
  const base = `${config.prefix}${version}`;
  if (config.show_update_hint && config.update_hint.trim()) {
    return `${base} · ${config.update_hint.trim()}`;
  }
  return base;
}

export function versionFilter(
  settings: Settings,
  fontFile: string,
  versionFile: string,
): string | null {
  const config = settings.overlays.version;
  if (!config?.enabled) return null;
  const { x, y } = positionExpressions(
    config.position,
    config.margin,
    config.offset_x,
    config.offset_y,
  );
  return (
    `drawtext=fontfile='${escapePath(fontFile)}':` +
    `textfile='${escapePath(versionFile)}':reload=1:expansion=none:` +
    `fontsize=${config.font_size}:fontcolor=${config.font_color}:` +
    `box=${config.show_box ? 1 : 0}:boxcolor=${config.box_color}:boxborderw=8:` +
    `x=${x}:y=${y}`
  );
}

/**
 * Countdown for local videos (remaining time as MM:SS, or H:MM:SS for long
 * files). The duration is baked into the expression because drawtext has no
 * duration variable. Only used in the local-video start path, so streamers and
 * screens never show it.
 */
export function remainingTimeFilter(
  settings: Settings,
  fontFile: string,
  durationSeconds: number,
  seekSeconds = 0,
): string | null {
  const remainingTotal = durationSeconds - Math.max(0, seekSeconds);
  if (!Number.isFinite(remainingTotal) || remainingTotal <= 0) return null;
  const [width, height] = settings.video.resolution.split('x').map(Number) as [number, number];
  const fontsize = Math.max(18, Math.round(Math.max(width, height) / 40));
  const duration = remainingTotal.toFixed(3);
  const remaining = `max(0\\,${duration}-t)`;
  const clock =
    remainingTotal >= 3600
      ? `%{eif\\:trunc(${remaining}/3600)\\:d}\\:` +
        `%{eif\\:trunc(mod(trunc(${remaining}/60)\\,60))\\:d\\:2}\\:` +
        `%{eif\\:trunc(mod(${remaining}\\,60))\\:d\\:2}`
      : `%{eif\\:trunc(${remaining}/60)\\:d\\:2}\\:` +
        `%{eif\\:trunc(mod(${remaining}\\,60))\\:d\\:2}`;
  return (
    `drawtext=fontfile='${escapePath(fontFile)}':` +
    `text='Noch ${clock}':` +
    `fontsize=${fontsize}:fontcolor=white:` +
    `box=1:boxcolor=black@0.45:boxborderw=10:` +
    `x=w-tw-24:y=h-th-24`
  );
}

export function wrapChatLine(line: string, maxChars: number): string[] {
  const clean = line.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return [clean];
  const words = clean.split(' ');
  const result: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      if (word.length <= maxChars) {
        current = word;
      } else {
        // Hard-break extremely long tokens (URLs, emoji spam).
        for (let index = 0; index < word.length; index += maxChars) {
          result.push(word.slice(index, index + maxChars));
        }
      }
      continue;
    }
    if (`${current} ${word}`.length <= maxChars) {
      current = `${current} ${word}`;
    } else {
      result.push(current);
      current = word.length > maxChars ? word.slice(0, maxChars) : word;
    }
  }
  if (current) result.push(current);
  return result;
}
