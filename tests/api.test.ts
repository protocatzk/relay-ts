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
import { LogRing } from '../src/utils/logger.js';
import { VERSION } from '../src/version.js';

const logger = pino({ level: 'silent' });

function status(): StatusSnapshot {
  return {
    state: 'idle',
    active_streamer_id: null,
    active_streamer_name: null,
    active_playlist: null,
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
    playPlaylist: async () => status(),
    playlistNext: async () => status(),
    stopPlaylist: async () => status(),
    restartSink: async () => status(),
    refreshNow: async () => status(),
    applySettings: async () => status(),
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
    expect(response.json()).toMatchObject({ status: 'ok', version: VERSION });
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

  it('accepts a bearer API token', async () => {
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/status',
      headers: { authorization: 'Bearer api-secret' },
    });
    expect(allowed.statusCode).toBe(200);
    const query = await app.inject({ method: 'GET', url: '/api/status?token=api-secret' });
    expect(query.statusCode).toBe(200);
    const denied = await app.inject({
      method: 'GET',
      url: '/api/status',
      headers: { authorization: 'Bearer nope' },
    });
    expect(denied.statusCode).toBe(401);
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

  it('returns structured JSON 404 for unknown API routes', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/does-not-exist',
      headers: { cookie: cookieHeader },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});
