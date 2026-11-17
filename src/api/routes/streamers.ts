import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiContext } from '../context.js';
import { normalizeHandle } from '../../utils/format.js';
import { ValidationError } from '../../utils/errors.js';

const StartBody = z.object({}).passthrough();

const QuickStartBody = z.object({
  tiktok: z.string().min(1),
  youtube_key: z.string().min(1),
  name: z.string().optional(),
  quality: z.enum(['best', '1080p', '720p', '480p', '360p']).optional(),
});

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/^@+/, '')
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'streamer'
  );
}

function viewById(ctx: ApiContext, id: string) {
  return ctx.supervisor.streamersView().find((streamer) => streamer.id === id);
}

export async function registerStreamerRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  app.get('/api/streamers', async () => ({ streamers: ctx.supervisor.streamersView() }));

  app.get('/api/streamers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const view = viewById(ctx, id);
    if (!view) {
      return reply.code(404).send({
        error: { code: 'not_found', message: `Streamer "${id}" wurde nicht gefunden` },
      });
    }
    return { streamer: view };
  });

  app.post('/api/streamers', async (request, reply) => {
    const streamer = ctx.store.create(request.body);
    ctx.supervisor.notifyStreamersChanged();
    const view = viewById(ctx, streamer.id);
    return reply.code(201).send({ streamer: view });
  });

  app.put('/api/streamers/:id', async (request) => {
    const { id } = request.params as { id: string };
    const streamer = ctx.store.update(id, request.body);
    ctx.supervisor.notifyStreamersChanged();
    return { streamer: viewById(ctx, streamer.id) };
  });

  app.delete('/api/streamers/:id', async (request) => {
    const { id } = request.params as { id: string };
    if (ctx.supervisor.buildStatus().active_streamer_id === id) {
      await ctx.supervisor.stop();
    }
    ctx.store.remove(id);
    ctx.supervisor.notifyStreamersChanged();
    return { ok: true };
  });

  app.post('/api/streamers/:id/start', async (request) => {
    const { id } = request.params as { id: string };
    StartBody.parse(request.body ?? {});
    return { ok: true, status: await ctx.supervisor.start(id) };
  });

  app.post('/api/streamers/:id/stop', async () => {
    return { ok: true, status: await ctx.supervisor.stop() };
  });

  app.post('/api/streamers/:id/switch', async (request) => {
    const { id } = request.params as { id: string };
    return { ok: true, status: await ctx.supervisor.switchTo(id) };
  });

  app.post('/api/quickstart', async (request, reply) => {
    const parsed = QuickStartBody.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Ungültige Schnellstart-Daten', parsed.error.issues);
    }
    const handle = normalizeHandle(parsed.data.tiktok);
    let id = slugify(handle);
    let suffix = 1;
    while (ctx.store.get(id)) {
      suffix += 1;
      id = `${slugify(handle)}-${suffix}`;
    }
    const streamer = ctx.store.create({
      id,
      name: parsed.data.name?.trim() || handle,
      tiktok: parsed.data.tiktok.trim(),
      youtube_key: parsed.data.youtube_key,
      quality: parsed.data.quality ?? 'best',
      enabled: true,
    });
    ctx.supervisor.notifyStreamersChanged();
    try {
      const status = await ctx.supervisor.start(streamer.id);
      return reply.code(201).send({ streamer: viewById(ctx, streamer.id), status });
    } catch (error) {
      // Keep the newly created streamer so the user can retry after fixing the
      // problem (offline handle, expired cookie, ...).
      ctx.supervisor.notifyStreamersChanged();
      throw error;
    }
  });
}
