import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';

const WIDTH = 720;
const HEIGHT = 1280;
const FPS = 20;
const DURATION = 8;
const FRAMES = FPS * DURATION;
const OUTPUT = resolve(process.argv[2] ?? 'data/pause/pause-420x.mp4');
const GREEN = '#3fb950';
const LIGHT = '#7ee787';

const canvas = createCanvas(WIDTH, HEIGHT);
const ctx = canvas.getContext('2d');
const TAU = Math.PI * 2;

function rgba(hex, alpha) {
  const value = hex.replace('#', '');
  return `rgba(${parseInt(value.slice(0, 2), 16)},${parseInt(value.slice(2, 4), 16)},${parseInt(value.slice(4, 6), 16)},${alpha})`;
}

function drawBackground() {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const glow = ctx.createRadialGradient(360, 480, 20, 360, 480, 720);
  glow.addColorStop(0, 'rgba(11,42,22,0.95)');
  glow.addColorStop(0.45, 'rgba(4,10,6,0.9)');
  glow.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawWire() {
  ctx.save();
  ctx.translate(360, 620);
  ctx.rotate((35 * Math.PI) / 180);
  ctx.strokeStyle = 'rgba(32,53,42,0.8)';
  ctx.lineWidth = 1.1;
  for (let x = -1100; x <= 1100; x += 72) {
    ctx.beginPath();
    ctx.moveTo(x, -1100);
    ctx.lineTo(x, 1100);
    ctx.stroke();
  }
  for (let y = -1100; y <= 1100; y += 72) {
    ctx.beginPath();
    ctx.moveTo(-1100, y);
    ctx.lineTo(1100, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(21,36,28,0.55)';
  ctx.lineWidth = 0.7;
  for (let i = -1100; i <= 1100; i += 72) {
    ctx.beginPath();
    ctx.moveTo(i, -1100);
    ctx.lineTo(i + 1100, 1100);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(63,185,80,0.25)';
  for (let x = -1080; x <= 1080; x += 72) {
    for (let y = -1080; y <= 1080; y += 72) {
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = '#2b4a36';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-60, 1060);
  ctx.bezierCurveTo(140, 930, 220, 1110, 410, 980);
  ctx.bezierCurveTo(540, 900, 690, 930, 800, 1040);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-40, 180);
  ctx.bezierCurveTo(160, 260, 260, 80, 430, 170);
  ctx.bezierCurveTo(560, 230, 680, 250, 780, 140);
  ctx.stroke();
  ctx.restore();
}

function drawRing(t) {
  const cx = 360;
  const cy = 500;
  const pulse = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * TAU * 0.35));
  const halo = ctx.createRadialGradient(cx, cy, 90, cx, cy, 270);
  halo.addColorStop(0, 'rgba(63,185,80,0)');
  halo.addColorStop(0.78, `rgba(63,185,80,${0.14 * pulse})`);
  halo.addColorStop(1, 'rgba(63,185,80,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(cx - 280, cy - 280, 560, 560);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.shadowColor = GREEN;
  ctx.shadowBlur = 22;
  ctx.lineCap = 'round';

  const outer = t * TAU * (1 / 9);
  ctx.save();
  ctx.rotate(outer);
  ctx.strokeStyle = GREEN;
  ctx.lineWidth = 7;
  for (let i = 0; i < 4; i += 1) {
    const start = (i * TAU) / 4;
    ctx.beginPath();
    ctx.arc(0, 0, 196, start, start + 0.42);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 196, start + 0.58, start + 0.62);
    ctx.stroke();
  }
  ctx.strokeStyle = LIGHT;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.8;
  for (let i = 0; i < 12; i += 1) {
    const start = (i * TAU) / 12;
    ctx.beginPath();
    ctx.arc(0, 0, 196, start, start + 0.03);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#e6ffed';
  ctx.beginPath();
  ctx.arc(196, 0, 9, 0, TAU);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.rotate(-t * TAU * (1 / 14));
  ctx.strokeStyle = rgba(GREEN, 0.65);
  ctx.lineWidth = 3;
  for (let i = 0; i < 6; i += 1) {
    const start = (i * TAU) / 6;
    ctx.beginPath();
    ctx.arc(0, 0, 132, start, start + 0.32);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = rgba(GREEN, 0.45 + 0.3 * pulse);
  ctx.lineWidth = 2;
  for (let i = 0; i < 24; i += 1) {
    const start = (i * TAU) / 24;
    ctx.beginPath();
    ctx.arc(0, 0, 66, start, start + 0.025);
    ctx.stroke();
  }
  ctx.shadowBlur = 28;
  ctx.fillStyle = GREEN;
  ctx.beginPath();
  ctx.arc(0, 0, 18 * (0.9 + 0.1 * pulse), 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, 6.5, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function centeredText(value, y, size, weight, color, spacing = 0) {
  ctx.save();
  ctx.font = `${weight} ${size}px "DejaVu Sans", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = `${spacing}px`;
  ctx.fillStyle = color;
  ctx.shadowColor = GREEN;
  ctx.shadowBlur = size * 0.16;
  ctx.fillText(value, 360, y);
  ctx.restore();
}

function drawText(t) {
  const gradient = ctx.createLinearGradient(0, 780, 0, 900);
  gradient.addColorStop(0, '#f4f8fc');
  gradient.addColorStop(1, '#7ee787');
  centeredText('PAUSE', 890, 132, 800, gradient, 10);

  ctx.save();
  ctx.strokeStyle = GREEN;
  ctx.lineWidth = 2;
  ctx.shadowColor = GREEN;
  ctx.shadowBlur = 18;
  ctx.strokeRect(244, 938, 232, 88);
  ctx.restore();
  centeredText('420X', 1002, 58, 700, LIGHT, 8);
  centeredText('RELAY · STANDBY', 1096, 22, 600, '#8a97a8', 8);

  ctx.save();
  ctx.strokeStyle = rgba(GREEN, 0.55);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(240, 1150);
  ctx.lineTo(480, 1150);
  ctx.stroke();
  const blink = 0.5 + 0.5 * Math.sin(t * TAU * 0.7);
  ctx.fillStyle = rgba(GREEN, 0.25 + 0.75 * blink);
  ctx.beginPath();
  ctx.arc(360, 1150, 3.5, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawScanlines() {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  for (let y = 0; y < HEIGHT; y += 4) ctx.fillRect(0, y, WIDTH, 0.5);
  ctx.strokeStyle = '#1c2a22';
  ctx.lineWidth = 1;
  ctx.strokeRect(18, 18, WIDTH - 36, HEIGHT - 36);
  ctx.restore();
}

function drawFrame(frame) {
  const t = frame / FRAMES;
  drawBackground();
  drawWire();
  drawRing(t);
  drawText(t);
  drawScanlines();
}

mkdirSync(dirname(OUTPUT), { recursive: true });
const ffmpeg = spawn(
  'ffmpeg',
  [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'rawvideo',
    '-pixel_format',
    'rgba',
    '-video_size',
    `${WIDTH}x${HEIGHT}`,
    '-framerate',
    String(FPS),
    '-i',
    'pipe:0',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    OUTPUT,
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);

function write(buffer) {
  return new Promise((resolveWrite, rejectWrite) => {
    ffmpeg.stdin.write(buffer, (error) => {
      if (error) rejectWrite(error);
      else resolveWrite();
    });
  });
}

for (let frame = 0; frame < FRAMES; frame += 1) {
  drawFrame(frame);
  const image = ctx.getImageData(0, 0, WIDTH, HEIGHT);
  const buffer = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  await write(buffer);
}
ffmpeg.stdin.end();

const code = await new Promise((resolveExit) => ffmpeg.once('close', resolveExit));
if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
console.log(`Wrote ${OUTPUT} (${FRAMES} frames, ${DURATION}s @ ${FPS}fps)`);
