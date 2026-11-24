import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/core/config/loader.js';
import { DEFAULT_SETTINGS } from '../src/core/config/schema.js';
import { EventBus } from '../src/core/events.js';
import { StreamerStore } from '../src/core/store/streamer-store.js';
import { SettingsService } from '../src/core/store/settings-service.js';
import { AuditLogStore } from '../src/core/audit-log.js';
import { TikTokAccountStore } from '../src/core/account/tiktok-account-store.js';
import { DiscoveryService } from '../src/core/source/discovery/discovery-service.js';
import type { DiscoveryHit, DiscoveryProvider } from '../src/core/source/discovery/types.js';
import { buildServer } from '../src/api/server.js';
import { AuthSessionStore } from '../src/api/session-store.js';
import { LogRing } from '../src/utils/logger.js';
import { VERSION } from '../src/version.js';

const logger = pino({ level: 'silent' });

describe('Discovery API Routes', () => {
  let app: FastifyInstance;
  let audit: AuditLogStore;
  let store: StreamerStore;
  let accounts: TikTokAccountStore;
  let service: DiscoveryService;
  let supervisor: any;
  let suggestCalls = 0;

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-discovery-api-'));
    const config = loadConfig({
      cwd: dir,
      env: { API_TOKEN: 'test-token', LOG_LEVEL: 'silent' },
    });

    store = new StreamerStore(
      config.paths.streamersFile,
      { streamers: [], playlists: [] },
      logger,
    );

    audit = new AuditLogStore(join(dir, 'audit.jsonl'));
    accounts = new TikTokAccountStore({
      filePath: join(dir, 'tiktok-accounts.json'),
      cookiesFile: config.paths.cookiesFile,
      cookiesDir: join(dir, 'cookies'),
      logger,
    });

    const settingsService = new SettingsService(config.paths.settingsFile, DEFAULT_SETTINGS, logger);

    supervisor = {
      buildStatus: vi.fn().mockReturnValue({ state: 'idle', version: VERSION }),
      streamersView: vi.fn().mockReturnValue([]),
      queuePlayNow: vi.fn().mockResolvedValue({ state: 'live', version: VERSION }),
      queueAdd: vi.fn().mockResolvedValue({}),
      buildQueueSnapshot: vi.fn().mockReturnValue({ entries: [], playing: false, index: null, loop: false }),
      start: vi.fn().mockResolvedValue({ state: 'live', version: VERSION }),
      notifyStreamersChanged: vi.fn(),
    };

    const mockLiveHit: DiscoveryHit = {
      handle: 'live_gamer',
      display_name: 'Live Gamer',
      avatar_url: 'https://example.com/avatar.jpg',
      bio: 'Just gaming',
      title: 'Road to Grandmaster',
      live: true,
      viewers: 777,
      source: 'room_info',
      fetched_at: new Date().toISOString(),
    };

    const mockOfflineHit: DiscoveryHit = {
      handle: 'offline_streamer',
      display_name: 'Offline Streamer',
      avatar_url: null,
      bio: null,
      title: null,
      live: false,
      viewers: null,
      source: 'room_info',
      fetched_at: new Date().toISOString(),
    };

    suggestCalls = 0;
    const mockProvider: DiscoveryProvider = {
      name: 'room_info',
      health: () => ({ name: 'room_info', status: 'online', last_error: null, last_ok_at: null }),
      trending: async () => [mockLiveHit],
      search: async (q: string) => (q.includes('live') ? [mockLiveHit] : []),
      suggest: async () => {
        suggestCalls += 1;
        return [{ handle: 'live_gamer', display_name: 'Live Gamer', avatar_url: null }];
      },
      roomInfo: async (handle: string) => {
        if (handle === 'live_gamer') return mockLiveHit;
        if (handle === 'offline_streamer') return mockOfflineHit;
        return null;
      },
    };

    const searchProvider: DiscoveryProvider = {
      ...mockProvider,
      name: 'search_api',
      health: () => ({ name: 'search_api', status: 'online', last_error: null, last_ok_at: null }),
    };

    const providers = new Map<string, DiscoveryProvider>([
      ['room_info', mockProvider],
      ['search_api', searchProvider],
    ]);

    service = new DiscoveryService({
      store,
      settingsService,
      supervisor,
      bus: new EventBus(),
      logger,
      providers: providers as any,
    });

    app = await buildServer({
      config,
      logger,
      store,
      settingsService,
      supervisor,
      bus: new EventBus(),
      ring: new LogRing(),
      version: VERSION,
      authSessions: new AuthSessionStore(join(dir, 'sessions.json')),
      audit,
      discovery: service,
      tiktokAccounts: accounts,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('counts streamers per TikTok account and guards deletion (#95)', async () => {
    const account = accounts.create({ label: 'Testkonto', sessionId: 'session-test' });
    store.create({ id: 'alpha', name: 'Alpha', tiktok: 'alpha', tiktok_account: account.id });

    const list = await app.inject({
      method: 'GET',
      url: '/api/discovery/accounts',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(list.statusCode).toBe(200);
    const entry = list
      .json()
      .accounts.find((item: { id: string }) => item.id === account.id);
    expect(entry.streamer_count).toBe(1);

    const blocked = await app.inject({
      method: 'DELETE',
      url: `/api/discovery/accounts/${account.id}`,
      headers: { authorization: 'Bearer test-token' },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().streamers).toEqual([{ id: 'alpha', name: 'Alpha' }]);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/discovery/accounts/${account.id}?reassign=active`,
      headers: { authorization: 'Bearer test-token' },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().reassigned).toBe(1);
    expect(store.require('alpha').tiktok_account).toBe('');
  });

  it('rejects unknown TikTok accounts on streamer writes (#95)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/streamers',
      headers: { authorization: 'Bearer test-token' },
      payload: { id: 'beta', name: 'Beta', tiktok: 'beta', tiktok_account: 'missing' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message ?? res.json().error?.message ?? '').toMatch(/TikTok-Konto/);
    expect(store.get('beta')).toBeUndefined();
  });

  it('GET /api/discovery/trending returns hits and provider statuses', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/discovery/trending',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hits).toHaveLength(1);
    expect(body.hits[0].handle).toBe('live_gamer');
    expect(body.providers).toBeDefined();
  });

  it('GET /api/discovery/search finds matches', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/discovery/search?q=live',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hits).toHaveLength(1);
    expect(body.hits[0].handle).toBe('live_gamer');
  });

  it('GET /api/discovery/room/:handle returns room detail', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/discovery/room/live_gamer',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hit?.handle).toBe('live_gamer');
    expect(body.hit?.live).toBe(true);
  });

  it('GET /api/discovery/preview/:handle returns 404 when no FLV stream URL is available', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/discovery/preview/offline_streamer',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('POST /api/discovery/add creates streamer disabled with priority 999 and source discovery', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/discovery/add',
      headers: { authorization: 'Bearer test-token' },
      payload: { handle: 'new_streamer', name: 'New Streamer' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.created).toBe(true);
    expect(body.streamer.enabled).toBe(false);
    expect(body.streamer.priority).toBe(999);
    expect(body.streamer.source).toBe('discovery');

    // Audit log check
    const { entries } = audit.query({ limit: 10 });
    expect(entries.some((e) => e.action === 'discovery.add')).toBe(true);
  });

  it('POST /api/discovery/queue queues a live streamer and audits the action', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/discovery/queue',
      headers: { authorization: 'Bearer test-token' },
      payload: { handle: 'live_gamer', mode: 'now' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(supervisor.queuePlayNow).toHaveBeenCalled();

    const { entries } = audit.query({ limit: 10 });
    expect(entries.some((e) => e.action === 'discovery.queue')).toBe(true);
  });

  it('POST /api/discovery/queue rejects offline streamer with 409 Conflict', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/discovery/queue',
      headers: { authorization: 'Bearer test-token' },
      payload: { handle: 'offline_streamer', mode: 'now' },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.message).toContain('nicht live');
  });

  it('POST /api/discovery/switch switches to live streamer and audits', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/discovery/switch',
      headers: { authorization: 'Bearer test-token' },
      payload: { handle: 'live_gamer' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(supervisor.start).toHaveBeenCalled();

    const { entries } = audit.query({ limit: 10 });
    expect(entries.some((e) => e.action === 'discovery.switch')).toBe(true);
  });

  it('GET /api/discovery/suggest returns profile suggestions and caches them', async () => {
    const first = await app.inject({
      method: 'GET',
      url: '/api/discovery/suggest?q=live&limit=5',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(first.statusCode).toBe(200);
    const body = first.json();
    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0].handle).toBe('live_gamer');
    expect(body.providers).toBeDefined();

    const callsAfterFirst = suggestCalls;
    const second = await app.inject({
      method: 'GET',
      url: '/api/discovery/suggest?q=live&limit=5',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(second.statusCode).toBe(200);
    // Cached: no extra provider round-trip for the same term.
    expect(suggestCalls).toBe(callsAfterFirst);
  });

  it('GET /api/discovery/suggest rejects empty queries', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/discovery/suggest?q=',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/discovery/status maps live, offline and unknown handles', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/discovery/status?handles=live_gamer,offline_streamer,ghost_user',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.statuses.live_gamer).toBe('live');
    expect(body.statuses.offline_streamer).toBe('offline');
    expect(body.statuses.ghost_user).toBe('unknown');
    expect(typeof body.checked_at).toBe('string');
  });

  it('GET /api/discovery/status requires at least one handle', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/discovery/status?handles=',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/discovery/preview honours the fallback flag for offline rooms', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/discovery/preview/offline_streamer?fallback=1',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(res.statusCode).toBe(204);

    const strict = await app.inject({
      method: 'GET',
      url: '/api/discovery/preview/offline_streamer',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(strict.statusCode).toBe(404);
  });

  it('enforces rate limiting when too many requests arrive', async () => {
    let triggeredRateLimit = false;
    for (let i = 0; i < 25; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/discovery/trending',
        headers: { authorization: 'Bearer test-token' },
      });
      if (res.statusCode === 429) {
        triggeredRateLimit = true;
        break;
      }
    }
    expect(triggeredRateLimit).toBe(true);
  });
});
