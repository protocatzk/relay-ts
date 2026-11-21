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

function formatMET(ms: number): string {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const tenths = Math.floor((Math.max(0, ms) % 1000) / 100);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}.${tenths} MET`;
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
  private cachedStarshipCanopy: Canvas | null = null;
  private cachedStarshipCanopyKey = '';
  private sessionStartTime = Date.now();
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
    if (cfg.layout_mode === 'pillar_monitor' || cfg.layout_mode === 'starship_cockpit') {
      this.spec = {
        width: outputWidth,
        height: outputHeight,
        x: 0,
        y: 0,
        fps: cfg.render_fps,
      };
      this.canvas = createCanvas(outputWidth, outputHeight);
      this.ctx = this.canvas.getContext('2d');
    } else {
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

  private renderPillarMonitor(
    ctx: SKRSContext2D,
    width: number,
    height: number,
    messages: ChatMessage[],
    isPreviewSample = false,
  ): void {
    const cfg = this.options.overlays.chat;
    ctx.clearRect(0, 0, width, height);

    const card = this.shouldRenderEarningsCard(isPreviewSample);

    // 1. Top Banner (RELAY TokTracker Style: hard edges rx=2, neon accent #00ff88, dark surface #0b0f19)
    if (cfg.top_banner_enabled !== false) {
      const bx = 16;
      const by = 12;
      const bw = width - 32;
      const bh = 56;

      ctx.save();
      // Banner outer container
      ctx.fillStyle = 'rgba(11, 15, 25, 0.94)';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
      ctx.lineWidth = 1;
      roundedRect(ctx, bx, by, bw, bh, 2);
      ctx.fill();
      ctx.stroke();

      // Left neon accent bar
      ctx.fillStyle = '#00ff88';
      roundedRect(ctx, bx, by, 4, bh, 2);
      ctx.fill();

      // Red LIVE pill
      const liveBadgeX = bx + 16;
      const liveBadgeY = by + 17;
      const liveBadgeW = 42;
      const liveBadgeH = 22;
      ctx.fillStyle = '#dc2626';
      roundedRect(ctx, liveBadgeX, liveBadgeY, liveBadgeW, liveBadgeH, 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = `800 10px ${fontFamily}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText('LIVE', liveBadgeX + liveBadgeW / 2, liveBadgeY + liveBadgeH / 2);
      ctx.textAlign = 'left';

      // Streamer Title
      let cursorX = liveBadgeX + liveBadgeW + 12;
      ctx.font = `700 13px ${fontFamily}`;
      ctx.fillStyle = '#ffffff';
      const titleText = isPreviewSample
        ? 'RELAY Studio Live'
        : (this.options.settings.streaming?.title_template || 'RELAY Stream');
      const truncatedTitle = titleText.length > 28 ? `${titleText.slice(0, 26)}…` : titleText;
      ctx.fillText(truncatedTitle, cursorX, by + bh / 2);
      cursorX += ctx.measureText(truncatedTitle).width + 20;

      // Stats: Viewers & Messages
      if (cfg.banner_show_stats !== false) {
        ctx.font = `600 12px ${fontFamily}`;
        ctx.fillStyle = '#f8fafc';
        const msgStat = `💬 ${messages.length}`;
        ctx.fillText(msgStat, cursorX, by + bh / 2);
        cursorX += ctx.measureText(msgStat).width + 16;

        ctx.fillStyle = '#00ff88';
        ctx.fillText('⏱ LIVE', cursorX, by + bh / 2);
      }

      // Center Mode Tag (if space permits)
      if (bw >= 1000) {
        const tagW = 160;
        const tagH = 20;
        const tagX = bx + (bw - tagW) / 2;
        const tagY = by + (bh - tagH) / 2;
        ctx.fillStyle = 'rgba(30, 41, 59, 0.8)';
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 0.8;
        roundedRect(ctx, tagX, tagY, tagW, tagH, 2);
        ctx.fill();
        ctx.stroke();

        ctx.font = `600 9px ${fontFamily}`;
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.fillText('KOPFZEILE (STATS & ZIEL)', tagX + tagW / 2, tagY + tagH / 2);
        ctx.textAlign = 'left';
      }

      // Right items: Earnings & Goal bar
      if (cfg.banner_show_stats !== false && card) {
        let rightCursor = bx + bw - 16;

        // Goal progress bar
        if (cfg.banner_show_goal !== false && card.goalAmount && card.goalAmount > 0) {
          const goalW = 160;
          const goalH = 6;
          const current = card.net ?? 0;
          const ratio = Math.max(0, Math.min(1, current / card.goalAmount));
          const goalX = rightCursor - goalW;
          const goalY = by + (bh - goalH) / 2 + 8;

          // Goal label & percent above bar
          ctx.font = `500 10px ${fontFamily}`;
          ctx.fillStyle = '#94a3b8';
          ctx.textBaseline = 'bottom';
          ctx.fillText(`${card.goalLabel || 'Ziel'}:`, goalX, goalY - 3);

          ctx.textAlign = 'right';
          ctx.font = `600 10px ${fontFamily}`;
          ctx.fillStyle = '#f8fafc';
          ctx.fillText(`${Math.round(ratio * 100)} %`, goalX + goalW, goalY - 3);
          ctx.textAlign = 'left';

          // Bar background
          ctx.fillStyle = '#1e293b';
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 0.8;
          roundedRect(ctx, goalX, goalY, goalW, goalH, 2);
          ctx.fill();
          ctx.stroke();

          // Bar fill
          if (ratio > 0) {
            ctx.fillStyle = '#00ff88';
            roundedRect(ctx, goalX, goalY, Math.round(goalW * ratio), goalH, 2);
            ctx.fill();
          }

          rightCursor = goalX - 20;
        }

        // Coins / Net amount
        ctx.textBaseline = 'middle';
        ctx.font = `500 11px ${fontFamily}`;
        ctx.fillStyle = '#94a3b8';
        const labelText = 'Einnahmen:';
        const labelW = ctx.measureText(labelText).width;

        ctx.font = `600 12px ${fontFamily}`;
        ctx.fillStyle = '#f8fafc';
        const coinsStr = card.coins !== null && card.coins !== undefined ? `🪙 ${card.coins.toLocaleString('de-DE')}` : '';
        const coinsW = ctx.measureText(coinsStr).width;

        ctx.font = `700 12px ${fontFamily}`;
        ctx.fillStyle = '#00ff88';
        const netStr = card.net !== null && card.net !== undefined ? ` · ${card.net.toFixed(2)} €` : '';
        const netW = ctx.measureText(netStr).width;

        const totalEarnW = labelW + 8 + coinsW + netW;
        const earnStartX = rightCursor - totalEarnW;

        ctx.font = `500 11px ${fontFamily}`;
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(labelText, earnStartX, by + bh / 2);

        if (coinsStr) {
          ctx.font = `600 12px ${fontFamily}`;
          ctx.fillStyle = '#f8fafc';
          ctx.fillText(coinsStr, earnStartX + labelW + 6, by + bh / 2);
        }

        if (netStr) {
          ctx.font = `700 12px ${fontFamily}`;
          ctx.fillStyle = '#00ff88';
          ctx.fillText(netStr, earnStartX + labelW + 6 + coinsW, by + bh / 2);
        }
      }
      ctx.restore();
    }

    // 2. Chat Monitor on Left Pillarbox (TokTracker Style: rx=2, dark panel, hard borders, role badges)
    if (cfg.chat_monitor_enabled !== false) {
      const mx = 16;
      const my = 78;
      const mw = Math.min(410, Math.max(300, Math.round(width * 0.22)));
      const mh = height - 90;

      ctx.save();
      // Outer Monitor Container
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      roundedRect(ctx, mx, my, mw, mh, 2);
      ctx.fill();
      ctx.stroke();

      // Monitor Header
      const headerH = 34;
      ctx.fillStyle = '#1e293b';
      roundedRect(ctx, mx, my, mw, headerH, 2);
      ctx.fill();

      // Neon dot
      ctx.fillStyle = '#00ff88';
      ctx.beginPath();
      ctx.arc(mx + 16, my + 17, 4, 0, Math.PI * 2);
      ctx.fill();

      // Header title
      ctx.font = `700 11px ${fontFamily}`;
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.fillText('CHAT-MONITOR (LINKE SÄULE)', mx + 28, my + 18);

      // Header right badge
      const tagW = 76;
      const tagH = 18;
      const tagX = mx + mw - tagW - 12;
      const tagY = my + 8;
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 0.8;
      roundedRect(ctx, tagX, tagY, tagW, tagH, 2);
      ctx.fill();
      ctx.stroke();

      ctx.font = `600 9px ${fontFamily}`;
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'center';
      ctx.fillText('MINIMAL O/H', tagX + tagW / 2, tagY + tagH / 2);
      ctx.textAlign = 'left';

      // Chat Messages Stack
      const innerX = mx + 12;
      const innerW = mw - 24;
      const maxLines = Math.max(4, cfg.max_lines);
      const visible = messages.slice(-maxLines);

      const textSize = 11;
      const textLineHeight = 15;
      const nameSize = 11;

      let curY = my + mh - 26;
      for (let i = visible.length - 1; i >= 0; i--) {
        const msg = visible[i]!;
        ctx.font = `400 ${textSize}px ${fontFamily}`;
        const lines = wrapText(ctx, msg.text, innerW - 16, 3);
        const cardH = 22 + lines.length * textLineHeight + 4;
        const cardY = curY - cardH;
        if (cardY < my + headerH + 10) break;

        // Message card
        ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 0.8;
        roundedRect(ctx, innerX, cardY, innerW, cardH, 2);
        ctx.fill();
        ctx.stroke();

        let headX = innerX + 8;

        // Timestamp
        if (cfg.show_timestamps) {
          ctx.font = `500 9px ${fontFamily}`;
          ctx.fillStyle = '#94a3b8';
          ctx.textBaseline = 'middle';
          const timeStr = formatTime(msg);
          ctx.fillText(timeStr, headX, cardY + 12);
          headX += ctx.measureText(timeStr).width + 6;
        }

        // Role badge (SUB, MOD, VIP)
        if (cfg.show_badges && msg.tier) {
          const tier = msg.tier.toUpperCase();
          const badgeColor = tier === 'MOD' ? '#e11d48' : tier === 'VIP' ? '#d97706' : '#0284c7';
          const badgeText = tier === 'MOD' ? 'MOD' : tier === 'VIP' ? 'VIP' : 'SUB';
          const bW = 28;
          const bH = 14;
          ctx.fillStyle = badgeColor;
          roundedRect(ctx, headX, cardY + 5, bW, bH, 2);
          ctx.fill();

          ctx.font = `800 8px ${fontFamily}`;
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.fillText(badgeText, headX + bW / 2, cardY + 12);
          ctx.textAlign = 'left';
          headX += bW + 6;
        }

        // Sender Name
        ctx.font = `700 ${nameSize}px ${fontFamily}`;
        const senderColor = cfg.name_colors ? nameColor(msg.username || 'User') : '#38bdf8';
        ctx.fillStyle = senderColor;
        ctx.textBaseline = 'middle';
        const senderName = `${msg.displayName || msg.username || 'Gast'}:`;
        ctx.fillText(senderName, headX, cardY + 12);

        // Text lines
        ctx.font = `400 ${textSize}px ${fontFamily}`;
        ctx.fillStyle = '#e2e8f0';
        ctx.textBaseline = 'top';
        lines.forEach((line, lineIdx) => {
          ctx.fillText(line, innerX + 8, cardY + 22 + lineIdx * textLineHeight);
        });

        curY = cardY - 8;
      }

      // Footer Note inside Monitor
      ctx.font = `500 10px ${fontFamily}`;
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Nutzt die ungenutzte Pillarbox-Fläche (0 % Video-Cover)', mx + mw / 2, my + mh - 12);
      ctx.textAlign = 'left';

      ctx.restore();
    }
  }

  private buildStarshipCanopy(
    width: number,
    height: number,
    style: 'pillar_wings' | 'fullscreen_16_9',
  ): Canvas {
    const canopy = createCanvas(width, height);
    const ctx = canopy.getContext('2d');
    const cfg = this.options.overlays.chat;

    if (style === 'pillar_wings') {
      const centerW = Math.round(height * (9 / 16));
      const centerX = Math.round((width - centerW) / 2);
      const leftWingW = Math.max(200, centerX - 16);
      const rightWingX = centerX + centerW + 16;
      const rightWingW = Math.max(200, width - rightWingX - 16);

      // 1. Left Wing Canopy (Comms Terminal Chassis)
      if (cfg.starship_show_comms !== false) {
        ctx.fillStyle = 'rgba(9, 13, 22, 0.96)';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        roundedRect(ctx, 12, 10, leftWingW, height - 20, 2);
        ctx.fill();
        ctx.stroke();

        // Corner cutouts / cyan accent lines
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(12, 25);
        ctx.lineTo(27, 10);
        ctx.moveTo(12, height - 35);
        ctx.lineTo(27, height - 20);
        ctx.stroke();

        // Left Wing Header
        const headerH = 34;
        ctx.fillStyle = '#0f172a';
        roundedRect(ctx, 20, 20, leftWingW - 16, headerH, 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.3)';
        ctx.stroke();

        ctx.fillStyle = '#00f0ff';
        ctx.beginPath();
        ctx.arc(32, 20 + headerH / 2, 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = `700 11px ${fontFamily}`;
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText('COMMS TERMINAL // CHAT UPLINK', 44, 20 + headerH / 2);

        // SECURE Pill
        const secW = 56;
        const secH = 18;
        const secX = 20 + leftWingW - 16 - secW - 8;
        const secY = 20 + (headerH - secH) / 2;
        ctx.fillStyle = '#1e293b';
        roundedRect(ctx, secX, secY, secW, secH, 2);
        ctx.fill();
        ctx.font = `700 9px ${fontFamily}`;
        ctx.fillStyle = '#00ff88';
        ctx.textAlign = 'center';
        ctx.fillText('SECURE', secX + secW / 2, secY + secH / 2);
        ctx.textAlign = 'left';

        // Bottom Comms Stats Frame
        const statBoxY = height - 90;
        const statBoxH = 70;
        ctx.fillStyle = '#0b0f19';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        roundedRect(ctx, 20, statBoxY, leftWingW - 16, statBoxH, 2);
        ctx.fill();
        ctx.stroke();

        ctx.font = `700 9px ${fontFamily}`;
        ctx.fillStyle = '#64748b';
        ctx.fillText('CHAT THROUGHPUT', 32, statBoxY + 16);
        ctx.fillText('ACTIVE CREW', 20 + Math.round((leftWingW - 16) / 2) + 8, statBoxY + 16);

        // Subline
        ctx.font = `600 8px ${fontFamily}`;
        ctx.fillStyle = '#475569';
        ctx.fillText('UPLINK ENCRYPTED · ZERO-OVERHEAD DELTA', 32, statBoxY + statBoxH - 10);
      }

      // 2. Center Viewport Crosshairs & Visor
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(centerX, 25);
      ctx.lineTo(centerX + 15, 10);
      ctx.moveTo(centerX + centerW, 25);
      ctx.lineTo(centerX + centerW - 15, 10);
      ctx.moveTo(centerX, height - 35);
      ctx.lineTo(centerX + 15, height - 20);
      ctx.moveTo(centerX + centerW, height - 35);
      ctx.lineTo(centerX + centerW - 15, height - 20);
      ctx.stroke();

      // Top Center Canopy Visor
      const visorW = Math.min(340, Math.max(160, centerW - 40));
      const visorH = 24;
      const visorX = centerX + (centerW - visorW) / 2;
      ctx.fillStyle = '#0b0f19';
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
      ctx.lineWidth = 1;
      roundedRect(ctx, visorX, 10, visorW, visorH, 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#00ff88';
      ctx.beginPath();
      ctx.arc(visorX + 16, 10 + visorH / 2, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = `800 10px ${fontFamily}`;
      ctx.fillStyle = '#00ff88';
      ctx.textBaseline = 'middle';
      ctx.fillText('STARSHIP-HUD v1.0', visorX + 26, 10 + visorH / 2);

      if (visorW >= 260) {
        ctx.font = `600 9px ${fontFamily}`;
        ctx.fillStyle = '#64748b';
        ctx.fillText('SYS: OPTIMAL', visorX + 150, 10 + visorH / 2);
        ctx.fillStyle = '#00f0ff';
        ctx.fillText('RTMP SINK', visorX + 235, 10 + visorH / 2);
      }

      // 3. Right Wing Canopy (Telemetry & Flight Systems Chassis)
      if (cfg.starship_show_telemetry !== false) {
        ctx.fillStyle = 'rgba(9, 13, 22, 0.96)';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        roundedRect(ctx, rightWingX, 10, rightWingW, height - 20, 2);
        ctx.fill();
        ctx.stroke();

        // Right Wing Header
        const headerH = 34;
        ctx.fillStyle = '#0f172a';
        roundedRect(ctx, rightWingX + 8, 20, rightWingW - 16, headerH, 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 255, 136, 0.3)';
        ctx.stroke();

        ctx.fillStyle = '#00ff88';
        ctx.beginPath();
        ctx.arc(rightWingX + 22, 20 + headerH / 2, 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = `700 11px ${fontFamily}`;
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText('TELEMETRY // FLIGHT SYSTEMS', rightWingX + 34, 20 + headerH / 2);

        // ONLINE Pill
        const onW = 56;
        const onH = 18;
        const onX = rightWingX + rightWingW - 16 - onW - 8;
        const onY = 20 + (headerH - onH) / 2;
        ctx.fillStyle = '#1e293b';
        roundedRect(ctx, onX, onY, onW, onH, 2);
        ctx.fill();
        ctx.font = `700 9px ${fontFamily}`;
        ctx.fillStyle = '#00f0ff';
        ctx.textAlign = 'center';
        ctx.fillText('ONLINE', onX + onW / 2, onY + onH / 2);
        ctx.textAlign = 'left';

        // MET Static Frame
        const metY = 62;
        const metH = 56;
        ctx.fillStyle = '#090d16';
        ctx.strokeStyle = '#1e293b';
        roundedRect(ctx, rightWingX + 8, metY, rightWingW - 16, metH, 2);
        ctx.fill();
        ctx.stroke();
        ctx.font = `700 9px ${fontFamily}`;
        ctx.fillStyle = '#64748b';
        ctx.fillText('MISSION ELAPSED TIME (MET)', rightWingX + 18, metY + 16);

        // Bitrate & FPS Static Frames
        const instrY = 126;
        const instrH = 80;
        const halfW = Math.round((rightWingW - 24) / 2);

        ctx.fillStyle = '#090d16';
        ctx.strokeStyle = '#1e293b';
        roundedRect(ctx, rightWingX + 8, instrY, halfW, instrH, 2);
        ctx.fill();
        ctx.stroke();
        ctx.font = `700 9px ${fontFamily}`;
        ctx.fillStyle = '#64748b';
        ctx.fillText('INGEST BITRATE', rightWingX + 18, instrY + 16);

        roundedRect(ctx, rightWingX + 8 + halfW + 8, instrY, halfW, instrH, 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillText('OUTPUT FPS', rightWingX + 18 + halfW + 8, instrY + 16);

        // Delay Buffer Frame
        const bufY = 214;
        const bufH = 60;
        roundedRect(ctx, rightWingX + 8, bufY, rightWingW - 16, bufH, 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillText('DELAY BUFFER PACING // CATCHUP 1.01X', rightWingX + 18, bufY + 16);

        // Power Grid Frame
        const pwrY = 282;
        const pwrH = 96;
        roundedRect(ctx, rightWingX + 8, pwrY, rightWingW - 16, pwrH, 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillText('POWER GRID // REVENUE & MISSION GOAL', rightWingX + 18, pwrY + 16);

        // Annunciator Matrix Frame
        const annY = 386;
        const annH = 140;
        roundedRect(ctx, rightWingX + 8, annY, rightWingW - 16, annH, 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillText('SYSTEM ANNUNCIATOR MATRIX', rightWingX + 18, annY + 16);

        // Static Annunciator Chips
        const tileW = Math.round((rightWingW - 40) / 2);
        const tileH = 34;
        const t1X = rightWingX + 18;
        const t2X = t1X + tileW + 8;
        const t1Y = annY + 28;
        const t2Y = t1Y + tileH + 8;

        const drawChip = (cx: number, cy: number, title: string, sub: string, col: string) => {
          ctx.fillStyle = '#0f172a';
          ctx.strokeStyle = col;
          ctx.lineWidth = 0.8;
          roundedRect(ctx, cx, cy, tileW, tileH, 2);
          ctx.fill();
          ctx.stroke();
          ctx.font = `700 8px ${fontFamily}`;
          ctx.fillStyle = col;
          ctx.fillText(title, cx + 8, cy + 12);
          ctx.font = `600 7px ${fontFamily}`;
          ctx.fillStyle = '#64748b';
          ctx.fillText(sub, cx + 8, cy + 24);
        };

        drawChip(t1X, t1Y, 'NVENC HW ACCEL', 'ACTIVE · 1080p60', '#00ff88');
        drawChip(t2X, t1Y, 'DISCONNECT GUARD', 'ARMED (2.0s GRACE)', '#00f0ff');
        drawChip(t1X, t2Y, 'AUDIO RESAMPLE', 'AAC-LC 48kHz ST', '#00ff88');
        drawChip(t2X, t2Y, 'CPU LOAD', '< 1.5% CANVAS', '#00ff88');

        ctx.font = `600 8px ${fontFamily}`;
        ctx.fillStyle = '#38bdf8';
        ctx.fillText('RADICAL CPU-SPAR-MODUS:', rightWingX + 18, annY + 114);
        ctx.fillStyle = '#64748b';
        ctx.fillText('Canopy gerendert 1x · Delta-Updates bei 1Hz', rightWingX + 18, annY + 126);

        // Footer Frame
        const footY = height - 85;
        const footH = 65;
        roundedRect(ctx, rightWingX + 8, footY, rightWingW - 16, footH, 2);
        ctx.fill();
        ctx.stroke();
        ctx.font = `700 9px ${fontFamily}`;
        ctx.fillStyle = '#64748b';
        ctx.fillText('FLIGHT CONTROLLER', rightWingX + 18, footY + 18);
        ctx.font = `700 12px ${fontFamily}`;
        ctx.fillStyle = '#00f0ff';
        ctx.fillText('COCKPIT CANOPY ACTIVE', rightWingX + 18, footY + 38);
        ctx.font = `600 8px ${fontFamily}`;
        ctx.fillStyle = '#475569';
        ctx.fillText('OVERLAY fd 3 // ZERO-OVERHEAD DELTA BLIT', rightWingX + 18, footY + 52);
      }
    } else {
      // style === 'fullscreen_16_9'
      const visorW = width - 160;
      const visorH = 44;
      const visorX = 80;
      ctx.fillStyle = 'rgba(9, 13, 22, 0.94)';
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      roundedRect(ctx, visorX, 8, visorW, visorH, 2);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = 'rgba(0, 240, 255, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(visorX + 10, 8 + visorH);
      ctx.lineTo(visorX + visorW - 10, 8 + visorH);
      ctx.stroke();

      ctx.font = `700 11px ${fontFamily}`;
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.fillText('STARSHIP ODYSSEY', visorX + 64, 8 + visorH / 2);

      ctx.font = `600 9px ${fontFamily}`;
      ctx.fillStyle = '#64748b';
      ctx.fillText('SYS: STABLE', visorX + 280, 8 + visorH / 2);

      // Corner Struts
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(60, 0); ctx.lineTo(85, 25); ctx.lineTo(25, 25); ctx.lineTo(0, 50); ctx.closePath();
      ctx.moveTo(width, 0); ctx.lineTo(width - 60, 0); ctx.lineTo(width - 85, 25); ctx.lineTo(width - 25, 25); ctx.lineTo(width, 50); ctx.closePath();
      ctx.moveTo(0, height); ctx.lineTo(50, height); ctx.lineTo(70, height - 20); ctx.lineTo(20, height - 20); ctx.lineTo(0, height - 40); ctx.closePath();
      ctx.moveTo(width, height); ctx.lineTo(width - 50, height); ctx.lineTo(width - 70, height - 20); ctx.lineTo(width - 20, height - 20); ctx.lineTo(width, height - 40); ctx.closePath();
      ctx.stroke();

      // Bottom-Left Tactical Comms Chassis
      const commsW = 360;
      const commsH = 250;
      const commsY = height - commsH - 30;
      ctx.fillStyle = 'rgba(9, 13, 22, 0.9)';
      ctx.strokeStyle = '#1e293b';
      roundedRect(ctx, 24, commsY, commsW, commsH, 2);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(24, commsY);
      ctx.lineTo(24 + commsW, commsY);
      ctx.stroke();

      ctx.font = `700 10px ${fontFamily}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText('COMMS TERMINAL // CHAT', 36, commsY + 16);

      // Bottom-Right Telemetry Chassis
      const telemW = 360;
      const telemH = 250;
      const telemX = width - telemW - 24;
      const telemY = height - telemH - 30;
      ctx.fillStyle = 'rgba(9, 13, 22, 0.9)';
      ctx.strokeStyle = '#1e293b';
      roundedRect(ctx, telemX, telemY, telemW, telemH, 2);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(telemX, telemY);
      ctx.lineTo(telemX + telemW, telemY);
      ctx.stroke();

      ctx.font = `700 10px ${fontFamily}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText('TELEMETRY & FLIGHT VECTORS', telemX + 16, telemY + 16);

      // Bottom-Center Compass Tape
      const compW = 280;
      const compH = 22;
      const compX = (width - compW) / 2;
      const compY = height - compH - 8;
      ctx.fillStyle = '#060911';
      ctx.strokeStyle = '#1e293b';
      roundedRect(ctx, compX, compY, compW, compH, 2);
      ctx.fill();
      ctx.stroke();

      ctx.font = `700 9px ${fontFamily}`;
      ctx.fillStyle = '#00f0ff';
      ctx.textAlign = 'center';
      ctx.fillText('◄ 090° · HDG · 180° · SINK · 270° ►', compX + compW / 2, compY + compH / 2);
      ctx.textAlign = 'left';
    }

    return canopy;
  }

  private renderStarshipCockpit(
    ctx: SKRSContext2D,
    width: number,
    height: number,
    messages: ChatMessage[],
    isPreviewSample = false,
  ): void {
    const cfg = this.options.overlays.chat;
    const isLandscape = width >= height;
    const style: 'pillar_wings' | 'fullscreen_16_9' =
      cfg.starship_style === 'fullscreen_16_9'
        ? 'fullscreen_16_9'
        : cfg.starship_style === 'pillar_wings'
        ? 'pillar_wings'
        : isLandscape && (this.options.settings.video?.layout?.scale ?? 100) >= 150
        ? 'fullscreen_16_9'
        : 'pillar_wings';

    // 1. Blit cached static canopy (Ultra-fast Skia drawImage)
    const key = `${width}x${height}:${style}:${cfg.starship_show_telemetry}:${cfg.starship_show_comms}:${cfg.starship_show_power_grid}`;
    if (this.cachedStarshipCanopyKey !== key || !this.cachedStarshipCanopy) {
      this.cachedStarshipCanopy = this.buildStarshipCanopy(width, height, style);
      this.cachedStarshipCanopyKey = key;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.cachedStarshipCanopy, 0, 0);

    const card = this.shouldRenderEarningsCard(isPreviewSample);
    const now = Date.now();
    const elapsed = now - this.sessionStartTime;
    const metText = formatMET(elapsed);

    ctx.save();

    if (style === 'pillar_wings') {
      const centerW = Math.round(height * (9 / 16));
      const centerX = Math.round((width - centerW) / 2);
      const leftWingW = Math.max(200, centerX - 16);
      const rightWingX = centerX + centerW + 16;
      const rightWingW = Math.max(200, width - rightWingX - 16);

      // Comms Uplink Messages in Left Wing
      if (cfg.starship_show_comms !== false) {
        const visible = messages.length > 0 ? messages.slice(-5) : (isPreviewSample ? SAMPLE_MESSAGES.slice(-5) : []);
        const msgStartY = 64;
        const msgH = 46;
        const msgW = leftWingW - 24;

        for (let i = 0; i < visible.length; i++) {
          const msg = visible[i]!;
          const my = msgStartY + i * (msgH + 6);
          if (my + msgH > height - 100) break;

          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.strokeStyle = '#1e293b';
          ctx.lineWidth = 0.8;
          roundedRect(ctx, 24, my, msgW, msgH, 2);
          ctx.fill();
          ctx.stroke();

          // Timestamp
          const ts = msg.timestamp ? new Date(msg.timestamp) : new Date(msg.receivedAt);
          const timeStr = `${ts.getHours().toString().padStart(2, '0')}:${ts.getMinutes().toString().padStart(2, '0')}:${ts.getSeconds().toString().padStart(2, '0')}`;
          ctx.font = `600 8px ${fontFamily}`;
          ctx.fillStyle = '#64748b';
          ctx.textBaseline = 'top';
          ctx.fillText(timeStr, 32, my + 6);

          // Role Badge
          const badgeType = i === 0 ? 'VIP' : i === 1 ? 'SUB' : i === 2 ? 'MOD' : 'CREW';
          const badgeCol = badgeType === 'VIP' ? '#60a5fa' : badgeType === 'SUB' ? '#00ff88' : badgeType === 'MOD' ? '#fbbf24' : '#00f0ff';
          const bW = 28;
          const bH = 13;
          ctx.fillStyle = 'rgba(30, 41, 59, 0.8)';
          ctx.strokeStyle = badgeCol;
          roundedRect(ctx, 76, my + 5, bW, bH, 2);
          ctx.fill();
          ctx.stroke();

          ctx.font = `800 7px ${fontFamily}`;
          ctx.fillStyle = badgeCol;
          ctx.textAlign = 'center';
          ctx.fillText(badgeType, 76 + bW / 2, my + 6);
          ctx.textAlign = 'left';

          // Username
          ctx.font = `700 10px ${fontFamily}`;
          ctx.fillStyle = nameColor(msg.username || 'User');
          ctx.fillText(msg.displayName || msg.username || 'CrewMember', 112, my + 6, msgW - 120);

          // Message Text
          ctx.font = `500 10px ${fontFamily}`;
          ctx.fillStyle = '#e2e8f0';
          const truncatedMsg = msg.text.length > 42 ? `${msg.text.slice(0, 40)}…` : msg.text;
          ctx.fillText(truncatedMsg, 32, my + 24, msgW - 16);
        }

        // Stats in bottom box
        const statBoxY = height - 90;
        ctx.font = `800 13px ${fontFamily}`;
        ctx.fillStyle = '#00f0ff';
        const msgRate = `${(Math.max(1, messages.length) / 5).toFixed(1)} MSGS/SEC`;
        ctx.fillText(msgRate, 32, statBoxY + 36);

        ctx.fillStyle = '#00ff88';
        const crewCount = `${(messages.length * 8 + 1482).toLocaleString('de-DE')} CREW`;
        ctx.fillText(crewCount, 20 + Math.round((leftWingW - 16) / 2) + 8, statBoxY + 36);
      }

      // Telemetry in Right Wing
      if (cfg.starship_show_telemetry !== false) {
        // MET
        const metY = 62;
        ctx.font = `800 18px ${fontFamily}`;
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(metText, rightWingX + 18, metY + 38);
        ctx.font = `700 9px ${fontFamily}`;
        ctx.fillStyle = '#00ff88';
        ctx.fillText('STATUS: STABLE', rightWingX + rightWingW - 110, metY + 38);

        // Bitrate & FPS values and bars
        const instrY = 126;
        const halfW = Math.round((rightWingW - 24) / 2);

        // Bitrate
        ctx.font = `800 18px ${fontFamily}`;
        ctx.fillStyle = '#00f0ff';
        ctx.fillText('4,850', rightWingX + 18, instrY + 42);
        ctx.font = `600 10px ${fontFamily}`;
        ctx.fillStyle = '#64748b';
        ctx.fillText('kbps', rightWingX + 75, instrY + 42);
        // Bar
        ctx.fillStyle = '#1e293b';
        roundedRect(ctx, rightWingX + 18, instrY + 56, halfW - 20, 5, 1);
        ctx.fill();
        ctx.fillStyle = '#00f0ff';
        roundedRect(ctx, rightWingX + 18, instrY + 56, Math.round((halfW - 20) * 0.75), 5, 1);
        ctx.fill();

        // FPS
        ctx.font = `800 18px ${fontFamily}`;
        ctx.fillStyle = '#00ff88';
        ctx.fillText('60.0', rightWingX + 18 + halfW + 8, instrY + 42);
        ctx.font = `600 10px ${fontFamily}`;
        ctx.fillStyle = '#64748b';
        ctx.fillText('CFR', rightWingX + 75 + halfW + 8, instrY + 42);
        // Bar
        ctx.fillStyle = '#1e293b';
        roundedRect(ctx, rightWingX + 18 + halfW + 8, instrY + 56, halfW - 20, 5, 1);
        ctx.fill();
        ctx.fillStyle = '#00ff88';
        roundedRect(ctx, rightWingX + 18 + halfW + 8, instrY + 56, halfW - 20, 5, 1);
        ctx.fill();

        // Delay Buffer
        const bufY = 214;
        ctx.font = `800 12px ${fontFamily}`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText('150 MS LATENCY', rightWingX + 18, bufY + 36);
        ctx.font = `700 9px ${fontFamily}`;
        ctx.fillStyle = '#00ff88';
        ctx.fillText('DRIFT: 0.00 MS', rightWingX + rightWingW - 110, bufY + 36);

        // Segmented bar
        for (let s = 0; s < 6; s++) {
          ctx.fillStyle = s < 4 ? '#00ff88' : s === 4 ? '#00f0ff' : '#1e293b';
          roundedRect(ctx, rightWingX + 18 + s * 45, bufY + 44, 40, 4, 1);
          ctx.fill();
        }

        // Power Grid (Revenue / Goal)
        const pwrY = 282;
        const coinsStr = card?.coins !== null && card?.coins !== undefined ? `${Math.round(card.coins).toLocaleString('de-DE')} COINS` : '14,250 COINS';
        const netStr = card?.net !== null && card?.net !== undefined ? `(${card.net.toFixed(2)} €)` : '(74.81 €)';
        const ratio = card?.goalAmount && card.net ? Math.max(0, Math.min(1, card.net / card.goalAmount)) : 0.71;

        ctx.font = `800 13px ${fontFamily}`;
        ctx.fillStyle = '#00ff88';
        ctx.fillText(coinsStr, rightWingX + 18, pwrY + 42);
        ctx.font = `600 11px ${fontFamily}`;
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(netStr, rightWingX + 140, pwrY + 42);

        ctx.font = `800 12px ${fontFamily}`;
        ctx.fillStyle = '#00f0ff';
        ctx.fillText(`${Math.round(ratio * 100)} %`, rightWingX + rightWingW - 55, pwrY + 42);

        // Progress Bar
        const barW = rightWingW - 36;
        ctx.fillStyle = '#1e293b';
        roundedRect(ctx, rightWingX + 18, pwrY + 56, barW, 8, 2);
        ctx.fill();
        ctx.fillStyle = '#00ff88';
        roundedRect(ctx, rightWingX + 18, pwrY + 56, Math.round(barW * ratio), 8, 2);
        ctx.fill();
      }
    } else {
      // style === 'fullscreen_16_9'
      const visorW = width - 160;
      const visorH = 44;
      const visorX = 80;

      // Top Visor Dynamic
      // LIVE badge
      ctx.fillStyle = '#ef4444';
      roundedRect(ctx, visorX + 16, 8 + 12, 38, 20, 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 9px ${fontFamily}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText('LIVE', visorX + 35, 8 + 22);
      ctx.textAlign = 'left';

      // Crew counter
      ctx.font = `700 10px ${fontFamily}`;
      ctx.fillStyle = '#00ff88';
      ctx.fillText('● 1,482 CREW', visorX + 190, 8 + visorH / 2);

      // MET
      ctx.font = `800 12px ${fontFamily}`;
      ctx.fillStyle = '#00f0ff';
      ctx.fillText(metText, visorX + 370, 8 + visorH / 2);

      // Goal bar
      const ratio = card?.goalAmount && card.net ? Math.max(0, Math.min(1, card.net / card.goalAmount)) : 0.82;
      ctx.fillStyle = '#1e293b';
      roundedRect(ctx, visorX + visorW - 180, 8 + 18, 120, 8, 2);
      ctx.fill();
      ctx.fillStyle = '#00ff88';
      roundedRect(ctx, visorX + visorW - 180, 8 + 18, Math.round(120 * ratio), 8, 2);
      ctx.fill();
      ctx.font = `800 10px ${fontFamily}`;
      ctx.fillText(`${Math.round(ratio * 100)}%`, visorX + visorW - 50, 8 + 22);

      // Comms Uplink Messages (Bottom Left)
      const commsW = 360;
      const commsH = 250;
      const commsY = height - commsH - 30;
      const visible = messages.length > 0 ? messages.slice(-4) : (isPreviewSample ? SAMPLE_MESSAGES.slice(-4) : []);

      for (let i = 0; i < visible.length; i++) {
        const msg = visible[i]!;
        const my = commsY + 36 + i * 48;
        if (my + 44 > commsY + commsH) break;

        ctx.fillStyle = 'rgba(12, 18, 34, 0.7)';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 0.8;
        roundedRect(ctx, 36, my, commsW - 24, 40, 2);
        ctx.fill();
        ctx.stroke();

        ctx.font = `600 8px ${fontFamily}`;
        ctx.fillStyle = '#64748b';
        ctx.textBaseline = 'top';
        ctx.fillText('20:14:02', 44, my + 6);

        ctx.font = `700 10px ${fontFamily}`;
        ctx.fillStyle = nameColor(msg.username || 'User');
        ctx.fillText(msg.displayName || msg.username || 'Crew', 90, my + 6);

        ctx.font = `500 9px ${fontFamily}`;
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText(msg.text.length > 36 ? `${msg.text.slice(0, 34)}…` : msg.text, 44, my + 22);
      }

      // Telemetry (Bottom Right)
      const telemW = 360;
      const telemH = 250;
      const telemX = width - telemW - 24;
      const telemY = height - telemH - 30;

      // Bitrate & FPS
      ctx.font = `800 16px ${fontFamily}`;
      ctx.fillStyle = '#00f0ff';
      ctx.fillText('5,120 kbps', telemX + 24, telemY + 54);

      ctx.fillStyle = '#00ff88';
      ctx.fillText('60.00 fps', telemX + 180, telemY + 54);

      // Latency
      ctx.font = `700 11px ${fontFamily}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText('150 ms (Catchup 1.01x · Drift 0.0ms)', telemX + 24, telemY + 110);
    }

    ctx.restore();
  }

  private render(
    ctx: SKRSContext2D,
    width: number,
    height: number,
    messages: ChatMessage[],
    isPreviewSample = false,
  ): void {
    const cfg = this.options.overlays.chat;
    if (cfg.layout_mode === 'pillar_monitor') {
      this.renderPillarMonitor(ctx, width, height, messages, isPreviewSample);
      return;
    }
    if (cfg.layout_mode === 'starship_cockpit') {
      this.renderStarshipCockpit(ctx, width, height, messages, isPreviewSample);
      return;
    }
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
