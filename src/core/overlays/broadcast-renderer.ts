import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { Settings } from '../config/schema.js';
import { VERSION } from '../../version.js';
import type { ChatMessage } from './chat-service.js';
import {
  formatClockText,
  formatTime,
  formatUptime,
  nameColor,
  overlayFontFamily,
  parseColor,
  rgba,
  roundedRect,
} from './canvas-utils.js';
import { formatVersionOverlayText, type OverlayPosition } from './drawtext.js';
import type { ChatEarningsCard, ChatQueueInput, ChatStreamerInfo } from './chat-engine.js';
import { buildQueueWindow } from './chat-engine.js';

export type BroadcastMode = 'glass_minimal' | 'ultra_clean';

export interface BroadcastLayerCache {
  canvas: Canvas | null;
  key: string;
}

export interface BroadcastRenderInput {
  mode: BroadcastMode;
  settings: Settings;
  cfg: Settings['overlays']['chat'];
  messages: ChatMessage[];
  streamer: ChatStreamerInfo | null;
  earnings: ChatEarningsCard | null;
  earningsText: string;
  queue: ChatQueueInput;
  viewers?: number | null;
  sessionStartTime: number;
  isPreviewSample: boolean;
}

interface BoxRect {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

function drawGlassBox(ctx: SKRSContext2D, rect: BoxRect, opacity: number): void {
  ctx.save();
  ctx.fillStyle = `rgba(12, 15, 22, ${(0.64 * opacity).toFixed(3)})`;
  roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.r);
  ctx.fill();
  ctx.strokeStyle = `rgba(255, 255, 255, ${(0.1 * opacity).toFixed(3)})`;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function applyTextShadow(ctx: SKRSContext2D, enabled: boolean): void {
  if (!enabled) {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    return;
  }
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 1;
}

function anchorRect(
  position: OverlayPosition,
  boxW: number,
  boxH: number,
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
  margin: number,
  radius: number,
): BoxRect {
  const baseX = position.endsWith('right') ? width - margin - boxW : margin;
  const baseY = position.startsWith('bottom') ? height - margin - boxH : margin;
  return {
    x: Math.max(0, Math.min(width - boxW, baseX + offsetX)),
    y: Math.max(0, Math.min(height - boxH, baseY + offsetY)),
    w: boxW,
    h: boxH,
    r: radius,
  };
}

function truncateText(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

function wrapTextWithFirstLine(
  ctx: SKRSContext2D,
  text: string,
  firstMaxW: number,
  nextMaxW: number,
  maxLines: number,
): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const limit = lines.length === 0 ? firstMaxW : nextMaxW;
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= limit) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = word;
    } else {
      lines.push(truncateText(ctx, word, limit));
      current = '';
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === 0) return [''];
  if (lines.length >= maxLines) {
    const limit = lines.length === 1 ? firstMaxW : nextMaxW;
    lines[maxLines - 1] = truncateText(ctx, lines[maxLines - 1]!, limit);
  }
  return lines.slice(0, maxLines);
}

/**
 * Renders the modern minimal broadcast overlays (`glass_minimal` and `ultra_clean`).
 * Static glass pill backgrounds are cached in `cache` to keep CPU usage minimal.
 */
export function renderBroadcastOverlay(
  ctx: SKRSContext2D,
  width: number,
  height: number,
  input: BroadcastRenderInput,
  cache: BroadcastLayerCache,
): void {
  const {
    mode,
    settings,
    cfg,
    messages,
    streamer,
    earnings,
    earningsText,
    queue,
    viewers,
    sessionStartTime,
    isPreviewSample,
  } = input;
  const isGlass = mode === 'glass_minimal';
  const font = overlayFontFamily();
  const opacity = Math.max(0.15, Math.min(1, cfg.bubble_opacity ?? 1));
  const margin = Math.max(16, Math.round(Math.min(width, height) * 0.022));
  const isLandscape = width >= height;

  // In 16:9 with a 9:16 centered feed, keep the center 9:16 column unobstructed.
  const centerFeedW = isLandscape ? Math.round((height * 9) / 16) : width;
  const pillarW = isLandscape ? Math.max(200, Math.floor((width - centerFeedW) / 2) - margin * 2) : width - margin * 2;

  const showStatus = cfg.top_banner_enabled !== false;
  const showChat = cfg.chat_monitor_enabled !== false;
  const showEarnings = cfg.banner_show_stats !== false && Boolean(earnings);
  const showGoal = cfg.banner_show_goal !== false && Boolean(earnings?.goalAmount && earnings.goalAmount > 0 && earnings.net !== null);
  const showQueue = cfg.queue_enabled && queue.labels.length > 0;

  const baseFont = Math.max(12, Math.min(36, cfg.font_size || 18));
  const smallFont = Math.max(11, Math.round(baseFont * 0.72));
  const statusFont =
    cfg.status_font_size && cfg.status_font_size > 0 ? cfg.status_font_size : smallFont;
  const earningsHudFont =
    cfg.earnings_hud_font_size && cfg.earnings_hud_font_size > 0
      ? cfg.earnings_hud_font_size
      : smallFont;
  const queueFont = cfg.queue_font_size > 0 ? cfg.queue_font_size : smallFont;

  const statusPillH = Math.max(28, Math.round(statusFont * 2.1));
  const earningsPillH = Math.max(28, Math.round(earningsHudFont * 2.1));

  // Layout rects (every element anchored to its configured corner + offset)
  const chatW = cfg.panel_width > 0 ? Math.min(width - margin * 2, cfg.panel_width) : pillarW;
  const chatH =
    cfg.panel_height > 0
      ? Math.min(height - margin * 2, cfg.panel_height)
      : isLandscape
        ? Math.round(height * 0.68)
        : Math.round(height * 0.38);
  const chatRect = anchorRect(
    cfg.position ?? 'bottom-left',
    chatW,
    chatH,
    cfg.offset_x,
    cfg.offset_y,
    width,
    height,
    margin,
    14,
  );

  const queueW =
    cfg.queue_width && cfg.queue_width > 0
      ? Math.min(width - margin * 2, cfg.queue_width)
      : Math.min(width - margin * 2, pillarW);
  const queueH = Math.max(46, Math.round(queueFont * 3.1));
  const queueRect = anchorRect(
    cfg.queue_position ?? 'bottom-right',
    queueW,
    queueH,
    cfg.queue_offset_x,
    cfg.queue_offset_y,
    width,
    height,
    margin,
    14,
  );

  const statusText = (() => {
    const name = streamer?.tiktok
      ? `@${streamer.tiktok.replace(/^@/, '')}`
      : streamer?.name || (isPreviewSample ? '@creator_live' : 'RELAY');
    const uptime = formatUptime(isPreviewSample ? 5050_000 : Date.now() - sessionStartTime);
    const viewerCount = viewers !== undefined && viewers !== null
      ? viewers
      : isPreviewSample
        ? 1284
        : null;
    const viewerLabel =
      viewerCount !== null
        ? `👥 ${Math.max(0, Math.round(viewerCount)).toLocaleString('de-DE')}`
        : null;
    return { name, uptime, viewerLabel };
  })();

  ctx.font = `600 ${statusFont}px ${font}`;
  const statusMeasured = statusText.viewerLabel
    ? `LIVE  ·  ${statusText.name}  ·  ${statusText.viewerLabel}  ·  ${statusText.uptime}`
    : `LIVE  ·  ${statusText.name}  ·  ${statusText.uptime}`;
  const statusPillW = Math.min(
    width - margin * 2,
    Math.round(ctx.measureText(statusMeasured).width + 54),
  );
  const statusRect = anchorRect(
    cfg.status_position ?? 'top-left',
    statusPillW,
    statusPillH,
    cfg.status_offset_x ?? 0,
    cfg.status_offset_y ?? 0,
    width,
    height,
    margin,
    statusPillH / 2,
  );

  ctx.font = `600 ${earningsHudFont}px ${font}`;
  const earningsSummary = earnings
    ? `${earnings.coins !== null ? `${Math.round(earnings.coins).toLocaleString('de-DE')} Coins` : ''}${
        earnings.coins !== null && earnings.net !== null ? '  ·  ' : ''
      }${earnings.net !== null ? `${earnings.currency === 'USD' ? '$' : '€'}${earnings.net.toFixed(2)}` : ''}`
    : '';
  const earningsPillW = earnings
    ? Math.min(
        width - margin * 2,
        Math.max(150, Math.round(ctx.measureText(earningsSummary || 'Einnahmen').width + 44)),
      )
    : 0;
  const earningsH = showGoal ? earningsPillH + 10 : earningsPillH;
  const earningsRect = anchorRect(
    cfg.earnings_hud_position ?? 'top-right',
    earningsPillW,
    earningsH,
    cfg.earnings_hud_offset_x ?? 0,
    cfg.earnings_hud_offset_y ?? 0,
    width,
    height,
    margin,
    showGoal ? 14 : earningsPillH / 2,
  );

  // Cache static glass backgrounds once per geometry/toggle signature
  ctx.clearRect(0, 0, width, height);
  if (isGlass) {
    const cacheKey = [
      width,
      height,
      opacity.toFixed(2),
      showStatus ? `${statusRect.x},${statusRect.y},${statusRect.w},${statusRect.h}` : '0',
      showEarnings ? `${earningsRect.x},${earningsRect.y},${earningsRect.w},${earningsRect.h}` : '0',
      showChat ? `${chatRect.x},${chatRect.y},${chatRect.w},${chatRect.h}` : '0',
      showQueue ? `${queueRect.x},${queueRect.y},${queueRect.w},${queueRect.h}` : '0',
    ].join('|');

    if (!cache.canvas || cache.key !== cacheKey) {
      const bg = createCanvas(width, height);
      const bctx = bg.getContext('2d');
      if (showStatus) drawGlassBox(bctx, statusRect, opacity);
      if (showEarnings && earningsPillW > 0) drawGlassBox(bctx, earningsRect, opacity);
      if (showChat) drawGlassBox(bctx, chatRect, opacity);
      if (showQueue) drawGlassBox(bctx, queueRect, opacity);
      cache.canvas = bg;
      cache.key = cacheKey;
    }
    ctx.drawImage(cache.canvas, 0, 0);
  }

  const textShadow = !isGlass;
  const textColor = rgba(parseColor(cfg.font_color, { r: 255, g: 255, b: 255, a: 1 }));

  // 1. Status Pill (top-left)
  if (showStatus) {
    ctx.save();
    applyTextShadow(ctx, textShadow);
    const cy = statusRect.y + statusRect.h / 2;
    let cursorX = statusRect.x + 14;

    // Live cyan dot
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath();
    ctx.arc(cursorX + 4, cy, 4, 0, Math.PI * 2);
    ctx.fill();
    cursorX += 14;

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `700 ${Math.max(10, statusFont - 1)}px ${font}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('LIVE', cursorX, cy);
    cursorX += ctx.measureText('LIVE').width + 8;

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('·', cursorX, cy);
    cursorX += 10;

    ctx.font = `600 ${statusFont}px ${font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillText(statusText.name, cursorX, cy);
    cursorX += ctx.measureText(statusText.name).width + 8;

    if (statusText.viewerLabel) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText('·', cursorX, cy);
      cursorX += 10;

      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(statusText.viewerLabel, cursorX, cy);
      cursorX += ctx.measureText(statusText.viewerLabel).width + 8;
    }

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('·', cursorX, cy);
    cursorX += 10;

    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText(statusText.uptime, cursorX, cy);
    ctx.restore();
  }

  // 2. Earnings Pill (top-right)
  if (showEarnings && earnings && earningsPillW > 0) {
    ctx.save();
    applyTextShadow(ctx, textShadow);
    const cy = showGoal
      ? earningsRect.y + earningsPillH / 2 - 1
      : earningsRect.y + earningsRect.h / 2;
    let cursorX = earningsRect.x + 14;

    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(cursorX + 3.5, cy, 3.5, 0, Math.PI * 2);
    ctx.fill();
    cursorX += 13;

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `600 ${earningsHudFont}px ${font}`;

    if (earnings.coins !== null) {
      const coinsStr = `${Math.round(earnings.coins).toLocaleString('de-DE')} Coins`;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(coinsStr, cursorX, cy);
      cursorX += ctx.measureText(coinsStr).width + 8;
    }
    if (earnings.coins !== null && earnings.net !== null) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText('·', cursorX, cy);
      cursorX += 10;
    }
    if (earnings.net !== null) {
      const sym = earnings.currency === 'USD' ? '$' : '€';
      ctx.fillStyle = '#67e8f9';
      ctx.font = `700 ${earningsHudFont}px ${font}`;
      ctx.fillText(`${sym}${earnings.net.toFixed(2)}`, cursorX, cy);
    }

    if (showGoal && earnings.goalAmount && earnings.net !== null) {
      const ratio = Math.max(0, Math.min(1, earnings.net / earnings.goalAmount));
      const barX = earningsRect.x + 14;
      const barY = earningsRect.y + earningsRect.h - 9;
      const barW = earningsRect.w - 28;
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      roundedRect(ctx, barX, barY, barW, 3, 1.5);
      ctx.fill();
      if (ratio > 0) {
        ctx.fillStyle = '#22d3ee';
        roundedRect(ctx, barX, barY, Math.max(4, barW * ratio), 3, 1.5);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // 3. Chat Area (never overlaps name & wraps full width on continuation lines)
  if (showChat && messages.length > 0) {
    ctx.save();
    applyTextShadow(ctx, textShadow);
    const padX = 14;
    const padY = 12;
    const innerW = Math.max(80, chatRect.w - padX * 2);
    const lineH = Math.round(baseFont * 1.38);
    const visible = messages.slice(-cfg.max_lines);

    let y = chatRect.y + chatRect.h - padY;
    const topLimit = chatRect.y + padY;

    for (let i = visible.length - 1; i >= 0; i -= 1) {
      const msg = visible[i]!;
      const rawName = (msg.displayName || msg.username || 'Chat').slice(0, 32);
      const timeStr = cfg.show_timestamps ? `${formatTime(msg)} ` : '';
      const tierStr = cfg.show_badges && cfg.show_tiers && msg.tier ? ` [${msg.tier}]` : '';

      ctx.font = `${Math.max(10, Math.round(baseFont * 0.8))}px ${font}`;
      const timeOffset = timeStr ? ctx.measureText(timeStr).width : 0;

      ctx.font = `700 ${baseFont}px ${font}`;
      const maxNameW = Math.max(48, Math.round(innerW * 0.46) - timeOffset);
      const nameLabel = truncateText(ctx, `${rawName}${tierStr}`, maxNameW);
      const nameW = ctx.measureText(nameLabel).width;
      const gap = 8;
      const firstLineMaxW = Math.max(50, innerW - timeOffset - nameW - gap);

      ctx.font = `${baseFont}px ${font}`;
      const lines = wrapTextWithFirstLine(ctx, msg.text, firstLineMaxW, innerW, 4);
      const blockH = lines.length * lineH + 5;
      if (y - blockH < topLimit) break;

      const rowTop = y - blockH;
      const relY = (rowTop - topLimit) / Math.max(1, chatRect.h - padY * 2);
      const fadeAlpha = relY < 0.22 ? Math.max(0.25, relY / 0.22) : 1;

      ctx.globalAlpha = fadeAlpha;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';

      if (timeStr) {
        ctx.font = `${Math.max(10, Math.round(baseFont * 0.8))}px ${font}`;
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillText(timeStr, chatRect.x + padX, rowTop + 2);
      }

      ctx.font = `700 ${baseFont}px ${font}`;
      ctx.fillStyle = cfg.name_colors ? nameColor(rawName) : '#67e8f9';
      ctx.fillText(nameLabel, chatRect.x + padX + timeOffset, rowTop);

      const textStartX = chatRect.x + padX + timeOffset + nameW + gap;
      ctx.font = `${baseFont}px ${font}`;
      ctx.fillStyle = textColor;
      lines.forEach((line, idx) => {
        ctx.fillText(line, idx === 0 ? textStartX : chatRect.x + padX, rowTop + idx * lineH);
      });

      y = rowTop - 5;
    }
    ctx.restore();
  }

  // 4. Regie-Queue Pill
  if (showQueue) {
    const win = buildQueueWindow(queue.labels, queue.activeIndex, cfg.queue_max_entries);
    if (win.labels.length > 0) {
      ctx.save();
      applyTextShadow(ctx, textShadow);
      const padX = 14;
      const headerFont = Math.max(10, Math.round(queueFont * 0.82));
      const itemFont = Math.max(11, queueFont);
      const activeColor = rgba(parseColor(cfg.queue_active_color, { r: 34, g: 211, b: 238, a: 1 }));

      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.font = `700 ${headerFont}px ${font}`;
      ctx.fillStyle = 'rgba(255,255,255,0.48)';
      ctx.fillText('REGIE-QUEUE', queueRect.x + padX, queueRect.y + 8);

      if (queue.activeIndex !== null && queue.activeIndex >= 0) {
        ctx.textAlign = 'right';
        ctx.fillStyle = activeColor;
        ctx.fillText(
          `${queue.activeIndex + 1}/${queue.labels.length}`,
          queueRect.x + queueRect.w - padX,
          queueRect.y + 8,
        );
      }

      ctx.textAlign = 'left';
      ctx.font = `600 ${itemFont}px ${font}`;
      let x = queueRect.x + padX;
      const rowY = queueRect.y + queueRect.h - itemFont - 10;
      const maxX = queueRect.x + queueRect.w - padX;
      const availW = Math.max(40, maxX - x);
      const sep = ' → ';
      const sepW = ctx.measureText(sep).width;
      const ellipsisW = ctx.measureText('… ').width;

      // Advance startIdx so the active entry is always visible inside availW.
      let startIdx = 0;
      if (win.activeOffset > 0) {
        while (startIdx < win.activeOffset) {
          const hasLead = win.hasBefore || startIdx > 0;
          let needed = hasLead ? ellipsisW : 0;
          for (let j = startIdx; j <= win.activeOffset; j += 1) {
            if (j > startIdx) needed += sepW;
            const txt = j === win.activeOffset ? `▶ ${win.labels[j]}` : win.labels[j]!;
            needed += ctx.measureText(txt).width;
          }
          if (needed <= availW) break;
          startIdx += 1;
        }
      }

      if (win.hasBefore || startIdx > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillText('… ', x, rowY);
        x += ellipsisW;
      }

      for (let i = startIdx; i < win.labels.length; i += 1) {
        if (i > startIdx) {
          if (x + sepW > maxX) break;
          ctx.fillStyle = 'rgba(255,255,255,0.32)';
          ctx.fillText(sep, x, rowY);
          x += sepW;
        }
        const isActive = i === win.activeOffset;
        const rawLabel = isActive ? `▶ ${win.labels[i]}` : win.labels[i]!;
        const lw = ctx.measureText(rawLabel).width;
        if (x + lw > maxX) {
          if (isActive) {
            ctx.fillStyle = activeColor;
            ctx.fillText(truncateText(ctx, rawLabel, Math.max(20, maxX - x)), x, rowY);
          } else {
            ctx.fillStyle = 'rgba(255,255,255,0.45)';
            ctx.fillText('…', x, rowY);
          }
          break;
        }
        ctx.fillStyle = isActive ? activeColor : 'rgba(255,255,255,0.78)';
        ctx.fillText(rawLabel, x, rowY);
        x += lw;
      }
      ctx.restore();
    }
  }

  // 5. Unified Clock, Text, Version & Standalone Earnings overlays (no drawtext needed)
  const overlays = settings.overlays;
  if (overlays.clock.enabled) {
    drawPositionedOverlayText(ctx, formatClockText(overlays.clock.format), {
      width,
      height,
      position: overlays.clock.position,
      fontSize: overlays.clock.font_size,
      fontColor: overlays.clock.font_color,
      showBox: isGlass && overlays.clock.show_box,
      opacity,
      margin: overlays.clock.margin,
      offsetX: overlays.clock.offset_x,
      offsetY: overlays.clock.offset_y,
      font,
      textShadow,
    });
  }

  if (overlays.text.enabled && overlays.text.text.trim()) {
    drawPositionedOverlayText(ctx, overlays.text.text, {
      width,
      height,
      position: overlays.text.position,
      fontSize: overlays.text.font_size,
      fontColor: overlays.text.font_color,
      showBox: isGlass && overlays.text.show_box,
      opacity,
      margin: overlays.text.margin,
      offsetX: overlays.text.offset_x,
      offsetY: overlays.text.offset_y,
      font,
      textShadow,
    });
  }

  if (overlays.version.enabled) {
    const versionLabel = formatVersionOverlayText(overlays.version, VERSION);
    if (versionLabel) {
      drawPositionedOverlayText(ctx, versionLabel, {
        width,
        height,
        position: overlays.version.position,
        fontSize: overlays.version.font_size,
        fontColor: overlays.version.font_color,
        showBox: isGlass && overlays.version.show_box,
        opacity,
        margin: overlays.version.margin,
        offsetX: overlays.version.offset_x,
        offsetY: overlays.version.offset_y,
        font,
        textShadow,
      });
    }
  }

  if (settings.earnings.overlay_enabled && earningsText.trim()) {
    drawPositionedOverlayText(ctx, earningsText, {
      width,
      height,
      position: settings.earnings.overlay_position,
      fontSize: settings.earnings.overlay_font_size,
      fontColor: settings.earnings.overlay_font_color,
      showBox: isGlass && settings.earnings.overlay_show_box,
      opacity,
      margin: settings.earnings.overlay_margin,
      offsetX: settings.earnings.overlay_offset_x,
      offsetY: settings.earnings.overlay_offset_y,
      font,
      textShadow,
    });
  }
}

function drawPositionedOverlayText(
  ctx: SKRSContext2D,
  rawText: string,
  opts: {
    width: number;
    height: number;
    position: OverlayPosition;
    fontSize: number;
    fontColor: string;
    showBox: boolean;
    opacity: number;
    margin: number;
    offsetX: number;
    offsetY: number;
    font: string;
    textShadow: boolean;
  },
): void {
  const lines = rawText.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 1 && lines[lines.length - 1]?.trim() === '') lines.pop();
  if (lines.length === 0) return;

  ctx.save();
  ctx.font = `600 ${opts.fontSize}px ${opts.font}`;
  ctx.textBaseline = 'top';
  const availW = Math.max(40, opts.width - opts.margin * 2);
  const lineH = Math.round(opts.fontSize * 1.32);
  const widths = lines.map((line) => Math.min(availW, ctx.measureText(line).width));
  const blockW = Math.max(0, ...widths);
  const blockH = lineH * lines.length;
  const isRight = opts.position.endsWith('right');
  const isTop = opts.position.startsWith('top');
  const padX = opts.showBox ? 12 : 0;
  const padY = opts.showBox ? 6 : 0;
  const rawX =
    (isRight ? Math.max(opts.margin, opts.width - blockW - opts.margin) : opts.margin) +
    opts.offsetX;
  const rawY =
    (isTop ? opts.margin : Math.max(opts.margin, opts.height - blockH - opts.margin)) +
    opts.offsetY;
  const x = Math.max(padX, Math.min(Math.max(padX, opts.width - blockW - padX), rawX));
  const y = Math.max(padY, Math.min(Math.max(padY, opts.height - blockH - padY), rawY));

  if (opts.showBox) {
    drawGlassBox(
      ctx,
      {
        x: x - 12,
        y: y - 6,
        w: blockW + 24,
        h: blockH + 10,
        r: lines.length === 1 ? (blockH + 10) / 2 : 12,
      },
      opts.opacity,
    );
  }

  applyTextShadow(ctx, opts.textShadow);
  ctx.fillStyle = rgba(parseColor(opts.fontColor, { r: 255, g: 255, b: 255, a: 1 }));
  lines.forEach((line, idx) => {
    const lx = isRight ? x + (blockW - (widths[idx] ?? 0)) : x;
    ctx.fillText(line, lx, y + idx * lineH, availW);
  });
  ctx.restore();
}
