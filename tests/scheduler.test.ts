import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthSessionStore } from '../src/api/session-store.js';
import { buildServer } from '../src/api/server.js';
import { loadConfig } from '../src/core/config/loader.js';
import { DEFAULT_SETTINGS } from '../src/core/config/schema.js';
import { EventBus } from '../src/core/events.js';
import { LogRing } from '../src/utils/logger.js';
import {
  computeNextRunAt,
  isValidTimeZone,
  localTimeParts,
  StreamScheduler,
  type ScheduleRule,
} from '../src/core/scheduler/scheduler.js';
import { SettingsService } from '../src/core/store/settings-service.js';
import { StreamerStore } from '../src/core/store/streamer-store.js';
import type { Supervisor } from '../src/core/supervisor/supervisor.js';
import { VERSION } from '../src/version.js';

const logger = pino({ level: 'silent' });
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('scheduler time helpers', () => {
  it('validates IANA timezones and computes Berlin winter/summer local times', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('Invalid/Zone')).toBe(false);

    // 2026-01-15T19:30:00Z is 20:30 CET (+01:00), Thursday (day=4)
    expect(localTimeParts(new Date('2026-01-15T19:30:00.000Z'), 'Europe/Berlin')).toEqual({
      day: 4,
      hhmm: '20:30',
      minuteKey: '2026-01-15T20:30',
    });

    // 2026-07-15T18:30:00Z is 20:30 CEST (+02:00), Wednesday (day=3)
    expect(localTimeParts(new Date('2026-07-15T18:30:00.000Z'), 'Europe/Berlin')).toEqual({
      day: 3,
      hhmm: '20:30',
      minuteKey: '2026-07-15T20:30',
    });
  });

  it('computes the next matching run timestamp', () => {
    const next = computeNextRunAt(
      { enabled: true, days: [5], time: '20:00', timezone: 'Europe/Berlin' },
      new Date('2026-01-15T10:00:00.000Z'), // Thursday
    );
    expect(next).toBe('2026-01-16T19:00:00.000Z'); // Friday 20:00 CET

    expect(
      computeNextRunAt({ enabled: false, days: [5], time: '20:00', timezone: 'Europe/Berlin' }),
    ).toBeNull();
  });
});

describe('StreamScheduler', () => {
  it('triggers matching enabled rules once per minute and persists errors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-sched-'));
    tempDirs.push(dir);
    const file = join(dir, 'schedules.json');
    const executed: ScheduleRule[] = [];
    let shouldFail = false;

    const scheduler = new StreamScheduler({
      path: file,
      logger,
      executor: {
        execute: async (rule) => {
          executed.push(rule);
          if (shouldFail) throw new Error('Streamer offline');
        },
      },
    });

    const rule = scheduler.create({
      name: 'Abendstream',
      enabled: true,
      days: [4],
      time: '20:30',
      timezone: 'Europe/Berlin',
      action: 'start_streamer',
      target_id: 'alpha',
    });
    const disabled = scheduler.create({
      name: 'Deaktiviert',
      enabled: false,
      days: [4],
      time: '20:30',
      timezone: 'Europe/Berlin',
      action: 'stop',
    });

    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(() =>
      scheduler.create({
        name: 'Bad target',
        days: [1],
        time: '12:00',
        timezone: 'Europe/Berlin',
        action: 'start_screen',
        target_id: 'invalid',
      }),
    ).toThrow(/pause/);

    const matchTime = new Date('2026-01-15T19:30:10.000Z'); // Thu 20:30 Europe/Berlin
    expect(await scheduler.tick(matchTime)).toEqual([rule.id]);
    expect(await scheduler.tick(new Date('2026-01-15T19:30:40.000Z'))).toEqual([]);
    expect(executed).toHaveLength(1);
    expect(executed[0]?.id).toBe(rule.id);
    expect(disabled.next_run_at).toBeNull();

    shouldFail = true;
    const failed = await scheduler.runNow(rule.id);
    expect(failed.last_error).toContain('Streamer offline');
    expect(scheduler.get(rule.id)?.last_error).toContain('Streamer offline');

    const reloaded = new StreamScheduler({
      path: file,
      logger,
      executor: { execute: async () => undefined },
    });
    expect(reloaded.list()).toHaveLength(2);
    expect(reloaded.get(rule.id)?.last_run_key).toBe('2026-01-15T20:30');
  });
});

describe('Schedules API', () => {
  it('supports CRUD and manual execution via HTTP API', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-sched-api-'));
    tempDirs.push(dir);
    const config = loadConfig({
      cwd: dir,
      env: { API_TOKEN: 'api-secret', LOG_LEVEL: 'silent' },
    });
    const store = new StreamerStore(config.paths.streamersFile, { streamers: [], playlists: [] }, logger);
    const settingsService = new SettingsService(config.paths.settingsFile, DEFAULT_SETTINGS, logger);

    const ran: string[] = [];
    const scheduler = new StreamScheduler({
      path: join(dir, 'schedules.json'),
      logger,
      executor: {
        execute: async (rule) => {
          ran.push(`${rule.action}:${rule.target_id ?? ''}`);
        },
      },
    });

    const fakeStatus = {
      state: 'idle',
      active_streamer_id: null,
      active_streamer_name: null,
      active_playlist: null,
      active_scene_id: null,
      active_scene_name: null,
      manual_screen: null,
      started_at: null,
      uptime_seconds: 0,
      source: { online: null, resolving: false, connected: false, pid: null, last_data_at: null, bitrate_kbps: null, reconnects: 0 },
      relay: { ingest_clients: 0, output_connected: false, buffer_seconds: 0, excess_seconds: 0, catching_up: false, pacing_multiplier: 1, buffered_bytes: 0, dropped_bytes: 0, delay_seconds: 30, pacing_kbps: null, total_bytes: 0 },
      sink: { running: false, pid: null, bitrate_kbps: null, target_bitrate_kbps: 4000, fps: null, dropped_frames: 0, speed: null, last_progress_at: null, restarts: 0, dts_errors: 0, silence_active: false, silence_since: null, last_error: null },
      watchdog: { stall_timeout: 30, stall_count: 0, last_stall_at: null, last_error: null, reconnecting: false },
      auto_refresh: { enabled: true, interval_minutes: 20, next_refresh_in_seconds: null, last_refresh_at: null, count: 0 },
      chat: { enabled: false, engine: null, messages: 0, last_message_at: null, api_configured: false, canvas_active: false },
      media: null,
      version: VERSION,
    };

    const supervisor = { buildStatus: () => fakeStatus } as unknown as Supervisor;
    const app = await buildServer({
      config,
      logger,
      store,
      settingsService,
      supervisor,
      bus: new EventBus(),
      ring: new LogRing(),
      version: VERSION,
      authSessions: new AuthSessionStore(),
      scheduler,
    });
    await app.ready();

    try {
      const headers = { authorization: 'Bearer api-secret' };

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/schedules',
        headers,
        payload: {
          name: 'Pause Test',
          enabled: true,
          days: [1, 2, 3],
          time: '18:00',
          timezone: 'Europe/Berlin',
          action: 'start_screen',
          target_id: 'pause',
        },
      });
      expect(createRes.statusCode).toBe(201);
      const created = (createRes.json() as { schedule: { id: string } }).schedule;

      const listRes = await app.inject({ method: 'GET', url: '/api/schedules', headers });
      expect(listRes.statusCode).toBe(200);
      expect((listRes.json() as { schedules: unknown[] }).schedules).toHaveLength(1);

      const updRes = await app.inject({
        method: 'PUT',
        url: `/api/schedules/${created.id}`,
        headers,
        payload: { time: '18:30' },
      });
      expect(updRes.statusCode).toBe(200);
      expect((updRes.json() as { schedule: { time: string } }).schedule.time).toBe('18:30');

      const runRes = await app.inject({
        method: 'POST',
        url: `/api/schedules/${created.id}/run`,
        headers,
      });
      expect(runRes.statusCode).toBe(200);
      expect(ran).toEqual(['start_screen:pause']);

      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/schedules/${created.id}`,
        headers,
      });
      expect(delRes.statusCode).toBe(200);
      expect(scheduler.list()).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});
