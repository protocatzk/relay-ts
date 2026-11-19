import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { EarningsHistoryStore, periodStart } from '../src/core/earnings/history.js';

const logger = pino({ level: 'silent' });
let temp: string | null = null;

afterEach(() => {
  if (temp) {
    rmSync(temp, { recursive: true, force: true });
    temp = null;
  }
});

function setup() {
  temp = mkdtempSync(join(tmpdir(), 'relay-earnings-'));
  const path = join(temp, 'earnings-history.json');
  return { path, store: new EarningsHistoryStore(path, logger) };
}

function point(at: string, net: number, coins = net * 10) {
  return {
    at,
    streamer_id: 'kiyan',
    period: 'today' as const,
    net,
    gross: net * 2,
    coins,
    currency: 'EUR' as const,
  };
}

describe('earnings history', () => {
  it('computes period boundaries', () => {
    const now = new Date('2026-11-18T12:00:00').getTime();
    expect(new Date(periodStart('today', now)!).getHours()).toBe(0);
    expect(periodStart('24h', now)).toBe(now - 24 * 60 * 60 * 1000);
    expect(periodStart('7d', now)).toBe(now - 7 * 24 * 60 * 60 * 1000);
    expect(periodStart('all', now)).toBeNull();
  });

  it('appends, deduplicates and persists points', () => {
    const { path, store } = setup();
    const now = Date.now();
    store.append(point(new Date(now).toISOString(), 10));
    store.append(point(new Date(now + 1000).toISOString(), 10));
    expect(store.query('kiyan', 'today')).toHaveLength(1);

    store.append(point(new Date(now + 60_000).toISOString(), 20));
    expect(store.query('kiyan', 'today')).toHaveLength(2);

    const reloaded = new EarningsHistoryStore(path, logger);
    expect(reloaded.query('kiyan', 'today')).toHaveLength(2);
    expect(JSON.parse(readFileSync(path, 'utf8')).points).toHaveLength(2);
  });

  it('computes the delta since the first point in the period', () => {
    const { store } = setup();
    // Fixed midday timestamp so the "1 hour ago" point stays within the same
    // "today" window regardless of the wall clock (the previous Date.now()
    // version failed between 00:00 and 01:00 when the point fell on yesterday).
    const now = new Date('2026-11-18T12:00:00').getTime();
    store.append(point(new Date(now - 3600_000).toISOString(), 10, 100));
    store.append(point(new Date(now).toISOString(), 25, 250));
    expect(store.delta('kiyan', 'today', now)).toEqual({
      net: 15,
      gross: 30,
      coins: 150,
      since: new Date(now - 3600_000).toISOString(),
    });
  });

  it('filters by streamer and period and ignores old data', () => {
    const { store } = setup();
    const now = Date.now();
    store.append(point(new Date(now).toISOString(), 10));
    store.append({
      ...point(new Date(now).toISOString(), 99),
      streamer_id: 'other',
    });
    store.append({
      ...point(new Date(now).toISOString(), 50),
      period: '7d',
    });
    store.append(point(new Date(now - 100 * 24 * 3600_000).toISOString(), 1));

    expect(store.query('kiyan', 'today')).toHaveLength(1);
    expect(store.query('kiyan', '7d')).toHaveLength(1);
    expect(store.query('other', 'today')).toHaveLength(1);
    expect(store.query(null, 'today')).toHaveLength(2);
    expect(store.query('kiyan', 'all').some((item) => item.net === 1)).toBe(false);
  });
});
