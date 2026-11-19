import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'src/web/public/logo.png');
const outDir = join(root, 'src/web/public/icons');

async function render(size: number, logoFraction: number, background: string, out: string): Promise<void> {
  const logo = await loadImage(source);
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);

  const logoSize = Math.round(size * logoFraction);
  const offset = Math.round((size - logoSize) / 2);
  ctx.drawImage(logo, offset, offset, logoSize, logoSize);

  writeFileSync(out, await canvas.encode('png'));
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });

  // "any" icons — full bleed.
  await render(192, 1, 'transparent', join(outDir, 'pwa-192x192.png'));
  await render(512, 1, 'transparent', join(outDir, 'pwa-512x512.png'));

  // maskable — logo within the 80% safe circle on a solid background.
  await render(512, 0.6, '#05070b', join(outDir, 'pwa-maskable-512x512.png'));
  await render(192, 0.6, '#05070b', join(outDir, 'pwa-maskable-192x192.png'));

  // Apple touch icon — opaque, full bleed.
  await render(180, 1, '#05070b', join(outDir, 'apple-touch-icon.png'));

  console.log('PWA icons generated in', outDir);
}

void main();
