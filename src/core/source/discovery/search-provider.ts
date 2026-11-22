import type { DiscoveryHit, DiscoveryProvider, DiscoveryProviderStatus, DiscoveryProviderState } from './types.js';
import { normalizeHandle } from '../../../utils/format.js';
import { readCookieHeader } from '../resolver.js';

export interface SearchProviderOptions {
  cookiesFile?: string;
  userAgent?: string;
}

export function parseSearchPayload(payload: unknown): DiscoveryHit[] {
  if (!payload || typeof payload !== 'object') return [];
  const hits: DiscoveryHit[] = [];
  const seenHandles = new Set<string>();

  const data = (payload as Record<string, unknown>).data ?? payload;
  const list = Array.isArray(data)
    ? data
    : (Array.isArray((data as Record<string, unknown>).live_list)
      ? (data as Record<string, unknown>).live_list as unknown[]
      : (Array.isArray((data as Record<string, unknown>).itemList)
        ? (data as Record<string, unknown>).itemList as unknown[]
        : (Array.isArray((data as Record<string, unknown>).items)
          ? (data as Record<string, unknown>).items as unknown[]
          : [])));

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const user = (rec.author || rec.owner || rec.user || rec) as Record<string, unknown>;
    const liveRoom = (rec.liveRoom || rec.room || rec) as Record<string, unknown>;

    const rawHandle = typeof user.uniqueId === 'string'
      ? user.uniqueId
      : (typeof rec.uniqueId === 'string' ? rec.uniqueId : '');
    if (!rawHandle) continue;

    const handle = normalizeHandle(rawHandle);
    if (!handle || seenHandles.has(handle)) continue;

    const displayName = typeof user.nickname === 'string'
      ? user.nickname
      : (typeof rec.nickname === 'string' ? rec.nickname : handle);

    const avatarUrl = typeof user.avatarLarger === 'string'
      ? user.avatarLarger
      : (typeof user.avatarThumb === 'string' ? user.avatarThumb : null);

    const bio = typeof user.signature === 'string'
      ? user.signature
      : (typeof user.bioDescription === 'string' ? user.bioDescription : null);

    const title = typeof liveRoom.title === 'string'
      ? liveRoom.title
      : (typeof rec.title === 'string' ? rec.title : null);

    const rawStatus = liveRoom.status ?? rec.status;
    const isLive = rawStatus === 2 || rawStatus === 'live' || rec.live === true;

    const rawViewers = liveRoom.userCount ?? liveRoom.aliveUserCount ?? rec.userCount;
    const viewers = typeof rawViewers === 'number'
      ? rawViewers
      : (typeof rawViewers === 'string' ? parseInt(rawViewers, 10) || null : null);

    const ageRestricted = Boolean(
      liveRoom.ageRestricted ||
      liveRoom.isAgeRestricted ||
      rec.ageRestricted ||
      rec.isAgeRestricted ||
      rec.age_restricted
    );

    seenHandles.add(handle);
    hits.push({
      handle,
      display_name: displayName,
      avatar_url: avatarUrl,
      bio,
      title,
      live: isLive,
      viewers,
      age_restricted: ageRestricted,
      source: 'search_api',
      fetched_at: new Date().toISOString(),
    });
  }

  return hits;
}

export class SearchProvider implements DiscoveryProvider {
  readonly name = 'search_api';
  private state: DiscoveryProviderState = 'online';
  private lastError: string | null = null;
  private lastOkAt: string | null = null;

  constructor(private readonly options: SearchProviderOptions = {}) {}

  health(): DiscoveryProviderStatus {
    return {
      name: this.name,
      status: this.state,
      last_error: this.lastError,
      last_ok_at: this.lastOkAt,
    };
  }

  async search(q: string, opts?: { limit?: number; region?: string }): Promise<DiscoveryHit[]> {
    const trimmed = q.trim();
    if (!trimmed) return [];

    const url = new URL('https://www.tiktok.com/api/live/search/');
    url.searchParams.set('aid', '1988');
    url.searchParams.set('keyword', trimmed);
    if (opts?.limit) url.searchParams.set('count', String(opts.limit));

    const headers: Record<string, string> = {
      accept: 'application/json',
      referer: 'https://www.tiktok.com/',
      'user-agent': this.options.userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    if (this.options.cookiesFile) {
      const cookie = readCookieHeader(this.options.cookiesFile);
      if (cookie) headers.cookie = cookie;
    }

    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });

      if (response.status === 429) {
        this.state = 'rate_limited';
        this.lastError = 'HTTP 429 Rate Limited';
        return [];
      }

      if (!response.ok) {
        this.state = 'offline';
        this.lastError = `HTTP ${response.status} ${response.statusText}`;
        return [];
      }

      const payload = await response.json();
      const hits = parseSearchPayload(payload);

      this.state = 'online';
      this.lastOkAt = new Date().toISOString();
      this.lastError = null;

      return hits;
    } catch (error) {
      const isTimeout = (error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError';
      this.state = 'offline';
      this.lastError = isTimeout ? 'Request timeout (10s)' : (error instanceof Error ? error.message : String(error));
      return [];
    }
  }
}
