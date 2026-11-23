import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../context.js';

export async function registerSettingsRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  app.get('/api/settings', async () => ctx.settingsService.sanitized());

  // Dedicated reveal endpoint for the RTMP ingest key: GET /api/settings
  // returns `stream_key_set` only, so dashboards fetch the plaintext here
  // (e.g. for the OBS copy button).
  app.get('/api/settings/rtmp-ingest/stream-key', async () => ({
    stream_key: ctx.settingsService.get().rtmp_ingest.stream_key,
  }));

  app.put('/api/settings', async (request) => {
    const { previous, next } = ctx.settingsService.update(request.body);
    await ctx.supervisor.applySettings(next, previous);
    return ctx.settingsService.sanitized();
  });
}
