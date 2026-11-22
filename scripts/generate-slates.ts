import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT_DIR = resolve('src/web/public/slates');
const LOGO_PATH = resolve('src/web/public/logo.png');

interface SlateSpec {
  name: string;
  width: number;
  height: number;
  isVertical: boolean;
  type: 'pause' | 'startup' | 'generic';
}

const SPECS: SlateSpec[] = [
  { name: 'relay-slate-vertical-720x1280.png', width: 720, height: 1280, isVertical: true, type: 'generic' },
  { name: 'relay-slate-horizontal-1280x720.png', width: 1280, height: 720, isVertical: false, type: 'generic' },
  { name: 'relay-pause-vertical-720x1280.png', width: 720, height: 1280, isVertical: true, type: 'pause' },
  { name: 'relay-pause-horizontal-1280x720.png', width: 1280, height: 720, isVertical: false, type: 'pause' },
  { name: 'relay-startup-vertical-720x1280.png', width: 720, height: 1280, isVertical: true, type: 'startup' },
  { name: 'relay-startup-horizontal-1280x720.png', width: 1280, height: 720, isVertical: false, type: 'startup' },
];

async function generateSlates() {
  console.log(`Generating RELAY branded slates into ${OUT_DIR}...`);
  const logo = existsSync(LOGO_PATH) ? await loadImage(LOGO_PATH) : null;

  for (const spec of SPECS) {
    const { name, width, height, isVertical, type } = spec;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 1. Deep Dark Background
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, '#06090e');
    bgGrad.addColorStop(0.5, '#080c14');
    bgGrad.addColorStop(1, '#05070a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // 2. Subtle Dark Grid / Tech Pattern
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
    ctx.lineWidth = 1;
    const gridSize = isVertical ? 48 : 64;
    for (let x = 0; x <= width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // 3. Ambient Glows (RELAY Neon Brand: Lime, Cyan, Violet, Emerald)
    const glow1 = ctx.createRadialGradient(
      width * 0.25, height * 0.25, 10,
      width * 0.25, height * 0.25, Math.min(width, height) * 0.7
    );
    glow1.addColorStop(0, 'rgba(61, 224, 140, 0.12)'); // Emerald / Lime
    glow1.addColorStop(1, 'rgba(61, 224, 140, 0)');
    ctx.fillStyle = glow1;
    ctx.fillRect(0, 0, width, height);

    const glow2 = ctx.createRadialGradient(
      width * 0.75, height * 0.7, 10,
      width * 0.75, height * 0.7, Math.min(width, height) * 0.75
    );
    glow2.addColorStop(0, 'rgba(38, 227, 255, 0.10)'); // Cyan
    glow2.addColorStop(1, 'rgba(38, 227, 255, 0)');
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, width, height);

    const glow3 = ctx.createRadialGradient(
      width * 0.5, height * 0.9, 10,
      width * 0.5, height * 0.9, Math.min(width, height) * 0.6
    );
    glow3.addColorStop(0, 'rgba(176, 92, 255, 0.08)'); // Purple / Neon Violet
    glow3.addColorStop(1, 'rgba(176, 92, 255, 0)');
    ctx.fillStyle = glow3;
    ctx.fillRect(0, 0, width, height);

    // 4. Subtle Decorative Brand Accent Lines
    const topBarGrad = ctx.createLinearGradient(width * 0.1, 0, width * 0.9, 0);
    topBarGrad.addColorStop(0, '#DFFF4F');
    topBarGrad.addColorStop(0.35, '#4CE07F');
    topBarGrad.addColorStop(0.7, '#26E3FF');
    topBarGrad.addColorStop(1, '#B05CFF');

    ctx.fillStyle = topBarGrad;
    ctx.fillRect(0, 0, width, 4); // Top subtle accent line

    // Bottom subtle accent line
    ctx.fillRect(0, height - 3, width, 3);

    // 5. Watermarked Large Logo in Center Background
    if (logo) {
      ctx.save();
      const watermarkSize = Math.min(width, height) * (isVertical ? 0.65 : 0.60);
      const wmX = (width - watermarkSize) / 2;
      const wmY = isVertical ? (height - watermarkSize) / 2 - 80 : (height - watermarkSize) / 2;
      ctx.globalAlpha = 0.06;
      ctx.drawImage(logo, wmX, wmY, watermarkSize, watermarkSize);
      ctx.restore();
    }

    // 6. Center Branding Card / Emblem
    if (logo) {
      const logoSize = isVertical ? 140 : 120;
      const logoX = (width - logoSize) / 2;
      const logoY = isVertical ? height * 0.30 : height * 0.24;

      // Glow behind logo
      ctx.save();
      const logoGlow = ctx.createRadialGradient(
        logoX + logoSize / 2, logoY + logoSize / 2, 10,
        logoX + logoSize / 2, logoY + logoSize / 2, logoSize * 1.2
      );
      logoGlow.addColorStop(0, 'rgba(76, 224, 127, 0.25)');
      logoGlow.addColorStop(1, 'rgba(76, 224, 127, 0)');
      ctx.fillStyle = logoGlow;
      ctx.fillRect(logoX - 50, logoY - 50, logoSize + 100, logoSize + 100);

      // Draw Logo
      ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
      ctx.restore();
    }

    // 7. Render Text for Pause or Startup screens
    if (type !== 'generic') {
      ctx.save();
      ctx.textAlign = 'center';

      // Header Text
      const title = type === 'pause' ? 'PAUSE' : 'STREAM STARTET';
      const subtitle = type === 'pause' ? 'Gleich geht es weiter' : 'Gleich geht’s los';
      const detail = type === 'pause'
        ? 'Der Stream wird in Kürze fortgesetzt'
        : 'Bereitmachen – wir verbinden die Regie';

      const baseY = isVertical ? height * 0.50 : height * 0.52;

      // Category Pill / Status
      const pillWidth = isVertical ? 220 : 200;
      const pillHeight = 32;
      const pillX = (width - pillWidth) / 2;
      const pillY = baseY - 48;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.beginPath();
      ctx.roundRect(pillX, pillY, pillWidth, pillHeight, 16);
      ctx.fill();
      ctx.strokeStyle = 'rgba(76, 224, 127, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Dot inside pill
      ctx.fillStyle = '#4CE07F';
      ctx.beginPath();
      ctx.arc(pillX + 24, pillY + pillHeight / 2, 5, 0, Math.PI * 2);
      ctx.fill();

      // Pill text
      ctx.fillStyle = '#4CE07F';
      ctx.font = '600 13px sans-serif';
      ctx.fillText(type === 'pause' ? 'LIVE RELAY PAUSED' : 'STARTUP SEQUENCE', pillX + pillWidth / 2 + 10, pillY + 21);

      // Main Title with gradient
      const titleY = baseY + (isVertical ? 40 : 36);
      const titleGrad = ctx.createLinearGradient(width * 0.3, titleY - 30, width * 0.7, titleY);
      titleGrad.addColorStop(0, '#FFFFFF');
      titleGrad.addColorStop(0.7, '#EDF2F7');
      titleGrad.addColorStop(1, '#CBD5E1');
      ctx.fillStyle = titleGrad;
      ctx.font = `bold ${isVertical ? 44 : 38}px sans-serif`;
      ctx.fillText(title, width / 2, titleY);

      // Subtitle
      const subY = titleY + (isVertical ? 46 : 38);
      ctx.fillStyle = '#94A3B8';
      ctx.font = `500 ${isVertical ? 24 : 20}px sans-serif`;
      ctx.fillText(subtitle, width / 2, subY);

      // Detail
      const detailY = subY + (isVertical ? 36 : 30);
      ctx.fillStyle = '#64748B';
      ctx.font = `400 ${isVertical ? 16 : 14}px sans-serif`;
      ctx.fillText(detail, width / 2, detailY);

      ctx.restore();
    } else {
      // Generic Background (Clean Slate ready for ffmpeg drawtext or custom titles)
      // Just a clean RELAY brand footer
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.font = '600 14px sans-serif';
      ctx.fillText('RELAY LIVE ENGINE', width / 2, height - 36);
      ctx.restore();
    }

    // Write PNG
    const buffer = canvas.toBuffer('image/png');
    const outPath = join(OUT_DIR, name);
    writeFileSync(outPath, buffer);
    console.log(`✓ Generated ${name} (${width}x${height}, ${(buffer.length / 1024).toFixed(1)} KB)`);
  }

  // Generate video loop with ffmpeg (5s smooth breathing loop for pause and startup)
  try {
    console.log('Generating 5s looping MP4 slates with ffmpeg...');
    // Vertical Video Loop (720x1280)
    execFileSync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-loop', '1', '-i', join(OUT_DIR, 'relay-pause-vertical-720x1280.png'),
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-t', '5',
      '-vf', 'fps=25,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18',
      '-c:a', 'aac', '-b:a', '128k',
      join(OUT_DIR, 'relay-pause-vertical-720x1280.mp4')
    ]);
    console.log('✓ Generated relay-pause-vertical-720x1280.mp4');

    // Horizontal Video Loop (1280x720)
    execFileSync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-loop', '1', '-i', join(OUT_DIR, 'relay-pause-horizontal-1280x720.png'),
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-t', '5',
      '-vf', 'fps=25,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18',
      '-c:a', 'aac', '-b:a', '128k',
      join(OUT_DIR, 'relay-pause-horizontal-1280x720.mp4')
    ]);
    console.log('✓ Generated relay-pause-horizontal-1280x720.mp4');
  } catch (err) {
    console.warn('Note: ffmpeg video generation skipped or failed:', err);
  }
}

generateSlates().catch(console.error);
