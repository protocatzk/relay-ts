import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/core/config/loader.js';
import { EventBus } from '../src/core/events.js';
import { StreamerStore } from '../src/core/store/streamer-store.js';
import { SettingsService } from '../src/core/store/settings-service.js';
import { DEFAULT_SETTINGS } from '../src/core/config/schema.js';
import type { Supervisor } from '../src/core/supervisor/supervisor.js';
import { buildServer } from '../src/api/server.js';
import { AuthSessionStore } from '../src/api/session-store.js';
import { YouTubeAuthStore } from '../src/core/youtube/auth-store.js';
import { YouTubeAuthService } from '../src/core/youtube/service.js';
import { LogRing } from '../src/utils/logger.js';
import { VERSION } from '../src/version.js';

const logger = pino({ level: 'silent' });
const auth = { authorization: 'Bearer api-token' };

let app: FastifyInstance;
let service: YouTubeAuthService;
let store: StreamerStore;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-youtube-routes-'));
  const config = loadConfig({
    cwd: dir,
    env: {
      API_TOKEN: 'api-token',
      GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'GOCSPX-secret',
      GOOGLE_REDIRECT_URI: 'https://relay.example/api/youtube/oauth/callback',
      LOG_LEVEL: 'silent',
    },
  });
  store = new StreamerStore(
    config.paths.streamersFile,
    { streamers: [], playlists: [] },
    logger,
  );
  store.create({ id: 'alpha', name: 'Alpha', tiktok: 'alpha', youtube_key: 'streamer-key' });
  const settingsService = new SettingsService(config.paths.settingsFile, DEFAULT_SETTINGS, logger);
  service = new YouTubeAuthService({
    config: config.youtube,
    store: new YouTubeAuthStore(join(config.paths.dataDir, 'youtube-auth.json'), logger),
    logger,
    automation: () => settingsService.get().youtube,
  });
  app = await buildServer({
    config,
    logger,
    store,
    settingsService,
    supervisor: {} as unknown as Supervisor,
    bus: new EventBus(),
    ring: new LogRing(),
    version: VERSION,
    authSessions: new AuthSessionStore(),
    youtubeAuth: service,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('YouTube routes', () => {
  it('protects the status endpoint', async () => {
    const denied = await app.inject({ method: 'GET', url: '/api/youtube/status' });
    expect(denied.statusCode).toBe(401);

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/youtube/status',
      headers: auth,
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({
      configured: true,
      connected: false,
      scopes: [],
    });
    expect(JSON.stringify(allowed.json())).not.toContain('access_token');
    expect(JSON.stringify(allowed.json())).not.toContain('refresh_token');
  });

  it('allows the Google callback without a dashboard session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/youtube/oauth/callback?state=unknown&code=abc',
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/#/youtube?error=state_invalid');
  });

  it('completes the OAuth round trip from start to callback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith('https://oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'access-1',
              refresh_token: 'refresh-1',
              expires_in: 3600,
              scope: 'https://www.googleapis.com/auth/youtube.force-ssl',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.startsWith('https://www.googleapis.com/youtube/v3/channels')) {
          return new Response(
            JSON.stringify({ items: [{ id: 'UC123', snippet: { title: 'Testkanal' } }] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.includes('/youtube/v3/liveBroadcasts') && (init?.method ?? 'GET') === 'GET') {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: 'live-1',
                  snippet: { title: 'Live jetzt' },
                  status: { lifeCycleStatus: 'live', privacyStatus: 'public' },
                  contentDetails: { boundStreamId: 'stream-1' },
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.includes('/youtube/v3/liveStreams')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: 'stream-1',
                  status: { streamStatus: 'active' },
                  cdn: { ingestionInfo: { streamName: 'streamer-key' } },
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.includes('/liveBroadcasts/bind')) {
          return new Response(
            JSON.stringify({ id: 'bc-1', contentDetails: { boundStreamId: 'stream-1' } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.includes('/liveBroadcasts/transition')) {
          return new Response(JSON.stringify({ id: 'bc-1' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.includes('/youtube/v3/liveBroadcasts') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              id: 'bc-1',
              snippet: { title: 'Neu', scheduledStartTime: '2026-01-02T11:00:00.000Z' },
              status: { lifeCycleStatus: 'created', privacyStatus: 'unlisted' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const start = await app.inject({
      method: 'GET',
      url: '/api/youtube/oauth/start',
      headers: auth,
    });
    expect(start.statusCode).toBe(200);
    const url = new URL(start.json().url);
    const state = url.searchParams.get('state') ?? '';

    const callback = await app.inject({
      method: 'GET',
      url: `/api/youtube/oauth/callback?state=${encodeURIComponent(state)}&code=auth-code`,
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('/#/youtube?connected=1');

    const status = await app.inject({
      method: 'GET',
      url: '/api/youtube/status',
      headers: auth,
    });
    expect(status.json()).toMatchObject({
      connected: true,
      account: { channel_id: 'UC123', channel_title: 'Testkanal' },
    });

    const broadcasts = await app.inject({
      method: 'GET',
      url: '/api/youtube/broadcasts',
      headers: auth,
    });
    expect(broadcasts.statusCode).toBe(200);
    expect(broadcasts.json().items).toEqual([
      expect.objectContaining({
        id: 'live-1',
        title: 'Live jetzt',
        status: 'live',
        stream_status: 'active',
        watch_url: 'https://www.youtube.com/watch?v=live-1',
      }),
    ]);
    expect(JSON.stringify(broadcasts.json())).not.toContain('streamName');

    const created = await app.inject({
      method: 'POST',
      url: '/api/youtube/broadcasts',
      headers: auth,
      payload: {
        title: 'Neu',
        scheduled_start: '2026-01-02T11:00:00Z',
        streamer_id: 'alpha',
      },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      id: 'bc-1',
      privacy: 'unlisted',
      bound_stream_id: 'stream-1',
    });

    // Without an explicit streamer RELAY must bind to its own ingest instead
    // of creating a fresh YouTube liveStream that receives no data.
    const autoCreated = await app.inject({
      method: 'POST',
      url: '/api/youtube/broadcasts',
      headers: auth,
      payload: {
        title: 'Auto',
        scheduled_start: '2026-01-03T11:00:00Z',
      },
    });
    expect(autoCreated.statusCode).toBe(200);
    expect(autoCreated.json()).toMatchObject({ bound_stream_id: 'stream-1' });

    const transition = await app.inject({
      method: 'POST',
      url: '/api/youtube/broadcasts/bc-1/transition',
      headers: auth,
      payload: { status: 'live' },
    });
    expect(transition.statusCode).toBe(200);
    expect(transition.json()).toEqual({ ok: true, status: 'live' });

    // Even when YouTube's mine=true list endpoint has eventual consistency and
    // momentarily omits bc-1 right after transitioning to live, RELAY preserves
    // the broadcast with status 'live' so it never vanishes from the YouTube tab.
    const broadcastsAfterLive = await app.inject({
      method: 'GET',
      url: '/api/youtube/broadcasts',
      headers: auth,
    });
    expect(broadcastsAfterLive.statusCode).toBe(200);
    expect(broadcastsAfterLive.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'bc-1',
          title: 'Neu',
          status: 'live',
        }),
      ]),
    );

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/youtube/broadcasts/bc-1/transition',
      headers: auth,
      payload: { status: 'nope' },
    });
    expect(invalid.statusCode).toBe(400);

    const automation = await app.inject({
      method: 'PUT',
      url: '/api/youtube/automation',
      headers: auth,
      payload: { mode: 'off' },
    });
    expect(automation.statusCode).toBe(200);
    expect(automation.json()).toMatchObject({ mode: 'off', auto_transition: false });

    const restored = await app.inject({
      method: 'PUT',
      url: '/api/youtube/automation',
      headers: auth,
      payload: { mode: 'relay_only', auto_start: true, auto_stop: true },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({
      mode: 'relay_only',
      auto_transition: true,
      auto_start: true,
      auto_stop: true,
    });

    const disconnect = await app.inject({
      method: 'POST',
      url: '/api/youtube/oauth/disconnect',
      headers: auth,
    });
    expect(disconnect.statusCode).toBe(200);
    expect(disconnect.json()).toMatchObject({ connected: false });
  });

  it('validates and handles thumbnail uploads for broadcasts', async () => {
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    const invalidBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="test.txt"',
      'Content-Type: text/plain',
      '',
      'not an image',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const res = await app.inject({
      method: 'POST',
      url: '/api/youtube/broadcasts/test-broadcast/thumbnail',
      headers: {
        ...auth,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: invalidBody,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_file_type');

    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const validBody = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="thumb.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
      ),
      jpegBytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const setThumbnailSpy = vi.spyOn(service, 'setBroadcastThumbnail').mockResolvedValueOnce({
      ok: true,
      thumbnail_url: 'https://i.ytimg.com/vi/test/default.jpg',
    });

    const validRes = await app.inject({
      method: 'POST',
      url: '/api/youtube/broadcasts/test-broadcast/thumbnail',
      headers: {
        ...auth,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: validBody,
    });
    expect(validRes.statusCode).toBe(200);
    expect(validRes.json()).toEqual({
      ok: true,
      thumbnail_url: 'https://i.ytimg.com/vi/test/default.jpg',
    });
    expect(setThumbnailSpy).toHaveBeenCalledWith(
      'test-broadcast',
      expect.any(Buffer),
      'image/jpeg',
    );
  });
});
