import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthSessionStore } from '../src/api/session-store.js';
import { buildServer } from '../src/api/server.js';
import { loadConfig } from '../src/core/config/loader.js';
import { DEFAULT_SETTINGS, type WebhooksSettings } from '../src/core/config/schema.js';
import { EventBus, type StatusSnapshot } from '../src/core/events.js';
import { LogRing } from '../src/utils/logger.js';
import { formatPrometheusMetrics, incMetric, metricsSnapshot, resetMetrics } from '../src/core/metrics.js';
import { buildWebhookPayload, WebhookDispatcher } from '../src/core/notifications/webhooks.js';
import { SettingsService } from '../src/core/store/settings-service.js';
import { StreamerStore } from '../src/core/store/streamer-store.js';
import type { Supervisor } from '../src/core/supervisor/supervisor.js';
import { VERSION } from '../src/version.js';

const logger = pino({ level: 'silent' });
const tempDirs: string[] = [];

afterEach(() => {
  resetMetrics();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeStatus(): StatusSnapshot {
  return {
    state: 'live',
    active_streamer_id: 'alpha',
    active_streamer_name: 'Alpha',
    active_playlist: null,
    active_scene_id: 'gaming',
    active_scene_name: 'Gaming',
    manual_screen: null,
    started_at: '2026-11-21T10:00:00.000Z',
    uptime_seconds: 120,
    source: {
      online: true,
      resolving: false,
      connected: true,
      pid: 42,
      last_data_at: '2026-11-21T10:02:00.000Z',
      bitrate_kbps: 2200,
      reconnects: 2,
    },
    relay: {
      ingest_clients: 1,
      output_connected: true,
      buffer_seconds: 20.5,
      excess_seconds: 0.5,
      catching_up: true,
      pacing_multiplier: 1.01,
      buffered_bytes: 1024,
      dropped_bytes: 0,
      delay_seconds: 20,
      pacing_kbps: 2500,
      total_bytes: 4096,
    },
    sink: {
      running: true,
      pid: 99,
      bitrate_kbps: 3900,
      target_bitrate_kbps: 4000,
      fps: 30,
      dropped_frames: 1,
      speed: '1.0x',
      last_progress_at: '2026-11-21T10:02:00.000Z',
      restarts: 1,
      dts_errors: 0,
      silence_active: true,
      silence_since: '2026-11-21T10:01:45.000Z',
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
      next_refresh_in_seconds: 600,
      last_refresh_at: null,
      count: 0,
    },
    chat: {
      enabled: true,
      engine: 'canvas',
      messages: 5,
      last_message_at: null,
      api_configured: false,
      canvas_active: true,
      viewers: null,
    },
    media: null,
    version: VERSION,
  };
}

describe('Prometheus metrics formatter', () => {
  it('renders counters and live status gauges in Prometheus exposition format', () => {
    incMetric('sink_silence_events_total', 3);
    incMetric('webhook_errors_total', 1);
    const text = formatPrometheusMetrics(metricsSnapshot(), makeStatus(), 4);

    expect(text).toContain('# TYPE relay_sink_silence_events_total counter');
    expect(text).toContain('relay_sink_silence_events_total 3');
    expect(text).toContain('relay_webhook_errors_total 1');
    expect(text).toContain('relay_stream_state{state="live"} 1');
    expect(text).toContain('relay_sink_running 1');
    expect(text).toContain('relay_sink_silence_active 1');
    expect(text).toContain('relay_sink_bitrate_kbps 3900');
    expect(text).toContain('relay_buffer_seconds 20.5');
    expect(text).toContain('relay_queue_entries 4');
    expect(text).toContain('relay_buffer_catching_up 1');
    expect(text).toContain('relay_buffer_pacing_multiplier 1.01');
  });
});

describe('WebhookDispatcher', () => {
  it('builds generic, discord, and slack payloads', () => {
    const discord = buildWebhookPayload(
      'discord',
      'stream_error',
      'Fehler',
      'Stream abgebrochen',
      '2026-11-21T10:00:00.000Z',
      VERSION,
      { streamer: 'alpha' },
    );
    expect(discord.username).toBe('RELAY');
    expect(Array.isArray(discord.embeds)).toBe(true);

    const slack = buildWebhookPayload(
      'slack',
      'pause_limit',
      'Pause',
      'Limit erreicht',
      '2026-11-21T10:00:00.000Z',
      VERSION,
      { minutes: 15 },
    );
    expect(String(slack.text)).toContain('[RELAY] *Pause*');

    const generic = buildWebhookPayload(
      'generic',
      'audio_silence',
      'Stille',
      'Kein Ton',
      '2026-11-21T10:00:00.000Z',
      VERSION,
    );
    expect(generic).toMatchObject({ event: 'audio_silence', title: 'Stille', version: VERSION });
  });

  it('signs requests with HMAC SHA-256, respects cooldown, and isolates failures', async () => {
    let nowMs = 1_700_000_000_000;
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    let shouldFail = false;

    const settings: WebhooksSettings = {
      enabled: true,
      url: 'https://hooks.example.test/webhook',
      format: 'generic',
      secret: 'hmac-secret',
      events: ['stream_error', 'audio_silence'],
      cooldown_seconds: 60,
    };

    const dispatcher = new WebhookDispatcher({
      getSettings: () => settings,
      logger,
      now: () => nowMs,
      fetcher: vi.fn(async (input: string | URL, init?: RequestInit) => {
        if (shouldFail) {
          return new Response('err', { status: 500 });
        }
        calls.push({
          url: String(input),
          headers: (init?.headers ?? {}) as Record<string, string>,
          body: String(init?.body ?? ''),
        });
        return new Response(null, { status: 204 });
      }) as unknown as typeof fetch,
    });

    dispatcher.notify('stream_error', 'Abbruch', 'Test 1', { streamer: 'alpha' });
    // Second call within 60s cooldown should be suppressed
    nowMs += 10_000;
    dispatcher.notify('stream_error', 'Abbruch', 'Test 2');
    // Unsubscribed event should not fire
    dispatcher.notify('disk_warning', 'Disk', 'Full');
    await new Promise((r) => setTimeout(r, 15));

    expect(calls).toHaveLength(1);
    const sig = createHmac('sha256', 'hmac-secret').update(calls[0]!.body).digest('hex');
    expect(calls[0]!.headers['x-relay-signature']).toBe(`sha256=${sig}`);

    // Failure increments metric without throwing from notify()
    nowMs += 70_000;
    shouldFail = true;
    dispatcher.notify('audio_silence', 'Stille', 'Kein Ton');
    await new Promise((r) => setTimeout(r, 15));
    expect(metricsSnapshot().counters.webhook_errors_total).toBe(1);

    await expect(dispatcher.sendTest()).rejects.toThrow(/HTTP 500/);
  });
});

describe('Settings masking & API routes for Prometheus / Webhooks', () => {
  it('masks webhook URL & secret in sanitized settings and serves metrics + webhook test route', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-prom-api-'));
    tempDirs.push(dir);
    const config = loadConfig({
      cwd: dir,
      env: { API_TOKEN: 'api-secret', LOG_LEVEL: 'silent' },
    });
    const store = new StreamerStore(config.paths.streamersFile, { streamers: [], playlists: [] }, logger);
    const settingsService = new SettingsService(config.paths.settingsFile, DEFAULT_SETTINGS, logger);

    settingsService.update({
      webhooks: {
        enabled: true,
        url: 'https://hooks.example.test/secret-path',
        secret: 'signing-secret',
        format: 'discord',
      },
    });

    const sanitized = settingsService.sanitized();
    expect(sanitized.webhooks).toMatchObject({
      enabled: true,
      url_set: true,
      url_host: 'hooks.example.test',
      secret_set: true,
      format: 'discord',
    });
    expect(JSON.stringify(sanitized)).not.toContain('secret-path');
    expect(JSON.stringify(sanitized)).not.toContain('signing-secret');

    // Omitting secrets keeps stored values
    settingsService.update({ webhooks: { enabled: false } });
    expect(settingsService.get().webhooks.url).toBe('https://hooks.example.test/secret-path');
    expect(settingsService.get().webhooks.secret).toBe('signing-secret');

    const webhook = new WebhookDispatcher({
      getSettings: () => settingsService.get().webhooks,
      logger,
      fetcher: vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
    });

    const supervisor = {
      buildStatus: () => makeStatus(),
      buildQueueSnapshot: () => ({ entries: [], active_index: null, active_entry_id: null, playing: false }),
    } as unknown as Supervisor;

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
      webhooks: webhook,
    });
    await app.ready();

    try {
      const headers = { authorization: 'Bearer api-secret' };

      const promQuery = await app.inject({
        method: 'GET',
        url: '/api/metrics?format=prometheus',
        headers,
      });
      expect(promQuery.statusCode).toBe(200);
      expect(promQuery.headers['content-type']).toContain('text/plain');
      expect(promQuery.body).toContain('relay_sink_silence_active 1');

      const promAccept = await app.inject({
        method: 'GET',
        url: '/api/metrics',
        headers: { ...headers, accept: 'text/plain; version=0.0.4' },
      });
      expect(promAccept.statusCode).toBe(200);
      expect(promAccept.body).toContain('relay_sink_bitrate_kbps 3900');

      const testWebhook = await app.inject({
        method: 'POST',
        url: '/api/webhooks/test',
        headers,
      });
      expect(testWebhook.statusCode).toBe(200);
      expect(testWebhook.json()).toEqual({ ok: true, status: 204 });
    } finally {
      await app.close();
    }
  });
});
