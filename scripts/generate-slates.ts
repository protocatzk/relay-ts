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
  variant?: 'default' | 'studio' | 'minimal' | 'cyber';
}

const SPECS: SlateSpec[] = [
  // 9:16 Vertical
  { name: 'relay-slate-vertical-720x1280.png', width: 720, height: 1280, isVertical: true, type: 'generic' },
  { name: 'relay-pause-vertical-720x1280.png', width: 720, height: 1280, isVertical: true, type: 'pause', variant: 'default' },
  { name: 'relay-startup-vertical-720x1280.png', width: 720, height: 1280, isVertical: true, type: 'startup', variant: 'default' },

  // 16:9 Horizontal (1280x720) - Mehrere attraktive Varianten
  { name: 'relay-slate-horizontal-1280x720.png', width: 1280, height: 720, isVertical: false, type: 'generic' },
  { name: 'relay-pause-horizontal-1280x720.png', width: 1280, height: 720, isVertical: false, type: 'pause', variant: 'default' },
  { name: 'relay-startup-horizontal-1280x720.png', width: 1280, height: 720, isVertical: false, type: 'startup', variant: 'default' },
  { name: 'relay-pause-studio-1280x720.png', width: 1280, height: 720, isVertical: false, type: 'pause', variant: 'studio' },
  { name: 'relay-pause-minimal-1280x720.png', width: 1280, height: 720, isVertical: false, type: 'pause', variant: 'minimal' },
  { name: 'relay-pause-cyber-1280x720.png', width: 1280, height: 720, isVertical: false, type: 'pause', variant: 'cyber' },
];

async function generateSlates() {
  console.log(`Generating RELAY branded slates into ${OUT_DIR}...`);
  const logo = existsSync(LOGO_PATH) ? await loadImage(LOGO_PATH) : null;

  for (const spec of SPECS) {
    const { name, width, height, isVertical, type, variant = 'default' } = spec;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 1. Deep Dark Background
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    if (variant === 'cyber') {
      bgGrad.addColorStop(0, '#04060a');
      bgGrad.addColorStop(0.5, '#070b16');
      bgGrad.addColorStop(1, '#0b0614');
    } else if (variant === 'studio') {
      bgGrad.addColorStop(0, '#0a0d14');
      bgGrad.addColorStop(0.5, '#0d121c');
      bgGrad.addColorStop(1, '#07090f');
    } else {
      bgGrad.addColorStop(0, '#06090e');
      bgGrad.addColorStop(0.5, '#080c14');
      bgGrad.addColorStop(1, '#05070a');
    }
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // 2. Grid & Tech Pattern
    if (variant !== 'minimal') {
      ctx.strokeStyle = variant === 'cyber' ? 'rgba(38, 227, 255, 0.04)' : 'rgba(255, 255, 255, 0.025)';
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
    }

    // 3. Ambient Glows
    const glow1 = ctx.createRadialGradient(
      width * 0.25, height * 0.25, 10,
      width * 0.25, height * 0.25, Math.min(width, height) * 0.75
    );
    glow1.addColorStop(0, variant === 'cyber' ? 'rgba(38, 227, 255, 0.16)' : 'rgba(61, 224, 140, 0.12)');
    glow1.addColorStop(1, 'rgba(61, 224, 140, 0)');
    ctx.fillStyle = glow1;
    ctx.fillRect(0, 0, width, height);

    const glow2 = ctx.createRadialGradient(
      width * 0.75, height * 0.7, 10,
      width * 0.75, height * 0.7, Math.min(width, height) * 0.8
    );
    glow2.addColorStop(0, variant === 'cyber' ? 'rgba(176, 92, 255, 0.14)' : 'rgba(38, 227, 255, 0.10)');
    glow2.addColorStop(1, 'rgba(38, 227, 255, 0)');
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, width, height);

    // 4. Accent Lines
    const topBarGrad = ctx.createLinearGradient(width * 0.1, 0, width * 0.9, 0);
    topBarGrad.addColorStop(0, '#DFFF4F');
    topBarGrad.addColorStop(0.35, '#4CE07F');
    topBarGrad.addColorStop(0.7, '#26E3FF');
    topBarGrad.addColorStop(1, '#B05CFF');

    ctx.fillStyle = topBarGrad;
    ctx.fillRect(0, 0, width, 4);
    ctx.fillRect(0, height - 3, width, 3);

    // 5. Large Watermark Logo
    if (logo && variant !== 'minimal') {
      ctx.save();
      const watermarkSize = Math.min(width, height) * (isVertical ? 0.65 : 0.62);
      const wmX = (width - watermarkSize) / 2;
      const wmY = isVertical ? (height - watermarkSize) / 2 - 80 : (height - watermarkSize) / 2;
      ctx.globalAlpha = variant === 'cyber' ? 0.08 : 0.06;
      ctx.drawImage(logo, wmX, wmY, watermarkSize, watermarkSize);
      ctx.restore();
    }

    // 6. Center Branding Emblem
    if (logo) {
      const logoSize = isVertical ? 140 : 124;
      const logoX = (width - logoSize) / 2;
      const logoY = isVertical ? height * 0.28 : height * 0.22;

      ctx.save();
      const logoGlow = ctx.createRadialGradient(
        logoX + logoSize / 2, logoY + logoSize / 2, 10,
        logoX + logoSize / 2, logoY + logoSize / 2, logoSize * 1.3
      );
      logoGlow.addColorStop(0, variant === 'cyber' ? 'rgba(38, 227, 255, 0.3)' : 'rgba(76, 224, 127, 0.25)');
      logoGlow.addColorStop(1, 'rgba(76, 224, 127, 0)');
      ctx.fillStyle = logoGlow;
      ctx.fillRect(logoX - 60, logoY - 60, logoSize + 120, logoSize + 120);

      ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
      ctx.restore();
    }

    // 7. Render Text & Status Pill
    if (type !== 'generic') {
      ctx.save();
      ctx.textAlign = 'center';

      const title = type === 'pause' ? 'PAUSE' : 'STREAM STARTET';
      let subtitle = type === 'pause' ? 'Gleich geht es weiter' : 'Gleich geht’s los';
      let detail = type === 'pause'
        ? 'Der Stream wird in Kürze fortgesetzt'
        : 'Bereitmachen – wir verbinden die Regie';

      if (variant === 'studio') {
        subtitle = 'Kurze Sendepause';
        detail = 'Das Signal wird optimiert – gleich wieder live';
      } else if (variant === 'cyber') {
        subtitle = 'Übertragung unterbrochen';
        detail = 'Signal wird synchronisiert // Bitte warten';
      }

      const baseY = isVertical ? height * 0.50 : height * 0.50;

      // Status Pill
      const pillWidth = isVertical ? 220 : 210;
      const pillHeight = 32;
      const pillX = (width - pillWidth) / 2;
      const pillY = baseY - 48;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.beginPath();
      ctx.roundRect(pillX, pillY, pillWidth, pillHeight, 16);
      ctx.fill();
      ctx.strokeStyle = variant === 'cyber' ? 'rgba(38, 227, 255, 0.4)' : 'rgba(76, 224, 127, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Dot inside pill
      ctx.fillStyle = variant === 'cyber' ? '#26E3FF' : '#4CE07F';
      ctx.beginPath();
      ctx.arc(pillX + 24, pillY + pillHeight / 2, 5, 0, Math.PI * 2);
      ctx.fill();

      // Pill text
      ctx.fillStyle = variant === 'cyber' ? '#26E3FF' : '#4CE07F';
      ctx.font = '600 13px sans-serif';
      ctx.fillText(
        type === 'pause' ? (variant === 'cyber' ? 'RELAY SIGNAL PAUSED' : 'LIVE RELAY PAUSED') : 'STARTUP SEQUENCE',
        pillX + pillWidth / 2 + 10,
        pillY + 21
      );

      // Main Title with gradient
      const titleY = baseY + (isVertical ? 40 : 36);
      const titleGrad = ctx.createLinearGradient(width * 0.3, titleY - 30, width * 0.7, titleY);
      titleGrad.addColorStop(0, '#FFFFFF');
      titleGrad.addColorStop(0.7, '#EDF2F7');
      titleGrad.addColorStop(1, '#CBD5E1');
      ctx.fillStyle = titleGrad;
      ctx.font = `bold ${isVertical ? 44 : 40}px sans-serif`;
      ctx.fillText(title, width / 2, titleY);

      // Subtitle
      const subY = titleY + (isVertical ? 46 : 40);
      ctx.fillStyle = '#94A3B8';
      ctx.font = `500 ${isVertical ? 24 : 22}px sans-serif`;
      ctx.fillText(subtitle, width / 2, subY);

      // Detail
      const detailY = subY + (isVertical ? 36 : 30);
      ctx.fillStyle = '#64748B';
      ctx.font = `400 ${isVertical ? 16 : 15}px sans-serif`;
      ctx.fillText(detail, width / 2, detailY);

      ctx.restore();
    } else {
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

  // Generate video loops with ffmpeg
  try {
    console.log('Generating looping MP4 slates with ffmpeg...');
    const loops = [
      { png: 'relay-pause-vertical-720x1280.png', mp4: 'relay-pause-vertical-720x1280.mp4' },
      { png: 'relay-pause-horizontal-1280x720.png', mp4: 'relay-pause-horizontal-1280x720.mp4' },
      { png: 'relay-pause-studio-1280x720.png', mp4: 'relay-pause-studio-1280x720.mp4' },
      { png: 'relay-pause-cyber-1280x720.png', mp4: 'relay-pause-cyber-1280x720.mp4' },
    ];

    for (const loop of loops) {
      execFileSync('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-loop', '1', '-i', join(OUT_DIR, loop.png),
        '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-t', '5',
        '-vf', 'fps=25,format=yuv420p',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18',
        '-c:a', 'aac', '-b:a', '128k',
        join(OUT_DIR, loop.mp4)
      ]);
      console.log(`✓ Generated ${loop.mp4}`);
    }
  } catch (err) {
    console.warn('Note: ffmpeg video generation skipped or failed:', err);
  }
}

generateSlates().catch(console.error);
