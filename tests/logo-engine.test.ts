import { loadImage } from '@napi-rs/canvas';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../src/core/config/schema.js';
import { LogoOverlayEngine } from '../src/core/overlays/logo-engine.js';

const logger = pino({ level: 'silent' });
const logoPath = new URL('../src/web/public/logo.png', import.meta.url).pathname;

function withLogo(patch: Partial<Settings['overlays']['logo']>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    overlays: {
      ...DEFAULT_SETTINGS.overlays,
      logo: { ...DEFAULT_SETTINGS.overlays.logo, enabled: true, ...patch },
    },
  };
}

describe('LogoOverlayEngine', () => {
  it('places the logo at the configured position and size', async () => {
    const image = await loadImage(logoPath);
    const engine = new LogoOverlayEngine({
      settings: withLogo({
        position: 'top-left',
        width: 160,
        margin: 32,
        offset_x: 10,
        offset_y: -5,
      }),
      image,
      logger,
    });
    expect(engine.panel).toEqual({ width: 160, height: 160, x: 42, y: 27, fps: 10 });
    engine.stop();
  });

  it('respects the bottom-right position and width', async () => {
    const image = await loadImage(logoPath);
    const [width, height] = DEFAULT_SETTINGS.video.resolution.split('x').map(Number) as [
      number,
      number,
    ];
    const engine = new LogoOverlayEngine({
      settings: withLogo({ position: 'bottom-right', width: 100, margin: 20 }),
      image,
      logger,
    });
    expect(engine.panel).toEqual({
      width: 100,
      height: 100,
      x: width - 100 - 20,
      y: height - 100 - 20,
      fps: 10,
    });
    engine.stop();
  });
});
