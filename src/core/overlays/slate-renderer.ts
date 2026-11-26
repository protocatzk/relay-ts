import { createCanvas } from '@napi-rs/canvas';
import type { Settings } from '../config/schema.js';
import { overlayFontFamily, parseColor, rgba, roundedRect } from './canvas-utils.js';

export interface SlateRenderOptions {
  screen: 'pause' | 'startup';
  width: number;
  height: number;
  text: string;
  subtext: string;
  color?: string;
  textColor?: string;
  layoutMode?: Settings['overlays']['chat']['layout_mode'];
}

function wrapLines(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const paragraphs = text.replace(/\r\n?/g, '\n').split('\n');
  const lines: string[] = [];
  for (const para of paragraphs) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
        if (lines.length >= maxLines) break;
      }
    }
    if (current && lines.length < maxLines) lines.push(current);
    if (lines.length >= maxLines) break;
  }
  return lines.slice(0, maxLines);
}

/**
 * Renders a modern, minimalist pause or startup slate as a PNG buffer,
 * matching the `glass_minimal` / `ultra_clean` broadcast design.
 */
export function renderSlatePng(options: SlateRenderOptions): Buffer {
  const { width, height, screen } = options;
  const font = overlayFontFamily();
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const isUltraClean = options.layoutMode === 'ultra_clean';
  const minDim = Math.min(width, height);

  // 1. Deep modern dark gradient background
  const baseBg = parseColor(options.color || '#0b0e14', { r: 11, g: 14, b: 20, a: 1 });
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, `rgb(${baseBg.r},${baseBg.g},${baseBg.b})`);
  grad.addColorStop(
    1,
    `rgb(${Math.max(4, baseBg.r - 5)},${Math.max(5, baseBg.g - 6)},${Math.max(9, baseBg.b - 7)})`,
  );
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Subtle ambient radial glow (cyan for startup, soft cyan/blue for pause)
  const glow = ctx.createRadialGradient(
    width * 0.5,
    height * 0.42,
    0,
    width * 0.5,
    height * 0.42,
    Math.max(width, height) * 0.55,
  );
  if (screen === 'startup') {
    glow.addColorStop(0, 'rgba(34, 211, 238, 0.14)');
    glow.addColorStop(0.55, 'rgba(59, 130, 246, 0.05)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  } else {
    glow.addColorStop(0, 'rgba(56, 189, 248, 0.11)');
    glow.addColorStop(0.55, 'rgba(14, 165, 233, 0.04)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  }
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Faint architectural grid lines for depth
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
  ctx.lineWidth = 1;
  const step = Math.max(64, Math.round(minDim / 8));
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

  // 2. Measure typography
  const titleSize = Math.max(24, Math.min(64, Math.round(minDim * 0.056)));
  const subSize = Math.max(14, Math.min(32, Math.round(titleSize * 0.52)));
  const badgeSize = Math.max(11, Math.min(18, Math.round(titleSize * 0.3)));

  const cardMaxW = Math.min(Math.round(width * 0.82), 780);
  const padX = Math.max(28, Math.round(minDim * 0.05));
  const padY = Math.max(26, Math.round(minDim * 0.045));
  const textMaxW = Math.max(160, cardMaxW - padX * 2);

  ctx.font = `700 ${titleSize}px ${font}`;
  const titleLines = options.text.trim() ? wrapLines(ctx, options.text.trim(), textMaxW, 3) : [];
  const titleLineH = Math.round(titleSize * 1.24);

  ctx.font = `500 ${subSize}px ${font}`;
  const subLines = options.subtext.trim()
    ? wrapLines(ctx, options.subtext.trim(), textMaxW, 3)
    : [];
  const subLineH = Math.round(subSize * 1.38);

  const badgeLabel = screen === 'startup' ? 'STREAM STARTET' : 'PAUSE';
  ctx.font = `700 ${badgeSize}px ${font}`;
  const badgeW = Math.round(ctx.measureText(badgeLabel).width + 36);
  const badgeH = Math.max(24, Math.round(badgeSize * 2));

  const titleBlockH = titleLines.length * titleLineH;
  const subBlockH = subLines.length * subLineH;
  const gapTitle = titleLines.length > 0 ? 18 : 0;
  const gapSub = subLines.length > 0 ? 12 : 0;

  const contentH = badgeH + gapTitle + titleBlockH + gapSub + subBlockH;
  const cardH = contentH + padY * 2 + 10;
  const cardW = cardMaxW;
  const cardX = Math.round((width - cardW) / 2);
  const cardY = Math.round((height - cardH) / 2);

  // 3. Glass Card (unless ultra_clean)
  if (!isUltraClean) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 32;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = 'rgba(12, 15, 22, 0.72)';
    roundedRect(ctx, cardX, cardY, cardW, cardH, 20);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 1;
    roundedRect(ctx, cardX, cardY, cardW, cardH, 20);
    ctx.stroke();

    // Subtle top accent bar
    const accentGrad = ctx.createLinearGradient(cardX + 40, 0, cardX + cardW - 40, 0);
    accentGrad.addColorStop(0, 'rgba(34, 211, 238, 0)');
    accentGrad.addColorStop(0.5, screen === 'startup' ? 'rgba(34, 211, 238, 0.8)' : 'rgba(251, 191, 36, 0.75)');
    accentGrad.addColorStop(1, 'rgba(34, 211, 238, 0)');
    ctx.fillStyle = accentGrad;
    ctx.fillRect(cardX + 40, cardY, cardW - 80, 2);
    ctx.restore();
  }

  // 4. Status Pill
  let cursorY = cardY + padY;
  const badgeX = Math.round((width - badgeW) / 2);
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  roundedRect(ctx, badgeX, cursorY, badgeW, badgeH, badgeH / 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const dotColor = screen === 'startup' ? '#22d3ee' : '#fbbf24';
  const badgeCy = cursorY + badgeH / 2;
  ctx.fillStyle = dotColor;
  ctx.beginPath();
  ctx.arc(badgeX + 14, badgeCy, 3.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = `700 ${badgeSize}px ${font}`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(badgeLabel, badgeX + 24, badgeCy);
  ctx.restore();

  cursorY += badgeH + gapTitle;

  // 5. Title
  const textColor = rgba(parseColor(options.textColor || 'white', { r: 255, g: 255, b: 255, a: 1 }));
  if (titleLines.length > 0) {
    ctx.save();
    ctx.font = `700 ${titleSize}px ${font}`;
    ctx.fillStyle = textColor;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    if (isUltraClean) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 2;
    }
    titleLines.forEach((line, idx) => {
      ctx.fillText(line, width / 2, cursorY + idx * titleLineH);
    });
    ctx.restore();
    cursorY += titleBlockH + gapSub;
  }

  // 6. Subtext
  if (subLines.length > 0) {
    ctx.save();
    ctx.font = `500 ${subSize}px ${font}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.68)';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    subLines.forEach((line, idx) => {
      ctx.fillText(line, width / 2, cursorY + idx * subLineH);
    });
    ctx.restore();
  }

  // 7. Subtle RELAY watermark at bottom
  ctx.save();
  ctx.font = `600 ${Math.max(10, Math.round(minDim * 0.018))}px ${font}`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('RELAY', width / 2, height - Math.max(18, Math.round(minDim * 0.03)));
  ctx.restore();

  return canvas.toBuffer('image/png');
}
