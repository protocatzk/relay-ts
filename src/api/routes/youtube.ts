import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../context.js';
import { AppError } from '../../utils/errors.js';

const CallbackQuery = z.object({
  code: z.string().max(2048).optional(),
  state: z.string().max(512).optional(),
  error: z.string().max(120).optional(),
});

/**
 * YouTube OAuth foundation (#18). The callback is the only public endpoint:
 * Google redirects the browser there without a dashboard session, so it is
 * protected by the single-use OAuth state and PKCE instead of the cookie.
 */
export async function registerYouTubeRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  const service = ctx.youtubeAuth;
  if (!service) return;

  app.get('/api/youtube/status', async () => service.status());

  app.get('/api/youtube/broadcasts', async () => service.broadcasts());

  app.get(
    '/api/youtube/oauth/start',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async () => service.begin(),
  );

  app.get(
    '/api/youtube/oauth/callback',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = CallbackQuery.safeParse(request.query ?? {});
      if (!parsed.success) {
        throw new AppError('youtube_invalid_callback', 'Ungültige OAuth-Antwort', 400);
      }
      const result = await service.complete(parsed.data);
      const target = result.ok
        ? '/#/youtube?connected=1'
        : `/#/youtube?error=${encodeURIComponent(result.reason)}`;
      return reply.code(302).header('location', target).header('cache-control', 'no-store').send();
    },
  );

  app.post('/api/youtube/oauth/disconnect', async () => {
    await service.disconnect();
    return service.status();
  });
}
