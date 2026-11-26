import { existsSync } from 'node:fs';
import { GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import type { Settings } from '../config/schema.js';
import type { ChatMessage } from './chat-service.js';

const REGULAR_FONTS = [
  '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
];
const TEXT_FONTS = [
  '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
  '/usr/share/fonts/noto/NotoSans-Regular.ttf',
  '/usr/share/fonts/NotoSans-Regular.ttf',
];
const TEXT_BOLD_FONTS = [
  '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
  '/usr/share/fonts/noto/NotoSans-Bold.ttf',
  '/usr/share/fonts/NotoSans-Bold.ttf',
];
const BOLD_FONTS = [
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/dejavu-sans-fonts/DejaVuSans-Bold.ttf',
];
const EMOJI_FONTS = [
  '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf',
  '/usr/share/fonts/noto-emoji/NotoColorEmoji.ttf',
  '/usr/share/fonts/noto/NotoColorEmoji.ttf',
  '/usr/share/fonts/NotoColorEmoji.ttf',
  '/usr/share/fonts/truetype/noto/NotoEmoji-Regular.ttf',
  '/usr/share/fonts/noto-emoji/NotoEmoji-Regular.ttf',
  '/usr/share/fonts/noto/NotoEmoji-Regular.ttf',
];

let fontsRegistered = false;
let fontFamily = '"DejaVu Sans", "Noto Color Emoji", sans-serif';

export function registerFonts(): void {
  if (fontsRegistered) return;
  fontsRegistered = true;
  const regular = REGULAR_FONTS.find((path) => existsSync(path));
  if (regular) {
    try {
      GlobalFonts.registerFromPath(regular, 'DejaVu Sans');
    } catch {
      // fall back to the runtime's default font
    }
  }
  const text = TEXT_FONTS.find((path) => existsSync(path));
  if (text) {
    try {
      GlobalFonts.registerFromPath(text, 'Noto Sans');
    } catch {
      // optional
    }
  }
  const textBold = TEXT_BOLD_FONTS.find((path) => existsSync(path));
  if (textBold) {
    try {
      GlobalFonts.registerFromPath(textBold, 'Noto Sans Bold');
    } catch {
      // optional
    }
  }
  const bold = BOLD_FONTS.find((path) => existsSync(path));
  if (bold) {
    try {
      GlobalFonts.registerFromPath(bold, 'DejaVu Sans Bold');
    } catch {
      // optional
    }
  }
  const emoji = EMOJI_FONTS.find((path) => existsSync(path));
  if (emoji) {
    try {
      GlobalFonts.registerFromPath(emoji, 'Noto Color Emoji');
    } catch {
      // optional
    }
  }
  if (text && emoji) fontFamily = '"Noto Sans", "Noto Color Emoji", "DejaVu Sans", sans-serif';
  else if (text) fontFamily = '"Noto Sans", "DejaVu Sans", sans-serif';
  else if (regular) fontFamily = '"DejaVu Sans", "Noto Color Emoji", sans-serif';
  else if (emoji) fontFamily = '"Noto Color Emoji", sans-serif';
  else fontFamily = 'sans-serif';
}

/** Font stack used by the canvas overlays (chat, studio preview labels). */
export function overlayFontFamily(): string {
  registerFonts();
  return fontFamily;
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [244, 67, 54],
  green: [76, 175, 80],
  blue: [33, 150, 243],
  yellow: [255, 235, 59],
  orange: [255, 152, 0],
  purple: [156, 39, 176],
  cyan: [0, 188, 212],
  gray: [158, 158, 158],
  grey: [158, 158, 158],
};

export function parseColor(
  value: string,
  fallback: Rgba = { r: 0, g: 0, b: 0, a: 0.55 },
): Rgba {
  const raw = value.trim();
  const at = raw.lastIndexOf('@');
  const base = (at > 0 ? raw.slice(0, at) : raw).trim();
  const alpha = at > 0 ? Number(raw.slice(at + 1)) : undefined;
  let rgb: [number, number, number] | null;
  const hex = /^#?([0-9a-f]{6})$/i.exec(base);
  if (hex) {
    const val = hex[1]!;
    rgb = [
      parseInt(val.slice(0, 2), 16),
      parseInt(val.slice(2, 4), 16),
      parseInt(val.slice(4, 6), 16),
    ];
  } else if (/^0x[0-9a-f]{6}$/i.test(base)) {
    const val = base.slice(2);
    rgb = [
      parseInt(val.slice(0, 2), 16),
      parseInt(val.slice(2, 4), 16),
      parseInt(val.slice(4, 6), 16),
    ];
  } else {
    rgb = NAMED_COLORS[base.toLowerCase()] ?? null;
  }
  if (!rgb) return fallback;
  return {
    r: rgb[0],
    g: rgb[1],
    b: rgb[2],
    a: alpha !== undefined && Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1,
  };
}

export function rgba(color: Rgba): string {
  return `rgba(${color.r},${color.g},${color.b},${color.a})`;
}

export function nameColor(name: string): string {
  const palette = [
    '#FF8A80',
    '#FFB74D',
    '#FFD54F',
    '#A5D6A7',
    '#4DD0E1',
    '#90CAF9',
    '#B39DDB',
    '#F48FB1',
    '#C5E1A5',
    '#80DEEA',
  ];
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return palette[hash % palette.length]!;
}

export function roundedRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

export function wrapText(
  ctx: SKRSContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === 0) return [''];
  if (lines.length >= maxLines) {
    let last = lines[maxLines - 1]!;
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = `${last}…`;
  }
  return lines.slice(0, maxLines);
}

export function formatTime(message: ChatMessage): string {
  const date = message.timestamp ?? message.receivedAt;
  try {
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function formatUptime(ms: number): string {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

export function formatClockText(format: string, now = new Date()): string {
  const values: Record<string, string> = {
    '%H': String(now.getHours()).padStart(2, '0'),
    '%M': String(now.getMinutes()).padStart(2, '0'),
    '%S': String(now.getSeconds()).padStart(2, '0'),
    '%%': '%',
  };
  return format.replace(/%(H|M|S|%)/g, (token) => values[`%${token.slice(1)}`] ?? token);
}

/** True when the full-frame canvas compositor handles clock/text/version/earnings too. */
export function isBroadcastCanvasMode(settings: Settings): boolean {
  const chat = settings.overlays.chat;
  return (
    chat.enabled &&
    chat.engine === 'canvas' &&
    (chat.layout_mode === 'glass_minimal' || chat.layout_mode === 'ultra_clean')
  );
}
