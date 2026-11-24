import { describe, expect, it } from 'vitest';
import {
  applyViewOptions,
  countLive,
  filterHits,
  providerTone,
  sortHits,
} from '../src/web/src/utils/discovery-filter.js';
import type { DiscoveryHit, DiscoveryProviderStatus } from '../src/web/src/api/types.js';

function hit(handle: string, viewers: number | null, live = true): DiscoveryHit {
  return {
    handle,
    display_name: handle.toUpperCase(),
    avatar_url: null,
    bio: null,
    title: null,
    live,
    viewers,
    source: 'live_page',
    fetched_at: '2026-11-24T12:00:00.000Z',
  };
}

describe('discovery view helpers', () => {
  it('counts live hits only', () => {
    expect(countLive([hit('a', 10), hit('b', null, false), hit('c', 5)])).toBe(2);
    expect(countLive([])).toBe(0);
  });

  it('filters offline hits when liveOnly is set', () => {
    const list = [hit('a', 10), hit('b', 20, false)];
    expect(filterHits(list, { liveOnly: true }).map((entry) => entry.handle)).toEqual(['a']);
    expect(filterHits(list)).toHaveLength(2);
  });

  it('filters by minimum viewers and treats null as zero', () => {
    const list = [hit('a', 10), hit('b', null), hit('c', 500)];
    expect(filterHits(list, { minViewers: 100 }).map((entry) => entry.handle)).toEqual(['c']);
    expect(filterHits(list, { minViewers: 0 })).toHaveLength(3);
  });

  it('sorts live first, then by viewers, then by name', () => {
    const list = [hit('zeta', 10, false), hit('beta', 5), hit('alpha', 500), hit('gamma', 5)];
    expect(sortHits(list, 'live').map((entry) => entry.handle)).toEqual([
      'alpha',
      'beta',
      'gamma',
      'zeta',
    ]);
  });

  it('sorts alphabetically in name mode', () => {
    const list = [hit('c', 10), hit('a', 1), hit('b', 99)];
    expect(sortHits(list, 'name').map((entry) => entry.handle)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the input order untouched while sorting', () => {
    const list = [hit('b', 1), hit('a', 2)];
    const sorted = sortHits(list, 'name');
    expect(list.map((entry) => entry.handle)).toEqual(['b', 'a']);
    expect(sorted).not.toBe(list);
  });

  it('combines filter and sort', () => {
    const list = [hit('low', 3), hit('high', 900), hit('offline', 5000, false)];
    expect(
      applyViewOptions(list, { liveOnly: true, minViewers: 100, sort: 'viewers' }).map(
        (entry) => entry.handle,
      ),
    ).toEqual(['high']);
  });

  it('maps provider status to a badge tone', () => {
    const provider = (status: DiscoveryProviderStatus['status']): DiscoveryProviderStatus => ({
      name: 'live_page',
      status,
      last_error: null,
      last_ok_at: null,
    });
    expect(providerTone(provider('online'))).toBe('online');
    expect(providerTone(provider('rate_limited'))).toBe('limited');
    expect(providerTone(provider('offline'))).toBe('offline');
  });
});
