import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../context.js';
import { AppError, ValidationError } from '../../utils/errors.js';
import { resolveStreamKey } from '../../core/config/schema.js';
import { resolveRelayIngestKey } from '../../core/youtube/ingest.js';

const CallbackQuery = z.object({
  code: z.string().max(2048).optional(),
  state: z.string().max(512).optional(),
  error: z.string().max(120).optional(),
});

const IdParams = z.object({ id: z.string().min(1).max(64) });

const CreateBroadcastBody = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().max(5000).optional(),
  scheduled_start: z.string().min(1).max(64),
  privacy: z.enum(['public', 'unlisted', 'private']).optional(),
  enable_dvr: z.boolean().optional(),
  enable_auto_start: z.boolean().optional(),
  enable_auto_stop: z.boolean().optional(),
  streamer_id: z.string().min(1).max(64).optional(),
});

const UpdateBroadcastBody = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(5000).optional(),
  scheduled_start: z.string().min(1).max(64).optional(),
  privacy: z.enum(['public', 'unlisted', 'private']).optional(),
});

const TransitionBody = z.object({
  status: z.enum(['testing', 'live', 'complete']),
});

const AssignBody = z.object({
  streamer_id: z.string().min(1).max(64),
});

function streamerKey(ctx: ApiContext, id: string): string {
  const streamer = ctx.store.require(id);
  const { key } = resolveStreamKey(streamer);
  if (!key) {
    throw new ValidationError(`Für Streamer "${id}" ist kein YouTube-Key hinterlegt`);
  }
  return key;
}

/**
 * Broadcasts created through RELAY must use the ingest RELAY is actually
 * streaming to. Prefer the active streamer, then the preferred one, then the
 * first enabled streamer with a key. Only fall back to YOUTUBE_STREAM_KEY.
 */
function relayIngestKey(ctx: ApiContext): string {
  return resolveRelayIngestKey(
    ctx.store,
    ctx.supervisor.buildStatus?.().active_streamer_id ?? null,
  );
}

/**
 * YouTube OAuth and broadcast management (#18). The callback is the only
 * public endpoint: Google redirects the browser there without a dashboard
 * session, so it is protected by the single-use OAuth state and PKCE instead
 * of the cookie.
 */
export async function registerYouTubeRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  const service = ctx.youtubeAuth;
  if (!service) return;

  const writeLimit = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

  app.get('/api/youtube/status', async () => service.status());

  app.get('/api/youtube/broadcasts', async () => service.broadcasts());

  app.post('/api/youtube/broadcasts', writeLimit, async (request) => {
    const body = CreateBroadcastBody.parse(request.body);
    const key = body.streamer_id ? streamerKey(ctx, body.streamer_id) : relayIngestKey(ctx);
    return service.createBroadcast(
      {
        title: body.title,
        description: body.description,
        scheduled_start: body.scheduled_start,
        privacy: body.privacy,
        enable_dvr: body.enable_dvr,
        enable_auto_start: body.enable_auto_start,
        enable_auto_stop: body.enable_auto_stop,
      },
      key,
    );
  });

  app.put('/api/youtube/broadcasts/:id', writeLimit, async (request) => {
    const { id } = IdParams.parse(request.params);
    const patch = UpdateBroadcastBody.parse(request.body);
    return service.updateBroadcastById(id, patch);
  });

  app.post('/api/youtube/broadcasts/:id/publish', writeLimit, async (request) => {
    const { id } = IdParams.parse(request.params);
    return service.publishBroadcast(id);
  });

  app.post('/api/youtube/broadcasts/:id/transition', writeLimit, async (request) => {
    const { id } = IdParams.parse(request.params);
    const { status } = TransitionBody.parse(request.body);
    return service.transitionBroadcastById(id, status);
  });

  app.post('/api/youtube/broadcasts/:id/assign', writeLimit, async (request) => {
    const { id } = IdParams.parse(request.params);
    const { streamer_id } = AssignBody.parse(request.body);
    return service.assignBroadcast(id, streamerKey(ctx, streamer_id));
  });

  app.delete('/api/youtube/broadcasts/:id', writeLimit, async (request) => {
    const { id } = IdParams.parse(request.params);
    await service.deleteBroadcastById(id);
    return { ok: true };
  });

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
