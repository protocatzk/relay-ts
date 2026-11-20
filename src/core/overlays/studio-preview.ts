import { createCanvas, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import type { Logger } from 'pino';
import type { Settings } from '../config/schema.js';
import { ChatOverlayEngine, parseColor } from './chat-engine.js';
import type { ChatMessage } from './chat-service.js';
import type { OverlayPosition } from './drawtext.js';

export type PreviewAspect = '9:16' | '16:9' | '1:1';

export interface StudioPreviewOptions {
  settings: Settings;
  overlays: Settings['overlays'];
  logger: Logger;
  sample?: boolean;
  earningsText?: string;
  chatMessages?: ChatMessage[];
  logoImage?: Image;
  maxDimension?: number;
  videoAspect?: PreviewAspect;
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

/** Splits overlay text into rendered lines, ignoring trailing blank lines. */
export function splitTextLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 1 && lines[lines.length - 1]?.trim() === '') lines.pop();
  return lines.length > 0 ? lines : [''];
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
  const lines = splitTextLines(text);
  const availableWidth = Math.max(1, opts.width - opts.margin * 2);
  const lineHeight = Math.round(opts.fontSize * 1.3);
  const lineWidths = lines.map((line) => Math.min(availableWidth, ctx.measureText(line).width));
  const blockWidth = Math.max(0, ...lineWidths);
  const blockHeight = lineHeight * lines.length;
  const x =
    (target.endsWith('left')
      ? opts.margin
      : Math.max(opts.margin, opts.width - blockWidth - opts.margin)) + (opts.offsetX ?? 0);
  const y =
    (opts.alignTop
      ? opts.margin
      : Math.max(opts.margin, opts.height - blockHeight - opts.margin)) + (opts.offsetY ?? 0);
  if (opts.showBox) {
    const box = parseColor(opts.boxColor, { r: 0, g: 0, b: 0, a: 0.45 });
    ctx.fillStyle = `rgba(${box.r},${box.g},${box.b},${box.a})`;
    ctx.fillRect(x - 8, y - 6, blockWidth + 16, blockHeight + 8);
  }
  ctx.fillStyle = opts.fontColor.startsWith('#') || opts.fontColor.startsWith('0x')
    ? opts.fontColor.replace(/^0x/, '#')
    : opts.fontColor;
  lines.forEach((line, index) => {
    const lineX = target.endsWith('left') ? x : x + (blockWidth - (lineWidths[index] ?? 0));
    ctx.fillText(line, lineX, y + index * lineHeight, availableWidth);
  });
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

function drawVideoArea(
  ctx: SKRSContext2D,
  width: number,
  height: number,
  layout: Settings['video']['layout'],
  aspect: PreviewAspect,
): void {
  const [aspectWidth, aspectHeight] = aspect.split(':').map(Number) as [number, number];
  const ratio = aspectWidth / aspectHeight;
  const frameRatio = width / height;
  const baseWidth = frameRatio > ratio ? height * ratio : width;
  const baseHeight = frameRatio > ratio ? height : width / ratio;
  const scale = (layout.enabled ? layout.scale : 100) / 100;
  const positionX = layout.enabled ? layout.position_x : 50;
  const positionY = layout.enabled ? layout.position_y : 50;
  const videoWidth = baseWidth * scale;
  const videoHeight = baseHeight * scale;
  const x = ((width - videoWidth) * positionX) / 100;
  const y = ((height - videoHeight) * positionY) / 100;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  ctx.fillStyle = '#080d13';
  ctx.fillRect(x, y, videoWidth, videoHeight);
  ctx.strokeStyle = 'rgba(255,255,255,0.24)';
  ctx.lineWidth = Math.max(1, Math.round(width / 640));
  ctx.strokeRect(x + 0.5, y + 0.5, videoWidth - 1, videoHeight - 1);

  const labelSize = Math.max(12, Math.round(width * 0.016));
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.52)';
  ctx.font = `700 ${labelSize}px "DejaVu Sans", sans-serif`;
  const labelX = Math.min(width - 16, Math.max(16, x + videoWidth / 2));
  const labelY = Math.min(height - 16, Math.max(16, y + videoHeight / 2));
  ctx.fillText('TIKTOK LIVE', labelX, labelY);
  ctx.font = `${Math.max(10, Math.round(labelSize * 0.7))}px "DejaVu Sans", sans-serif`;
  ctx.fillText(
    `${aspect}${layout.enabled ? ` · ${layout.scale} %` : ''}`,
    labelX,
    labelY + labelSize,
  );
  ctx.restore();
  ctx.textAlign = 'left';
}

export function renderStudioPreview(options: StudioPreviewOptions): Buffer {
  const { settings, overlays, logger, sample = true } = options;
  const [width, height] = settings.video.resolution.split('x').map(Number) as [number, number];
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  drawBackground(ctx, width, height);
  drawVideoArea(ctx, width, height, settings.video.layout, options.videoAspect ?? '9:16');

  const clock = overlays.clock;
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

  const text = overlays.text;
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

  const chat = overlays.chat;
  if (chat.enabled) {
    const engine = new ChatOverlayEngine({ settings, overlays, logger });
    if (options.chatMessages && options.chatMessages.length > 0) {
      engine.setMessages(options.chatMessages);
    }
    const panel = engine.panel;
    ctx.drawImage(engine.previewCanvas(sample), panel.x, panel.y);
    engine.stop();
  }

  const logo = overlays.logo;
  if (logo?.enabled && options.logoImage) {
    const logoWidth = Math.max(32, Math.min(logo.width, width));
    const ratio =
      options.logoImage.width > 0 && options.logoImage.height > 0
        ? options.logoImage.height / options.logoImage.width
        : 1;
    const logoHeight = Math.max(1, Math.round(logoWidth * ratio));
    const margin = Math.max(0, logo.margin);
    const x = logo.position.endsWith('right') ? width - logoWidth - margin : margin;
    const y = logo.position.startsWith('top') ? margin : height - logoHeight - margin;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, logo.opacity));
    ctx.drawImage(
      options.logoImage,
      x + logo.offset_x,
      y + logo.offset_y,
      logoWidth,
      logoHeight,
    );
    ctx.restore();
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
