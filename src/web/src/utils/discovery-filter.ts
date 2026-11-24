/**
 * Pure view helpers for the discovery feed (#92).
 *
 * Filtering and sorting happen client-side so the panel can react instantly to
 * filter changes without another provider round-trip. Kept free of Vue and DOM
 * APIs so Vitest can cover the edge cases.
 */
import type { DiscoveryHit, DiscoveryProviderStatus } from '@/src/api/types';

export type DiscoverySort = 'live' | 'viewers' | 'name';

export interface DiscoveryViewOptions {
  /** Hide offline hits. */
  liveOnly?: boolean;
  /** Hide hits below this viewer count (0 = no filter). */
  minViewers?: number;
  sort?: DiscoverySort;
}

/** Number of live hits in a result list. */
export function countLive(hits: readonly DiscoveryHit[]): number {
  let live = 0;
  for (const hit of hits) {
    if (hit.live) live += 1;
  }
  return live;
}

/** Viewer count with `null` treated as 0 for sorting and filtering. */
function viewersOf(hit: DiscoveryHit): number {
  return typeof hit.viewers === 'number' && Number.isFinite(hit.viewers) ? hit.viewers : 0;
}

export function filterHits(
  hits: readonly DiscoveryHit[],
  options: Pick<DiscoveryViewOptions, 'liveOnly' | 'minViewers'> = {},
): DiscoveryHit[] {
  const minViewers = Math.max(0, options.minViewers ?? 0);
  return hits.filter((hit) => {
    if (options.liveOnly && !hit.live) return false;
    if (minViewers > 0 && viewersOf(hit) < minViewers) return false;
    return true;
  });
}

export function sortHits(hits: readonly DiscoveryHit[], sort: DiscoverySort = 'live'): DiscoveryHit[] {
  const copy = [...hits];
  switch (sort) {
    case 'viewers':
      // Live first, then by audience size; name breaks ties for stable output.
      return copy.sort(
        (a, b) =>
          Number(b.live) - Number(a.live) ||
          viewersOf(b) - viewersOf(a) ||
          a.display_name.localeCompare(b.display_name, 'de', { sensitivity: 'base' }),
      );
    case 'name':
      return copy.sort((a, b) =>
        a.display_name.localeCompare(b.display_name, 'de', { sensitivity: 'base' }),
      );
    case 'live':
    default:
      return copy.sort(
        (a, b) =>
          Number(b.live) - Number(a.live) ||
          viewersOf(b) - viewersOf(a) ||
          a.display_name.localeCompare(b.display_name, 'de', { sensitivity: 'base' }),
      );
  }
}

/** Filter and sort in one pass; the order the UI expects. */
export function applyViewOptions(
  hits: readonly DiscoveryHit[],
  options: DiscoveryViewOptions = {},
): DiscoveryHit[] {
  return sortHits(filterHits(hits, options), options.sort ?? 'live');
}

/** CSS class suffix for a provider badge. */
export function providerTone(status: DiscoveryProviderStatus): 'online' | 'limited' | 'offline' {
  if (status.status === 'online') return 'online';
  if (status.status === 'rate_limited') return 'limited';
  return 'offline';
}
