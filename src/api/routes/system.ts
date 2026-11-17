import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../context.js';

const LogQuery = z.object({
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  q: z.string().max(200).optional(),
});

export async function registerSystemRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  app.get('/health', async () => ({
    status: 'ok',
    version: ctx.version,
    uptime_seconds: Math.round(process.uptime()),
    state: ctx.supervisor.buildStatus().state,
  }));

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

  app.post('/api/chat/test', async (request) => {
    const body = z
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
    status: await ctx.supervisor.pause(),
  }));

  app.post('/api/pause/stop', async () => ({
    ok: true,
    status: await ctx.supervisor.resume(),
  }));

  app.post('/api/system/restart-sink', async () => ({
    ok: true,
    status: await ctx.supervisor.restartSink(),
  }));

  app.post('/api/system/refresh', async () => ({
    ok: true,
    status: await ctx.supervisor.refreshNow(),
  }));
}
