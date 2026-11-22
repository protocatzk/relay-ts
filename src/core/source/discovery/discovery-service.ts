import type { Logger } from 'pino';
import type { EventBus } from '../../events.js';
import type { SettingsService } from '../../store/settings-service.js';
import type { StreamerStore } from '../../store/streamer-store.js';
import type { StreamerConfig } from '../../config/schema.js';
import type { Supervisor } from '../../supervisor/supervisor.js';
import { ConflictError, ValidationError } from '../../../utils/errors.js';
import { normalizeHandle } from '../../../utils/format.js';
import type {
  DiscoveryHit,
  DiscoveryProvider,
  DiscoveryProviderName,
  DiscoveryProviderStatus,
  DiscoveryResponse,
} from './types.js';
import { LivePageProvider } from './live-page-provider.js';
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
  providers?: Map<DiscoveryProviderName, DiscoveryProvider>;
}

export class DiscoveryService {
  private readonly providers = new Map<DiscoveryProviderName, DiscoveryProvider>();
  private cachedTrending: { response: DiscoveryResponse; expiresAt: number } | null = null;
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
    this.cachedTrending = null;
    this.searchCache.clear();
    this.roomCache.clear();
  }

  private filterHits(hits: DiscoveryHit[]): DiscoveryHit[] {
    return hits.filter((h) => Boolean(h.handle) && !h.age_restricted);
  }

  async trending(opts?: { region?: string; language?: string; limit?: number }): Promise<DiscoveryResponse> {
    const settings = this.deps.settingsService.get().discovery;
    const now = Date.now();

    if (this.cachedTrending && this.cachedTrending.expiresAt > now) {
      return this.cachedTrending.response;
    }

    const hitsMap = new Map<string, DiscoveryHit>();
    const providerOrder = settings.providers;

    for (const name of providerOrder) {
      const provider = this.providers.get(name);
      if (!provider?.trending) continue;

      try {
        const results = await provider.trending({
          region: opts?.region ?? settings.region,
          language: opts?.language ?? settings.language,
          limit: opts?.limit ?? 30,
        });

        for (const hit of this.filterHits(results)) {
          if (!hitsMap.has(hit.handle)) {
            hitsMap.set(hit.handle, hit);
          }
        }
      } catch (err) {
        this.deps.logger.warn({ provider: name, err }, 'Discovery Provider trending() fehlgeschlagen');
      }
    }

    const hits = Array.from(hitsMap.values());
    const response: DiscoveryResponse = {
      hits,
      providers: this.providerStatuses(),
      fetched_at: new Date().toISOString(),
    };

    const ttlMs = settings.cache_seconds * 1000 * (0.9 + Math.random() * 0.2);
    this.cachedTrending = { response, expiresAt: now + ttlMs };

    this.deps.bus.emit({ type: 'discovery', data: response });
    return response;
  }

  async search(q: string, opts?: { limit?: number; region?: string }): Promise<DiscoveryResponse> {
    const trimmed = q.trim();
    if (!trimmed) {
      return this.trending({ region: opts?.region, limit: opts?.limit });
    }

    const settings = this.deps.settingsService.get().discovery;
    const now = Date.now();
    const cacheKey = `${trimmed.toLowerCase()}::${opts?.region ?? ''}`;
    const cached = this.searchCache.get(cacheKey);

    if (cached && cached.expiresAt > now) {
      return cached.response;
    }

    const hitsMap = new Map<string, DiscoveryHit>();
    const providerOrder = settings.providers;

    // 1. Direct handle search if query looks like a handle
    const cleanedHandle = trimmed.replace(/^@/, '');
    if (/^[a-zA-Z0-9._]{2,32}$/.test(cleanedHandle)) {
      const direct = await this.roomInfo(cleanedHandle);
      if (direct && !direct.age_restricted) {
        hitsMap.set(direct.handle, direct);
      }
    }

    // 2. Query search providers
    for (const name of providerOrder) {
      const provider = this.providers.get(name);
      if (!provider?.search) continue;

      try {
        const results = await provider.search(trimmed, {
          limit: opts?.limit ?? 20,
          region: opts?.region ?? settings.region,
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

    // 3. Fallback: search in cached trending items if search returned very few
    if (hitsMap.size === 0 && this.cachedTrending) {
      const lower = trimmed.toLowerCase();
      for (const hit of this.cachedTrending.response.hits) {
        if (
          hit.handle.toLowerCase().includes(lower) ||
          hit.display_name.toLowerCase().includes(lower) ||
          (hit.title && hit.title.toLowerCase().includes(lower))
        ) {
          hitsMap.set(hit.handle, hit);
        }
      }
    }

    const hits = Array.from(hitsMap.values());
    const response: DiscoveryResponse = {
      hits,
      providers: this.providerStatuses(),
      fetched_at: new Date().toISOString(),
    };

    const ttlMs = settings.cache_seconds * 1000 * (0.9 + Math.random() * 0.2);
    this.searchCache.set(cacheKey, { response, expiresAt: now + ttlMs });

    return response;
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
      source: 'discovery',
    });

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

    const { streamer, created } = this.addStreamer(handle, hit.display_name);

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

    const { streamer, created } = this.addStreamer(handle, hit.display_name);
    const statusResult = await this.deps.supervisor.start(streamer.id);

    return {
      streamer,
      created,
      status: statusResult,
    };
  }
}
