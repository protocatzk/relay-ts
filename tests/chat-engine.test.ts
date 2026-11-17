import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { ChatOverlayEngine, parseColor } from '../src/core/overlays/chat-engine.js';
import { DEFAULT_SETTINGS, StreamerSchema } from '../src/core/config/schema.js';

const streamer = StreamerSchema.parse({
  id: 'canvas-test',
  name: 'Canvas Test',
  tiktok: 'canvas_test',
  overlays: {
    chat: {
      enabled: true,
      engine: 'canvas',
      position: 'bottom-left',
      max_lines: 5,
      font_size: 22,
      render_fps: 10,
      show_timestamps: true,
    },
  },
});

describe('Canvas chat overlay', () => {
  it('renders a PNG preview with sample messages', () => {
    const engine = new ChatOverlayEngine({
      settings: DEFAULT_SETTINGS,
      streamer,
      logger: pino({ level: 'silent' }),
    });
    const png = engine.previewPng(true);
    expect(png.length).toBeGreaterThan(1000);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('calculates a panel inside the output frame', () => {
    const engine = new ChatOverlayEngine({
      settings: DEFAULT_SETTINGS,
      streamer,
      logger: pino({ level: 'silent' }),
    });
    const panel = engine.panel;
    expect(panel.width).toBeGreaterThan(100);
    expect(panel.height).toBeGreaterThan(80);
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(720);
    expect(panel.y + panel.height).toBeLessThanOrEqual(1280);
  });

  it('parses named, hex and alpha colors', () => {
    expect(parseColor('black@0.45')).toMatchObject({ r: 0, g: 0, b: 0, a: 0.45 });
    expect(parseColor('#ff8800')).toMatchObject({ r: 255, g: 136, b: 0, a: 1 });
    expect(parseColor('0x00ff00')).toMatchObject({ r: 0, g: 255, b: 0, a: 1 });
  });

  it('survives a closed overlay pipe', () => {
    const engine = new ChatOverlayEngine({
      settings: DEFAULT_SETTINGS,
      streamer,
      logger: pino({ level: 'silent' }),
    });
    const stream = new PassThrough();
    engine.attach(stream);
    expect(() => stream.emit('error', new Error('read ECONNRESET'))).not.toThrow();
    engine.detach();
  });
});
