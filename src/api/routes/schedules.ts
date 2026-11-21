import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../context.js';
import { AppError } from '../../utils/errors.js';

export async function registerScheduleRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  const requireScheduler = () => {
    if (!ctx.scheduler) {
      throw new AppError('scheduler_unavailable', 'Zeitplan-Scheduler nicht verfügbar', 503);
    }
    return ctx.scheduler;
  };

  app.get('/api/schedules', async () => {
    const scheduler = requireScheduler();
    return { schedules: scheduler.list() };
  });

  app.post('/api/schedules', async (request, reply) => {
    const scheduler = requireScheduler();
    const schedule = scheduler.create(request.body);
    return reply.code(201).send({ schedule });
  });

  app.put('/api/schedules/:id', async (request) => {
    const scheduler = requireScheduler();
    const { id } = request.params as { id: string };
    const schedule = scheduler.update(id, request.body);
    return { schedule };
  });

  app.delete('/api/schedules/:id', async (request) => {
    const scheduler = requireScheduler();
    const { id } = request.params as { id: string };
    scheduler.remove(id);
    return { ok: true };
  });

  app.post('/api/schedules/:id/run', async (request) => {
    const scheduler = requireScheduler();
    const { id } = request.params as { id: string };
    const schedule = await scheduler.runNow(id);
    return {
      ok: true,
      schedule,
      status: ctx.supervisor.buildStatus(),
    };
  });
}
