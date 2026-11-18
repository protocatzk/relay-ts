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
import { LogRing } from '../src/utils/logger.js';
import { VERSION } from '../src/version.js';

const logger = pino({ level: 'silent' });

function status(): StatusSnapshot {
  return {
    state: 'idle',
    active_streamer_id: null,
    active_streamer_name: null,
    active_playlist: null,
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
    earnings: null,
    version: VERSION,
  };
}

let app: FastifyInstance;
let cookieHeader = '';

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
    earningsStatus: () => null,
    earningsHistory: () => [],
  } as unknown as Supervisor;
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
