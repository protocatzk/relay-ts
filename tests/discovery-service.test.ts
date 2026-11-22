import { describe, expect, it, vi } from 'vitest';
import { parseLivePageHtml } from '../src/core/source/discovery/live-page-provider.js';
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

  it('parses room info payload from api-live/user/room', () => {
    const payload = {
      data: {
        user: {
          uniqueId: "cool_gamer",
          nickname: "Cool Gamer",
          avatarLarger: "https://example.com/cool.jpg",
          status: 2,
          bioDescription: "Gamer aus Leidenschaft",
        },
        liveRoom: {
          title: "Ranked Grind",
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
  });

  it('parses search payload into structured discovery hits', () => {
    const payload = {
      data: {
        live_list: [
          {
            author: {
              uniqueId: "search_hit_1",
              nickname: "Search Result 1",
            },
            liveRoom: {
              title: "Gaming Session",
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
