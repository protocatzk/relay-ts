import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { ChatOverlayEngine, parseColor } from '../src/core/overlays/chat-engine.js';
import { OverlayManager } from '../src/core/overlays/overlay-manager.js';
import { OverlayRuntime } from '../src/core/supervisor/overlay-runtime.js';
import { DEFAULT_SETTINGS } from '../src/core/config/schema.js';

const settings = {
  ...DEFAULT_SETTINGS,
  overlays: {
    ...DEFAULT_SETTINGS.overlays,
    chat: {
      ...DEFAULT_SETTINGS.overlays.chat,
      enabled: true,
      engine: 'canvas' as const,
      position: 'bottom-left' as const,
      max_lines: 5,
      font_size: 22,
      render_fps: 10,
      show_timestamps: true,
    },
  },
};

describe('Canvas chat overlay', () => {
  it('renders a PNG preview with sample messages', () => {
    const engine = new ChatOverlayEngine({
      settings,
      overlays: settings.overlays,
      logger: pino({ level: 'silent' }),
    });
    const png = engine.previewPng(true);
    expect(png.length).toBeGreaterThan(1000);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('calculates a panel inside the output frame', () => {
    const engine = new ChatOverlayEngine({
      settings,
      overlays: settings.overlays,
      logger: pino({ level: 'silent' }),
    });
    const panel = engine.panel;
    expect(panel.width).toBeGreaterThan(100);
    expect(panel.height).toBeGreaterThan(400);
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
      settings,
      overlays: settings.overlays,
      logger: pino({ level: 'silent' }),
    });
    const stream = new PassThrough();
    engine.attach(stream);
    expect(() => stream.emit('error', new Error('read ECONNRESET'))).not.toThrow();
    engine.detach();
  });

  it('measures max_age_seconds from firstSeenAt so delayed messages stay visible', () => {
    const agedSettings = {
      ...settings,
      overlays: {
        ...settings.overlays,
        chat: {
          ...settings.overlays.chat,
          max_age_seconds: 15,
        },
      },
    };
    const engine = new ChatOverlayEngine({
      settings: agedSettings,
      overlays: agedSettings.overlays,
      logger: pino({ level: 'silent' }),
    });
    const now = Date.now();
    // Message timestamp is 60s old (e.g. due to delay buffer), but just appeared on screen.
    engine.setMessages(
      [
        {
          id: 'delayed-1',
          username: 'alice',
          text: 'Hello after delay',
          receivedAt: new Date(now - 60_000),
          timestamp: new Date(now - 60_000),
        },
      ],
      now,
    );
    expect(engine.currentMessages).toHaveLength(1);
    engine.stop();
  });

  it('does not end an active chat pipe when adoptEngine is called with logo disabled', () => {
    const logger = pino({ level: 'silent' });
    const runtime = new OverlayRuntime({
      settings,
      overlays: new OverlayManager(
        {
          media: { overlayFont: '' } as never,
          overlaysDir: '/tmp',
          logger,
        },
        settings,
      ),
      earnings: {
        get: () => null,
      } as never,
      logger,
      logoPath: '',
    });
    const initial = runtime.createEngine()!;
    const pipe = new PassThrough();
    const endSpy = vi.spyOn(pipe, 'end');
    runtime.adoptEngine(initial, undefined, pipe, null);

    // Calling adoptEngine again on sink reuse when logo is disabled must NOT end fd 3.
    const candidate = runtime.createEngine()!;
    runtime.adoptEngine(candidate, undefined, pipe, null);
    expect(endSpy).not.toHaveBeenCalled();
    expect(runtime.engine).toBe(initial);
    runtime.stopEngine();
  });

  it('does not mark dirty when setMessages is called with identical messages (#56)', () => {
    const engine = new ChatOverlayEngine({
      settings,
      overlays: settings.overlays,
      logger: pino({ level: 'silent' }),
    });
    const msgs = [
      { id: '1', username: 'bob', text: 'Hi', receivedAt: new Date(), timestamp: new Date() },
    ];
    engine.setMessages(msgs);
    expect(engine.isDirty).toBe(true);

    // Simulate tick clearing dirty
    const stream = new PassThrough();
    engine.attach(stream);
    // After attach and first tick, dirty is cleared
    expect(engine.isDirty).toBe(false);

    // Calling setMessages with identical array must NOT trigger dirty
    engine.setMessages([...msgs]);
    expect(engine.isDirty).toBe(false);

    // Adding a new message MUST trigger dirty
    engine.setMessages([
      ...msgs,
      { id: '2', username: 'alice', text: 'Hey', receivedAt: new Date(), timestamp: new Date() },
    ]);
    expect(engine.isDirty).toBe(true);
    engine.stop();
  });
});
