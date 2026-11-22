import type { DiscoveryHit, DiscoveryProvider, DiscoveryProviderStatus, DiscoveryProviderState } from './types.js';
import { normalizeHandle } from '../../../utils/format.js';

export interface LivePageProviderOptions {
  userAgent?: string;
  defaultLanguage?: string;
  defaultRegion?: string;
}

export function parseLivePageHtml(html: string): DiscoveryHit[] {
  const hits: DiscoveryHit[] = [];
  const seenHandles = new Set<string>();

  function addCandidate(candidate: Record<string, unknown>): void {
    if (!candidate || typeof candidate !== 'object') return;

    const liveRoom = (candidate.liveRoom || candidate.room || candidate) as Record<string, unknown>;
    const user = (candidate.owner || candidate.user || candidate.author || liveRoom.owner || liveRoom.user || liveRoom.author || candidate) as Record<string, unknown>;

    const rawHandle = typeof user.uniqueId === 'string'
      ? user.uniqueId
      : (typeof candidate.uniqueId === 'string'
        ? candidate.uniqueId
        : (typeof candidate.unique_id === 'string' ? candidate.unique_id : ''));

    if (!rawHandle) return;
    const handle = normalizeHandle(rawHandle);
    if (!handle || seenHandles.has(handle)) return;

    const displayName = typeof user.nickname === 'string'
      ? user.nickname
      : (typeof candidate.nickname === 'string' ? candidate.nickname : handle);

    const avatarUrl = typeof user.avatarLarger === 'string'
      ? user.avatarLarger
      : (typeof user.avatarThumb === 'string'
        ? user.avatarThumb
        : (typeof candidate.avatar === 'string' ? candidate.avatar : null));

    const bio = typeof user.signature === 'string'
      ? user.signature
      : (typeof user.bioDescription === 'string' ? user.bioDescription : null);

    const title = typeof liveRoom.title === 'string'
      ? liveRoom.title
      : (typeof candidate.title === 'string' ? candidate.title : null);

    const rawStatus = liveRoom.status ?? candidate.status;
    const isLive = rawStatus === 2 || rawStatus === 'live' || candidate.live === true || candidate.isLive === true;

    const rawViewers = liveRoom.userCount ?? liveRoom.aliveUserCount ?? candidate.userCount ?? candidate.viewers;
    const viewers = typeof rawViewers === 'number' ? rawViewers : (typeof rawViewers === 'string' ? parseInt(rawViewers, 10) || null : null);

    const ageRestricted = Boolean(
      liveRoom.ageRestricted ||
      liveRoom.isAgeRestricted ||
      candidate.ageRestricted ||
      candidate.isAgeRestricted ||
      candidate.age_restricted
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
      source: 'live_page',
      fetched_at: new Date().toISOString(),
    });
  }

  // 1. Try script tag matches
  const scriptRegex = /<script\s+[^>]*id=["'](__UNIVERSAL_DATA_FOR_REHYDRATION__|SIGI_STATE|__INITIAL_DATA__)["'][^>]*>([\s\S]*?)<\/script>/gi;
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

function findLiveRooms(obj: unknown, callback: (candidate: Record<string, unknown>) => void, depth = 0): void {
  if (!obj || typeof obj !== 'object' || depth > 8) return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (item && typeof item === 'object') {
        findLiveRooms(item, callback, depth + 1);
      }
    }
    return;
  }

  const record = obj as Record<string, unknown>;

  // Check if current node is a live room candidate
  if (
    (record.liveRoom && typeof record.liveRoom === 'object') ||
    (record.streamData && typeof record.streamData === 'object') ||
    (record.roomId && record.owner) ||
    (record.room_id && (record.owner || record.author)) ||
    (record.uniqueId && (record.userCount !== undefined || record.status !== undefined))
  ) {
    callback(record);
  }

  // Common TikTok keys that hold collections
  const candidateKeys = [
    'LiveRoom', 'liveRoom', 'roomList', 'recommendList', 'liveList',
    'webapp.live-detail', 'webapp.live-room-list', 'webapp.live-recommend',
    'live_list', 'data', 'itemList', 'subItems',
  ];

  for (const key of candidateKeys) {
    if (key in record && record[key]) {
      findLiveRooms(record[key], callback, depth + 1);
    }
  }

  // Also traverse values if not many keys
  const keys = Object.keys(record);
  if (keys.length < 20) {
    for (const k of keys) {
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

  async trending(opts?: { region?: string; language?: string; limit?: number }): Promise<DiscoveryHit[]> {
    const lang = opts?.language ?? this.options.defaultLanguage ?? 'de';
    const userAgent = this.options.userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    const headers: Record<string, string> = {
      'user-agent': userAgent,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'accept-language': `${lang}-${(opts?.region ?? this.options.defaultRegion ?? 'DE').toUpperCase()},${lang};q=0.9,en;q=0.8`,
      referer: 'https://www.tiktok.com/',
    };

    try {
      const response = await fetch('https://www.tiktok.com/live', {
        headers,
        signal: AbortSignal.timeout(12_000),
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

      const html = await response.text();
      const hits = parseLivePageHtml(html);

      this.state = 'online';
      this.lastOkAt = new Date().toISOString();
      this.lastError = null;

      if (opts?.limit && hits.length > opts.limit) {
        return hits.slice(0, opts.limit);
      }
      return hits;
    } catch (error) {
      const isTimeout = (error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError';
      this.state = 'offline';
      this.lastError = isTimeout ? 'Request timeout (12s)' : (error instanceof Error ? error.message : String(error));
      return [];
    }
  }
}
