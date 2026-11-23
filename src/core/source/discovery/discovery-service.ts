import type { Logger } from 'pino';
import type { EventBus } from '../../events.js';
import type { SettingsService } from '../../store/settings-service.js';
import type { StreamerStore } from '../../store/streamer-store.js';
import type { StreamerConfig } from '../../config/schema.js';
import type { Supervisor } from '../../supervisor/supervisor.js';
import type { TikTokAccountStore } from '../../account/tiktok-account-store.js';
import { ConflictError, ValidationError } from '../../../utils/errors.js';
import { normalizeHandle } from '../../../utils/format.js';
import { FollowingProvider } from './following-provider.js';
import type {
  DiscoveryHit,
  DiscoveryProvider,
  DiscoveryProviderName,
  DiscoveryProviderStatus,
  DiscoveryResponse,
} from './types.js';
import { getRememberedStreamUrl, LivePageProvider } from './live-page-provider.js';
import { RoomInfoProvider } from './room-info-provider.js';
import { SearchProvider } from './search-provider.js';

export interface DiscoveryServiceDeps {
  store: StreamerStore;
  settingsService: SettingsService;
  supervisor: Supervisor;
  bus: EventBus;
  logger: Logger;
  userAgent?: string;
  cookiesFile?: string;
  accountStore?: TikTokAccountStore;
  providers?: Map<DiscoveryProviderName, DiscoveryProvider>;
}

export class DiscoveryService {
  private readonly providers = new Map<DiscoveryProviderName, DiscoveryProvider>();
  private readonly trendingCache = new Map<string, { response: DiscoveryResponse; expiresAt: number }>();
  private readonly searchCache = new Map<string, { response: DiscoveryResponse; expiresAt: number }>();
  private readonly roomCache = new Map<string, { hit: DiscoveryHit | null; expiresAt: number }>();

  constructor(private readonly deps: DiscoveryServiceDeps) {
    if (deps.providers) {
      for (const [name, provider] of deps.providers) {
        this.providers.set(name, provider);
      }
    } else {
      this.providers.set(
        'live_page',
        new LivePageProvider({ userAgent: deps.userAgent }),
      );
      this.providers.set(
        'room_info',
        new RoomInfoProvider({ userAgent: deps.userAgent, cookiesFile: deps.cookiesFile }),
      );
      this.providers.set(
        'search_api',
        new SearchProvider({ userAgent: deps.userAgent, cookiesFile: deps.cookiesFile }),
      );
      this.providers.set(
        'following',
        new FollowingProvider({
          userAgent: deps.userAgent,
          cookiesFile: deps.cookiesFile,
          accountStore: deps.accountStore,
        }),
      );
    }
  }

  getProvider(name: DiscoveryProviderName): DiscoveryProvider | undefined {
    return this.providers.get(name);
  }

  providerStatuses(): DiscoveryProviderStatus[] {
    const list: DiscoveryProviderStatus[] = [];
    for (const provider of this.providers.values()) {
      list.push(provider.health());
    }
    return list;
  }

  clearCaches(): void {
    this.trendingCache.clear();
    this.searchCache.clear();
    this.roomCache.clear();
  }

  private filterHits(hits: DiscoveryHit[]): DiscoveryHit[] {
    return hits.filter((h) => Boolean(h.handle) && !h.age_restricted);
  }

  async trending(opts?: { region?: string; language?: string; limit?: number; page?: number }): Promise<DiscoveryResponse> {
    const settings = this.deps.settingsService.get().discovery;
    const now = Date.now();
    const effectiveRegion = (opts?.region ?? settings.region ?? 'DE').toUpperCase();
    const effectiveLanguage = opts?.language ?? (opts?.region ? undefined : settings.language);
    const page = Math.max(0, opts?.page ?? 0);
    const cacheKey = `${effectiveRegion}::${effectiveLanguage ?? ''}`;

    if (page === 0) {
      const cached = this.trendingCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        return cached.response;
      }
    }

    const hitsMap = new Map<string, DiscoveryHit>();
    const providerOrder = settings.providers;
    const limit = opts?.limit ?? 30;

    for (const name of providerOrder) {
      const provider = this.providers.get(name);
      if (!provider?.trending) continue;

      try {
        const results = await provider.trending({
          region: effectiveRegion,
          language: effectiveLanguage,
          limit,
          page,
        });

        for (const hit of this.filterHits(results)) {
          if (!hitsMap.has(hit.handle)) {
            hitsMap.set(hit.handle, hit);
          }
        }

        // Stop cascading once we have a solid trending feed
        if (hitsMap.size > 0) {
          break;
        }
      } catch (err) {
        this.deps.logger.warn({ provider: name, err }, 'Discovery Provider trending() fehlgeschlagen');
      }
    }

    // Fallback: if external feeds returned nothing, check known configured streamers
    if (hitsMap.size === 0) {
      const configured = this.deps.store.list().slice(0, 8);
      const checks = await Promise.allSettled(
        configured.map((s) => this.roomInfo(s.tiktok)),
      );
      for (const res of checks) {
        if (res.status === 'fulfilled' && res.value && !res.value.age_restricted) {
          if (!hitsMap.has(res.value.handle)) {
            hitsMap.set(res.value.handle, res.value);
          }
        }
      }
    }

    const hits = Array.from(hitsMap.values())
      .sort((a, b) => Number(b.live) - Number(a.live) || (b.viewers ?? 0) - (a.viewers ?? 0))
      .slice(0, limit);

    const response: DiscoveryResponse = {
      hits,
      providers: this.providerStatuses(),
      fetched_at: new Date().toISOString(),
    };

    // Only cache page 0 for full TTL when hits were found; avoid locking into empty cache on transient failures
    if (page === 0 && hits.length > 0) {
      const ttlMs = settings.cache_seconds * 1000 * (0.9 + Math.random() * 0.2);
      this.trendingCache.set(cacheKey, { response, expiresAt: now + ttlMs });
    }

    if (page === 0 && effectiveRegion === (settings.region ?? 'DE').toUpperCase()) {
      this.deps.bus.emit({ type: 'discovery', data: response });
    }
    return response;
  }

  async search(q: string, opts?: { limit?: number; region?: string; page?: number }): Promise<DiscoveryResponse> {
    const trimmed = q.trim();
    if (!trimmed) {
      return this.trending({ region: opts?.region, limit: opts?.limit, page: opts?.page });
    }

    const settings = this.deps.settingsService.get().discovery;
    const now = Date.now();
    const page = Math.max(0, opts?.page ?? 0);
    const cacheKey = `${trimmed.toLowerCase()}::${opts?.region ?? ''}::${page}`;
    const cached = this.searchCache.get(cacheKey);

    if (cached && cached.expiresAt > now) {
      return cached.response;
    }

    const hitsMap = new Map<string, DiscoveryHit>();
    const providerOrder = settings.providers;
    const limit = opts?.limit ?? 20;

    const isExplicitHandle = trimmed.startsWith('@');
    const cleanedHandle = trimmed.replace(/^@/, '');
    const looksLikeHandle = /^[a-zA-Z0-9._]{2,32}$/.test(cleanedHandle);

    let directHandleHit: DiscoveryHit | null = null;
    if (page === 0 && looksLikeHandle) {
      directHandleHit = await this.roomInfo(cleanedHandle);
      if (directHandleHit && !directHandleHit.age_restricted && (isExplicitHandle || directHandleHit.live)) {
        hitsMap.set(directHandleHit.handle, directHandleHit);
      }
    }

    // Query search providers
    for (const name of providerOrder) {
      const provider = this.providers.get(name);
      if (!provider?.search) continue;

      try {
        const results = await provider.search(trimmed, {
          limit,
          region: opts?.region ?? settings.region,
          page,
        });

        for (const hit of this.filterHits(results)) {
          if (!hitsMap.has(hit.handle)) {
            hitsMap.set(hit.handle, hit);
          }
        }
      } catch (err) {
        this.deps.logger.warn({ provider: name, err }, 'Discovery Provider search() fehlgeschlagen');
      }
    }

    // Fallback 1: search in cached trending items
    for (const cachedEntry of this.trendingCache.values()) {
      const lower = trimmed.toLowerCase().replace(/^[#@]+/, '');
      for (const hit of cachedEntry.response.hits) {
        if (
          !hitsMap.has(hit.handle) &&
          (hit.handle.toLowerCase().includes(lower) ||
            hit.display_name.toLowerCase().includes(lower) ||
            (hit.title && hit.title.toLowerCase().includes(lower)) ||
            (hit.bio && hit.bio.toLowerCase().includes(lower)))
        ) {
          hitsMap.set(hit.handle, hit);
        }
      }
    }

    // Fallback 2: if no live hits matched the keyword, include the offline direct handle hit if one existed
    if (hitsMap.size === 0 && directHandleHit && !directHandleHit.age_restricted) {
      hitsMap.set(directHandleHit.handle, directHandleHit);
    }

    const hits = Array.from(hitsMap.values())
      .sort((a, b) => {
        if (isExplicitHandle) {
          const aExact = a.handle === normalizeHandle(cleanedHandle);
          const bExact = b.handle === normalizeHandle(cleanedHandle);
          if (aExact !== bExact) return aExact ? -1 : 1;
        }
        return Number(b.live) - Number(a.live) || (b.viewers ?? 0) - (a.viewers ?? 0);
      })
      .slice(0, limit);

    const response: DiscoveryResponse = {
      hits,
      providers: this.providerStatuses(),
      fetched_at: new Date().toISOString(),
    };

    if (hits.length > 0) {
      const ttlMs = settings.cache_seconds * 1000 * (0.9 + Math.random() * 0.2);
      this.searchCache.set(cacheKey, { response, expiresAt: now + ttlMs });
    }

    return response;
  }

  async following(opts?: {
    limit?: number;
    page?: number;
    account_id?: string;
    session_id?: string;
    accountId?: string;
    sessionId?: string;
  }): Promise<DiscoveryResponse> {
    const provider = this.providers.get('following');
    const hits: DiscoveryHit[] = [];
    if (provider?.following) {
      const results = await provider.following({
        limit: opts?.limit,
        page: opts?.page,
        accountId: opts?.account_id ?? opts?.accountId,
        sessionId: opts?.session_id ?? opts?.sessionId,
      });
      hits.push(...this.filterHits(results));
    }
    return {
      hits,
      providers: this.providerStatuses(),
      fetched_at: new Date().toISOString(),
    };
  }

  async roomInfo(handle: string, opts?: { forceFresh?: boolean }): Promise<DiscoveryHit | null> {
    const normalized = normalizeHandle(handle);
    if (!normalized) return null;

    const now = Date.now();
    const cached = this.roomCache.get(normalized);
    if (!opts?.forceFresh && cached && cached.expiresAt > now) {
      return cached.hit;
    }

    const roomProvider = this.providers.get('room_info');
    if (!roomProvider?.roomInfo) {
      return null;
    }

    const hit = await roomProvider.roomInfo(normalized);
    const validHit = hit && !hit.age_restricted ? hit : null;

    this.roomCache.set(normalized, {
      hit: validHit,
      expiresAt: now + 60_000,
    });

    return validHit;
  }

  async resolvePreviewStreamUrl(handle: string): Promise<string | null> {
    const normalized = normalizeHandle(handle);
    if (!normalized) return null;

    const cachedUrl = getRememberedStreamUrl(normalized);
    if (cachedUrl) {
      return cachedUrl;
    }

    const hit = await this.roomInfo(normalized);
    if (!hit || !hit.live || hit.age_restricted) {
      return null;
    }

    return getRememberedStreamUrl(normalized);
  }

  addStreamer(handle: string, name?: string): { streamer: StreamerConfig; created: boolean } {
    const normalized = normalizeHandle(handle);
    if (!normalized) {
      throw new ValidationError('Ungültiger TikTok-Handle');
    }

    const existing = this.deps.store.list().find(
      (s) => normalizeHandle(s.tiktok) === normalized,
    );
    if (existing) {
      return { streamer: existing, created: false };
    }

    let baseId = normalized.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    if (!/^[a-z0-9]/.test(baseId)) {
      baseId = `s_${baseId}`;
    }
    if (baseId.length > 50) {
      baseId = baseId.slice(0, 50);
    }

    let id = baseId;
    let counter = 1;
    const existingIds = new Set(this.deps.store.list().map((s) => s.id));
    while (existingIds.has(id)) {
      id = `${baseId}-${counter++}`;
    }

    const displayName = (name && name.trim()) || normalized;

    const created = this.deps.store.create({
      id,
      name: displayName,
      tiktok: normalized,
      enabled: false,
      priority: 999,
      auto_start: false,
      preferred: false,
      group: 'Discovery',
      source: 'discovery',
    });

    this.deps.supervisor.notifyStreamersChanged?.();
    return { streamer: created, created: true };
  }

  async queueNow(handle: string, mode: 'now' | 'next' = 'now'): Promise<{
    streamer: StreamerConfig;
    created: boolean;
    queue: unknown;
    status: unknown;
  }> {
    const hit = await this.roomInfo(handle, { forceFresh: true });
    if (!hit || !hit.live) {
      throw new ConflictError(`Streamer „${handle}“ ist aktuell nicht live`);
    }

    const added = this.addStreamer(handle, hit.display_name);
    let streamer = added.streamer;
    const { created } = added;
    if (!streamer.enabled) {
      streamer = this.deps.store.update(streamer.id, { enabled: true });
      this.deps.supervisor.notifyStreamersChanged?.();
    }

    let statusResult: unknown;
    if (mode === 'now') {
      statusResult = await this.deps.supervisor.queuePlayNow(streamer.id);
    } else {
      await this.deps.supervisor.queueAdd(streamer.id);
      statusResult = this.deps.supervisor.buildStatus();
    }

    const queue = this.deps.supervisor.buildQueueSnapshot();
    return {
      streamer,
      created,
      queue,
      status: statusResult,
    };
  }

  async switchToStreamer(handle: string): Promise<{
    streamer: StreamerConfig;
    created: boolean;
    status: unknown;
  }> {
    const hit = await this.roomInfo(handle, { forceFresh: true });
    if (!hit || !hit.live) {
      throw new ConflictError(`Streamer „${handle}“ ist aktuell nicht live`);
    }

    const added = this.addStreamer(handle, hit.display_name);
    let streamer = added.streamer;
    const { created } = added;
    if (!streamer.enabled) {
      streamer = this.deps.store.update(streamer.id, { enabled: true });
      this.deps.supervisor.notifyStreamersChanged?.();
    }
    const statusResult = await this.deps.supervisor.start(streamer.id);

    return {
      streamer,
      created,
      status: statusResult,
    };
  }
}
