import { existsSync } from 'node:fs';
import { createCanvas, GlobalFonts, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { Logger } from 'pino';
import type { Settings } from '../config/schema.js';
import type { ChatMessage } from './chat-service.js';

const REGULAR_FONTS = [
  '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
];
const BOLD_FONTS = [
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/dejavu-sans-fonts/DejaVuSans-Bold.ttf',
];
const EMOJI_FONTS = [
  '/usr/share/fonts/noto-emoji/NotoColorEmoji.ttf',
  '/usr/share/fonts/noto/NotoColorEmoji.ttf',
  '/usr/share/fonts/NotoColorEmoji.ttf',
  '/usr/share/fonts/noto-emoji/NotoEmoji-Regular.ttf',
  '/usr/share/fonts/noto/NotoEmoji-Regular.ttf',
];

let fontsRegistered = false;
let fontFamily = '"DejaVu Sans", "Noto Color Emoji", sans-serif';

function registerFonts(): void {
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
  if (regular) fontFamily = '"DejaVu Sans", "Noto Color Emoji", sans-serif';
  else if (emoji) fontFamily = '"Noto Color Emoji", sans-serif';
  else fontFamily = 'sans-serif';
}

interface Rgba {
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

export function parseColor(value: string, fallback: Rgba = { r: 0, g: 0, b: 0, a: 0.55 }): Rgba {
  const raw = value.trim();
  const at = raw.lastIndexOf('@');
  const base = (at > 0 ? raw.slice(0, at) : raw).trim();
  const alpha = at > 0 ? Number(raw.slice(at + 1)) : undefined;
  let rgb: [number, number, number] | null;
  const hex = /^#?([0-9a-f]{6})$/i.exec(base);
  if (hex) {
    const value = hex[1]!;
    rgb = [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16),
    ];
  } else if (/^0x[0-9a-f]{6}$/i.test(base)) {
    const value = base.slice(2);
    rgb = [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16),
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

function rgba(color: Rgba): string {
  return `rgba(${color.r},${color.g},${color.b},${color.a})`;
}

function nameColor(name: string): string {
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

function roundedRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function wrapText(
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

function formatTime(message: ChatMessage): string {
  const date = message.timestamp ?? message.receivedAt;
  try {
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

const SAMPLE_MESSAGES: ChatMessage[] = [
  {
    id: 'sample-1',
    username: 'sophie',
    displayName: 'Sophie',
    text: 'Hallo! 👋',
    receivedAt: new Date(),
    timestamp: new Date(),
  },
  {
    id: 'sample-2',
    username: 'marco',
    displayName: 'Marco',
    text: 'Der Stream sieht richtig gut aus!',
    receivedAt: new Date(),
    timestamp: new Date(),
  },
  {
    id: 'sample-3',
    username: 'lena',
    displayName: 'Lena',
    text: '🔥🔥🔥',
    receivedAt: new Date(),
    timestamp: new Date(),
  },
];

export interface ChatPanelSpec {
  width: number;
  height: number;
  x: number;
  y: number;
  fps: number;
  /** Rawvideo pipe fed to the sink; chat defaults to fd 3, logo uses fd 4. */
  fd?: number;
}

export interface ChatEarningsCard {
  periodLabel: string;
  currency: 'EUR' | 'USD';
  net: number | null;
  gross: number | null;
  coins: number | null;
  goalAmount?: number;
  goalLabel?: string;
}

export interface ChatOverlayEngineOptions {
  settings: Settings;
  overlays: Settings['overlays'];
  logger: Logger;
}

/**
 * Canvas-based chat overlay. Renders only the chat panel as RGBA frames and
 * feeds them to a second ffmpeg input, so bubbles, colors, wrapping and emoji
 * work without restarting the encoder when messages change.
 */
export class ChatOverlayEngine {
  private readonly options: ChatOverlayEngineOptions;
  private readonly canvas: Canvas;
  private readonly ctx: SKRSContext2D;
  private readonly spec: ChatPanelSpec;
  private messages: ChatMessage[] = [];
  private readonly firstSeenAt = new Map<string, number>();
  private earningsCard: ChatEarningsCard | null = null;
  private lastEarningsCardKey = '';
  private stream?: NodeJS.WritableStream;
  private timer?: NodeJS.Timeout;
  private dirty = true;
  private cachedStatsLabel: string | null = null;
  private lastFrame?: Buffer;
  private blocked = false;
  private stopped = false;

  constructor(options: ChatOverlayEngineOptions) {
    this.options = options;
    registerFonts();
    const cfg = options.overlays.chat;
    const [outputWidth, outputHeight] = options.settings.video.resolution.split('x').map(Number) as [
      number,
      number,
    ];
    const margin = Math.max(16, Math.round(outputWidth * 0.03));
    const maxWidth = outputWidth - margin * 2;
    const autoWidth = Math.round(outputWidth * (outputWidth >= outputHeight ? 0.6 : 0.92));
    const width = Math.max(200, Math.min(maxWidth, cfg.panel_width > 0 ? cfg.panel_width : autoWidth));
    const lineHeight = Math.round(cfg.font_size * 1.55);
    const nameLineHeight = Math.round(cfg.font_size * 0.82 * 1.3);
    const assumedBubbleLines = 2;
    const autoHeight =
      cfg.max_lines * (32 + nameLineHeight + lineHeight * assumedBubbleLines) + 32;
    const height =
      cfg.panel_height > 0
        ? Math.max(80, Math.min(outputHeight - margin * 2, cfg.panel_height))
        : Math.min(outputHeight - margin * 2, Math.max(120, autoHeight));
    let x = margin;
    if (cfg.position === 'top-right' || cfg.position === 'bottom-right') {
      x = outputWidth - width - margin;
    }
    const y =
      cfg.position === 'top-left' || cfg.position === 'top-right'
        ? margin
        : outputHeight - height - margin;
    this.spec = {
      width,
      height,
      x: x + cfg.offset_x,
      y: y + cfg.offset_y,
      fps: cfg.render_fps,
    };
    this.canvas = createCanvas(width, height);
    this.ctx = this.canvas.getContext('2d');
  }

  get panel(): ChatPanelSpec {
    return { ...this.spec };
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  get currentMessages(): ChatMessage[] {
    return [...this.messages];
  }

  setEarningsCard(card: ChatEarningsCard | null): void {
    const key = card ? `${card.net}:${card.coins}:${card.periodLabel}:${card.goalAmount ?? ''}` : '';
    if (key !== this.lastEarningsCardKey) {
      this.earningsCard = card;
      this.lastEarningsCardKey = key;
      this.dirty = true;
    }
  }

  setMessages(messages: ChatMessage[], now = Date.now()): void {
    const cfg = this.options.overlays.chat;
    for (const message of messages) {
      if (!this.firstSeenAt.has(message.id)) {
        this.firstSeenAt.set(message.id, now);
      }
    }
    const maxItems = Math.max(cfg.max_messages, cfg.max_lines);
    const activeIds = new Set(messages.map((m) => m.id));
    for (const id of this.firstSeenAt.keys()) {
      if (!activeIds.has(id)) this.firstSeenAt.delete(id);
    }
    const nextMessages = this.filterByAge(messages, now).slice(-maxItems);
    const unchanged =
      nextMessages.length === this.messages.length &&
      nextMessages.every(
        (msg, idx) =>
          msg.id === this.messages[idx]?.id &&
          msg.text === this.messages[idx]?.text &&
          msg.displayName === this.messages[idx]?.displayName,
      );
    if (!unchanged) {
      this.messages = nextMessages;
      this.cachedStatsLabel = null;
      this.dirty = true;
    }
  }

  private filterByAge(messages: ChatMessage[], now = Date.now()): ChatMessage[] {
    const maxAge = this.options.overlays.chat.max_age_seconds;
    if (maxAge <= 0) return messages;
    const cutoff = now - maxAge * 1000;
    return messages.filter((message) => {
      const seenAt = this.firstSeenAt.get(message.id);
      if (seenAt !== undefined) return seenAt >= cutoff;
      const at = (message.timestamp ?? message.receivedAt).getTime();
      return Number.isFinite(at) ? at >= cutoff : true;
    });
  }

  addLocalMessage(username: string, text: string): ChatMessage[] {
    const message: ChatMessage = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      username: username.slice(0, 40) || 'Test',
      text: text.slice(0, 300) || 'Testnachricht',
      receivedAt: new Date(),
      timestamp: new Date(),
    };
    this.messages.push(message);
    const cfg = this.options.overlays.chat;
    const limit = Math.max(1, cfg.max_messages);
    if (this.messages.length > limit) this.messages = this.messages.slice(-limit);
    this.cachedStatsLabel = null;
    this.dirty = true;
    return [...this.messages];
  }

  attach(stream: NodeJS.WritableStream | null): void {
    if (!stream) return;
    if (this.stream === stream) return;
    this.detach();
    this.stopped = false;
    this.stream = stream;
    this.lastFrame = undefined;
    this.dirty = true;
    // ffmpeg may close pipe:3 while restarting/dying. A raw pipe without an
    // error listener would otherwise raise an uncaughtException and take down
    // the whole service.
    const guarded = stream as NodeJS.WritableStream & {
      destroyed?: boolean;
      writable?: boolean;
      on?: (event: string, listener: (error: Error) => void) => void;
      once?: (event: string, listener: () => void) => void;
    };
    if (guarded.on) {
      guarded.on('error', (error) => {
        if (this.stream !== stream) return;
        this.options.logger.warn(
          { err: error.message },
          'Overlay-Pipe getrennt – Canvas-Frame-Stream wird gestoppt',
        );
        this.stream = undefined;
        this.lastFrame = undefined;
        this.blocked = false;
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
      });
    }
    if (guarded.once) {
      guarded.once('close', () => {
        if (this.stream !== stream) return;
        this.stream = undefined;
        this.lastFrame = undefined;
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
      });
    }
    if (guarded.destroyed) return;
    // +5% write headroom so ffmpeg's overlay filter never throttles 1.01x relay catch-up.
    this.timer = setInterval(() => this.tick(), Math.max(20, Math.floor(1000 / (this.spec.fps * 1.05))));
    this.tick();
  }

  detach(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const stream = this.stream;
    this.stream = undefined;
    this.lastFrame = undefined;
    this.blocked = false;
    if (stream) {
      try {
        stream.end();
      } catch {
        // already closed
      }
    }
  }

  stop(): void {
    this.stopped = true;
    this.detach();
    this.messages = [];
    this.firstSeenAt.clear();
    this.dirty = true;
  }

  private tick(): void {
    if (this.stopped || !this.stream || this.blocked) return;
    const now = Date.now();
    if (this.options.overlays.chat.max_age_seconds > 0 && this.messages.length > 0) {
      const filtered = this.filterByAge(this.messages, now);
      if (filtered.length !== this.messages.length) {
        this.messages = filtered;
        this.cachedStatsLabel = null;
        this.dirty = true;
      }
    }
    const card = this.shouldRenderEarningsCard(false);
    const cardKey = card ? `${card.net}:${card.coins}:${card.periodLabel}` : '';
    if (cardKey !== this.lastEarningsCardKey) {
      this.lastEarningsCardKey = cardKey;
      this.dirty = true;
    }
    if (this.dirty || !this.lastFrame) {
      this.lastFrame = this.renderFrame(this.messages);
      this.dirty = false;
    }
    if (!this.lastFrame) return;
    try {
      const ok = this.stream.write(this.lastFrame);
      if (!ok) {
        this.blocked = true;
        this.stream.once('drain', () => {
          this.blocked = false;
        });
      }
    } catch {
      this.detach();
    }
  }

  previewCanvas(sample = false): Canvas {
    const canvas = createCanvas(this.spec.width, this.spec.height);
    const ctx = canvas.getContext('2d');
    const messages = sample || this.messages.length === 0 ? SAMPLE_MESSAGES : this.messages;
    this.render(ctx, canvas.width, canvas.height, messages, sample);
    return canvas;
  }

  previewPng(sample = false): Buffer {
    return this.previewCanvas(sample).toBuffer('image/png');
  }

  private renderFrame(messages: ChatMessage[]): Buffer {
    this.render(this.ctx, this.spec.width, this.spec.height, messages, false);
    const image = this.ctx.getImageData(0, 0, this.spec.width, this.spec.height);
    return Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  }

  private shouldRenderEarningsCard(isPreviewSample: boolean): ChatEarningsCard | null {
    const cfg = this.options.overlays.chat;
    if (!cfg.show_earnings_card) return null;
    if (isPreviewSample) {
      return (
        this.earningsCard ?? {
          periodLabel: 'Heute',
          currency: 'EUR',
          net: 205.28,
          gross: 410.64,
          coins: 42505,
          goalAmount: this.options.settings.earnings.goal_amount || 300,
          goalLabel: this.options.settings.earnings.goal_label || 'Tagesziel',
        }
      );
    }
    return this.earningsCard;
  }

  private render(
    ctx: SKRSContext2D,
    width: number,
    height: number,
    messages: ChatMessage[],
    isPreviewSample = false,
  ): void {
    const cfg = this.options.overlays.chat;
    ctx.clearRect(0, 0, width, height);
    const card = this.shouldRenderEarningsCard(isPreviewSample);
    if (messages.length === 0 && !card) return;

    const padding = 12;
    const gap = 6;
    const innerWidth = width - padding * 2;
    const nameSize = Math.max(10, Math.round(cfg.font_size * 0.82));
    const textSize = cfg.font_size;
    const textLineHeight = Math.round(textSize * 1.28);
    const nameLineHeight = Math.round(nameSize * 1.3);
    const box = parseColor(cfg.box_color, { r: 0, g: 0, b: 0, a: 0.55 });
    const textColor = rgba(parseColor(cfg.font_color, { r: 255, g: 255, b: 255, a: 1 }));
    const opacity = Math.max(0, Math.min(1, cfg.bubble_opacity));
    const showTiers = cfg.show_badges && cfg.show_tiers;
    const showTimestamps = cfg.show_timestamps;
    const useNameColors = cfg.name_colors;
    const style = cfg.style;
    const visible = messages.slice(-cfg.max_lines);
    let topLimit = padding;

    if (style === 'panel' && visible.length > 0) {
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.fillStyle = rgba(box);
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 2;
      roundedRect(ctx, padding, padding, innerWidth, height - padding * 2, 12);
      ctx.fill();
      ctx.restore();
    }

    if (cfg.show_stats && visible.length > 0) {
      if (!this.cachedStatsLabel) {
        const cutoff = Date.now() - 10 * 60_000;
        const recent = messages.filter((message) => {
          const at = (message.timestamp ?? message.receivedAt).getTime();
          return Number.isFinite(at) ? at >= cutoff : true;
        });
        const counts = new Map<string, number>();
        for (const message of recent) {
          const name = message.displayName || message.username || 'Chat';
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        const topChatter = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        this.cachedStatsLabel = [
          `${recent.length} MSG`,
          `${counts.size} CHATTER`,
          `${(recent.length / 10).toFixed(1)}/MIN`,
          ...(topChatter ? [`TOP ${topChatter}`] : []),
        ].join(' · ').toUpperCase();
      }
      ctx.textBaseline = 'top';
      ctx.font = `600 ${Math.round(nameSize * 0.85)}px ${fontFamily}`;
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.fillText(this.cachedStatsLabel, padding * 2, topLimit + 2, innerWidth - padding * 2);
      topLimit += nameLineHeight + 6;
    }

    if (card) {
      const symbol = card.currency === 'USD' ? '$' : '€';
      const netText = card.net !== null ? `${card.net.toFixed(2)} ${symbol}` : '–';
      const coinsText = card.coins !== null ? `${Math.round(card.coins).toLocaleString('de-DE')} Coins` : '';
      const hasGoal = Boolean(card.goalAmount && card.goalAmount > 0 && card.net !== null);
      const cardHeight = hasGoal ? nameLineHeight + textLineHeight + 22 : nameLineHeight + textLineHeight + 12;

      ctx.save();
      ctx.globalAlpha = Math.max(0.75, opacity);
      ctx.fillStyle = 'rgba(13, 21, 32, 0.9)';
      roundedRect(ctx, padding, topLimit, innerWidth, cardHeight, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(56, 211, 153, 0.65)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.textBaseline = 'top';
      ctx.font = `700 ${Math.round(nameSize * 0.85)}px ${fontFamily}`;
      ctx.fillStyle = '#38d399';
      ctx.fillText(
        `EINNAHMEN · ${card.periodLabel.toUpperCase()}`,
        padding * 2,
        topLimit + 7,
        innerWidth - padding * 2,
      );

      ctx.font = `700 ${textSize}px ${fontFamily}`;
      ctx.fillStyle = '#ffffff';
      const summary = coinsText ? `${netText} · ${coinsText}` : netText;
      ctx.fillText(summary, padding * 2, topLimit + 7 + nameLineHeight, innerWidth - padding * 2);

      if (hasGoal && card.goalAmount && card.net !== null) {
        const ratio = Math.max(0, Math.min(1, card.net / card.goalAmount));
        const barY = topLimit + cardHeight - 8;
        const barW = innerWidth - padding * 2;
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        roundedRect(ctx, padding * 2, barY, barW, 4, 2);
        ctx.fill();
        ctx.fillStyle = '#38d399';
        if (ratio > 0) {
          roundedRect(ctx, padding * 2, barY, Math.max(4, barW * ratio), 4, 2);
          ctx.fill();
        }
      }
      ctx.restore();
      topLimit += cardHeight + gap;
    }

    let bottom = height - padding;

    for (let index = visible.length - 1; index >= 0; index -= 1) {
      const message = visible[index]!;
      const name = (message.displayName || message.username || 'Chat').slice(0, 46);
      const nameLabel = `${name}${showTiers && message.tier ? ` · ${message.tier.toUpperCase()}` : ''}`;
      const timeLabel = showTimestamps ? formatTime(message) : '';
      ctx.font = `600 ${nameSize}px ${fontFamily}`;
      const timeWidth = timeLabel
        ? ctx.measureText(timeLabel).width + 8
        : 0;
      ctx.font = `${textSize}px ${fontFamily}`;
      const lines = wrapText(ctx, message.text, innerWidth - padding * 2, 4);
      const bubbleHeight = padding * 2 + nameLineHeight + lines.length * textLineHeight;
      if (bottom - bubbleHeight < topLimit) break;
      const top = bottom - bubbleHeight;

      if (style === 'bubbles') {
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.fillStyle = rgba(box);
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 2;
        roundedRect(ctx, padding, top, innerWidth, bubbleHeight, 10);
        ctx.fill();
        ctx.restore();
      }

      ctx.textBaseline = 'top';
      ctx.font = `600 ${nameSize}px ${fontFamily}`;
      ctx.fillStyle = useNameColors ? nameColor(name) : textColor;
      ctx.fillText(nameLabel, padding * 2, top + padding, innerWidth - padding * 4 - timeWidth);
      if (timeLabel) {
        ctx.font = `${Math.round(nameSize * 0.85)}px ${fontFamily}`;
        ctx.fillStyle = 'rgba(255,255,255,0.58)';
        ctx.textAlign = 'right';
        ctx.fillText(timeLabel, width - padding * 2, top + padding + 1);
        ctx.textAlign = 'left';
      }

      ctx.font = `${textSize}px ${fontFamily}`;
      ctx.fillStyle = textColor;
      let lineY = top + padding + nameLineHeight;
      for (const line of lines) {
        ctx.fillText(line, padding * 2, lineY, innerWidth - padding * 4);
        lineY += textLineHeight;
      }
      bottom = top - gap;
    }
  }
}
