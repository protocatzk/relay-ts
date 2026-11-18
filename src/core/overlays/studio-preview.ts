import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { Logger } from 'pino';
import type { Settings, StreamerConfig } from '../config/schema.js';
import { ChatOverlayEngine, parseColor } from './chat-engine.js';
import type { ChatMessage } from './chat-service.js';
import type { OverlayPosition } from './drawtext.js';

export interface StudioPreviewOptions {
  settings: Settings;
  streamer: StreamerConfig;
  logger: Logger;
  sample?: boolean;
  earningsText?: string;
  chatMessages?: ChatMessage[];
  maxDimension?: number;
}

function clockText(format: string): string {
  const now = new Date();
  const values: Record<string, string> = {
    '%H': String(now.getHours()).padStart(2, '0'),
    '%M': String(now.getMinutes()).padStart(2, '0'),
    '%S': String(now.getSeconds()).padStart(2, '0'),
    '%%': '%',
  };
  return format.replace(/%(H|M|S|%)/g, (token) => values[`%${token.slice(1)}`] ?? token);
}

function drawBoxedText(
  ctx: SKRSContext2D,
  text: string,
  target: OverlayPosition,
  opts: {
    width: number;
    height: number;
    fontSize: number;
    fontColor: string;
    boxColor: string;
    showBox: boolean;
    margin: number;
    alignTop: boolean;
    offsetX?: number;
    offsetY?: number;
  },
): void {
  ctx.font = `700 ${opts.fontSize}px "DejaVu Sans", sans-serif`;
  ctx.textBaseline = 'top';
  const width = Math.min(opts.width - opts.margin * 2, ctx.measureText(text).width);
  const boxHeight = Math.round(opts.fontSize * 1.45);
  const x =
    (target.endsWith('left')
      ? opts.margin
      : Math.max(opts.margin, opts.width - width - opts.margin)) + (opts.offsetX ?? 0);
  const y =
    (opts.alignTop
      ? opts.margin
      : Math.max(opts.margin, opts.height - boxHeight - opts.margin)) + (opts.offsetY ?? 0);
  if (opts.showBox) {
    const box = parseColor(opts.boxColor, { r: 0, g: 0, b: 0, a: 0.45 });
    ctx.fillStyle = `rgba(${box.r},${box.g},${box.b},${box.a})`;
    ctx.fillRect(x - 8, y - 6, width + 16, boxHeight + 8);
  }
  ctx.fillStyle = opts.fontColor.startsWith('#') || opts.fontColor.startsWith('0x')
    ? opts.fontColor.replace(/^0x/, '#')
    : opts.fontColor;
  ctx.fillText(text, x, y, opts.width - opts.margin * 2);
}

function drawBackground(
  ctx: SKRSContext2D,
  width: number,
  height: number,
): void {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#101722');
  gradient.addColorStop(0.55, '#0b1018');
  gradient.addColorStop(1, '#151d2a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  const step = Math.max(48, Math.round(width / 12));
  for (let x = step; x < width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = step; y < height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  ctx.font = '700 18px "DejaVu Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('STREAM PREVIEW', width / 2, height / 2 - 10);
  ctx.font = '12px "DejaVu Sans", sans-serif';
  ctx.fillText(`${width} × ${height}`, width / 2, height / 2 + 16);
  ctx.textAlign = 'left';
}

export function renderStudioPreview(options: StudioPreviewOptions): Buffer {
  const { settings, streamer, logger, sample = true } = options;
  const [width, height] = settings.video.resolution.split('x').map(Number) as [number, number];
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  drawBackground(ctx, width, height);

  const clock = streamer.overlays.clock;
  if (clock.enabled) {
    drawBoxedText(ctx, clockText(clock.format), clock.position, {
      width,
      height,
      fontSize: clock.font_size,
      fontColor: clock.font_color,
      boxColor: clock.box_color,
      showBox: clock.show_box,
      margin: clock.margin,
      alignTop: clock.position.startsWith('top'),
      offsetX: clock.offset_x,
      offsetY: clock.offset_y,
    });
  }

  const text = streamer.overlays.text;
  if (text.enabled && text.text.trim()) {
    drawBoxedText(ctx, text.marquee ? `${text.text}     ${text.text}` : text.text, text.position, {
      width,
      height,
      fontSize: text.font_size,
      fontColor: text.font_color,
      boxColor: text.box_color,
      showBox: text.show_box,
      margin: text.margin,
      alignTop: text.position.startsWith('top'),
      offsetX: text.offset_x,
      offsetY: text.offset_y,
    });
  }

  const chat = streamer.overlays.chat;
  if (chat.enabled) {
    const engine = new ChatOverlayEngine({ settings, streamer, logger });
    if (options.chatMessages && options.chatMessages.length > 0) {
      engine.setMessages(options.chatMessages);
    }
    const panel = engine.panel;
    ctx.drawImage(engine.previewCanvas(sample), panel.x, panel.y);
    engine.stop();
  }

  if (settings.earnings.overlay_enabled && options.earningsText) {
    drawBoxedText(
      ctx,
      options.earningsText,
      settings.earnings.overlay_position,
      {
        width,
        height,
        fontSize: settings.earnings.overlay_font_size,
        fontColor: settings.earnings.overlay_font_color,
        boxColor: settings.earnings.overlay_box_color,
        showBox: settings.earnings.overlay_show_box,
        margin: settings.earnings.overlay_margin,
        alignTop: settings.earnings.overlay_position.startsWith('top'),
        offsetX: settings.earnings.overlay_offset_x,
        offsetY: settings.earnings.overlay_offset_y,
      },
    );
  }

  const maxDimension = options.maxDimension ?? 720;
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  if (scale < 1) {
    const scaled = createCanvas(Math.round(width * scale), Math.round(height * scale));
    const target = scaled.getContext('2d');
    target.drawImage(canvas, 0, 0, scaled.width, scaled.height);
    return scaled.toBuffer('image/png');
  }
  return canvas.toBuffer('image/png');
}
