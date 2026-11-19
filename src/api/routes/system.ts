import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ServerResponse } from 'node:http';
import type { ApiContext } from '../context.js';
import {
  EarningsSettingsSchema,
  OverlaysSettingsSchema,
  VideoLayoutSchema,
  formatZodError,
} from '../../core/config/schema.js';
import { ValidationError } from '../../utils/errors.js';
import { join } from 'node:path';
import { renderPausePreview } from '../../core/overlays/pause-preview.js';
import { metricsSnapshot } from '../../core/metrics.js';

const LogQuery = z.object({
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  q: z.string().max(200).optional(),
});

const StudioPreviewBody = z.object({
  streamer_id: z.string().optional(),
  overlays: z.unknown(),
  earnings: EarningsSettingsSchema.partial().optional(),
  video_layout: VideoLayoutSchema.partial().optional(),
  video_aspect: z.enum(['9:16', '16:9', '1:1']).optional(),
  sample: z.boolean().optional(),
  max_dimension: z.coerce.number().int().min(120).max(1200).optional(),
});

const OverlaySaveBody = z.object({
  overlays: z.unknown(),
});

const EarningsPeriodBody = z.object({
  period: z.enum(['today', '24h', '7d', '30d', 'all']),
});

const EarningsHistoryQuery = z.object({
  period: z.enum(['today', '24h', '7d', '30d', 'all']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

const PausePreviewBody = z.object({
  screen: z.enum(['pause', 'startup']).optional(),
  text: z.string().max(200).optional(),
  subtext: z.string().max(200).optional(),
  color: z
    .string()
    .regex(/^(0x[0-9a-fA-F]{6}|#[0-9a-fA-F]{6})$/, 'Farbe muss 0xRRGGBB oder #RRGGBB sein')
    .optional(),
  background: z.string().max(500).optional(),
  font: z.string().max(500).optional(),
  text_color: z.string().max(64).optional(),
  fit: z.enum(['cover', 'contain', 'stretch']).optional(),
});

export async function registerSystemRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  app.get('/health', async () => {
    const status = ctx.supervisor.buildStatus();
    return {
      status: 'ok',
      version: ctx.version,
      uptime_seconds: Math.round(process.uptime()),
      state: status.state,
      source: {
        online: status.source.online,
        connected: status.source.connected,
        reconnects: status.source.reconnects,
        last_data_at: status.source.last_data_at,
      },
      relay: {
        ingest_clients: status.relay.ingest_clients,
        output_connected: status.relay.output_connected,
        buffered_bytes: status.relay.buffered_bytes,
        buffer_seconds: status.relay.buffer_seconds,
      },
      sink: {
        running: status.sink.running,
        bitrate_kbps: status.sink.bitrate_kbps,
        fps: status.sink.fps,
      },
      pause: {
        active: status.state === 'paused',
        manual_screen: status.manual_screen,
      },
    };
  });

  app.get('/api/metrics', async () => metricsSnapshot());

  app.get('/api/status', async () => ctx.supervisor.buildStatus());

  app.get('/api/logs', async (request) => {
    const query = LogQuery.parse(request.query);
    return { lines: ctx.ring.list(query) };
  });

  app.get('/api/overlays/preview.png', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const sample = query.sample === '1' || query.sample === 'true';
    const png = ctx.supervisor.overlayPreviewPng(sample);
    return reply
      .header('cache-control', 'no-store')
      .type('image/png')
      .send(png);
  });

  app.post('/api/pause/preview.png', async (request, reply) => {
    const parsed = PausePreviewBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw new ValidationError('Ungültige Vorschau-Parameter', parsed.error.issues);
    }
    const { screen, ...draft } = parsed.data;
    const png = await renderPausePreview({
      media: ctx.config.media,
      settings: ctx.settingsService.get(),
      overlaysDir: join(ctx.config.paths.dataDir, 'overlays'),
      logger: ctx.logger,
      screen: screen ?? 'pause',
      draft,
    });
    return reply.header('cache-control', 'no-store').type('image/png').send(png);
  });

  app.post('/api/overlays/studio.png', async (request, reply) => {
    const parsed = StudioPreviewBody.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(
        `Ungültige Overlay-Vorschau: ${formatZodError(parsed.error)}`,
        parsed.error.issues,
      );
    }
    const overlays = OverlaysSettingsSchema.safeParse(parsed.data.overlays);
    if (!overlays.success) {
      throw new ValidationError(
        `Ungültige Overlay-Einstellungen: ${formatZodError(overlays.error)}`,
        overlays.error.issues,
      );
    }
    const sample = parsed.data.sample ?? true;
    const png = ctx.supervisor.studioPreviewPng(
      overlays.data,
      sample,
      parsed.data.max_dimension ?? 720,
      sample ? undefined : ctx.supervisor.recentChatMessages(),
      parsed.data.earnings,
      parsed.data.video_layout,
      parsed.data.video_aspect,
    );
    return reply
      .header('cache-control', 'no-store')
      .type('image/png')
      .send(png);
  });

  app.put('/api/overlays', async (request) => {
    const parsed = OverlaySaveBody.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(
        `Ungültige Overlay-Einstellungen: ${formatZodError(parsed.error)}`,
        parsed.error.issues,
      );
    }
    const { previous, next } = ctx.settingsService.update({ overlays: parsed.data.overlays });
    await ctx.supervisor.applySettings(next, previous);
    return ctx.settingsService.sanitized();
  });

  app.get('/api/earnings', async () => ctx.supervisor.earningsStatus());

  app.get('/api/earnings/history', async (request) => {
    const query = EarningsHistoryQuery.parse(request.query);
    const period = query.period ?? ctx.settingsService.get().earnings.period;
    return {
      period,
      points: ctx.supervisor.earningsHistory(period, query.limit ?? 240),
    };
  });

  app.post('/api/earnings/period', async (request) => {
    const parsed = EarningsPeriodBody.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Ungültiger Einnahmen-Zeitraum', parsed.error.issues);
    }
    const { previous, next } = ctx.settingsService.update({
      earnings: { period: parsed.data.period },
    });
    await ctx.supervisor.applySettings(next, previous);
    return { ok: true, earnings: ctx.supervisor.earningsStatus() };
  });

  app.post('/api/earnings/refresh', async () => ({
    ok: true,
    earnings: await ctx.supervisor.refreshEarnings(),
  }));

  app.post('/api/chat/test', async (request) => {    const body = z
      .object({
        username: z.string().max(40).optional(),
        text: z.string().max(300).optional(),
      })
      .parse(request.body ?? {});
    const messages = ctx.supervisor.addTestChatMessage(
      body.username?.trim() || 'Testuser',
      body.text?.trim() || 'Testnachricht aus dem Dashboard',
    );
    return { ok: true, count: messages.length };
  });

  app.delete('/api/logs', async () => {
    ctx.ring.clear();
    return { ok: true };
  });

  // --- SSE fan-out hub ---------------------------------------------------------
  // A single subscription to the event bus serializes each event once and fans
  // it out to all connected dashboards. Events arriving within the same tick
  // are coalesced into a single write to reduce syscalls.
  const sseClients = new Set<ServerResponse>();
  let sseSub: { unsubscribe(): void } | null = null;
  let ssePending: string[] = [];
  let sseFlushQueued = false;

  function flushSse(): void {
    sseFlushQueued = false;
    if (ssePending.length === 0) return;
    const frames = ssePending;
    ssePending = [];
    const chunk = frames.join('');
    for (const res of sseClients) res.write(chunk);
  }

  function ensureSseSubscription(): void {
    if (sseSub) return;
    sseSub = ctx.bus.observe().subscribe((event) => {
      if (sseClients.size === 0) return;
      ssePending.push(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
      if (!sseFlushQueued) {
        sseFlushQueued = true;
        setImmediate(flushSse);
      }
    });
  }

  function stopSseSubscriptionIfIdle(): void {
    if (sseClients.size > 0 || !sseSub) return;
    sseSub.unsubscribe();
    sseSub = null;
  }

  app.get('/api/events', async (request, reply) => {
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    request.socket.setNoDelay(true);
    response.setTimeout(0);

    // Initial snapshot is per-connection; ongoing events are fanned out from a
    // single shared subscription (see ensureSseSubscription below).
    const send = (event: string, data: unknown) => {
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send('status', ctx.supervisor.buildStatus());
    send('streamers', ctx.supervisor.streamersView());
    send('earnings', ctx.supervisor.earningsStatus());

    sseClients.add(response);
    ensureSseSubscription();

    const heartbeat = setInterval(() => {
      response.write(': ping\n\n');
    }, 15_000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(response);
      stopSseSubscriptionIfIdle();
      response.end();
    });
  });

  app.post('/api/pause/start', async () => ({
    ok: true,
    status: await ctx.supervisor.showScreen('pause'),
  }));

  app.post('/api/pause/stop', async () => ({
    ok: true,
    status: await ctx.supervisor.hideScreen(),
  }));

  app.post('/api/screens/:type/start', async (request) => {
    const { type } = request.params as { type: string };
    if (type !== 'startup' && type !== 'pause') {
      throw new ValidationError('Ungültiger Screen-Typ');
    }
    return { ok: true, status: await ctx.supervisor.showScreen(type) };
  });

  app.post('/api/screens/stop', async () => ({
    ok: true,
    status: await ctx.supervisor.hideScreen(),
  }));

  app.post('/api/system/restart-sink', async () => ({
    ok: true,
    status: await ctx.supervisor.restartSink(),
  }));

  app.post('/api/system/refresh', async () => ({
    ok: true,
    status: await ctx.supervisor.refreshNow(),
  }));

  app.post('/api/reload', async () => {
    const changed = ctx.store.reloadIfChanged();
    if (changed) ctx.supervisor.notifyStreamersChanged();
    return { ok: true, changed };
  });

  app.post('/api/online/check', async () => {
    await ctx.supervisor.checkOnlineNow();
    return { ok: true };
  });
}
