import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { SettingsSchema } from '../src/core/config/schema.js';
import { ChatOverlayEngine } from '../src/core/overlays/chat-engine.js';
import { formatVersionOverlayText, versionFilter } from '../src/core/overlays/drawtext.js';
import { renderStudioPreview } from '../src/core/overlays/studio-preview.js';
import { resolveTheme } from '../src/web/src/utils/theme.js';

const logger = pino({ level: 'silent' });

describe('Theme auto mode (#27)', () => {
  it('resolves auto preference from system color scheme and respects explicit overrides', () => {
    expect(resolveTheme('auto', true)).toBe('light');
    expect(resolveTheme('auto', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });
});

describe('Version overlay (#41)', () => {
  it('formats version text with optional update hint and builds drawtext filter', () => {
    const settings = SettingsSchema.parse({
      overlays: {
        version: {
          enabled: true,
          prefix: 'RELAY v',
          show_update_hint: true,
          update_hint: 'Neu: 0.19.0',
        },
      },
    });
    expect(formatVersionOverlayText(settings.overlays.version, '0.18.0')).toBe(
      'RELAY v0.18.0 · Neu: 0.19.0',
    );
    const filter = versionFilter(settings, '/usr/share/fonts/dejavu/DejaVuSans.ttf', '/tmp/version.txt');
    expect(filter).toContain('drawtext=');
    expect(filter).toContain('version.txt');

    const png = renderStudioPreview({
      settings,
      overlays: settings.overlays,
      logger,
      sample: true,
      maxDimension: 360,
    });
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });
});

describe('In-chat earnings card (#42)', () => {
  it('renders earnings card in ChatOverlayEngine preview when enabled', () => {
    const settings = SettingsSchema.parse({
      overlays: {
        chat: {
          enabled: true,
          show_earnings_card: true,
          earnings_card_interval_seconds: 60,
        },
      },
      earnings: {
        goal_amount: 300,
        goal_label: 'Tagesziel',
      },
    });
    const engine = new ChatOverlayEngine({
      settings,
      overlays: settings.overlays,
      logger,
    });
    engine.setEarningsCard({
      periodLabel: 'Heute',
      currency: 'EUR',
      net: 150,
      gross: 300,
      coins: 30000,
      goalAmount: 300,
      goalLabel: 'Tagesziel',
    });
    const png = engine.previewPng(true);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    engine.stop();
  });
});
