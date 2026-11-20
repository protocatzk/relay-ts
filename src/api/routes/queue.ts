import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiContext } from '../context.js';

const ChannelBody = z.object({
  channel: z.string().min(1).max(300),
});

const MoveBody = z.object({
  id: z.string().min(1).max(100),
  to: z.coerce.number().int().min(0).max(500),
});

const PlayBody = z.object({
  index: z.coerce.number().int().min(0).max(1000).optional(),
});

const SeekBody = z.object({
  seconds: z.coerce.number().min(0).max(86_400),
});

const LoopBody = z.object({
  loop: z.boolean(),
});

const UpdateEntryBody = z.object({
  duration_seconds: z.union([z.coerce.number().min(1).max(86_400), z.null()]).optional(),
});

/** Live-editable "Regie" queue of videos, streamers and screens. */
export async function registerQueueRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  app.get('/api/queue', async () => ctx.supervisor.buildQueueSnapshot());

  app.post('/api/queue/entries', async (request, reply) => {
    const body = ChannelBody.parse(request.body ?? {});
    const queue = await ctx.supervisor.queueAdd(body.channel);
    return reply.code(201).send({ queue });
  });

  app.delete('/api/queue/entries/:id', async (request) => {
    const { id } = request.params as { id: string };
    return { queue: await ctx.supervisor.queueRemove(id) };
  });

  app.put('/api/queue/entries/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = UpdateEntryBody.parse(request.body ?? {});
    return { queue: await ctx.supervisor.queueUpdateEntry(id, body) };
  });

  app.post('/api/queue/entries/:id/duplicate', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.code(201).send({ queue: await ctx.supervisor.queueDuplicate(id) });
  });

  app.put('/api/queue/loop', async (request) => {
    const body = LoopBody.parse(request.body ?? {});
    return { queue: await ctx.supervisor.queueSetLoop(body.loop) };
  });

  app.post('/api/queue/move', async (request) => {
    const body = MoveBody.parse(request.body ?? {});
    return { queue: await ctx.supervisor.queueMove(body.id, body.to) };
  });

  app.delete('/api/queue', async () => ({ queue: await ctx.supervisor.queueClear() }));

  app.post('/api/queue/play', async (request) => {
    const body = PlayBody.parse(request.body ?? {});
    return {
      ok: true,
      status: await ctx.supervisor.queuePlay(body.index ?? 0),
      queue: ctx.supervisor.buildQueueSnapshot(),
    };
  });

  app.post('/api/queue/next', async () => ({
    ok: true,
    status: await ctx.supervisor.queueNext(),
    queue: ctx.supervisor.buildQueueSnapshot(),
  }));

  app.post('/api/queue/stop', async () => ({
    ok: true,
    status: await ctx.supervisor.queueStop(),
    queue: ctx.supervisor.buildQueueSnapshot(),
  }));

  app.post('/api/queue/now', async (request) => {
    const body = ChannelBody.parse(request.body ?? {});
    return {
      ok: true,
      status: await ctx.supervisor.queuePlayNow(body.channel),
      queue: ctx.supervisor.buildQueueSnapshot(),
    };
  });

  app.post('/api/queue/seek', async (request) => {
    const body = SeekBody.parse(request.body ?? {});
    return {
      ok: true,
      status: await ctx.supervisor.seekActiveVideo(body.seconds),
      queue: ctx.supervisor.buildQueueSnapshot(),
    };
  });
}
