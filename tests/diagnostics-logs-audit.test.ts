import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
import { AuditLogStore } from '../src/core/audit-log.js';
import { clearDiagnosticsCache, measureDirectory } from '../src/core/diagnostics.js';
import { LogRing, formatLogsAsText } from '../src/utils/logger.js';
import { VERSION } from '../src/version.js';

describe('Diagnostics, Logs and Audit Trail', () => {
  it('measures directory size and handles missing paths safely', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-diag-dir-'));
    writeFileSync(join(dir, 'a.bin'), Buffer.alloc(128));
    writeFileSync(join(dir, 'b.bin'), Buffer.alloc(64));

    expect(measureDirectory(dir)).toEqual({ exists: true, bytes: 192, files: 2 });
    expect(measureDirectory(join(dir, 'does-not-exist'))).toEqual({
      exists: false,
      bytes: 0,
      files: 0,
    });
  });

  it('writes 0600 JSONL audit logs, redacts secrets, filters and rotates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-audit-store-'));
    const file = join(dir, 'audit.jsonl');
    const store = new AuditLogStore(file, {
      maxBytes: 250,
      maxFiles: 2,
      redact: (text) => text.replace(/TOPSECRET/g, '***'),
    });

    store.record({
      actor: 'web:Dashboard',
      source: 'web',
      action: 'stream.start',
      target: 'alpha',
      result: 'ok',
    });
    store.record({
      actor: 'telegram:bot',
      source: 'telegram',
      action: 'stream.stop',
      target: 'alpha',
      result: 'error',
      detail: 'failed with TOPSECRET token',
    });
    store.record({
      actor: 'api:token',
      source: 'api',
      action: 'screen.start',
      target: 'pause',
      result: 'ok',
    });

    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(existsSync(`${file}.1`)).toBe(true);

    const rawAll =
      readFileSync(file, 'utf8') + (existsSync(`${file}.1`) ? readFileSync(`${file}.1`, 'utf8') : '');
    expect(rawAll).not.toContain('TOPSECRET');

    const all = store.query({ limit: 20 });
    expect(all.total).toBe(3);
    expect(all.entries[0]?.action).toBe('screen.start');
    expect(all.entries[1]?.detail).toContain('***');

    const onlyTelegram = store.query({ actor: 'telegram:bot' });
    expect(onlyTelegram.total).toBe(1);
    expect(onlyTelegram.entries[0]?.action).toBe('stream.stop');

    const onlyAction = store.query({ action: 'stream.start' });
    expect(onlyAction.total).toBe(1);
  });

  it('supports server-side log search, streamer filtering, time range, pagination and text export', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-logs-query-'));
    const logFile = join(dir, 'restreamer.log');
    writeFileSync(
      logFile,
      [
        JSON.stringify({
          time: '2026-11-20T10:00:00.000Z',
          level: 30,
          msg: 'historic start',
          streamer: 'alpha',
        }),
        JSON.stringify({
          time: '2026-11-20T10:05:00.000Z',
          level: 50,
          msg: 'historic error',
          streamer: 'beta',
        }),
      ].join('\n') + '\n',
    );

    const ring = new LogRing();
    ring.push({
      time: '2026-11-20T10:10:00.000Z',
      level: 'info',
      msg: 'live alpha ok',
      streamer: 'alpha',
    });
    ring.push({
      time: '2026-11-20T10:15:00.000Z',
      level: 'warn',
      msg: 'live alpha warn',
      streamer: 'alpha',
    });

    const alphaOnly = ring.query({ streamer: 'alpha', limit: 2, offset: 0 }, logFile);
    expect(alphaOnly.total).toBe(3);
    expect(alphaOnly.has_more).toBe(true);
    expect(alphaOnly.lines.map((l) => l.msg)).toEqual(['live alpha ok', 'live alpha warn']);

    const alphaOlder = ring.query({ streamer: 'alpha', limit: 2, offset: 2 }, logFile);
    expect(alphaOlder.has_more).toBe(false);
    expect(alphaOlder.lines.map((l) => l.msg)).toEqual(['historic start']);

    const sinceFiltered = ring.query({ since: '2026-11-20T10:06:00.000Z' }, logFile);
    expect(sinceFiltered.total).toBe(2);

    const exported = formatLogsAsText(alphaOnly.lines);
    expect(exported).toContain('[INFO] live alpha ok');
    expect(exported).toContain('streamer=alpha');
  });
});

describe('Diagnostics, Logs Export and Audit HTTP API', () => {
  let app: FastifyInstance;
  let ring: LogRing;
  let audit: AuditLogStore;

  beforeAll(async () => {
    clearDiagnosticsCache();
    const dir = mkdtempSync(join(tmpdir(), 'relay-phase2-api-'));
    const logger = pino({ level: 'silent' });
    const config = loadConfig({
      cwd: dir,
      env: {
        API_TOKEN: 'phase2-secret',
        LOG_LEVEL: 'silent',
        FFMPEG_BIN: '/bin/false',
        YTDLP_BIN: '/bin/false',
      },
    });
    const store = new StreamerStore(
      config.paths.streamersFile,
      { streamers: [], playlists: [] },
      logger,
    );
    store.create({ id: 'alpha', name: 'Alpha', tiktok: 'alpha', youtube_key: 'yt-secret-key' });
    const settingsService = new SettingsService(config.paths.settingsFile, DEFAULT_SETTINGS, logger);
    ring = new LogRing();
    ring.push({
      time: '2026-11-20T12:00:00.000Z',
      level: 'error',
      msg: 'alpha sink failure',
      streamer: 'alpha',
    });
    ring.push({
      time: '2026-11-20T12:01:00.000Z',
      level: 'info',
      msg: 'beta connected',
      streamer: 'beta',
    });
    audit = new AuditLogStore(join(dir, 'audit.jsonl'));
    const supervisor = {
      buildStatus: () => ({ state: 'idle', version: VERSION }),
      streamersView: () => [store.view(store.require('alpha'))],
      playlistsView: () => [],
      start: async () => ({ state: 'live', version: VERSION }),
      showScreen: async () => ({ state: 'paused', version: VERSION }),
      restartSink: async () => ({ state: 'idle', version: VERSION }),
      refreshNow: async () => ({ state: 'idle', version: VERSION }),
    } as unknown as Supervisor;

    app = await buildServer({
      config,
      logger,
      store,
      settingsService,
      supervisor,
      bus: new EventBus(),
      ring,
      version: VERSION,
      authSessions: new AuthSessionStore(),
      audit,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves system diagnostics with versions, ports, storage and recent errors', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/diagnostics',
      headers: { authorization: 'Bearer phase2-secret' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      version: string;
      ports: { http: number; relay: number; playback: number };
      storage: { media: { exists: boolean }; logs: { exists: boolean } };
      recent_errors: Array<{ msg: string }>;
    };
    expect(body.version).toBe(VERSION);
    expect(body.ports.playback).toBe(body.ports.relay + 1);
    expect(body.storage.logs.exists).toBe(true);
    expect(body.recent_errors.some((e) => e.msg === 'alpha sink failure')).toBe(true);
  });

  it('exports filtered logs as .log and .json', async () => {
    const logRes = await app.inject({
      method: 'GET',
      url: '/api/logs/export?format=log&streamer=alpha',
      headers: { authorization: 'Bearer phase2-secret' },
    });
    expect(logRes.statusCode).toBe(200);
    expect(logRes.headers['content-type']).toContain('text/plain');
    expect(logRes.headers['content-disposition']).toContain('.log"');
    expect(logRes.body).toContain('alpha sink failure');
    expect(logRes.body).not.toContain('beta connected');

    const jsonRes = await app.inject({
      method: 'GET',
      url: '/api/logs/export?format=json&level=error',
      headers: { authorization: 'Bearer phase2-secret' },
    });
    expect(jsonRes.statusCode).toBe(200);
    expect(jsonRes.headers['content-type']).toContain('application/json');
    const parsed = JSON.parse(jsonRes.body) as { lines: Array<{ msg: string }> };
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0]?.msg).toBe('alpha sink failure');
  });

  it('automatically records HTTP control actions in the audit log and allows filtering', async () => {
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/streamers/alpha/start',
      headers: { authorization: 'Bearer phase2-secret' },
      payload: {},
    });
    expect(startRes.statusCode).toBe(200);

    const screenRes = await app.inject({
      method: 'POST',
      url: '/api/screens/pause/start',
      headers: { authorization: 'Bearer phase2-secret' },
    });
    expect(screenRes.statusCode).toBe(200);

    const auditRes = await app.inject({
      method: 'GET',
      url: '/api/audit?action=stream.start',
      headers: { authorization: 'Bearer phase2-secret' },
    });
    expect(auditRes.statusCode).toBe(200);
    const body = auditRes.json() as {
      total: number;
      entries: Array<{ actor: string; source: string; action: string; target: string; result: string }>;
    };
    expect(body.total).toBe(1);
    expect(body.entries[0]).toMatchObject({
      actor: 'api:token',
      source: 'api',
      action: 'stream.start',
      target: 'alpha',
      result: 'ok',
    });
  });
});
