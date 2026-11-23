import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/core/config/loader.js';
import { DEFAULT_SETTINGS } from '../src/core/config/schema.js';
import { EventBus, type StatusSnapshot } from '../src/core/events.js';
import { StreamerStore } from '../src/core/store/streamer-store.js';
import { SettingsService } from '../src/core/store/settings-service.js';
import type { Supervisor } from '../src/core/supervisor/supervisor.js';
import { buildServer } from '../src/api/server.js';
import { AuthSessionStore } from '../src/api/session-store.js';
import { ApiKeyStore } from '../src/api/api-key-store.js';
import { LogRing } from '../src/utils/logger.js';
import { VERSION } from '../src/version.js';

const logger = pino({ level: 'silent' });

function status(): StatusSnapshot {
  return {
    state: 'idle',
    active_streamer_id: null,
    active_streamer_name: null,
    active_playlist: null,
    active_scene_id: null,
    active_scene_name: null,
    manual_screen: null,
    started_at: null,
    uptime_seconds: 0,
    source: {
      online: null,
      resolving: false,
      connected: false,
      pid: null,
      last_data_at: null,
      bitrate_kbps: null,
      reconnects: 0,
    },
    relay: {
      ingest_clients: 0,
      output_connected: false,
      buffer_seconds: 0,
      excess_seconds: 0,
      catching_up: false,
      pacing_multiplier: 1,
      buffered_bytes: 0,
      dropped_bytes: 0,
      delay_seconds: 30,
      pacing_kbps: null,
      total_bytes: 0,
    },
    sink: {
      running: false,
      pid: null,
      bitrate_kbps: null,
      target_bitrate_kbps: 4000,
      fps: null,
      dropped_frames: 0,
      speed: null,
      last_progress_at: null,
      restarts: 0,
      dts_errors: 0,
      silence_active: false,
      silence_since: null,
      last_error: null,
    },
    watchdog: {
      stall_timeout: 30,
      stall_count: 0,
      last_stall_at: null,
      last_error: null,
      reconnecting: false,
    },
    auto_refresh: {
      enabled: true,
      interval_minutes: 20,
      next_refresh_in_seconds: null,
      last_refresh_at: null,
      count: 0,
    },
    chat: {
      enabled: false,
      engine: null,
      messages: 0,
      last_message_at: null,
      api_configured: false,
      canvas_active: false,
    },
    media: null,
    version: VERSION,
  };
}

let app: FastifyInstance;
let cookieHeader = '';

let apiKeysStore: ApiKeyStore;
let apiKeyAdmin = '';
let apiKeyQueueOnly = '';

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-api-'));
  const config = loadConfig({
    cwd: dir,
    env: { DASHBOARD_PASSWORD: 'secret', API_TOKEN: 'api-secret', LOG_LEVEL: 'silent' },
  });
  const store = new StreamerStore(
    config.paths.streamersFile,
    { streamers: [], playlists: [] },
    logger,
  );
  store.create({ id: 'alpha', name: 'Alpha', tiktok: 'alpha', youtube_key: 'key' });
  const settingsService = new SettingsService(config.paths.settingsFile, DEFAULT_SETTINGS, logger);
  const supervisor = {
    buildStatus: () => status(),
    streamersView: () => [store.view(store.require('alpha'))],
    playlistsView: () => [],
    notifyStreamersChanged: () => undefined,
    start: async () => status(),
    stop: async () => status(),
    switchTo: async () => status(),
    pause: async () => status(),
    resume: async () => status(),
    showScreen: async () => status(),
    hideScreen: async () => status(),
    playPlaylist: async () => status(),
    playlistNext: async () => status(),
    stopPlaylist: async () => status(),
    restartSink: async () => status(),
    refreshNow: async () => status(),
    applySettings: async () => status(),
    buildQueueSnapshot: () => ({ entries: [], playing: false, index: null, loop: false }),
    queueAdd: async () => ({ entries: [], playing: false, index: null, loop: false }),
    earningsStatus: () => null,
    earningsHistory: () => [],
  } as unknown as Supervisor;
  apiKeysStore = new ApiKeyStore();
  apiKeyAdmin = apiKeysStore.create({ name: 'Admin', scopes: ['*'] }).key;
  apiKeyQueueOnly = apiKeysStore.create({ name: 'Queue', scopes: ['control:queue'] }).key;

  app = await buildServer({
    config,
    logger,
    store,
    settingsService,
    supervisor,
    bus: new EventBus(),
    ring: new LogRing(),
    version: VERSION,
    authSessions: new AuthSessionStore(),
    apiKeys: apiKeysStore,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('API', () => {
  it('serves health without authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      version: VERSION,
      source: expect.objectContaining({ reconnects: expect.any(Number) }),
      relay: expect.objectContaining({ ingest_clients: expect.any(Number) }),
      sink: expect.objectContaining({ running: expect.any(Boolean) }),
      pause: expect.objectContaining({ active: expect.any(Boolean) }),
    });
  });

  it('exposes process metrics for authenticated users', async () => {
    const denied = await app.inject({ method: 'GET', url: '/api/metrics' });
    expect(denied.statusCode).toBe(401);

    const response = await app.inject({
      method: 'GET',
      url: '/api/metrics',
      headers: { authorization: 'Bearer api-secret' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      started_at: string;
      counters: Record<string, number>;
    };
    expect(typeof body.started_at).toBe('string');
    expect(body.counters).toMatchObject({
      source_exits_total: expect.any(Number),
      sink_restarts_total: expect.any(Number),
      chat_poll_errors_total: expect.any(Number),
    });
  });

  it('serves the OpenAPI document to authenticated users', async () => {
    const denied = await app.inject({ method: 'GET', url: '/api/openapi.json' });
    expect(denied.statusCode).toBe(401);

    const response = await app.inject({
      method: 'GET',
      url: '/api/openapi.json',
      headers: { authorization: 'Bearer api-secret' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      openapi: string;
      info: { version: string };
      paths: Record<string, unknown>;
    };
    expect(body.openapi).toBe('3.1.0');
    expect(body.info.version).toBe(VERSION);
    expect(body.paths['/api/status']).toBeTruthy();
  });

  it('protects API routes and accepts a valid login session', async () => {
    const denied = await app.inject({ method: 'GET', url: '/api/streamers' });
    expect(denied.statusCode).toBe(401);

    const badLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'wrong' },
    });
    expect(badLogin.statusCode).toBe(401);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'secret' },
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers['set-cookie'];
    expect(setCookie).toBeTruthy();
    cookieHeader = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0]!;

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/streamers',
      headers: { cookie: cookieHeader },
    });
    expect(allowed.statusCode).toBe(200);
    const payload = allowed.json() as { streamers: { id: string; youtube_key_set: boolean }[] };
    expect(payload.streamers[0]).toMatchObject({ id: 'alpha', youtube_key_set: true });
    expect(JSON.stringify(payload)).not.toContain('"key"');

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookieHeader },
    });
    expect(me.json()).toMatchObject({ authenticated: true, auth_required: true });
  });

  it('protects the live preview stream', async () => {
    const denied = await app.inject({ method: 'GET', url: '/api/preview.ts' });
    expect(denied.statusCode).toBe(401);
  });

  it('accepts a bearer API token', async () => {
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/status',
      headers: { authorization: 'Bearer api-secret' },
    });
    expect(allowed.statusCode).toBe(200);
    const query = await app.inject({ method: 'GET', url: '/api/status?token=api-secret' });
    expect(query.statusCode).toBe(401);
    const denied = await app.inject({
      method: 'GET',
      url: '/api/status',
      headers: { authorization: 'Bearer nope' },
    });
    expect(denied.statusCode).toBe(401);
  });

  it('enforces API key scopes on read and write routes', async () => {
    const queueKey = { authorization: `Bearer ${apiKeyQueueOnly}` };
    const adminKey = { authorization: `Bearer ${apiKeyAdmin}` };

    const queueRead = await app.inject({ method: 'GET', url: '/api/queue', headers: queueKey });
    expect(queueRead.statusCode).toBe(200);

    // Control-plane surfaces stay hidden behind values-only keys.
    const settingsDenied = await app.inject({ method: 'GET', url: '/api/settings', headers: queueKey });
    expect(settingsDenied.statusCode).toBe(403);
    const keysDenied = await app.inject({ method: 'GET', url: '/api/api-keys', headers: queueKey });
    expect(keysDenied.statusCode).toBe(403);
    const logsDenied = await app.inject({ method: 'GET', url: '/api/logs', headers: queueKey });
    expect(logsDenied.statusCode).toBe(403);

    // Write routes still require their own scopes.
    const queueWrite = await app.inject({
      method: 'POST',
      url: '/api/queue/entries',
      headers: { ...queueKey, origin: 'http://localhost' },
      payload: { channel: 'file:nope.mp4' },
    });
    expect(queueWrite.statusCode).toBe(201); // scope ok; stub accepts the entry
    const screensWrite = await app.inject({
      method: 'POST',
      url: '/api/screens/pause/start',
      headers: { ...queueKey, origin: 'http://localhost' },
    });
    expect(screensWrite.statusCode).toBe(403);

    // Admin keys read and manage everything.
    const keysOk = await app.inject({ method: 'GET', url: '/api/api-keys', headers: adminKey });
    expect(keysOk.statusCode).toBe(200);
  });

  it('redacts the RTMP ingest key and serves a scoped reveal endpoint', async () => {
    const adminKey = { authorization: `Bearer ${apiKeyAdmin}`, origin: 'http://localhost' };
    const queueKey = { authorization: `Bearer ${apiKeyQueueOnly}` };

    const settings = await app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { authorization: `Bearer ${apiKeyAdmin}` },
    });
    const body = settings.json() as { rtmp_ingest?: { stream_key?: unknown; stream_key_set: boolean } };
    expect(body.rtmp_ingest).toBeDefined();
    expect(body.rtmp_ingest?.stream_key).toBeUndefined();
    expect(body.rtmp_ingest?.stream_key_set).toBe(true);

    const reveal = await app.inject({
      method: 'GET',
      url: '/api/settings/rtmp-ingest/stream-key',
      headers: adminKey,
    });
    expect(reveal.statusCode).toBe(200);
    expect(reveal.json()).toMatchObject({ stream_key: DEFAULT_SETTINGS.rtmp_ingest.stream_key });

    const revealDenied = await app.inject({
      method: 'GET',
      url: '/api/settings/rtmp-ingest/stream-key',
      headers: queueKey,
    });
    expect(revealDenied.statusCode).toBe(403);

    // An empty stream_key in a PUT payload keeps the stored secret.
    const keep = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: adminKey,
      payload: { rtmp_ingest: { enabled: false, port: 1935, stream_key: '', auto_takeover: true } },
    });
    expect(keep.statusCode).toBe(200);
    const revealAfter = await app.inject({
      method: 'GET',
      url: '/api/settings/rtmp-ingest/stream-key',
      headers: { authorization: `Bearer ${apiKeyAdmin}` },
    });
    expect(revealAfter.json()).toMatchObject({ stream_key: DEFAULT_SETTINGS.rtmp_ingest.stream_key });
  });

  it('rejects cookie-authenticated writes from foreign origins', async () => {
    const payload = { overlays: { chat: { enabled: true } } };
    const missing = await app.inject({
      method: 'PUT',
      url: '/api/overlays',
      headers: { cookie: cookieHeader },
      payload,
    });
    expect(missing.statusCode).toBe(403);

    const foreign = await app.inject({
      method: 'PUT',
      url: '/api/overlays',
      headers: { cookie: cookieHeader, origin: 'https://evil.example' },
      payload,
    });
    expect(foreign.statusCode).toBe(403);

    const tokenWrite = await app.inject({
      method: 'PUT',
      url: '/api/overlays',
      headers: { authorization: 'Bearer api-secret' },
      payload,
    });
    expect(tokenWrite.statusCode).toBe(200);
  });

  it('returns sanitized settings', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie: cookieHeader },
    });
    expect(response.statusCode).toBe(200);
    const settings = response.json() as Record<string, unknown>;
    expect(JSON.stringify(settings)).not.toContain('"api_key":');
  });

  it('applies partial settings updates without overwriting other sections or secrets', async () => {
    const setOnline = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie: cookieHeader, origin: 'http://localhost' },
      payload: {
        online: {
          enabled: false,
          source_url: 'https://example.test/online',
          interval: 45,
          auto_switch_preferred: false,
          api_key: 'super-secret-online-key',
        },
        streaming: {
          title_template: 'Keep Me {name}',
        },
      },
    });
    expect(setOnline.statusCode).toBe(200);
    expect((setOnline.json() as { online: { api_key_set: boolean } }).online.api_key_set).toBe(true);

    const partialWatchdog = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie: cookieHeader, origin: 'http://localhost' },
      payload: {
        watchdog: {
          stall_timeout: 42,
          min_bitrate: 500,
          min_source_rate_percent: 85,
          interval: 5,
          auto_reconnect: true,
        },
      },
    });
    expect(partialWatchdog.statusCode).toBe(200);
    const body = partialWatchdog.json() as {
      watchdog: { stall_timeout: number };
      streaming: { title_template: string };
      online: { interval: number; api_key_set: boolean };
    };
    expect(body.watchdog.stall_timeout).toBe(42);
    expect(body.streaming.title_template).toBe('Keep Me {name}');
    expect(body.online.interval).toBe(45);
    expect(body.online.api_key_set).toBe(true);
  });

  it('exposes login methods publicly', async () => {
    const methods = await app.inject({ method: 'GET', url: '/api/auth/methods' });
    expect(methods.statusCode).toBe(200);
    expect(methods.json()).toMatchObject({
      auth_required: true,
      password_auth: true,
      telegram_auth: false,
    });
    const telegram = await app.inject({
      method: 'POST',
      url: '/api/auth/telegram/request',
    });
    expect(telegram.statusCode).toBe(503);
  });

  it('persists global overlay settings', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/overlays',
      headers: { cookie: cookieHeader, origin: 'http://localhost' },
      payload: {
        overlays: {
          chat: { enabled: true, show_stats: true, panel_height: 240 },
          clock: { enabled: true, margin: 50, show_box: false },
          text: { enabled: true, show_box: false, text: 'Hallo' },
        },
      },
    });
    expect(response.statusCode).toBe(200);
    const overlays = (response.json() as {
      overlays: {
        chat: { enabled: boolean; show_stats: boolean; panel_height: number; style: string };
        clock: { enabled: boolean; margin: number; show_box: boolean };
        text: { enabled: boolean; show_box: boolean };
      };
    }).overlays;
    expect(overlays.chat).toMatchObject({
      enabled: true,
      show_stats: true,
      panel_height: 240,
      style: 'bubbles',
    });
    expect(overlays.clock).toMatchObject({ enabled: true, margin: 50, show_box: false });
    expect(overlays.text).toMatchObject({ enabled: true, show_box: false });
  });

  it('uploads and deletes pause assets', async () => {
    const boundary = '----relay-test-boundary';
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from('Content-Disposition: form-data; name="file"; filename="test.png"\r\n'),
      Buffer.from('Content-Type: image/png\r\n\r\n'),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const upload = await app.inject({
      method: 'POST',
      url: '/api/pause/assets',
      headers: {
        cookie: cookieHeader,
        origin: 'http://localhost',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(upload.statusCode).toBe(201);
    const asset = (upload.json() as {
      asset: { filename: string; path: string; kind: string; mime: string };
    }).asset;
    expect(asset).toMatchObject({ kind: 'image', mime: 'image/png' });
    expect(asset.filename).toMatch(/\.png$/);

    const served = await app.inject({
      method: 'GET',
      url: `/api/pause/assets/${asset.filename}`,
      headers: { cookie: cookieHeader },
    });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toContain('image/png');

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/pause/assets/${asset.filename}`,
      headers: { cookie: cookieHeader, origin: 'http://localhost' },
    });
    expect(remove.statusCode).toBe(200);
  });

  it('rejects unsupported pause asset types', async () => {
    const boundary = '----relay-test-boundary';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from('Content-Disposition: form-data; name="file"; filename="bad.txt"\r\n'),
      Buffer.from('Content-Type: text/plain\r\n\r\nnot an asset'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const upload = await app.inject({
      method: 'POST',
      url: '/api/pause/assets',
      headers: {
        cookie: cookieHeader,
        origin: 'http://localhost',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(upload.statusCode).toBe(400);
  });

  it('uploads, lists and deletes media videos', async () => {
    const boundary = '----relay-media-boundary';
    const payload = Buffer.from('fake video bytes');
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from('Content-Disposition: form-data; name="file"; filename="Mein Video!.MP4"\r\n'),
      Buffer.from('Content-Type: video/mp4\r\n\r\n'),
      payload,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const upload = await app.inject({
      method: 'POST',
      url: '/api/media',
      headers: {
        cookie: cookieHeader,
        origin: 'http://localhost',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(upload.statusCode).toBe(201);
    const file = (upload.json() as { file: { filename: string; size: number } }).file;
    expect(file.filename).toBe('mein-video.mp4');
    expect(file.size).toBe(payload.length);

    const list = await app.inject({
      method: 'GET',
      url: '/api/media',
      headers: { cookie: cookieHeader },
    });
    expect(list.statusCode).toBe(200);
    const files = (list.json() as { files: { filename: string }[] }).files;
    expect(files.some((entry) => entry.filename === file.filename)).toBe(true);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/media/${file.filename}`,
      headers: { cookie: cookieHeader, origin: 'http://localhost' },
    });
    expect(remove.statusCode).toBe(200);
  });

  it('rejects unsupported media types', async () => {
    const boundary = '----relay-media-boundary';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from('Content-Disposition: form-data; name="file"; filename="bad.txt"\r\n'),
      Buffer.from('Content-Type: text/plain\r\n\r\nnot a video'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const upload = await app.inject({
      method: 'POST',
      url: '/api/media',
      headers: {
        cookie: cookieHeader,
        origin: 'http://localhost',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(upload.statusCode).toBe(400);
  });

  it('activates and stops manual screens', async () => {
    const startup = await app.inject({
      method: 'POST',
      url: '/api/screens/startup/start',
      headers: { cookie: cookieHeader, origin: 'http://localhost' },
    });
    expect(startup.statusCode).toBe(200);
    const pause = await app.inject({
      method: 'POST',
      url: '/api/screens/pause/start',
      headers: { cookie: cookieHeader, origin: 'http://localhost' },
    });
    expect(pause.statusCode).toBe(200);
    const stop = await app.inject({
      method: 'POST',
      url: '/api/screens/stop',
      headers: { cookie: cookieHeader, origin: 'http://localhost' },
    });
    expect(stop.statusCode).toBe(200);
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/screens/nope/start',
      headers: { cookie: cookieHeader, origin: 'http://localhost' },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('returns earnings history and updates the quick period', async () => {
    const history = await app.inject({
      method: 'GET',
      url: '/api/earnings/history?period=7d',
      headers: { authorization: 'Bearer api-secret' },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({ period: '7d', points: [] });

    const changed = await app.inject({
      method: 'POST',
      url: '/api/earnings/period',
      headers: { cookie: cookieHeader, origin: 'http://localhost' },
      payload: { period: '30d' },
    });
    expect(changed.statusCode).toBe(200);
    const settings = await app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie: cookieHeader },
    });
    expect((settings.json() as { earnings: { period: string } }).earnings.period).toBe('30d');
  });

  it('returns structured JSON 404 for unknown API routes', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/does-not-exist',
      headers: { cookie: cookieHeader },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('lists and revokes server-side sessions', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/auth/sessions',
      headers: { cookie: cookieHeader },
    });
    expect(list.statusCode).toBe(200);
    const sessions = (list.json() as { sessions: { current: boolean; user: string }[] }).sessions;
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    expect(sessions.some((session) => session.current)).toBe(true);
    expect(sessions[0]?.user).toBe('Dashboard');

    const revoke = await app.inject({
      method: 'POST',
      url: '/api/auth/sessions/revoke-all',
      headers: { cookie: cookieHeader, origin: 'http://localhost' },
    });
    expect(revoke.statusCode).toBe(200);
    expect((revoke.json() as { removed: number }).removed).toBeGreaterThanOrEqual(1);

    const denied = await app.inject({
      method: 'GET',
      url: '/api/streamers',
      headers: { cookie: cookieHeader },
    });
    expect(denied.statusCode).toBe(401);
  });
});
