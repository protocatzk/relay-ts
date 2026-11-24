import type {
  DiscoveryHit,
  DiscoveryProvider,
  DiscoveryProviderState,
  DiscoveryProviderStatus,
  DiscoverySuggestion,
} from './types.js';
import { readCookieHeader } from '../resolver.js';
import {
  buildWebcastFeedUrl,
  extractHitFromRoomRecord,
  resolveRegionLocale,
} from './live-page-provider.js';

export interface SearchProviderOptions {
  cookiesFile?: string;
  userAgent?: string;
}

export function parseSearchPayload(payload: unknown): DiscoveryHit[] {
  if (!payload || typeof payload !== 'object') return [];
  const hits: DiscoveryHit[] = [];
  const seenHandles = new Set<string>();

  const root = payload as Record<string, unknown>;
  const data = root.data ?? payload;
  const list = Array.isArray(data)
    ? data
    : Array.isArray(root.userList)
      ? (root.userList as unknown[])
      : Array.isArray((data as Record<string, unknown>).live_list)
        ? ((data as Record<string, unknown>).live_list as unknown[])
        : Array.isArray((data as Record<string, unknown>).itemList)
          ? ((data as Record<string, unknown>).itemList as unknown[])
          : Array.isArray((data as Record<string, unknown>).items)
            ? ((data as Record<string, unknown>).items as unknown[])
            : Array.isArray((data as Record<string, unknown>).user_list)
              ? ((data as Record<string, unknown>).user_list as unknown[])
              : [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    let rec = item as Record<string, unknown>;

    // Handle /api/search/live/full/ format with live_info.raw_data / room_info
    if (rec.live_info && typeof rec.live_info === 'object') {
      const liveInfo = rec.live_info as Record<string, unknown>;
      const roomInfo =
        liveInfo.room_info && typeof liveInfo.room_info === 'object'
          ? (liveInfo.room_info as Record<string, unknown>)
          : {};
      let rawParsed: Record<string, unknown> = {};
      if (typeof liveInfo.raw_data === 'string' && liveInfo.raw_data.trim()) {
        try {
          rawParsed = JSON.parse(liveInfo.raw_data) as Record<string, unknown>;
        } catch {
          // Ignore malformed raw_data JSON
        }
      }
      rec = { ...roomInfo, ...rawParsed };
    } else if (rec.user_info && typeof rec.user_info === 'object') {
      rec = rec.user_info as Record<string, unknown>;
    }

    const hit = extractHitFromRoomRecord(rec, 'search_api');
    if (!hit || seenHandles.has(hit.handle)) continue;
    seenHandles.add(hit.handle);
    hits.push(hit);
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

  async trending(opts?: { region?: string; language?: string; limit?: number; page?: number }): Promise<DiscoveryHit[]> {
    const { defaultKeyword, region } = resolveRegionLocale(opts?.region, opts?.language);
    return this.search(defaultKeyword, { limit: opts?.limit ?? 20, region, page: opts?.page });
  }

  async search(q: string, opts?: { limit?: number; region?: string; page?: number }): Promise<DiscoveryHit[]> {
    const trimmed = q.trim();
    if (!trimmed) return [];

    const cleanQuery = trimmed.replace(/^[#@]+/, '').trim();
    if (!cleanQuery) return [];

    const limit = opts?.limit ?? 20;
    const page = Math.max(0, opts?.page ?? 0);
    const { region, language, locale } = resolveRegionLocale(opts?.region);
    const userAgent =
      this.options.userAgent ??
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    const headers: Record<string, string> = {
      accept: 'application/json, text/plain, */*',
      'accept-language': `${locale},${language};q=0.9,en;q=0.8`,
      referer: `https://www.tiktok.com/live/explore/${encodeURIComponent(cleanQuery)}`,
      origin: 'https://www.tiktok.com',
      'user-agent': userAgent,
    };

    if (this.options.cookiesFile) {
      const cookie = readCookieHeader(this.options.cookiesFile);
      if (cookie) headers.cookie = cookie;
    }

    const url = buildWebcastFeedUrl(
      {
        req_from: 'pc_web_seo_query_room',
        channel_id: '86',
        need_room_count: String(Math.max(12, limit)),
        last_page: String(page),
        search_keywords: cleanQuery,
      },
      { region, language, userAgent },
    );

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
      const hitsMap = new Map<string, DiscoveryHit>();
      for (const hit of parseSearchPayload(payload)) {
        hitsMap.set(hit.handle, hit);
      }

      // If no live rooms matched the keyword, check user suggestion API as fallback
      if (hitsMap.size === 0) {
        try {
          const sugUrl = new URL('https://www.tiktok.com/api/comment/search/sug/user/');
          sugUrl.searchParams.set('aid', '1988');
          sugUrl.searchParams.set('app_name', 'tiktok_web');
          sugUrl.searchParams.set('device_platform', 'web_pc');
          sugUrl.searchParams.set('region', region);
          sugUrl.searchParams.set('keyword', cleanQuery);

          const sugRes = await fetch(sugUrl, {
            headers,
            signal: AbortSignal.timeout(6_000),
          });
          if (sugRes.ok) {
            const sugPayload = await sugRes.json();
            for (const hit of parseSearchPayload(sugPayload)) {
              if (!hitsMap.has(hit.handle)) {
                hitsMap.set(hit.handle, hit);
              }
            }
          }
        } catch {
          // Ignore optional suggestion fallback errors
        }
      }

      this.state = 'online';
      this.lastOkAt = new Date().toISOString();
      this.lastError = null;

      const sorted = Array.from(hitsMap.values()).sort(
        (a, b) => Number(b.live) - Number(a.live) || (b.viewers ?? 0) - (a.viewers ?? 0),
      );
      return sorted.slice(0, limit);
    } catch (error) {
      const isTimeout = (error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError';
      this.state = 'offline';
      this.lastError = isTimeout
        ? 'Request timeout (10s)'
        : error instanceof Error
          ? error.message
          : String(error);
      return [];
    }
  }

  /**
   * Profile suggestions for the header search (#92). Uses the public user
   * suggestion endpoint; results are handles only, live status is resolved by
   * the caller.
   */
  async suggest(
    q: string,
    opts: { limit?: number; region?: string } = {},
  ): Promise<DiscoverySuggestion[]> {
    const cleanQuery = q.trim().replace(/^@+/, '');
    if (!cleanQuery) return [];
    const { region, language, locale } = resolveRegionLocale(opts.region);
    const limit = Math.min(20, Math.max(1, opts.limit ?? 8));
    const headers: Record<string, string> = {
      accept: 'application/json, text/plain, */*',
      'accept-language': `${locale},${language};q=0.9,en;q=0.8`,
      referer: `https://www.tiktok.com/search/user?q=${encodeURIComponent(cleanQuery)}`,
      'user-agent':
        this.options.userAgent ??
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    };
    if (this.options.cookiesFile) {
      const cookie = readCookieHeader(this.options.cookiesFile);
      if (cookie) headers.cookie = cookie;
    }

    const url = new URL('https://www.tiktok.com/api/comment/search/sug/user/');
    url.searchParams.set('aid', '1988');
    url.searchParams.set('app_name', 'tiktok_web');
    url.searchParams.set('device_platform', 'web_pc');
    url.searchParams.set('region', region);
    url.searchParams.set('keyword', cleanQuery);

    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(6_000) });
      if (!response.ok) return [];
      const payload = (await response.json()) as unknown;
      const seen = new Set<string>();
      const suggestions: DiscoverySuggestion[] = [];
      for (const hit of parseSearchPayload(payload)) {
        const handle = hit.handle.replace(/^@+/, '');
        if (!handle || seen.has(handle)) continue;
        seen.add(handle);
        suggestions.push({
          handle,
          display_name: hit.display_name || handle,
          avatar_url: hit.avatar_url,
        });
        if (suggestions.length >= limit) break;
      }
      return suggestions;
    } catch {
      // Suggestions are best effort; the search itself still works.
      return [];
    }
  }
}
