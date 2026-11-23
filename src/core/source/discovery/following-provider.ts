import { existsSync, readFileSync } from 'node:fs';
import type { TikTokAccountStore } from '../../account/tiktok-account-store.js';
import type { DiscoveryHit, DiscoveryProvider, DiscoveryProviderStatus } from './types.js';
import {
  buildWebcastFeedUrl,
  extractFlvStreamUrl,
  parseWebcastFeedPayload,
  rememberStreamUrl,
} from './live-page-provider.js';

export interface FollowingProviderOptions {
  userAgent?: string;
  cookiesFile?: string;
  accountStore?: TikTokAccountStore;
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function buildCookieHeader(sessionId: string, targetIdc?: string): string {
  const sid = sessionId.trim();
  const parts: string[] = [
    `sessionid=${sid}`,
    `sessionid_ss=${sid}`,
    `sid_tt=${sid}`,
    `sid_guard=${sid}%7C${Math.floor(Date.now() / 1000)}%7C5184000%7C${Math.floor(Date.now() / 1000)}`,
  ];
  if (targetIdc && targetIdc.trim()) {
    parts.push(`tt-target-idc=${targetIdc.trim()}`);
  }
  return parts.join('; ');
}

function readCookieHeader(filePath?: string): string {
  if (!filePath || !existsSync(filePath)) return '';
  try {
    const content = readFileSync(filePath, 'utf-8');
    const cookies: string[] = [];
    let hasSessionId = false;
    let sessionIdVal = '';
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const parts = line.split('\t');
      if (parts.length >= 7) {
        const name = parts[5];
        const val = parts[6];
        cookies.push(`${name}=${val}`);
        if (name === 'sessionid') {
          hasSessionId = true;
          sessionIdVal = val;
        }
      }
    }
    if (hasSessionId && !cookies.some((c) => c.startsWith('sessionid_ss='))) {
      cookies.push(`sessionid_ss=${sessionIdVal}`);
    }
    if (hasSessionId && !cookies.some((c) => c.startsWith('sid_tt='))) {
      cookies.push(`sid_tt=${sessionIdVal}`);
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
  private readonly accountStore?: TikTokAccountStore;
  private lastError: string | null = null;
  private lastOkAt: string | null = null;

  constructor(options: FollowingProviderOptions = {}) {
    this.userAgent = options.userAgent || DEFAULT_USER_AGENT;
    this.cookiesFile = options.cookiesFile;
    this.accountStore = options.accountStore;
  }

  health(): DiscoveryProviderStatus {
    return {
      name: this.name,
      status: this.lastError ? 'offline' : 'online',
      last_error: this.lastError,
      last_ok_at: this.lastOkAt,
    };
  }

  async following(
    opts: {
      limit?: number;
      page?: number;
      accountId?: string;
      sessionId?: string;
    } = {},
  ): Promise<DiscoveryHit[]> {
    let cookie = '';
    if (opts.sessionId) {
      cookie = buildCookieHeader(opts.sessionId);
    } else if (this.accountStore) {
      const account = opts.accountId
        ? this.accountStore.getById(opts.accountId)
        : this.accountStore.getActive();
      if (account?.sessionId) {
        cookie = buildCookieHeader(account.sessionId, account.targetIdc);
      }
    }

    if (!cookie) {
      cookie = readCookieHeader(this.cookiesFile);
    }

    if (!cookie) {
      this.lastError = 'Kein TikTok-Session-Cookie hinterlegt';
      return [];
    }

    const page = opts.page ?? 0;
    const isLoadMore = page > 0;
    const feedParams: Record<string, string> = {
      channel_id: '42',
      scene: 'feed_draw',
      req_from: isLoadMore ? 'pc_web_following_feed_loadmore' : 'pc_web_following_feed_refresh',
      user_is_login: 'true',
      count: String(Math.min(30, opts.limit ?? 20)),
      offset: String(page * 20),
    };

    const url = buildWebcastFeedUrl(feedParams, { userAgent: this.userAgent });

    try {
      const res = await fetch(url.toString(), {
        headers: {
          'user-agent': this.userAgent,
          cookie,
          referer: 'https://www.tiktok.com/live',
          origin: 'https://www.tiktok.com',
          accept: 'application/json, text/plain, */*',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const json = (await res.json()) as Record<string, unknown>;
      let hits = parseWebcastFeedPayload(json, 'following');

      // Fallback: If channel 42 returned no items on page 0, try channel 21
      if (hits.length === 0 && page === 0) {
        feedParams.channel_id = '21';
        const fallbackUrl = buildWebcastFeedUrl(feedParams, { userAgent: this.userAgent });
        const fallbackRes = await fetch(fallbackUrl.toString(), {
          headers: {
            'user-agent': this.userAgent,
            cookie,
            referer: 'https://www.tiktok.com/live',
            origin: 'https://www.tiktok.com',
            accept: 'application/json, text/plain, */*',
          },
          signal: AbortSignal.timeout(8000),
        }).catch(() => null);

        if (fallbackRes?.ok) {
          const fallbackJson = await fallbackRes.json().catch(() => null);
          if (fallbackJson) {
            hits = parseWebcastFeedPayload(fallbackJson, 'following');
          }
        }
      }

      // Fallback: If standard webcast feed payload format differed, manual extraction
      if (hits.length === 0 && Array.isArray(json.data)) {
        for (const item of json.data) {
          if (!item || typeof item !== 'object') continue;
          const rec = item as Record<string, unknown>;
          const room = (rec.data || rec) as Record<string, unknown>;
          const owner = (room.owner || {}) as Record<string, unknown>;
          const handle = String(owner.display_id || owner.uniqueId || owner.unique_id || '').trim();
          if (!handle) continue;

          const displayName = String(owner.nickname || handle).trim();
          const avatarUrl =
            owner.avatar_large &&
            typeof owner.avatar_large === 'object' &&
            Array.isArray((owner.avatar_large as { url_list?: unknown[] }).url_list)
              ? String((owner.avatar_large as { url_list: string[] }).url_list[0] || '') || null
              : null;

          const flv = extractFlvStreamUrl(rec);
          if (flv) {
            rememberStreamUrl(handle, flv);
          }

          const userCount =
            typeof (room.stats as { user_count?: unknown })?.user_count === 'number'
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
      }

      for (const hit of hits) {
        hit.source = 'following';
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
