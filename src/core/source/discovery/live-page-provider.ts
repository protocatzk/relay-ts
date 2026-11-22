import type {
  DiscoveryHit,
  DiscoveryProvider,
  DiscoveryProviderName,
  DiscoveryProviderState,
  DiscoveryProviderStatus,
} from './types.js';
import { normalizeHandle } from '../../../utils/format.js';

export interface LivePageProviderOptions {
  userAgent?: string;
  defaultLanguage?: string;
  defaultRegion?: string;
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const ALLOWED_STREAM_HOST_SUFFIXES = [
  '.tiktokcdn.com',
  '.tiktokcdn-eu.com',
  '.tiktokcdn-us.com',
  '.tiktokv.com',
  '.ttwstatic.com',
];

const streamUrlCache = new Map<string, { url: string; expiresAt: number }>();

export function isAllowedTikTokStreamUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_STREAM_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
  } catch {
    return false;
  }
}

export function rememberStreamUrl(handle: string, url: string): void {
  const norm = normalizeHandle(handle);
  if (!norm || !isAllowedTikTokStreamUrl(url)) return;
  if (streamUrlCache.size > 500) {
    const oldestKey = streamUrlCache.keys().next().value;
    if (oldestKey) streamUrlCache.delete(oldestKey);
  }
  streamUrlCache.set(norm, { url, expiresAt: Date.now() + 10 * 60_000 });
}

export function getRememberedStreamUrl(handle: string): string | null {
  const norm = normalizeHandle(handle);
  if (!norm) return null;
  const entry = streamUrlCache.get(norm);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    streamUrlCache.delete(norm);
    return null;
  }
  return entry.url;
}

export function extractFlvStreamUrl(record: Record<string, unknown>): string | null {
  const innerData =
    record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : record;
  const liveRoom = (innerData.liveRoom || innerData.room || innerData) as Record<string, unknown>;

  // 1. Webcast feed format: liveRoom.stream_url.flv_pull_url.{HD1, SD1, SD2, FULL_HD1}
  const streamUrlObj =
    liveRoom.stream_url && typeof liveRoom.stream_url === 'object'
      ? (liveRoom.stream_url as Record<string, unknown>)
      : null;

  if (streamUrlObj) {
    if (streamUrlObj.flv_pull_url && typeof streamUrlObj.flv_pull_url === 'object') {
      const flvMap = streamUrlObj.flv_pull_url as Record<string, unknown>;
      const preferredOrder = ['HD1', 'SD2', 'SD1', 'FULL_HD1'];
      for (const key of preferredOrder) {
        const candidate = flvMap[key];
        if (typeof candidate === 'string' && isAllowedTikTokStreamUrl(candidate)) {
          return candidate;
        }
      }
      for (const val of Object.values(flvMap)) {
        if (typeof val === 'string' && isAllowedTikTokStreamUrl(val)) {
          return val;
        }
      }
    }

    const coreSdk =
      streamUrlObj.live_core_sdk_data && typeof streamUrlObj.live_core_sdk_data === 'object'
        ? (streamUrlObj.live_core_sdk_data as Record<string, unknown>)
        : null;
    const pullData =
      coreSdk?.pull_data && typeof coreSdk.pull_data === 'object'
        ? (coreSdk.pull_data as Record<string, unknown>)
        : null;
    const fromCore = parseFlvFromStreamDataJson(pullData?.stream_data);
    if (fromCore) return fromCore;
  }

  // 2. Room info format: liveRoom.streamData.pull_data.stream_data
  const streamData =
    liveRoom.streamData && typeof liveRoom.streamData === 'object'
      ? (liveRoom.streamData as Record<string, unknown>)
      : null;
  const roomPull =
    streamData?.pull_data && typeof streamData.pull_data === 'object'
      ? (streamData.pull_data as Record<string, unknown>)
      : null;
  const fromRoom = parseFlvFromStreamDataJson(roomPull?.stream_data);
  if (fromRoom) return fromRoom;

  return null;
}

function parseFlvFromStreamDataJson(rawStreamData: unknown): string | null {
  let parsed = rawStreamData;
  if (typeof rawStreamData === 'string' && rawStreamData.trim()) {
    try {
      parsed = JSON.parse(rawStreamData);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const data = (parsed as Record<string, unknown>).data;
  if (!data || typeof data !== 'object') return null;
  const dataRec = data as Record<string, unknown>;

  for (const quality of ['hd', 'sd', 'ld', 'origin', ...Object.keys(dataRec)]) {
    const entry = dataRec[quality];
    if (!entry || typeof entry !== 'object') continue;
    const main = (entry as Record<string, unknown>).main;
    if (!main || typeof main !== 'object') continue;
    const flv = (main as Record<string, unknown>).flv;
    if (typeof flv === 'string' && isAllowedTikTokStreamUrl(flv)) {
      return flv;
    }
  }
  return null;
}

export interface RegionLocaleConfig {
  language: string;
  tz: string;
  defaultKeyword: string;
}

export const REGION_LOCALE_MAP: Record<string, RegionLocaleConfig> = {
  DE: { language: 'de', tz: 'Europe/Berlin', defaultKeyword: 'deutsch' },
  AT: { language: 'de', tz: 'Europe/Vienna', defaultKeyword: 'österreich' },
  CH: { language: 'de', tz: 'Europe/Zurich', defaultKeyword: 'schweiz' },
  US: { language: 'en', tz: 'America/New_York', defaultKeyword: 'live' },
  GB: { language: 'en', tz: 'Europe/London', defaultKeyword: 'uk' },
  FR: { language: 'fr', tz: 'Europe/Paris', defaultKeyword: 'france' },
  ES: { language: 'es', tz: 'Europe/Madrid', defaultKeyword: 'español' },
  IT: { language: 'it', tz: 'Europe/Rome', defaultKeyword: 'italia' },
  NL: { language: 'nl', tz: 'Europe/Amsterdam', defaultKeyword: 'nederland' },
  PL: { language: 'pl', tz: 'Europe/Warsaw', defaultKeyword: 'polska' },
  TR: { language: 'tr', tz: 'Europe/Istanbul', defaultKeyword: 'türkiye' },
  BR: { language: 'pt', tz: 'America/Sao_Paulo', defaultKeyword: 'brasil' },
  JP: { language: 'ja', tz: 'Asia/Tokyo', defaultKeyword: '日本' },
};

export function resolveRegionLocale(region?: string, language?: string): {
  region: string;
  language: string;
  locale: string;
  tz: string;
  defaultKeyword: string;
} {
  const normRegion = (region && region.trim() ? region.trim() : 'DE').toUpperCase();
  const preset = REGION_LOCALE_MAP[normRegion];
  const normLang = (
    language && language.trim() ? language.trim() : (preset?.language ?? 'de')
  ).toLowerCase();
  return {
    region: normRegion,
    language: normLang,
    locale: `${normLang}-${normRegion}`,
    tz: preset?.tz ?? 'Europe/Berlin',
    defaultKeyword: preset?.defaultKeyword ?? 'live',
  };
}

export function extractImageUrl(val: unknown): string | null {
  if (typeof val === 'string' && val.trim()) {
    return val.trim();
  }
  if (val && typeof val === 'object') {
    const rec = val as Record<string, unknown>;
    if (Array.isArray(rec.url_list)) {
      for (const item of rec.url_list) {
        if (typeof item === 'string' && item.trim()) {
          return item.trim();
        }
      }
    }
    if (typeof rec.url === 'string' && rec.url.trim()) {
      return rec.url.trim();
    }
  }
  return null;
}

export function isAgeRestrictedValue(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val > 0;
  if (val && typeof val === 'object') {
    const rec = val as Record<string, unknown>;
    if (rec.restricted === true || rec.isAgeRestricted === true || rec.ageRestricted === true) {
      return true;
    }
    const interval = Number(rec.age_interval ?? rec.AgeInterval ?? 0);
    if (Number.isFinite(interval) && interval > 0) {
      return true;
    }
  }
  return false;
}

export function buildWebcastFeedUrl(
  feedParams: Record<string, string>,
  opts?: { region?: string; language?: string; userAgent?: string },
): URL {
  const { region, locale, tz } = resolveRegionLocale(opts?.region, opts?.language);
  const ua = opts?.userAgent ?? DEFAULT_USER_AGENT;

  const url = new URL('https://webcast.tiktok.com/webcast/feed/');
  const baseParams: Record<string, string> = {
    aid: '1988',
    app_language: locale,
    app_name: 'tiktok_web',
    browser_language: locale,
    browser_name: 'Mozilla',
    browser_online: 'true',
    browser_platform: 'Win32',
    browser_version: ua.replace(/^Mozilla\//, ''),
    carrier_region: region,
    channel: 'tiktok_web',
    cookie_enabled: 'true',
    cpu_number: '8',
    data_collection_enabled: 'true',
    device_id: '7345678901234567890',
    device_platform: 'web_pc',
    device_type: 'web_h264',
    focus_state: 'true',
    history_len: '2',
    is_fullscreen: 'false',
    is_non_personalized: '0',
    is_page_visible: 'true',
    max_time: '0',
    os: 'windows',
    priority_region: region,
    referer: 'https://www.tiktok.com/',
    region,
    root_referer: 'https://www.tiktok.com/',
    screen_height: '1080',
    screen_width: '1920',
    tz_name: tz,
    user_is_login: 'false',
    webcast_language: locale,
    ...feedParams,
  };

  for (const [k, v] of Object.entries(baseParams)) {
    url.searchParams.set(k, v);
  }
  return url;
}

export function extractHitFromRoomRecord(
  candidate: Record<string, unknown>,
  source: DiscoveryProviderName,
): DiscoveryHit | null {
  if (!candidate || typeof candidate !== 'object') return null;

  const innerData =
    candidate.data && typeof candidate.data === 'object' && !Array.isArray(candidate.data)
      ? (candidate.data as Record<string, unknown>)
      : candidate;

  const liveRoom = (innerData.liveRoom || innerData.room || innerData) as Record<string, unknown>;
  const user = (
    innerData.owner ||
    innerData.user ||
    innerData.author ||
    liveRoom.owner ||
    liveRoom.user ||
    liveRoom.author ||
    candidate.owner ||
    candidate.user ||
    candidate.author ||
    innerData
  ) as Record<string, unknown>;

  const rawHandle =
    typeof user.uniqueId === 'string' && user.uniqueId.trim()
      ? user.uniqueId
      : typeof user.unique_id === 'string' && user.unique_id.trim()
        ? user.unique_id
        : typeof user.display_id === 'string' && user.display_id.trim()
          ? user.display_id
          : typeof user.displayId === 'string' && user.displayId.trim()
            ? user.displayId
            : typeof innerData.uniqueId === 'string' && innerData.uniqueId.trim()
              ? innerData.uniqueId
              : typeof innerData.unique_id === 'string' && innerData.unique_id.trim()
                ? innerData.unique_id
                : typeof innerData.display_id === 'string' && innerData.display_id.trim()
                  ? innerData.display_id
                  : '';

  if (!rawHandle) return null;
  const handle = normalizeHandle(rawHandle);
  if (!handle) return null;

  const displayName =
    typeof user.nickname === 'string' && user.nickname.trim()
      ? user.nickname.trim()
      : typeof innerData.nickname === 'string' && innerData.nickname.trim()
        ? innerData.nickname.trim()
        : handle;

  const avatarUrl =
    extractImageUrl(user.avatarLarger) ??
    extractImageUrl(user.avatar_large) ??
    extractImageUrl(user.avatar_medium) ??
    extractImageUrl(user.avatarThumb) ??
    extractImageUrl(user.avatar_thumb) ??
    extractImageUrl(liveRoom.cover) ??
    extractImageUrl(innerData.avatar);

  const coverUrl = extractImageUrl(liveRoom.cover) ?? avatarUrl;

  const flvUrl = extractFlvStreamUrl(innerData);
  if (flvUrl) {
    rememberStreamUrl(handle, flvUrl);
  }

  const bio =
    typeof user.bio_description === 'string' && user.bio_description.trim()
      ? user.bio_description.trim()
      : typeof user.bioDescription === 'string' && user.bioDescription.trim()
        ? user.bioDescription.trim()
        : typeof user.signature === 'string' && user.signature.trim()
          ? user.signature.trim()
          : null;

  const rawTitle = typeof liveRoom.title === 'string' ? liveRoom.title : typeof innerData.title === 'string' ? innerData.title : null;
  const title = rawTitle && rawTitle.trim() ? rawTitle.trim() : null;

  const rawStatus = liveRoom.status ?? innerData.status ?? candidate.status;
  const isLive =
    rawStatus === 2 ||
    rawStatus === 'live' ||
    innerData.live === true ||
    innerData.isLive === true ||
    candidate.live === true;

  const rawViewers =
    liveRoom.user_count ??
    liveRoom.userCount ??
    liveRoom.aliveUserCount ??
    innerData.user_count ??
    innerData.userCount ??
    innerData.viewers;

  let viewers: number | null =
    typeof rawViewers === 'number'
      ? rawViewers
      : typeof rawViewers === 'string'
        ? parseInt(rawViewers, 10) || null
        : null;

  if (viewers === null && isLive && liveRoom.stats && typeof liveRoom.stats === 'object') {
    viewers = 0;
  }

  const ageRestricted =
    isAgeRestrictedValue(liveRoom.ageRestricted) ||
    isAgeRestrictedValue(liveRoom.isAgeRestricted) ||
    isAgeRestrictedValue(liveRoom.age_restricted) ||
    isAgeRestrictedValue(innerData.ageRestricted) ||
    isAgeRestrictedValue(innerData.isAgeRestricted) ||
    isAgeRestrictedValue(innerData.age_restricted);

  return {
    handle,
    display_name: displayName,
    avatar_url: avatarUrl,
    cover_url: coverUrl,
    bio,
    title,
    live: isLive,
    viewers,
    age_restricted: ageRestricted,
    source,
    fetched_at: new Date().toISOString(),
  };
}

export function parseWebcastFeedPayload(
  payload: unknown,
  source: DiscoveryProviderName = 'live_page',
): DiscoveryHit[] {
  if (!payload || typeof payload !== 'object') return [];
  const rec = payload as Record<string, unknown>;
  const list = Array.isArray(rec.data) ? rec.data : [];

  const hits: DiscoveryHit[] = [];
  const seenHandles = new Set<string>();

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const hit = extractHitFromRoomRecord(entry as Record<string, unknown>, source);
    if (!hit || seenHandles.has(hit.handle)) continue;
    seenHandles.add(hit.handle);
    hits.push(hit);
  }

  return hits;
}

export function parseLivePageHtml(html: string): DiscoveryHit[] {
  const hits: DiscoveryHit[] = [];
  const seenHandles = new Set<string>();

  function addCandidate(candidate: Record<string, unknown>): void {
    const hit = extractHitFromRoomRecord(candidate, 'live_page');
    if (!hit || seenHandles.has(hit.handle)) return;
    seenHandles.add(hit.handle);
    hits.push(hit);
  }

  // 1. Try script tag matches
  const scriptRegex =
    /<script\s+[^>]*id=["'](__UNIVERSAL_DATA_FOR_REHYDRATION__|SIGI_STATE|__INITIAL_DATA__)["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(html)) !== null) {
    const rawJson = match[2]?.trim();
    if (!rawJson) continue;
    try {
      const data = JSON.parse(rawJson);
      findLiveRooms(data, addCandidate);
    } catch {
      // Ignore JSON parse errors for malformed embedded scripts
    }
  }

  // 2. Try window['__INITIAL_STATE__'] = {...} pattern
  if (hits.length === 0) {
    const windowMatch = /(?:window\['__INITIAL_STATE__'\]|window\.__INITIAL_STATE__)\s*=\s*(\{[\s\S]*?\});/i.exec(html);
    if (windowMatch && windowMatch[1]) {
      try {
        const data = JSON.parse(windowMatch[1]);
        findLiveRooms(data, addCandidate);
      } catch {
        // Ignore
      }
    }
  }

  return hits;
}

function findLiveRooms(
  node: unknown,
  callback: (candidate: Record<string, unknown>) => void,
  depth = 0,
): void {
  if (depth > 8 || !node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) {
      findLiveRooms(item, callback, depth + 1);
    }
    return;
  }

  const record = node as Record<string, unknown>;

  const hasUserIdentifier =
    typeof record.uniqueId === 'string' ||
    typeof record.unique_id === 'string' ||
    typeof record.display_id === 'string' ||
    (record.owner &&
      typeof record.owner === 'object' &&
      (typeof (record.owner as Record<string, unknown>).uniqueId === 'string' ||
        typeof (record.owner as Record<string, unknown>).display_id === 'string')) ||
    (record.user &&
      typeof record.user === 'object' &&
      typeof (record.user as Record<string, unknown>).uniqueId === 'string') ||
    (record.author &&
      typeof record.author === 'object' &&
      typeof (record.author as Record<string, unknown>).uniqueId === 'string');

  const hasRoomIndicators =
    'liveRoom' in record ||
    'room' in record ||
    'roomId' in record ||
    'room_id' in record ||
    'userCount' in record ||
    'user_count' in record ||
    'aliveUserCount' in record ||
    record.status === 2 ||
    record.live === true;

  if (hasUserIdentifier && hasRoomIndicators) {
    callback(record);
  }

  const candidateKeys = [
    'LiveRoom',
    'liveRoom',
    'roomList',
    'liveList',
    'recommendList',
    'items',
    'itemList',
    'users',
    'data',
    '__DEFAULT_SCOPE__',
    'webapp.live-detail',
    'webapp.live-recommend',
  ];

  for (const key of candidateKeys) {
    if (key in record && record[key] && typeof record[key] === 'object') {
      findLiveRooms(record[key], callback, depth + 1);
    }
  }

  if (depth < 4) {
    for (const k of Object.keys(record)) {
      if (typeof record[k] === 'object' && record[k] !== null && !candidateKeys.includes(k)) {
        findLiveRooms(record[k], callback, depth + 1);
      }
    }
  }
}

export class LivePageProvider implements DiscoveryProvider {
  readonly name = 'live_page';
  private state: DiscoveryProviderState = 'online';
  private lastError: string | null = null;
  private lastOkAt: string | null = null;

  constructor(private readonly options: LivePageProviderOptions = {}) {}

  health(): DiscoveryProviderStatus {
    return {
      name: this.name,
      status: this.state,
      last_error: this.lastError,
      last_ok_at: this.lastOkAt,
    };
  }

  async trending(opts?: { region?: string; language?: string; limit?: number; page?: number }): Promise<DiscoveryHit[]> {
    const resolved = resolveRegionLocale(
      opts?.region ?? this.options.defaultRegion,
      opts?.language,
    );
    const lang = resolved.language;
    const region = resolved.region;
    const userAgent = this.options.userAgent ?? DEFAULT_USER_AGENT;
    const isLoadMore = (opts?.page ?? 0) > 0;

    const feedChannels = [
      {
        channel_id: '87',
        req_from: isLoadMore ? 'live_mt_pc_web_rec_tab_loadmore' : 'live_mt_pc_web_rec_tab_refresh',
        related_live_tag: '',
      },
      {
        channel_id: '89',
        req_from: isLoadMore ? 'pc_web_game_feed_loadmore' : 'pc_web_game_feed_refresh',
        related_live_tag: '',
      },
      {
        channel_id: '1222001',
        req_from: isLoadMore ? 'webapp_taxonomy_drawer_feed_loadmore' : 'webapp_taxonomy_drawer_enter_feed',
        related_live_tag: 'chatting',
      },
    ];

    const hitsMap = new Map<string, DiscoveryHit>();
    let sawRateLimit = false;
    let lastErr: string | null = null;

    const feedResults = await Promise.allSettled(
      feedChannels.map(async (channel) => {
        const url = buildWebcastFeedUrl(channel, { region, language: lang, userAgent });
        const response = await fetch(url, {
          headers: {
            'user-agent': userAgent,
            accept: 'application/json, text/plain, */*',
            'accept-language': `${lang}-${region},${lang};q=0.9,en;q=0.8`,
            referer: 'https://www.tiktok.com/live',
            origin: 'https://www.tiktok.com',
          },
          signal: AbortSignal.timeout(10_000),
        });

        if (response.status === 429) {
          sawRateLimit = true;
          throw new Error('HTTP 429 Rate Limited');
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const payload = await response.json();
        return parseWebcastFeedPayload(payload, 'live_page');
      }),
    );

    for (const res of feedResults) {
      if (res.status === 'fulfilled') {
        for (const hit of res.value) {
          if (!hitsMap.has(hit.handle)) {
            hitsMap.set(hit.handle, hit);
          }
        }
      } else {
        const reason = res.reason instanceof Error ? res.reason.message : String(res.reason);
        lastErr = reason;
      }
    }

    if (hitsMap.size > 0) {
      this.state = 'online';
      this.lastOkAt = new Date().toISOString();
      this.lastError = null;

      const sorted = Array.from(hitsMap.values()).sort(
        (a, b) => Number(b.live) - Number(a.live) || (b.viewers ?? 0) - (a.viewers ?? 0),
      );
      return opts?.limit && sorted.length > opts.limit ? sorted.slice(0, opts.limit) : sorted;
    }

    // Fallback to SSR HTML scraping if webcast/feed yielded no items
    const headers: Record<string, string> = {
      'user-agent': userAgent,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'accept-language': `${lang}-${region},${lang};q=0.9,en;q=0.8`,
      referer: 'https://www.tiktok.com/',
    };

    try {
      const response = await fetch('https://www.tiktok.com/live', {
        headers,
        signal: AbortSignal.timeout(10_000),
      });

      if (response.status === 429 || sawRateLimit) {
        this.state = 'rate_limited';
        this.lastError = 'HTTP 429 Rate Limited';
        return [];
      }

      if (!response.ok) {
        this.state = 'offline';
        this.lastError = `HTTP ${response.status} ${response.statusText}`;
        return [];
      }

      const html = await response.text();
      const hits = parseLivePageHtml(html);

      if (hits.length === 0 && lastErr) {
        this.state = sawRateLimit ? 'rate_limited' : 'offline';
        this.lastError = lastErr;
        return [];
      }

      this.state = 'online';
      this.lastOkAt = new Date().toISOString();
      this.lastError = null;

      if (opts?.limit && hits.length > opts.limit) {
        return hits.slice(0, opts.limit);
      }
      return hits;
    } catch (error) {
      const isTimeout = (error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError';
      this.state = sawRateLimit ? 'rate_limited' : 'offline';
      this.lastError = isTimeout
        ? 'Request timeout (10s)'
        : lastErr ?? (error instanceof Error ? error.message : String(error));
      return [];
    }
  }
}
