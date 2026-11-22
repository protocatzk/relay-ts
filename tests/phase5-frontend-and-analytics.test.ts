import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { ChatAnalytics } from '../src/core/overlays/chat-analytics.js';
import {
  computeEarningsGoal,
  formatEarningsOverlay,
  type EarningsSnapshot,
} from '../src/core/earnings/monitor.js';
import { renderStudioPreview, splitTextLines } from '../src/core/overlays/studio-preview.js';
import { SettingsSchema } from '../src/core/config/schema.js';
import { buildSectionPayload } from '../src/web/src/utils/settings-sections.js';

function makeEarningsSnapshot(overrides: Partial<EarningsSnapshot> = {}): EarningsSnapshot {
  return {
    enabled: true,
    configured: true,
    status: 'ok',
    period: 'today',
    period_label: 'Heute',
    view: 'standard',
    interval_seconds: 300,
    source: 'https://example.test',
    streamer_id: 'alpha',
    streamer_name: 'Alpha',
    streamer_handle: 'alpha',
    display_name: 'Alpha',
    avatar_url: null,
    room_id: null,
    is_live: true,
    missing: false,
    error: null,
    updated_at: '2026-11-20T22:00:00.000Z',
    last_run_at: '2026-11-20T22:00:00.000Z',
    last_seen_at: '2026-11-20T22:00:00.000Z',
    net: 125,
    gross: 250,
    coins: 25000,
    viewers: 120,
    followers: 5000,
    gifts: 10,
    gifts_sent: 12,
    gifters: 5,
    currency: 'EUR',
    session: null,
    top_gift: null,
    top_gifter: null,
    rates: null,
    diagnostics: null,
    delta: null,
    ...overrides,
  };
}

describe('ChatAnalytics (#37)', () => {
  it('tracks rolling 30-minute buckets, deduplicates IDs, and ranks top chatters & badges', () => {
    const analytics = new ChatAnalytics();
    const base = Date.UTC(2026, 10, 20, 22, 30, 0);

    analytics.record(
      [
        {
          id: '1',
          username: 'alice',
          text: 'hi',
          badges: ['mod', 'vip'],
          receivedAt: new Date(base - 60_000),
        },
        {
          id: '2',
          username: 'bob',
          text: 'yo',
          badges: ['vip'],
          receivedAt: new Date(base - 60_000),
        },
        {
          id: '3',
          username: 'alice',
          text: 'again',
          badges: ['mod'],
          receivedAt: new Date(base),
        },
        // Duplicate id should be ignored
        {
          id: '1',
          username: 'alice',
          text: 'hi',
          badges: ['mod', 'vip'],
          receivedAt: new Date(base - 60_000),
        },
        // Outside 30-min window should be pruned
        {
          id: 'old',
          username: 'ghost',
          text: 'old',
          receivedAt: new Date(base - 35 * 60_000),
        },
      ],
      base,
    );

    const snap = analytics.snapshot(base);
    expect(snap.window_minutes).toBe(30);
    expect(snap.total_messages).toBe(3);
    expect(snap.unique_chatters).toBe(2);
    expect(snap.peak_per_minute).toBe(2);
    expect(snap.series).toHaveLength(30);
    expect(snap.series[28]).toBe(2);
    expect(snap.series[29]).toBe(1);
    expect(snap.top_chatters[0]).toEqual({ username: 'alice', count: 2 });
    expect(snap.top_badges[0]).toEqual({ badge: 'mod', count: 2 });

    analytics.reset();
    expect(analytics.snapshot(base).total_messages).toBe(0);
  });
});

describe('Earnings goal overlay (#38)', () => {
  it('computes progress, remaining amount, bar, and handles caps/fallbacks', () => {
    expect(computeEarningsGoal(50, 0).enabled).toBe(false);

    const half = computeEarningsGoal(50, 100, 10);
    expect(half.enabled).toBe(true);
    expect(half.percent).toBe(50);
    expect(half.remaining).toBe(50);
    expect(half.reached).toBe(false);
    expect(half.bar).toBe('█████░░░░░');

    const over = computeEarningsGoal(150, 100, 10);
    expect(over.percent).toBe(150);
    expect(over.clampedPercent).toBe(100);
    expect(over.remaining).toBe(0);
    expect(over.reached).toBe(true);
    expect(over.bar).toBe('██████████');

    const missing = computeEarningsGoal(null, 100, 10);
    expect(missing.percent).toBe(0);
    expect(missing.remaining).toBe(100);
    expect(missing.bar).toBe('░░░░░░░░░░');
  });

  it('auto-appends progress bar when goal is set and supports explicit placeholders', () => {
    const snap = makeEarningsSnapshot({ net: 125, currency: 'EUR' });

    const auto = formatEarningsOverlay('{net} €', snap, {
      goal_amount: 250,
      goal_label: 'Stream-Ziel',
      goal_bar_enabled: true,
    });
    expect(auto).toContain('125.00 €');
    expect(auto).toContain('Stream-Ziel: 125.00/250.00 € (50 %) █████░░░░░');

    const custom = formatEarningsOverlay('{goal_label}: {goal_percent} ({goal_remaining} offen) {goal_bar}', snap, {
      goal_amount: 250,
      goal_label: 'Tagesziel',
      goal_bar_enabled: true,
    });
    expect(custom).toBe('Tagesziel: 50 % (125.00 offen) █████░░░░░');

    const disabled = formatEarningsOverlay('{net} € · {goal}', snap, { goal_amount: 0 });
    expect(disabled).toBe('125.00 € · –');
  });
});

describe('Frontend & Studio preview regression helpers (#43)', () => {
  it('splits multiline overlay text cleanly and renders Studio preview with earnings goal', () => {
    expect(splitTextLines('Zeile 1\r\nZeile 2\n\n')).toEqual(['Zeile 1', 'Zeile 2']);
    const settings = SettingsSchema.parse({
      earnings: {
        overlay_enabled: true,
        goal_amount: 200,
        goal_label: 'Tagesziel',
        goal_bar_enabled: true,
      },
    });
    const png = renderStudioPreview({
      settings,
      overlays: settings.overlays,
      logger: pino({ level: 'silent' }),
      sample: true,
      earningsText: formatEarningsOverlay('{net} €', makeEarningsSnapshot(), settings.earnings),
      maxDimension: 360,
    });
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it('isolates per-section settings payloads without leaking unrelated sections', () => {
    const defaults = SettingsSchema.parse({});
    const payload = buildSectionPayload(
      'video',
      {
        ...defaults,
        online: { ...defaults.online, api_key_set: false },
        chat: { ...defaults.chat, api_key_set: false },
        earnings: { ...defaults.earnings, api_key_set: false },
        overlays: {
          ...defaults.overlays,
          chat: { ...defaults.overlays.chat, api_key_set: false },
        },
        secondary_sink: { ...defaults.secondary_sink, stream_key_set: false },
        streaming: { ...defaults.streaming, global_youtube_key_set: false },
        webhooks: { ...defaults.webhooks, url_set: false, url_host: '', secret_set: false },
      },
      { onlineApiKey: '', chatApiKey: '', earningsApiKey: '' },
    );
    expect(Object.keys(payload)).toEqual(['video', 'source']);
  });
});
