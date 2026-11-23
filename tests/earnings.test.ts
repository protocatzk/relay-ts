import { describe, expect, it } from 'vitest';
import {
  formatEarningsOverlay,
  parseEarningsPayload,
  type EarningsSnapshot,
} from '../src/core/earnings/monitor.js';
import { StreamerSchema } from '../src/core/config/schema.js';

const streamer = StreamerSchema.parse({ id: 'kiyan', name: 'Kiyan', tiktok: 'kiyan_069' });

function snapshot(overrides: Partial<EarningsSnapshot> = {}): EarningsSnapshot {
  return {
    enabled: true,
    configured: true,
    status: 'ok',
    streamer_id: 'kiyan',
    streamer_name: 'Kiyan',
    streamer_handle: 'kiyan_069',
    display_name: null,
    avatar_url: null,
    room_id: null,
    is_live: null,
    period: 'today',
    period_label: 'Heute',
    view: 'detailed',
    interval_seconds: 300,
    net: null,
    gross: null,
    coins: null,
    viewers: null,
    followers: null,
    gifts: null,
    gifts_sent: null,
    gifters: null,
    currency: 'EUR',
    session: null,
    top_gift: null,
    top_gifter: null,
    rates: null,
    diagnostics: null,
    delta: null,
    last_seen_at: null,
    source: null,
    updated_at: null,
    last_run_at: null,
    missing: false,
    error: null,
    ...overrides,
  };
}

describe('earnings parser', () => {
  it('extracts overview values and structured gift data', () => {
    const values = parseEarningsPayload(
      {
        period: 'today',
        streamers: [
          { username: 'other', eur_net: 1 },
          {
            username: 'kiyan_069',
            eur_net: 205.28,
            eur_gross: 410.64,
            total_coins: 42505,
            current_viewers: 344,
            follower_count: 76800,
            gift_events_count: 42,
            total_gifts_sent: 77,
            unique_gifters: 12,
            top_gift: { gift_name: 'Money Gun', coins: 6000, count: 3 },
            top_gifter: { sender_username: 'ness', coins: 1200 },
            last_seen_at: '2026-11-04T22:49:22',
          },
        ],
      },
      streamer,
    );
    expect(values).toMatchObject({
      net: 205.28,
      gross: 410.64,
      coins: 42505,
      viewers: 344,
      followers: 76800,
      gifts: 42,
      gifts_sent: 77,
      gifters: 12,
      currency: 'EUR',
      period: 'today',
      top_gift: { name: 'Money Gun', coins: 6000, count: 3 },
      top_gifter: { username: 'ness', coins: 1200 },
    });
  });

  it('parses detail responses with rates, sessions and diagnostics', () => {
    const values = parseEarningsPayload(
      {
        period: '7d',
        rates: {
          usd_per_diamond: 0.005,
          gross_usd_per_coin: 0.0106,
          usd_to_eur_rate: 0.92,
        },
        streamer: {
          username: 'kiyan_069',
          display_name: 'Kiyan',
          is_live: true,
          current_viewers: 344,
          total_coins: 42505,
        },
        summary: {
          follower_count: 76800,
          gift_events_count: 42,
          unique_gifters: 12,
        },
        sessions: [
          {
            status: 'active',
            session_coins: 1000,
            gift_events: 5,
            peak_viewers: 400,
            started_at: '2026-11-04T22:38:24',
          },
        ],
        worker_diagnostics: {
          state: 'running',
          connected_since: '2026-11-04T22:38:24',
          reconnect_attempts: 1,
        },
      },
      streamer,
    );
    expect(values).not.toBeNull();
    expect(values).toMatchObject({
      period: '7d',
      display_name: 'Kiyan',
      is_live: true,
      followers: 76800,
      net: 195.52,
      gross: 414.51,
      currency: 'EUR',
      rates: {
        usd_per_diamond: 0.005,
        gross_usd_per_coin: 0.0106,
        usd_to_eur_rate: 0.92,
      },
      diagnostics: { state: 'running', reconnect_attempts: 1 },
    });
    expect(values?.session).toMatchObject({
      coins: 1000,
      gifts: 5,
      peak_viewers: 400,
      status: 'active',
      currency: 'EUR',
    });
    expect(values?.session?.net).toBeCloseTo(4.6, 2);
  });

  it('returns null when the active streamer is missing', () => {
    expect(parseEarningsPayload({ streamers: [{ username: 'other' }] }, streamer)).toBeNull();
  });

  it('formats the overlay template with detailed placeholders', () => {
    const text = formatEarningsOverlay(
      '{period}: {net} {currency} · {gifts} Gifts · {gifters} Gifter · {session_net} · {top_gift} · {top_gifter}',
      snapshot({
        net: 205.28,
        coins: 42505,
        gifts: 42,
        gifters: 12,
        top_gift: { name: 'Money Gun', coins: 6000, count: 3 },
        top_gifter: { username: 'ness', display_name: null, coins: 1200 },
        session: {
          id: null,
          started_at: null,
          ended_at: null,
          status: null,
          peak_viewers: null,
          last_fan_tickets: null,
          coins: 1000,
          gifts: 5,
          net: 4.6,
          gross: null,
          currency: 'EUR',
        },
      }),
    );
    expect(text).toBe(
      'Heute: 205.28 EUR · 42 Gifts · 12 Gifter · 4.60 · Money Gun · ness',
    );
  });

  it('keeps line breaks from multi-line earnings templates', () => {
    const text = formatEarningsOverlay(
      '{period}\n{net} {currency}\n{coins} Coins',
      snapshot({ net: 205.28, coins: 42505 }),
    );
    expect(text).toBe('Heute\n205.28 EUR\n42505 Coins');
  });

  it('returns no data without an active streamer', () => {
    expect(parseEarningsPayload({ usd_net: 5 }, null)).toBeNull();
  });

  it('resets live stats to 0 when resetLiveStats or isLive false is called', async () => {
    const { EarningsMonitor } = await import('../src/core/earnings/monitor.js');
    const { DEFAULT_SETTINGS } = await import('../src/core/config/schema.js');
    const monitor = new EarningsMonitor({
      settings: DEFAULT_SETTINGS,
      logger: { info: () => {}, warn: () => {} } as any,
      getActive: () => streamer,
      onUpdate: () => {},
    });

    monitor.updateLiveRoomStats({ viewers: 150, isLive: true, roomId: 'room1' });
    expect(monitor.get().viewers).toBe(150);
    expect(monitor.get().is_live).toBe(true);

    monitor.updateLiveRoomStats({ isLive: false });
    expect(monitor.get().viewers).toBe(0);
    expect(monitor.get().is_live).toBe(false);

    monitor.updateLiveRoomStats({ viewers: 80, isLive: true });
    expect(monitor.get().viewers).toBe(80);

    monitor.resetLiveStats();
    expect(monitor.get().viewers).toBe(0);
    expect(monitor.get().is_live).toBe(false);
  });
});
