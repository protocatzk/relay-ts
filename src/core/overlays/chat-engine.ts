import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { Logger } from 'pino';
import type { Settings } from '../config/schema.js';
import type { ChatMessage } from './chat-service.js';
import {
  formatClockText,
  formatTime,
  isBroadcastCanvasMode,
  nameColor,
  overlayFontFamily,
  parseColor,
  registerFonts,
  rgba,
  roundedRect,
  wrapText,
} from './canvas-utils.js';
import {
  renderBroadcastOverlay,
  type BroadcastLayerCache,
} from './broadcast-renderer.js';

export { overlayFontFamily, parseColor } from './canvas-utils.js';

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

/** Queue data rendered by the chat overlay (#97). */
export interface ChatQueueInput {
  labels: string[];
  /** Index of the running entry in `labels`, or null when the queue is idle. */
  activeIndex: number | null;
}

export interface QueueWindow {
  labels: string[];
  /** Index of the running entry inside `labels`; -1 when none is active. */
  activeOffset: number;
  hasBefore: boolean;
  hasAfter: boolean;
}

/**
 * Picks the entries around the running one so the active streamer sits in the
 * middle of the strip: `1 … 2  [current]  3 … 4`.
 */
export function buildQueueWindow(
  labels: string[],
  activeIndex: number | null,
  maxEntries: number,
): QueueWindow {
  const max = Math.max(1, Math.floor(maxEntries));
  if (labels.length === 0) {
    return { labels: [], activeOffset: -1, hasBefore: false, hasAfter: false };
  }
  const active =
    activeIndex !== null && activeIndex >= 0 && activeIndex < labels.length
      ? activeIndex
      : null;
  let start = 0;
  if (active !== null) {
    const before = Math.floor((max - 1) / 2);
    start = Math.max(0, Math.min(active - before, labels.length - max));
  }
  const end = Math.min(labels.length, start + max);
  return {
    labels: labels.slice(start, end),
    activeOffset: active === null ? -1 : active - start,
    hasBefore: start > 0,
    hasAfter: end < labels.length,
  };
}

type ChatCfg = Settings['overlays']['chat'];

/** Font size for the queue strip: explicit value or derived from the chat size. */
function queueFontSize(cfg: ChatCfg, mode: 'standard' | 'pillar'): number {
  if (cfg.queue_font_size > 0) return cfg.queue_font_size;
  const base = cfg.font_size > 0 ? cfg.font_size : 22;
  return mode === 'pillar'
    ? Math.max(12, Math.min(30, Math.round(base * 0.62)))
    : Math.max(10, Math.round(base * 0.72));
}

function queueBarHeight(cfg: ChatCfg, mode: 'standard' | 'pillar'): number {
  return Math.round(queueFontSize(cfg, mode) * 1.6) + 14;
}

const SAMPLE_QUEUE: ChatQueueInput = {
  labels: ['Streamer 1', 'Streamer 2', 'Streamer 3', 'Streamer 4', 'Streamer 5'],
  activeIndex: 2,
};

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

export interface ChatStreamerInfo {
  name: string;
  tiktok?: string;
  title?: string;
  status?: string;
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
  private earningsText = '';
  private lastEarningsCardKey = '';
  private lastClockLabel = '';
  private streamerInfo: ChatStreamerInfo | null = null;
  private queue: ChatQueueInput = { labels: [], activeIndex: null };
  private lastQueueKey = '';
  private stream?: NodeJS.WritableStream;
  private timer?: NodeJS.Timeout;
  private dirty = true;
  private cachedStatsLabel: string | null = null;
  private broadcastCache: BroadcastLayerCache = { canvas: null, key: '' };
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
    if (cfg.layout_mode === 'glass_minimal' || cfg.layout_mode === 'ultra_clean') {
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
      const queueHeight = cfg.queue_enabled ? queueBarHeight(cfg, 'standard') + 8 : 0;
      const autoHeight =
        cfg.max_lines * (32 + nameLineHeight + lineHeight * assumedBubbleLines) +
        32 +
        queueHeight;
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

  setStreamer(streamer: ChatStreamerInfo | null): void {
    this.streamerInfo = streamer;
    this.dirty = true;
  }

  /** Updates the queue strip (#97); redraws only when the content changed. */
  setQueue(input: ChatQueueInput | null): void {
    const next = input ?? { labels: [], activeIndex: null };
    const key = `${next.activeIndex ?? '-'}\u0001${next.labels.join('\u0001')}`;
    if (key === this.lastQueueKey) return;
    this.lastQueueKey = key;
    this.queue = { labels: [...next.labels], activeIndex: next.activeIndex };
    this.dirty = true;
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

  setEarningsText(text: string): void {
    if (text === this.earningsText) return;
    this.earningsText = text;
    this.dirty = true;
  }

  /** Updates overlay config live without restarting the sink pipe. */
  updateConfig(settings: Settings, overlays: Settings['overlays']): void {
    this.options.settings = settings;
    this.options.overlays = overlays;
    this.broadcastCache.key = '';
    this.lastClockLabel = '';
    this.dirty = true;
  }

  private tick(): void {
    if (this.stopped || !this.stream || this.blocked) return;
    const now = Date.now();
    if (isBroadcastCanvasMode(this.options.settings) && this.options.overlays.clock.enabled) {
      const clockLabel = formatClockText(this.options.overlays.clock.format, new Date(now));
      if (clockLabel !== this.lastClockLabel) {
        this.lastClockLabel = clockLabel;
        this.dirty = true;
      }
    }
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

  private queueFor(isPreviewSample: boolean): ChatQueueInput {
    if (this.queue.labels.length === 0 && isPreviewSample) return SAMPLE_QUEUE;
    return this.queue;
  }

  /**
   * Draws the queue strip below the chat panel (standard layout). Pillar mode
   * renders it into the top banner instead (#97).
   */
  private renderQueueBar(
    ctx: SKRSContext2D,
    width: number,
    height: number,
    isPreviewSample: boolean,
  ): void {
    const cfg = this.options.overlays.chat;
    const barHeight = queueBarHeight(cfg, 'standard');
    this.drawQueueStrip(
      ctx,
      {
        x: 24 + cfg.queue_offset_x,
        y: height - barHeight - 4 + cfg.queue_offset_y,
        width: Math.max(80, width - 48),
        height: barHeight,
        fontSize: queueFontSize(cfg, 'standard'),
        centered: false,
        showBox: cfg.queue_show_box,
      },
      isPreviewSample,
    );
  }

  /**
   * Shared queue strip renderer. `area` is the available box; `centered`
   * reduces the strip to its measured width and centers it (used when no top
   * banner exists in pillar mode).
   */
  private drawQueueStrip(
    ctx: SKRSContext2D,
    area: {
      x: number;
      y: number;
      width: number;
      height: number;
      fontSize: number;
      centered: boolean;
      showBox: boolean;
    },
    isPreviewSample: boolean,
  ): void {
    const cfg = this.options.overlays.chat;
    const queue = this.queueFor(isPreviewSample);
    if (queue.labels.length === 0) return;
    const window = buildQueueWindow(queue.labels, queue.activeIndex, cfg.queue_max_entries);
    if (window.labels.length === 0) return;

    const fontColor = parseColor(cfg.queue_font_color, { r: 255, g: 255, b: 255, a: 1 });
    const activeColor = parseColor(cfg.queue_active_color, { r: 0, g: 240, b: 255, a: 1 });
    const boxColor = parseColor(cfg.queue_box_color, { r: 0, g: 0, b: 0, a: 0.45 });

    type Node = { text: string; active: boolean; muted: boolean };
    const nodes: Node[] = [];
    if (window.hasBefore) nodes.push({ text: '…', active: false, muted: true });
    window.labels.forEach((label, index) => {
      if (nodes.length > 0) nodes.push({ text: ' → ', active: false, muted: true });
      nodes.push({ text: label, active: index === window.activeOffset, muted: false });
    });
    if (window.hasAfter) nodes.push({ text: ' …', active: false, muted: true });

    ctx.save();
    ctx.font = `700 ${area.fontSize}px ${overlayFontFamily()}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const widths = nodes.map((node) => ctx.measureText(node.text).width);
    const total = widths.reduce((sum, value) => sum + value, 0);
    const maxWidth = Math.max(80, area.width);
    const shownWidth = Math.min(total, maxWidth);
    const x0 = area.centered ? Math.round(area.x + (maxWidth - shownWidth) / 2) : area.x;
    const y0 = area.y;

    if (area.showBox) {
      ctx.fillStyle = rgba(boxColor);
      roundedRect(ctx, x0 - 10, y0, shownWidth + 20, area.height, 8);
      ctx.fill();
    }

    const right = x0 + shownWidth;
    let x = x0;
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]!;
      const nodeWidth = widths[index]!;
      if (x + nodeWidth > right + 0.5) {
        // Not enough room: summarize the rest instead of squeezing labels.
        ctx.fillStyle = `rgba(${fontColor.r},${fontColor.g},${fontColor.b},0.6)`;
        ctx.fillText('…', x, y0 + area.height / 2);
        break;
      }
      if (node.active) {
        ctx.fillStyle = `rgba(${activeColor.r},${activeColor.g},${activeColor.b},0.18)`;
        roundedRect(ctx, x - 6, y0 + 4, nodeWidth + 12, area.height - 8, 6);
        ctx.fill();
        ctx.fillStyle = rgba(activeColor);
      } else if (node.muted) {
        ctx.fillStyle = `rgba(${fontColor.r},${fontColor.g},${fontColor.b},0.6)`;
      } else {
        ctx.fillStyle = rgba(fontColor);
      }
      ctx.fillText(node.text, x, y0 + area.height / 2);
      x += nodeWidth;
    }
    ctx.restore();
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
    if (cfg.layout_mode === 'glass_minimal' || cfg.layout_mode === 'ultra_clean') {
      renderBroadcastOverlay(
        ctx,
        width,
        height,
        {
          mode: cfg.layout_mode,
          settings: this.options.settings,
          cfg,
          messages,
          streamer: this.streamerInfo,
          earnings: this.shouldRenderEarningsCard(isPreviewSample),
          earningsText: this.earningsText,
          queue: this.queueFor(isPreviewSample),
          sessionStartTime: this.sessionStartTime,
          isPreviewSample,
        },
        this.broadcastCache,
      );
      return;
    }
    ctx.clearRect(0, 0, width, height);
    const card = this.shouldRenderEarningsCard(isPreviewSample);
    const queue = this.queueFor(isPreviewSample);
    if (messages.length === 0 && !card && !(cfg.queue_enabled && queue.labels.length > 0)) return;

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
      ctx.font = `600 ${Math.round(nameSize * 0.85)}px ${overlayFontFamily()}`;
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
      ctx.font = `700 ${Math.round(nameSize * 0.85)}px ${overlayFontFamily()}`;
      ctx.fillStyle = '#38d399';
      ctx.fillText(
        `EINNAHMEN · ${card.periodLabel.toUpperCase()}`,
        padding * 2,
        topLimit + 7,
        innerWidth - padding * 2,
      );

      ctx.font = `700 ${textSize}px ${overlayFontFamily()}`;
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

    // Keep the queue strip clear so the newest bubble never runs into it (#97).
    const queueReserve = cfg.queue_enabled ? queueBarHeight(cfg, 'standard') + 8 : 0;
    let bottom = height - padding - queueReserve;

    for (let index = visible.length - 1; index >= 0; index -= 1) {
      const message = visible[index]!;
      const name = (message.displayName || message.username || 'Chat').slice(0, 46);
      const nameLabel = `${name}${showTiers && message.tier ? ` · ${message.tier.toUpperCase()}` : ''}`;
      const timeLabel = showTimestamps ? formatTime(message) : '';
      ctx.font = `600 ${nameSize}px ${overlayFontFamily()}`;
      const timeWidth = timeLabel
        ? ctx.measureText(timeLabel).width + 8
        : 0;
      ctx.font = `${textSize}px ${overlayFontFamily()}`;
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
      ctx.font = `600 ${nameSize}px ${overlayFontFamily()}`;
      ctx.fillStyle = useNameColors ? nameColor(name) : textColor;
      ctx.fillText(nameLabel, padding * 2, top + padding, innerWidth - padding * 4 - timeWidth);
      if (timeLabel) {
        ctx.font = `${Math.round(nameSize * 0.85)}px ${overlayFontFamily()}`;
        ctx.fillStyle = 'rgba(255,255,255,0.58)';
        ctx.textAlign = 'right';
        ctx.fillText(timeLabel, width - padding * 2, top + padding + 1);
        ctx.textAlign = 'left';
      }

      ctx.font = `${textSize}px ${overlayFontFamily()}`;
      ctx.fillStyle = textColor;
      let lineY = top + padding + nameLineHeight;
      for (const line of lines) {
        ctx.fillText(line, padding * 2, lineY, innerWidth - padding * 4);
        lineY += textLineHeight;
      }
      bottom = top - gap;
    }

    if (cfg.queue_enabled) {
      this.renderQueueBar(ctx, width, height, isPreviewSample);
    }
  }
}
