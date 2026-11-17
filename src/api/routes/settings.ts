import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../context.js';

export async function registerSettingsRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  app.get('/api/settings', async () => ctx.settingsService.sanitized());

  app.put('/api/settings', async (request) => {
    const { previous, next } = ctx.settingsService.update(request.body);
    await ctx.supervisor.applySettings(next, previous);
    return ctx.settingsService.sanitized();
  });
}
