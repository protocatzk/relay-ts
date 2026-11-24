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
import { buildServer } from '../src/api/server.js';
import { AuthSessionStore } from '../src/api/session-store.js';
import { LogRing } from '../src/utils/logger.js';
import { VERSION } from '../src/version.js';
import type { PlaybackState } from '../src/core/events.js';

const logger = pino({ level: 'silent' });

describe('Playback API routes', () => {
  let app: FastifyInstance;
  let supervisor: Record<string, ReturnType<typeof vi.fn>>;

  const state = (overrides: Partial<PlaybackState> = {}): PlaybackState => ({
    source: 'queue',
    playing: true,
    paused: false,
    position_seconds: 12,
    duration_seconds: 120,
    current: { kind: 'file', id: 'e1', label: 'intro.mp4', channel: 'file:intro.mp4' },
    next: { kind: 'streamer', id: 'e2', label: 'Bravo', channel: 'bravo' },
    loop: 'off',
    queue_index: 0,
    held: false,
    updated_at: new Date().toISOString(),
    ...overrides,
  });

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-playback-api-'));
    const config = loadConfig({
      cwd: dir,
      env: { API_TOKEN: 'test-token', LOG_LEVEL: 'silent' },
    });

    const store = new StreamerStore(config.paths.streamersFile, { streamers: [], playlists: [] }, logger);
    const settingsService = new SettingsService(config.paths.settingsFile, DEFAULT_SETTINGS, logger);

    let currentState = state();
    supervisor = {
      buildStatus: vi.fn().mockReturnValue({ state: 'live', version: VERSION }),
      buildPlaybackState: vi.fn(() => currentState),
      playlistsView: vi.fn().mockReturnValue([]),
      queuePlay: vi.fn(async () => ({ state: 'live' })),
      queueNext: vi.fn(async () => ({ state: 'live' })),
      queuePrevious: vi.fn(async () => ({ state: 'live' })),
      queueSetLoop: vi.fn(async () => ({ entries: [], playing: true, index: 0, loop: true })),
      queueSetLoopMode: vi.fn(async () => ({ entries: [], playing: true, index: 0, loop_mode: 'all' })),
      queuePlayNow: vi.fn(async () => ({ state: 'live' })),
      showScreen: vi.fn(async () => ({ state: 'paused' })),
      hideScreen: vi.fn(async () => ({ state: 'live' })),
      holdPlayback: vi.fn(async () => ({ state: 'paused' })),
      resumePlayback: vi.fn(async () => ({ state: 'live' })),
      stop: vi.fn(async () => ({ state: 'idle' })),
      playlistNext: vi.fn(async () => ({ state: 'live' })),
      playlistPrevious: vi.fn(async () => ({ state: 'live' })),
      seekActiveVideo: vi.fn(async () => ({ state: 'live' })),
    };

    app = await buildServer({
      config,
      logger,
      store,
      settingsService,
      supervisor: supervisor as never,
      bus: new EventBus(),
      ring: new LogRing(),
      version: VERSION,
      authSessions: new AuthSessionStore(join(dir, 'sessions.json')),
      audit: new AuditLogStore(join(dir, 'audit.jsonl')),
      // Playback routes only need the supervisor; discovery stays undefined.
      discovery: undefined,
    });

    // Expose the mutable state for individual assertions.
    (app as unknown as { __setState: (next: PlaybackState) => void }).__setState = (next) => {
      currentState = next;
    };
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = { authorization: 'Bearer test-token' };

  it('GET /api/playback returns the unified state', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/playback', headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe('queue');
    expect(body.current.label).toBe('intro.mp4');
    expect(body.next.label).toBe('Bravo');
  });

  it('POST /api/playback/pause and /resume drive the screen controller', async () => {
    const pause = await app.inject({ method: 'POST', url: '/api/playback/pause', headers: auth });
    expect(pause.statusCode).toBe(200);
    expect(supervisor.showScreen).toHaveBeenCalledWith('pause');

    const resume = await app.inject({ method: 'POST', url: '/api/playback/resume', headers: auth });
    expect(resume.statusCode).toBe(200);
    expect(supervisor.resumePlayback).toHaveBeenCalled();

    const hold = await app.inject({ method: 'POST', url: '/api/playback/hold', headers: auth });
    expect(hold.statusCode).toBe(200);
    expect(supervisor.holdPlayback).toHaveBeenCalled();
  });

  it('POST /api/playback/next picks the queue when it is active', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/playback/next', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(supervisor.queueNext).toHaveBeenCalled();
    expect(supervisor.playlistNext).not.toHaveBeenCalled();
  });

  it('POST /api/playback/previous walks the queue back', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/playback/previous', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(supervisor.queuePrevious).toHaveBeenCalled();
  });

  it('POST /api/playback/next refuses without a playlist or queue', async () => {
    const app2 = app as unknown as { __setState: (next: PlaybackState) => void };
    app2.__setState(state({ source: 'streamer', queue_index: null, next: null }));
    const res = await app.inject({ method: 'POST', url: '/api/playback/next', headers: auth });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/playback/seek clamps to the known duration', async () => {
    const app2 = app as unknown as { __setState: (next: PlaybackState) => void };
    app2.__setState(state());
    const res = await app.inject({
      method: 'POST',
      url: '/api/playback/seek',
      headers: auth,
      payload: { seconds: 5000 },
    });
    expect(res.statusCode).toBe(200);
    expect(supervisor.seekActiveVideo).toHaveBeenCalledWith(119);
  });

  it('POST /api/playback/seek rejects sources without duration', async () => {
    const app2 = app as unknown as { __setState: (next: PlaybackState) => void };
    app2.__setState(state({ source: 'streamer', duration_seconds: null }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/playback/seek',
      headers: auth,
      payload: { seconds: 10 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/playback/loop passes the loop mode through', async () => {
    const all = await app.inject({
      method: 'POST',
      url: '/api/playback/loop',
      headers: auth,
      payload: { loop: 'all' },
    });
    expect(all.statusCode).toBe(200);
    expect(supervisor.queueSetLoopMode).toHaveBeenCalledWith('all');

    const one = await app.inject({
      method: 'POST',
      url: '/api/playback/loop',
      headers: auth,
      payload: { loop: 'one' },
    });
    expect(one.statusCode).toBe(200);
    expect(supervisor.queueSetLoopMode).toHaveBeenCalledWith('one');

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/playback/loop',
      headers: auth,
      payload: { loop: 'sometimes' },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('POST /api/playback/queue-now requires a channel', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/api/playback/queue-now',
      headers: auth,
      payload: {},
    });
    expect(missing.statusCode).toBe(404);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/playback/queue-now',
      headers: auth,
      payload: { channel: 'bravo' },
    });
    expect(ok.statusCode).toBe(200);
    expect(supervisor.queuePlayNow).toHaveBeenCalledWith('bravo');
  });
});
