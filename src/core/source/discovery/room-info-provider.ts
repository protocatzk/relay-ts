import type {
  DiscoveryHit,
  DiscoveryProvider,
  DiscoveryProviderState,
  DiscoveryProviderStatus,
} from './types.js';
import { normalizeHandle } from '../../../utils/format.js';
import { readCookieHeader } from '../resolver.js';
import { extractImageUrl, isAgeRestrictedValue } from './live-page-provider.js';

export interface RoomInfoProviderOptions {
  cookiesFile?: string;
  userAgent?: string;
}

export function parseRoomInfoPayload(payload: unknown, handle: string): DiscoveryHit | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as Record<string, unknown>).data;
  if (!data || typeof data !== 'object') return null;

  const dataRecord = data as Record<string, unknown>;
  const user =
    dataRecord.user && typeof dataRecord.user === 'object'
      ? (dataRecord.user as Record<string, unknown>)
      : {};
  const liveRoom =
    dataRecord.liveRoom && typeof dataRecord.liveRoom === 'object'
      ? (dataRecord.liveRoom as Record<string, unknown>)
      : {};

  const hasUserFields =
    typeof user.uniqueId === 'string' ||
    typeof user.unique_id === 'string' ||
    typeof user.display_id === 'string' ||
    typeof user.nickname === 'string' ||
    typeof user.id === 'string';
  const hasRoomFields =
    typeof liveRoom.title === 'string' ||
    typeof liveRoom.status === 'number' ||
    typeof liveRoom.userCount === 'number';

  if (!hasUserFields && !hasRoomFields) {
    return null;
  }

  const rawHandle =
    typeof user.uniqueId === 'string' && user.uniqueId.trim()
      ? user.uniqueId
      : typeof user.unique_id === 'string' && user.unique_id.trim()
        ? user.unique_id
        : typeof user.display_id === 'string' && user.display_id.trim()
          ? user.display_id
          : handle;

  const normalized = normalizeHandle(rawHandle);
  if (!normalized) return null;

  const liveStatus = Number(user.status ?? liveRoom.status ?? 0);
  const isLive = liveStatus === 2;

  const ageRestricted =
    isAgeRestrictedValue(liveRoom.ageRestricted) ||
    isAgeRestrictedValue(liveRoom.isAgeRestricted) ||
    isAgeRestrictedValue(liveRoom.age_restricted) ||
    isAgeRestrictedValue(dataRecord.ageRestricted) ||
    isAgeRestrictedValue(
      liveRoom.roomAuditStatus && (liveRoom.roomAuditStatus as Record<string, unknown>).isAgeRestricted,
    );

  const rawViewers = liveRoom.userCount ?? liveRoom.user_count ?? liveRoom.aliveUserCount;
  const viewers =
    typeof rawViewers === 'number'
      ? rawViewers
      : typeof rawViewers === 'string'
        ? parseInt(rawViewers, 10) || null
        : null;

  const displayName =
    typeof user.nickname === 'string' && user.nickname.trim() ? user.nickname.trim() : normalized;

  const avatarUrl =
    extractImageUrl(user.avatarLarger) ??
    extractImageUrl(user.avatar_large) ??
    extractImageUrl(user.avatarThumb) ??
    extractImageUrl(user.avatar_thumb);

  const bio =
    typeof user.bioDescription === 'string' && user.bioDescription.trim()
      ? user.bioDescription.trim()
      : typeof user.signature === 'string' && user.signature.trim()
        ? user.signature.trim()
        : null;

  const title = typeof liveRoom.title === 'string' && liveRoom.title.trim() ? liveRoom.title.trim() : null;

  return {
    handle: normalized,
    display_name: displayName,
    avatar_url: avatarUrl,
    bio,
    title,
    live: isLive,
    viewers,
    age_restricted: ageRestricted,
    source: 'room_info',
    fetched_at: new Date().toISOString(),
  };
}

export class RoomInfoProvider implements DiscoveryProvider {
  readonly name = 'room_info';
  private state: DiscoveryProviderState = 'online';
  private lastError: string | null = null;
  private lastOkAt: string | null = null;

  constructor(private readonly options: RoomInfoProviderOptions = {}) {}

  health(): DiscoveryProviderStatus {
    return {
      name: this.name,
      status: this.state,
      last_error: this.lastError,
      last_ok_at: this.lastOkAt,
    };
  }

  async roomInfo(handle: string): Promise<DiscoveryHit | null> {
    const normalized = normalizeHandle(handle);
    if (!normalized) return null;

    const url = new URL('https://www.tiktok.com/api-live/user/room');
    url.searchParams.set('aid', '1988');
    url.searchParams.set('sourceType', '54');
    url.searchParams.set('uniqueId', normalized);

    const headers: Record<string, string> = {
      accept: 'application/json',
      referer: `https://www.tiktok.com/@${normalized}/live`,
      'user-agent':
        this.options.userAgent ??
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
        return null;
      }

      if (!response.ok) {
        this.state = 'offline';
        this.lastError = `HTTP ${response.status} ${response.statusText}`;
        return null;
      }

      const payload = await response.json();
      const hit = parseRoomInfoPayload(payload, normalized);

      this.state = 'online';
      this.lastOkAt = new Date().toISOString();
      this.lastError = null;

      return hit;
    } catch (error) {
      const isTimeout = (error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError';
      this.state = 'offline';
      this.lastError = isTimeout
        ? 'Request timeout (10s)'
        : error instanceof Error
          ? error.message
          : String(error);
      return null;
    }
  }

  async search(q: string): Promise<DiscoveryHit[]> {
    const trimmed = q.trim();
    if (!trimmed) return [];

    const isExplicitHandle = trimmed.startsWith('@');
    const cleaned = trimmed.replace(/^@/, '');
    if (/^[a-zA-Z0-9._]{2,32}$/.test(cleaned)) {
      const hit = await this.roomInfo(cleaned);
      if (hit && (isExplicitHandle || hit.live)) {
        return [hit];
      }
    }
    return [];
  }
}
