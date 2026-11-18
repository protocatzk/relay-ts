import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/core/config/schema.js';
import { renderStudioPreview } from '../src/core/overlays/studio-preview.js';

const logger = pino({ level: 'silent' });

function settingsWith(overlays: Partial<(typeof DEFAULT_SETTINGS)['overlays']>) {
  return {
    ...DEFAULT_SETTINGS,
    overlays: { ...DEFAULT_SETTINGS.overlays, ...overlays },
  };
}

describe('studio preview', () => {
  it('renders a PNG with chat, clock and text overlays', () => {
    const settings = settingsWith({
      chat: {
        ...DEFAULT_SETTINGS.overlays.chat,
        enabled: true,
        style: 'panel',
        show_stats: true,
        show_tiers: true,
        name_colors: true,
        max_messages: 40,
        panel_height: 320,
      },
      clock: { ...DEFAULT_SETTINGS.overlays.clock, enabled: true, show_box: true, margin: 20 },
      text: {
        ...DEFAULT_SETTINGS.overlays.text,
        enabled: true,
        text: 'Studio Test',
        show_box: true,
        margin: 24,
      },
    });
    const png = renderStudioPreview({
      settings,
      overlays: settings.overlays,
      logger,
      sample: true,
      earningsText: '12,50 € · 1200 Coins',
      maxDimension: 720,
    });
    expect(png[0]).toBe(0x89);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.length).toBeGreaterThan(1000);
  });

  it('renders live messages and studio offsets', () => {
    const settings = settingsWith({
      chat: {
        ...DEFAULT_SETTINGS.overlays.chat,
        enabled: true,
        style: 'bubbles',
        offset_x: 40,
        offset_y: -30,
      },
      clock: {
        ...DEFAULT_SETTINGS.overlays.clock,
        enabled: true,
        position: 'bottom-right',
        offset_x: -20,
        offset_y: 10,
      },
    });
    const png = renderStudioPreview({
      settings,
      overlays: settings.overlays,
      logger,
      sample: false,
      chatMessages: [
        { id: '1', username: 'real', text: 'Echte Nachricht', receivedAt: new Date() },
      ],
      maxDimension: 480,
    });
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.length).toBeGreaterThan(500);
  });

  it('renders the earnings overlay with studio offsets and colors', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      earnings: {
        ...DEFAULT_SETTINGS.earnings,
        overlay_enabled: true,
        overlay_position: 'bottom-right' as const,
        overlay_font_size: 26,
        overlay_margin: 48,
        overlay_offset_x: 24,
        overlay_offset_y: -18,
        overlay_font_color: '#ff0000',
        overlay_box_color: 'black@0.5',
        overlay_show_box: false,
      },
    };
    const png = renderStudioPreview({
      settings,
      overlays: settings.overlays,
      logger,
      sample: true,
      earningsText: '205,28 € · 42.505 Coins',
      maxDimension: 480,
    });
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.length).toBeGreaterThan(500);
  });

  it('renders an empty stage when all overlays are disabled', () => {
    const png = renderStudioPreview({
      settings: DEFAULT_SETTINGS,
      overlays: DEFAULT_SETTINGS.overlays,
      logger,
      sample: true,
    });
    expect(png[0]).toBe(0x89);
    expect(png.length).toBeGreaterThan(500);
  });
});
