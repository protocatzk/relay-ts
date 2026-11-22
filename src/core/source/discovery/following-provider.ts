import { existsSync, readFileSync } from 'node:fs';
import type { DiscoveryHit, DiscoveryProvider, DiscoveryProviderStatus } from './types.js';
import { extractFlvStreamUrl, rememberStreamUrl } from './live-page-provider.js';

export interface FollowingProviderOptions {
  userAgent?: string;
  cookiesFile?: string;
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function readCookieHeader(filePath?: string): string {
  if (!filePath || !existsSync(filePath)) return '';
  try {
    const content = readFileSync(filePath, 'utf-8');
    const cookies: string[] = [];
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const parts = line.split('\t');
      if (parts.length >= 7) {
        cookies.push(`${parts[5]}=${parts[6]}`);
      }
    }
    return cookies.join('; ');
  } catch {
    return '';
  }
}

export class FollowingProvider implements DiscoveryProvider {
  readonly name = 'following';
  private readonly userAgent: string;
  private readonly cookiesFile?: string;
  private lastError: string | null = null;
  private lastOkAt: string | null = null;

  constructor(options: FollowingProviderOptions = {}) {
    this.userAgent = options.userAgent || DEFAULT_USER_AGENT;
    this.cookiesFile = options.cookiesFile;
  }

  health(): DiscoveryProviderStatus {
    return {
      name: this.name,
      status: this.lastError ? 'offline' : 'online',
      last_error: this.lastError,
      last_ok_at: this.lastOkAt,
    };
  }

  async following(opts: { limit?: number; page?: number } = {}): Promise<DiscoveryHit[]> {
    const cookie = readCookieHeader(this.cookiesFile);
    if (!cookie) {
      this.lastError = 'Kein TikTok-Session-Cookie hinterlegt';
      return [];
    }

    const page = opts.page ?? 0;
    const url = new URL('https://webcast.tiktok.com/webcast/feed/');
    url.searchParams.set('channel_id', '21'); // Following feed channel
    url.searchParams.set('scene', 'feed_draw');
    url.searchParams.set('req_from', page > 0 ? 'pc_web_following_feed_loadmore' : 'pc_web_following_feed_refresh');
    url.searchParams.set('aid', '1988');
    url.searchParams.set('app_language', 'de-DE');
    url.searchParams.set('webcast_language', 'de-DE');
    url.searchParams.set('device_platform', 'web');
    url.searchParams.set('count', String(Math.min(30, opts.limit ?? 20)));
    url.searchParams.set('offset', String(page * 20));

    try {
      const res = await fetch(url.toString(), {
        headers: {
          'user-agent': this.userAgent,
          cookie,
          referer: 'https://www.tiktok.com/live',
          accept: 'application/json, text/plain, */*',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const json = (await res.json()) as Record<string, unknown>;
      const rawData = Array.isArray(json.data) ? json.data : [];
      const hits: DiscoveryHit[] = [];

      for (const item of rawData) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const room = (rec.data || rec) as Record<string, unknown>;
        const owner = (room.owner || {}) as Record<string, unknown>;
        const handle = String(owner.display_id || owner.uniqueId || owner.unique_id || '').trim();
        if (!handle) continue;

        const displayName = String(owner.nickname || handle).trim();
        const avatarUrl =
          owner.avatar_large && typeof owner.avatar_large === 'object' && Array.isArray((owner.avatar_large as { url_list?: unknown[] }).url_list)
            ? String((owner.avatar_large as { url_list: string[] }).url_list[0] || '') || null
            : null;

        const flv = extractFlvStreamUrl(rec);
        if (flv) {
          rememberStreamUrl(handle, flv);
        }

        const userCount = typeof (room.stats as { user_count?: unknown })?.user_count === 'number'
          ? (room.stats as { user_count: number }).user_count
          : null;

        hits.push({
          handle,
          display_name: displayName,
          avatar_url: avatarUrl,
          cover_url: null,
          bio: null,
          title: typeof room.title === 'string' ? room.title : null,
          live: true,
          viewers: userCount,
          source: 'following',
          fetched_at: new Date().toISOString(),
        });
      }

      this.lastError = null;
      this.lastOkAt = new Date().toISOString();
      return hits;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      return [];
    }
  }
}
