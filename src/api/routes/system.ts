import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../context.js';
import { StreamerSchema, formatZodError, type StreamerConfig } from '../../core/config/schema.js';
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
  sample: z.boolean().optional(),
  max_dimension: z.coerce.number().int().min(120).max(1200).optional(),
});

const OverlaySaveBody = z.object({
  overlays: z.unknown(),
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
    const base =
      (parsed.data.streamer_id ? ctx.store.get(parsed.data.streamer_id) : undefined) ??
      ctx.store.list().find((streamer) => streamer.enabled) ??
      ctx.store.list()[0] ??
      StreamerSchema.parse({
        id: 'preview',
        name: 'Preview',
        tiktok: 'preview',
      });
    let streamer: StreamerConfig;
    try {
      streamer = StreamerSchema.parse({ ...base, overlays: parsed.data.overlays });
    } catch (error) {
      throw new ValidationError(
        `Ungültige Overlay-Einstellungen: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const png = ctx.supervisor.studioPreviewPng(
      streamer,
      parsed.data.sample ?? true,
      parsed.data.max_dimension ?? 720,
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

    const send = (event: string, data: unknown) => {
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send('status', ctx.supervisor.buildStatus());
    send('streamers', ctx.supervisor.streamersView());

    const subscription = ctx.bus.observe().subscribe((event) => {
      send(event.type, event.data);
    });
    const heartbeat = setInterval(() => {
      response.write(': ping\n\n');
    }, 15_000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      subscription.unsubscribe();
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
