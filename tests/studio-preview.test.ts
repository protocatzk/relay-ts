import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, StreamerSchema } from '../src/core/config/schema.js';
import { renderStudioPreview } from '../src/core/overlays/studio-preview.js';

const logger = pino({ level: 'silent' });

describe('studio preview', () => {
  it('renders a PNG with chat, clock and text overlays', () => {
    const settings = DEFAULT_SETTINGS;
    const streamer = StreamerSchema.parse({
      id: 'preview',
      name: 'Preview',
      tiktok: 'preview',
      overlays: {
        chat: {
          enabled: true,
          style: 'panel',
          show_stats: true,
          show_tiers: true,
          name_colors: true,
          max_messages: 40,
          panel_height: 320,
        },
        clock: { enabled: true, show_box: true, margin: 20 },
        text: { enabled: true, text: 'Studio Test', show_box: true, margin: 24 },
      },
    });
    const png = renderStudioPreview({
      settings,
      streamer,
      logger,
      sample: true,
      earningsText: '12,50 € · 1200 Coins',
      maxDimension: 720,
    });
    expect(png[0]).toBe(0x89);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.length).toBeGreaterThan(1000);
  });

  it('renders an empty stage when all overlays are disabled', () => {
    const streamer = StreamerSchema.parse({
      id: 'empty',
      name: 'Empty',
      tiktok: 'empty',
    });
    const png = renderStudioPreview({
      settings: DEFAULT_SETTINGS,
      streamer,
      logger,
      sample: true,
    });
    expect(png[0]).toBe(0x89);
    expect(png.length).toBeGreaterThan(500);
  });
});
