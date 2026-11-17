import { describe, expect, it } from 'vitest';
import { formatEarningsOverlay, parseEarningsPayload } from '../src/core/earnings/monitor.js';
import { StreamerSchema } from '../src/core/config/schema.js';

const streamer = StreamerSchema.parse({ id: 'kiyan', name: 'Kiyan', tiktok: 'kiyan_069' });

describe('earnings parser', () => {
  it('extracts the active streamer from a TokTracker overview', () => {
    const values = parseEarningsPayload(
      {
        streamers: [
          { username: 'other', eur_net: 1 },
          {
            username: 'kiyan_069',
            eur_net: 205.28,
            eur_gross: 410.64,
            total_coins: 42505,
            current_viewers: 344,
            top_gift: { gift_name: 'Money Gun', coins: 6000 },
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
      currency: 'EUR',
      top_gift: 'Money Gun',
    });
  });

  it('formats the overlay template', () => {
    const text = formatEarningsOverlay('{net} {currency} · {coins} Coins · {viewers} Zuschauer', {
      enabled: true,
      configured: true,
      streamer_id: 'kiyan',
      net: 205.28,
      gross: 410.64,
      coins: 42505,
      viewers: 344,
      currency: 'EUR',
      top_gift: 'Money Gun',
      updated_at: new Date().toISOString(),
      error: null,
    });
    expect(text).toBe('205.28 EUR · 42505 Coins · 344 Zuschauer');
  });

  it('returns empty values without an active streamer', () => {
    expect(parseEarningsPayload({ usd_net: 5 }, null)).toMatchObject({ net: null });
  });
});
