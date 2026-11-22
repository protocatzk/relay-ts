import { describe, expect, it, vi } from 'vitest';
import {
  buildWebcastFeedUrl,
  parseLivePageHtml,
  parseWebcastFeedPayload,
  resolveRegionLocale,
} from '../src/core/source/discovery/live-page-provider.js';
import { parseRoomInfoPayload } from '../src/core/source/discovery/room-info-provider.js';
import { parseSearchPayload } from '../src/core/source/discovery/search-provider.js';
import { DiscoveryService } from '../src/core/source/discovery/discovery-service.js';
import type { DiscoveryProvider } from '../src/core/source/discovery/types.js';
import { StreamerStore } from '../src/core/store/streamer-store.js';
import { SettingsService } from '../src/core/store/settings-service.js';
import { EventBus } from '../src/core/events.js';
import { ConflictError } from '../src/utils/errors.js';
import { createLogger } from '../src/utils/logger.js';

describe('Discovery Parsers (Pure Functions)', () => {
  it('parses live room html embedded in __UNIVERSAL_DATA_FOR_REHYDRATION__', () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">
        {
          "__DEFAULT_SCOPE__": {
            "webapp.live-detail": {
              "liveRoom": {
                "title": "Guten Morgen Stream",
                "status": 2,
                "userCount": 1337,
                "owner": {
                  "uniqueId": "streamer_alpha",
                  "nickname": "Alpha Streamer",
                  "avatarThumb": "https://example.com/avatar1.jpg"
                }
              }
            }
          }
        }
        </script>
      </head>
      <body></body>
      </html>
    `;

    const hits = parseLivePageHtml(html);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      handle: 'streamer_alpha',
      display_name: 'Alpha Streamer',
      title: 'Guten Morgen Stream',
      live: true,
      viewers: 1337,
      source: 'live_page',
      age_restricted: false,
    });
  });

  it('marks age_restricted flag on 18+ rooms', () => {
    const html = `
      <script id="SIGI_STATE" type="application/json">
      {
        "LiveRoom": {
          "uniqueId": "mature_streamer",
          "nickname": "Mature Channel",
          "status": 2,
          "isAgeRestricted": true,
          "userCount": 42
        }
      }
      </script>
    `;

    const hits = parseLivePageHtml(html);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.handle).toBe('mature_streamer');
    expect(hits[0]?.age_restricted).toBe(true);
  });

  it('parses webcast/feed payload with display_id, avatar url_list and empty age_restricted object', () => {
    const payload = {
      status_code: 0,
      data: [
        {
          type: 1,
          rid: '7710942965179042592',
          data: {
            id_str: '7710942965179042592',
            title: 'GTA6 Der hype ist da!',
            status: 2,
            user_count: 163,
            age_restricted: {},
            owner: {
              display_id: 'doalumar',
              nickname: 'Doalumar',
              bio_description: 'Daily Gaming Streams',
              avatar_large: {
                url_list: ['https://example.com/doalumar-large.webp'],
              },
            },
          },
        },
        {
          type: 1,
          rid: '7710942965179042593',
          data: {
            id_str: '7710942965179042593',
            title: 'Zero viewers protobuf room',
            status: 2,
            stats: { total_user: 8 },
            age_restricted: { age_interval: 0, restricted: false },
            owner: {
              display_id: 'kevtekk25',
              nickname: 'KevTekk',
            },
          },
        },
        {
          type: 1,
          rid: '7710942965179042594',
          data: {
            id_str: '7710942965179042594',
            title: '18+ Room',
            status: 2,
            user_count: 50,
            age_restricted: { age_interval: 4, restricted: true },
            owner: {
              display_id: 'adult_room',
              nickname: 'Adult Room',
            },
          },
        },
      ],
    };

    const hits = parseWebcastFeedPayload(payload, 'live_page');
    expect(hits).toHaveLength(3);
    expect(hits[0]).toMatchObject({
      handle: 'doalumar',
      display_name: 'Doalumar',
      avatar_url: 'https://example.com/doalumar-large.webp',
      bio: 'Daily Gaming Streams',
      title: 'GTA6 Der hype ist da!',
      live: true,
      viewers: 163,
      age_restricted: false,
      source: 'live_page',
    });
    expect(hits[1]).toMatchObject({
      handle: 'kevtekk25',
      live: true,
      viewers: 0,
      age_restricted: false,
    });
    expect(hits[2]?.age_restricted).toBe(true);
  });

  it('parses room info payload from api-live/user/room and returns null on empty user', () => {
    const payload = {
      data: {
        user: {
          uniqueId: 'cool_gamer',
          nickname: 'Cool Gamer',
          avatarLarger: 'https://example.com/cool.jpg',
          status: 2,
          bioDescription: 'Gamer aus Leidenschaft',
        },
        liveRoom: {
          title: 'Ranked Grind',
          status: 2,
          userCount: 500,
          ageRestricted: false,
        },
      },
    };

    const hit = parseRoomInfoPayload(payload, 'cool_gamer');
    expect(hit).not.toBeNull();
    expect(hit).toMatchObject({
      handle: 'cool_gamer',
      display_name: 'Cool Gamer',
      title: 'Ranked Grind',
      live: true,
      viewers: 500,
      bio: 'Gamer aus Leidenschaft',
      source: 'room_info',
      age_restricted: false,
    });

    expect(parseRoomInfoPayload({ data: { user: {}, liveRoom: {} } }, 'unknown_term')).toBeNull();
    expect(parseRoomInfoPayload({ data: null, message: 'params_error' }, 'unknown_term')).toBeNull();
  });

  it('parses search payload into structured discovery hits (legacy & webcast SEO format)', () => {
    const payload = {
      data: {
        live_list: [
          {
            author: {
              uniqueId: 'search_hit_1',
              nickname: 'Search Result 1',
            },
            liveRoom: {
              title: 'Gaming Session',
              status: 2,
              userCount: 88,
            },
          },
        ],
      },
    };

    const hits = parseSearchPayload(payload);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.handle).toBe('search_hit_1');
    expect(hits[0]?.display_name).toBe('Search Result 1');
    expect(hits[0]?.live).toBe(true);

    const seoPayload = {
      status_code: 0,
      data: [
        {
          type: 1,
          data: {
            title: 'Dein SongWunsch',
            status: 2,
            user_count: 56,
            age_restricted: {},
            owner: {
              display_id: 'voicepotmusic',
              nickname: 'VOICEPOT MUSIC',
            },
          },
        },
      ],
    };
    const seoHits = parseSearchPayload(seoPayload);
    expect(seoHits).toHaveLength(1);
    expect(seoHits[0]).toMatchObject({
      handle: 'voicepotmusic',
      display_name: 'VOICEPOT MUSIC',
      title: 'Dein SongWunsch',
      live: true,
      viewers: 56,
      source: 'search_api',
    });
  });

  it('builds regional webcast feed URLs with country-specific locale, carrier_region and timezone', () => {
    expect(resolveRegionLocale('AT')).toEqual({
      region: 'AT',
      language: 'de',
      locale: 'de-AT',
      tz: 'Europe/Vienna',
      defaultKeyword: 'österreich',
    });
    expect(resolveRegionLocale('US')).toEqual({
      region: 'US',
      language: 'en',
      locale: 'en-US',
      tz: 'America/New_York',
      defaultKeyword: 'live',
    });

    const url = buildWebcastFeedUrl({ channel_id: '87', req_from: 'live_mt_pc_web_rec_tab_refresh' }, { region: 'TR' });
    expect(url.searchParams.get('region')).toBe('TR');
    expect(url.searchParams.get('priority_region')).toBe('TR');
    expect(url.searchParams.get('carrier_region')).toBe('TR');
    expect(url.searchParams.get('app_language')).toBe('tr-TR');
    expect(url.searchParams.get('webcast_language')).toBe('tr-TR');
    expect(url.searchParams.get('tz_name')).toBe('Europe/Istanbul');
  });
});

describe('DiscoveryService & Provider Fallback', () => {
  const { logger } = createLogger({ level: 'silent' });

  function createMockStore() {
    const listMock = vi.fn().mockReturnValue([]);
    const createMock = vi.fn().mockImplementation((input) => input);
    return {
      list: listMock,
      create: createMock,
      view: vi.fn((s) => ({ ...s, status: { online: null, active: false } })),
    } as unknown as StreamerStore;
  }

  function createMockSupervisor() {
    return {
      queuePlayNow: vi.fn().mockResolvedValue({ state: 'live' }),
      queueAdd: vi.fn().mockResolvedValue({}),
      buildQueueSnapshot: vi.fn().mockReturnValue({ entries: [], playing: false, index: null, loop: false }),
      buildStatus: vi.fn().mockReturnValue({ state: 'idle' }),
      start: vi.fn().mockResolvedValue({ state: 'live' }),
    } as any;
  }

  function createMockSettings(providers = ['live_page', 'room_info', 'search_api']) {
    return {
      get: () => ({
        discovery: {
          enabled: true,
          providers,
          cache_seconds: 90,
          region: 'DE',
          language: 'de',
        },
      }),
    } as unknown as SettingsService;
  }

  it('filters out 18+ hits in trending() before returning', async () => {
    const bus = new EventBus();
    const store = createMockStore();
    const supervisor = createMockSupervisor();
    const settingsService = createMockSettings();

    const mockLivePage: DiscoveryProvider = {
      name: 'live_page',
      health: () => ({ name: 'live_page', status: 'online', last_error: null, last_ok_at: null }),
      trending: async () => [
        {
          handle: 'clean_streamer',
          display_name: 'Clean Streamer',
          avatar_url: null,
          bio: null,
          title: 'All Ages',
          live: true,
          viewers: 100,
          age_restricted: false,
          source: 'live_page',
          fetched_at: new Date().toISOString(),
        },
        {
          handle: 'adult_streamer',
          display_name: 'Adult Streamer',
          avatar_url: null,
          bio: null,
          title: '18+ Only',
          live: true,
          viewers: 200,
          age_restricted: true,
          source: 'live_page',
          fetched_at: new Date().toISOString(),
        },
      ],
    };

    const providers = new Map<string, DiscoveryProvider>([['live_page', mockLivePage]]);

    const service = new DiscoveryService({
      store,
      settingsService,
      supervisor,
      bus,
      logger,
      providers: providers as any,
    });

    const response = await service.trending();
    expect(response.hits).toHaveLength(1);
    expect(response.hits[0]?.handle).toBe('clean_streamer');
  });

  it('degrades gracefully when Tier 1 fails and Tier 2 takes over', async () => {
    const bus = new EventBus();
    const store = createMockStore();
    const supervisor = createMockSupervisor();
    const settingsService = createMockSettings(['live_page', 'search_api']);

    const mockLivePage: DiscoveryProvider = {
      name: 'live_page',
      health: () => ({ name: 'live_page', status: 'offline', last_error: 'HTTP 403 Forbidden', last_ok_at: null }),
      trending: async () => {
        throw new Error('403 Forbidden');
      },
    };

    const mockSearchApi: DiscoveryProvider = {
      name: 'search_api',
      health: () => ({ name: 'search_api', status: 'online', last_error: null, last_ok_at: null }),
      trending: async () => [
        {
          handle: 'fallback_streamer',
          display_name: 'Fallback Streamer',
          avatar_url: null,
          bio: null,
          title: 'Fallback Trending',
          live: true,
          viewers: 50,
          age_restricted: false,
          source: 'search_api',
          fetched_at: new Date().toISOString(),
        },
      ],
    };

    const providers = new Map<string, DiscoveryProvider>([
      ['live_page', mockLivePage],
      ['search_api', mockSearchApi],
    ]);

    const service = new DiscoveryService({
      store,
      settingsService,
      supervisor,
      bus,
      logger,
      providers: providers as any,
    });

    const response = await service.trending();
    expect(response.hits).toHaveLength(1);
    expect(response.hits[0]?.handle).toBe('fallback_streamer');

    const statuses = service.providerStatuses();
    const liveStatus = statuses.find((s) => s.name === 'live_page');
    expect(liveStatus?.status).toBe('offline');
  });

  it('caches trending results separately per country/region filter', async () => {
    const bus = new EventBus();
    const store = createMockStore();
    const supervisor = createMockSupervisor();
    const settingsService = createMockSettings(['live_page']);

    const trendingSpy = vi.fn().mockImplementation(async (opts?: { region?: string }) => [
      {
        handle: `streamer_${(opts?.region ?? 'DE').toLowerCase()}`,
        display_name: `Streamer ${opts?.region ?? 'DE'}`,
        avatar_url: null,
        bio: null,
        title: `Live in ${opts?.region ?? 'DE'}`,
        live: true,
        viewers: 120,
        age_restricted: false,
        source: 'live_page' as const,
        fetched_at: new Date().toISOString(),
      },
    ]);

    const mockLivePage: DiscoveryProvider = {
      name: 'live_page',
      health: () => ({ name: 'live_page', status: 'online', last_error: null, last_ok_at: null }),
      trending: trendingSpy,
    };

    const service = new DiscoveryService({
      store,
      settingsService,
      supervisor,
      bus,
      logger,
      providers: new Map([['live_page', mockLivePage]]) as any,
    });

    const deRes = await service.trending({ region: 'DE' });
    const usRes = await service.trending({ region: 'US' });
    const deCached = await service.trending({ region: 'DE' });

    expect(deRes.hits[0]?.handle).toBe('streamer_de');
    expect(usRes.hits[0]?.handle).toBe('streamer_us');
    expect(deCached.hits[0]?.handle).toBe('streamer_de');
    expect(trendingSpy).toHaveBeenCalledTimes(2);
  });

  it('returns live keyword hits for single-term searches without polluting with offline handle match, unless prefixed with @', async () => {
    const bus = new EventBus();
    const store = createMockStore();
    const supervisor = createMockSupervisor();
    const settingsService = createMockSettings(['room_info', 'search_api']);

    const offlineGamingUser = {
      handle: 'gaming',
      display_name: 'Inactive Gaming User',
      avatar_url: null,
      bio: null,
      title: null,
      live: false,
      viewers: null,
      age_restricted: false,
      source: 'room_info' as const,
      fetched_at: new Date().toISOString(),
    };

    const liveGamerHit = {
      handle: 'pro_gamer_de',
      display_name: 'Pro Gamer DE',
      avatar_url: null,
      bio: 'Daily Gaming',
      title: 'GTA 6 Hype Stream',
      live: true,
      viewers: 312,
      age_restricted: false,
      source: 'search_api' as const,
      fetched_at: new Date().toISOString(),
    };

    const mockRoomInfo: DiscoveryProvider = {
      name: 'room_info',
      health: () => ({ name: 'room_info', status: 'online', last_error: null, last_ok_at: null }),
      roomInfo: async (handle: string) => (handle === 'gaming' ? offlineGamingUser : null),
      search: async (q: string) => (q.startsWith('@gaming') ? [offlineGamingUser] : []),
    };

    const mockSearchApi: DiscoveryProvider = {
      name: 'search_api',
      health: () => ({ name: 'search_api', status: 'online', last_error: null, last_ok_at: null }),
      search: async () => [liveGamerHit],
    };

    const providers = new Map<string, DiscoveryProvider>([
      ['room_info', mockRoomInfo],
      ['search_api', mockSearchApi],
    ]);

    const service = new DiscoveryService({
      store,
      settingsService,
      supervisor,
      bus,
      logger,
      providers: providers as any,
    });

    // 1. Keyword search "gaming" (no @): only live keyword stream, no dead offline @gaming account
    const keywordRes = await service.search('gaming');
    expect(keywordRes.hits).toHaveLength(1);
    expect(keywordRes.hits[0]?.handle).toBe('pro_gamer_de');

    // 2. Explicit handle search "@gaming": includes @gaming at index 0
    const handleRes = await service.search('@gaming');
    expect(handleRes.hits).toHaveLength(2);
    expect(handleRes.hits[0]?.handle).toBe('gaming');
    expect(handleRes.hits[1]?.handle).toBe('pro_gamer_de');
  });

  it('strictly adheres to Add-Flow-Guard invariants (enabled: false, priority: 999, source: discovery)', () => {
    const bus = new EventBus();
    const store = createMockStore();
    const supervisor = createMockSupervisor();
    const settingsService = createMockSettings();

    const service = new DiscoveryService({
      store,
      settingsService,
      supervisor,
      bus,
      logger,
    });

    const result = service.addStreamer('New_Streamer_Handle', 'New Streamer Name');
    expect(result.created).toBe(true);
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'new_streamer_handle',
        name: 'New Streamer Name',
        tiktok: 'new_streamer_handle',
        enabled: false,
        priority: 999,
        auto_start: false,
        preferred: false,
        source: 'discovery',
      }),
    );
  });

  it('rejects queueNow if streamer is offline (Queue-Live-Guard)', async () => {
    const bus = new EventBus();
    const store = createMockStore();
    const supervisor = createMockSupervisor();
    const settingsService = createMockSettings();

    const mockRoomInfo: DiscoveryProvider = {
      name: 'room_info',
      health: () => ({ name: 'room_info', status: 'online', last_error: null, last_ok_at: null }),
      roomInfo: async (handle: string) => ({
        handle,
        display_name: handle,
        avatar_url: null,
        bio: null,
        title: 'Offline Room',
        live: false, // OFFLINE
        viewers: 0,
        source: 'room_info',
        fetched_at: new Date().toISOString(),
      }),
    };

    const providers = new Map<string, DiscoveryProvider>([['room_info', mockRoomInfo]]);

    const service = new DiscoveryService({
      store,
      settingsService,
      supervisor,
      bus,
      logger,
      providers: providers as any,
    });

    await expect(service.queueNow('offline_person', 'now')).rejects.toThrow(ConflictError);
    expect(supervisor.queuePlayNow).not.toHaveBeenCalled();
  });

  it('allows queueNow if streamer is live and adds them to queue', async () => {
    const bus = new EventBus();
    const store = createMockStore();
    const supervisor = createMockSupervisor();
    const settingsService = createMockSettings();

    const mockRoomInfo: DiscoveryProvider = {
      name: 'room_info',
      health: () => ({ name: 'room_info', status: 'online', last_error: null, last_ok_at: null }),
      roomInfo: async (handle: string) => ({
        handle,
        display_name: 'Live Streamer',
        avatar_url: null,
        bio: null,
        title: 'Streaming Now',
        live: true,
        viewers: 250,
        source: 'room_info',
        fetched_at: new Date().toISOString(),
      }),
    };

    const providers = new Map<string, DiscoveryProvider>([['room_info', mockRoomInfo]]);

    const service = new DiscoveryService({
      store,
      settingsService,
      supervisor,
      bus,
      logger,
      providers: providers as any,
    });

    const result = await service.queueNow('live_person', 'now');
    expect(result.created).toBe(true);
    expect(supervisor.queuePlayNow).toHaveBeenCalledWith('live_person');
  });
});
