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

  it('renders pillar_monitor layout with full output spec, top banner and chat monitor (#68)', () => {
    const pillarSettings = {
      ...settings,
      video: {
        ...settings.video,
        resolution: '1280x720' as const,
      },
      overlays: {
        ...settings.overlays,
        chat: {
          ...settings.overlays.chat,
          enabled: true,
          layout_mode: 'pillar_monitor' as const,
          top_banner_enabled: true,
          chat_monitor_enabled: true,
          banner_show_stats: true,
          banner_show_goal: true,
        },
      },
    };
    const engine = new ChatOverlayEngine({
      settings: pillarSettings,
      overlays: pillarSettings.overlays,
      logger: pino({ level: 'silent' }),
    });

    // In pillar_monitor, panel covers full resolution with x=0, y=0
    expect(engine.panel).toEqual({
      width: 1280,
      height: 720,
      x: 0,
      y: 0,
      fps: 10,
    });

    engine.setEarningsCard({
      periodLabel: 'Heute',
      currency: 'EUR',
      net: 120.5,
      gross: 241,
      coins: 25000,
      goalAmount: 200,
      goalLabel: 'Tagesziel',
    });

    engine.setStreamer({
      name: 'MaxMuster',
      tiktok: 'max_tiktok',
      status: 'LIVE',
    });

    const png = engine.previewPng(false);
    expect(png.length).toBeGreaterThan(1000);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    engine.stop();
  });

  it('renders starship_cockpit layout in pillar_wings and fullscreen_16_9 styles with canopy caching', () => {
    const starshipSettings = {
      ...settings,
      video: {
        ...settings.video,
        resolution: '1280x720' as const,
      },
      overlays: {
        ...settings.overlays,
        chat: {
          ...settings.overlays.chat,
          enabled: true,
          layout_mode: 'starship_cockpit' as const,
          starship_style: 'pillar_wings' as const,
          starship_show_telemetry: true,
          starship_show_comms: true,
          starship_show_power_grid: true,
        },
      },
    };
    const engine = new ChatOverlayEngine({
      settings: starshipSettings,
      overlays: starshipSettings.overlays,
      logger: pino({ level: 'silent' }),
    });

    expect(engine.panel).toEqual({
      width: 1280,
      height: 720,
      x: 0,
      y: 0,
      fps: 10,
    });

    engine.setEarningsCard({
      periodLabel: 'Heute',
      currency: 'EUR',
      net: 74.81,
      gross: 149.62,
      coins: 14250,
      goalAmount: 100,
      goalLabel: 'Missionsziel',
    });

    // 1. Pillar wings render
    const wingsPng = engine.previewPng(true);
    expect(wingsPng.length).toBeGreaterThan(1000);
    expect(wingsPng.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

    // 2. Fullscreen 16:9 render
    const fullscreenSettings = {
      ...starshipSettings,
      overlays: {
        ...starshipSettings.overlays,
        chat: {
          ...starshipSettings.overlays.chat,
          starship_style: 'fullscreen_16_9' as const,
        },
      },
    };
    const fsEngine = new ChatOverlayEngine({
      settings: fullscreenSettings,
      overlays: fullscreenSettings.overlays,
      logger: pino({ level: 'silent' }),
    });
    const fsPng = fsEngine.previewPng(true);
    expect(fsPng.length).toBeGreaterThan(1000);
    expect(fsPng.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

    engine.stop();
    fsEngine.stop();
  });
});
