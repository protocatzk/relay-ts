import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/core/config/loader.js';
import { DEFAULT_SETTINGS } from '../src/core/config/schema.js';
import { EventBus } from '../src/core/events.js';
import { StreamerStore } from '../src/core/store/streamer-store.js';
import { SettingsService } from '../src/core/store/settings-service.js';
import type { Supervisor } from '../src/core/supervisor/supervisor.js';
import { buildServer } from '../src/api/server.js';
import { AuthSessionStore } from '../src/api/session-store.js';
import {
  buildSecondaryRtmpUrl,
  buildSecondarySinkArgs,
} from '../src/core/sink/secondary-sink.js';
import {
  buildRecordingArgs,
  enforceRecordingLimits,
  evaluateRecordingStorage,
  recordingsDirectory,
} from '../src/core/recording/recording-controller.js';
import { LogRing } from '../src/utils/logger.js';
import { VERSION } from '../src/version.js';

describe('Phase 4: Multi-Destination Secondary Sink & MKV Recording', () => {
  it('builds secondary RTMP URLs and copy/reencode ffmpeg args cleanly', () => {
    expect(buildSecondaryRtmpUrl('rtmp://live.twitch.tv/app/', 'live_abc')).toBe(
      'rtmp://live.twitch.tv/app/live_abc',
    );
    expect(buildSecondaryRtmpUrl('http://invalid', 'live_abc')).toBe('');
    expect(buildSecondaryRtmpUrl('rtmp://live.twitch.tv/app', '')).toBe('');

    const dir = mkdtempSync(join(tmpdir(), 'relay-secondary-args-'));
    const config = loadConfig({ cwd: dir, env: { LOG_LEVEL: 'silent' } });

    const copySettings = structuredClone(DEFAULT_SETTINGS);
    copySettings.secondary_sink.mode = 'copy';
    const copyArgs = buildSecondarySinkArgs({
      media: config.media,
      settings: copySettings,
      url: 'rtmp://live.twitch.tv/app/key',
    });
    expect(copyArgs).toContain('-c');
    expect(copyArgs).toContain('copy');
    expect(copyArgs).toContain('flv');

    const reencodeSettings = structuredClone(DEFAULT_SETTINGS);
    reencodeSettings.secondary_sink.mode = 'reencode';
    const reencodeArgs = buildSecondarySinkArgs({
      media: config.media,
      settings: reencodeSettings,
      url: 'rtmp://live.twitch.tv/app/key',
      encoder: 'libx264',
    });
    expect(reencodeArgs).toContain('libx264');
    expect(reencodeArgs).toContain('flv');

    const recArgs = buildRecordingArgs(config.media, '/tmp/test.mkv');
    expect(recArgs).toContain('-c');
    expect(recArgs).toContain('copy');
    expect(recArgs).toContain('matroska');
    expect(recArgs[recArgs.length - 1]).toBe('/tmp/test.mkv');
  });

  it('enforces recording storage limits and auto-deletes oldest inactive files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-rec-limits-'));
    const recDir = recordingsDirectory(dir);
    mkdirSync(recDir, { recursive: true });

    const oldFile = join(recDir, '2026-11-01-old.mkv');
    const newFile = join(recDir, '2026-11-20-new.mkv');
    writeFileSync(oldFile, Buffer.alloc(700 * 1024));
    writeFileSync(newFile, Buffer.alloc(700 * 1024));
    const earlier = new Date('2026-11-01T10:00:00Z');
    const later = new Date('2026-11-20T10:00:00Z');
    utimesSync(oldFile, earlier, earlier);
    utimesSync(newFile, later, later);

    const cfg = { enabled: true, max_total_mb: 1, min_free_mb: 0, auto_delete: true };
    const before = evaluateRecordingStorage(dir, cfg);
    expect(before.disk_warning).toContain('Aufzeichnungs-Limit');

    const removed = enforceRecordingLimits(dir, cfg, '2026-11-20-new.mkv');
    expect(removed).toEqual(['2026-11-01-old.mkv']);
    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(newFile)).toBe(true);
  });
});

describe('Phase 4 HTTP API (sanitized secondary key, health, recordings CRUD)', () => {
  let app: FastifyInstance;
  let dataDir = '';
  let activeRecording: string | null = null;

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-phase4-api-'));
    const logger = pino({ level: 'silent' });
    const config = loadConfig({
      cwd: dir,
      env: { API_TOKEN: 'phase4-secret', LOG_LEVEL: 'silent' },
    });
    dataDir = config.paths.dataDir;
    const store = new StreamerStore(
      config.paths.streamersFile,
      { streamers: [], playlists: [] },
      logger,
    );
    const settingsService = new SettingsService(config.paths.settingsFile, DEFAULT_SETTINGS, logger);
    const supervisor = {
      buildStatus: () => ({
        state: 'idle',
        source: { online: null, connected: false, reconnects: 0, last_data_at: null },
        relay: { ingest_clients: 0, output_connected: false, buffered_bytes: 0, buffer_seconds: 0 },
        sink: { running: false, bitrate_kbps: null, fps: null },
        secondary_sink: {
          enabled: true,
          provider: 'twitch',
          mode: 'reencode',
          running: false,
          pid: null,
          bitrate_kbps: null,
          fps: null,
          restarts: 0,
          last_error: null,
        },
        recording: {
          enabled: true,
          active: Boolean(activeRecording),
          filename: activeRecording,
          started_at: null,
          bytes: 0,
          disk_warning: null,
          last_error: null,
        },
        manual_screen: null,
        version: VERSION,
      }),
      recordingFilename: () => activeRecording,
      applySettings: async () => ({ state: 'idle', version: VERSION }),
      streamersView: () => [],
      playlistsView: () => [],
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

  it('sanitizes secondary_sink.stream_key and exposes secondary_sink + recording in /health', async () => {
    const update = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { authorization: 'Bearer phase4-secret' },
      payload: {
        secondary_sink: {
          enabled: true,
          provider: 'twitch',
          rtmp_url: 'rtmp://live.twitch.tv/app',
          stream_key: 'live_super_secret_twitch_key',
          mode: 'copy',
        },
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.body).not.toContain('live_super_secret_twitch_key');
    expect(
      (update.json() as { secondary_sink: { stream_key_set: boolean; mode: string } })
        .secondary_sink,
    ).toMatchObject({ stream_key_set: true, mode: 'copy' });

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      secondary_sink: { enabled: true, provider: 'twitch' },
      recording: { enabled: true },
    });
  });

  it('lists, downloads, protects active, and deletes MKV recordings', async () => {
    const recDir = recordingsDirectory(dataDir);
    mkdirSync(recDir, { recursive: true });
    const file = join(recDir, '2026-11-20-demo.mkv');
    writeFileSync(file, Buffer.from('mkv-bytes'));

    const list = await app.inject({
      method: 'GET',
      url: '/api/recordings',
      headers: { authorization: 'Bearer phase4-secret' },
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { files: Array<{ filename: string }> }).files[0]?.filename).toBe(
      '2026-11-20-demo.mkv',
    );

    const dl = await app.inject({
      method: 'GET',
      url: '/api/recordings/2026-11-20-demo.mkv',
      headers: { authorization: 'Bearer phase4-secret' },
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toContain('video/x-matroska');
    expect(dl.body).toBe('mkv-bytes');

    // Active recording cannot be deleted (409 Conflict).
    activeRecording = '2026-11-20-demo.mkv';
    const busyDel = await app.inject({
      method: 'DELETE',
      url: '/api/recordings/2026-11-20-demo.mkv',
      headers: { authorization: 'Bearer phase4-secret' },
    });
    expect(busyDel.statusCode).toBe(409);

    activeRecording = null;
    const okDel = await app.inject({
      method: 'DELETE',
      url: '/api/recordings/2026-11-20-demo.mkv',
      headers: { authorization: 'Bearer phase4-secret' },
    });
    expect(okDel.statusCode).toBe(200);
    expect(existsSync(file)).toBe(false);
  });
});
