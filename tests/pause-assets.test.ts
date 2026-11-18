import { describe, expect, it } from 'vitest';
import {
  inspectPauseAsset,
  isSafePauseFilename,
  safePauseAssetName,
} from '../src/core/overlays/pause-assets.js';

describe('pause asset validation', () => {
  it('accepts valid PNG data', () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    expect(inspectPauseAsset(png, 'background.png')).toMatchObject({
      kind: 'image',
      mime: 'image/png',
      animated: false,
    });
  });

  it('rejects a spoofed image extension', () => {
    expect(() => inspectPauseAsset(Buffer.from('not an image'), 'fake.png')).toThrow(
      /gültiges PNG/,
    );
  });

  it('detects animated SVGs', () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><animate attributeName="opacity" /></svg>',
    );
    expect(inspectPauseAsset(svg, 'loop.svg')).toMatchObject({
      kind: 'image',
      animated: true,
    });
  });

  it('accepts TTF and rejects fake font files', () => {
    expect(inspectPauseAsset(Buffer.from([0x00, 0x01, 0x00, 0x00]), 'font.ttf')).toMatchObject({
      kind: 'font',
    });
    expect(() => inspectPauseAsset(Buffer.from('fake'), 'font.otf')).toThrow(/Schrift/);
  });

  it('creates safe generated filenames', () => {
    expect(isSafePauseFilename(safePauseAssetName('.mp4'))).toBe(true);
    expect(isSafePauseFilename('../evil.mp4')).toBe(false);
  });
});
