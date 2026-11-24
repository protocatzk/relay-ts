import { PassThrough, Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ApiContext } from '../context.js';
import { formatZodError } from '../../core/config/schema.js';
import { isAllowedTikTokStreamUrl } from '../../core/source/discovery/live-page-provider.js';
import { ValidationError, NotFoundError } from '../../utils/errors.js';

const TrendingQuerySchema = z.object({
  region: z.string().max(10).optional(),
  language: z.string().max(10).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  page: z.coerce.number().int().min(0).max(50).optional(),
});

const SearchQuerySchema = z.object({
  q: z.string().max(200).optional().default(''),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  region: z.string().max(10).optional(),
  page: z.coerce.number().int().min(0).max(50).optional(),
});

const FollowingQuerySchema = z.object({
  account_id: z.string().max(64).optional(),
  session_id: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  page: z.coerce.number().int().min(0).max(50).optional(),
});

const AddAccountBodySchema = z.object({
  label: z.string().min(1).max(100),
  sessionId: z.string().min(1).max(500),
  targetIdc: z.string().max(50).optional(),
  username: z.string().max(100).optional(),
});

const RoomParamsSchema = z.object({
  handle: z.string().min(1).max(100),
});

const SuggestQuerySchema = z.object({
  q: z.string().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(20).optional(),
  region: z.string().max(10).optional(),
});

const StatusQuerySchema = z.object({
  /** Comma separated handles, at most 20 (enforced in the service as well). */
  handles: z.string().min(1).max(1200),
});

const PreviewQuerySchema = z.object({
  /** 1 = return 204 instead of 404 when the room is offline (#92). */
  fallback: z
    .union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')])
    .optional(),
});

const AddBodySchema = z.object({
  handle: z.string().min(1).max(100),
  name: z.string().max(120).optional(),
});

const QueueBodySchema = z.object({
  handle: z.string().min(1).max(100),
  mode: z.enum(['now', 'next', 'end']).optional().default('now'),
});

const SwitchBodySchema = z.object({
  handle: z.string().min(1).max(100),
});

const RATE_LIMIT_CONFIG = {
  max: 20,
  timeWindow: '1 minute',
};

export async function registerDiscoveryRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  const getDiscovery = () => {
    if (!ctx.discovery) {
      throw new NotFoundError('Discovery-Service ist nicht initialisiert');
    }
    return ctx.discovery;
  };

  app.get(
    '/api/discovery/trending',
    { config: { rateLimit: RATE_LIMIT_CONFIG } },
    async (request: FastifyRequest) => {
      const parsed = TrendingQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(`Ungültige Query-Parameter: ${formatZodError(parsed.error)}`, parsed.error.issues);
      }
      return getDiscovery().trending(parsed.data);
    },
  );

  app.get(
    '/api/discovery/search',
    { config: { rateLimit: RATE_LIMIT_CONFIG } },
    async (request: FastifyRequest) => {
      const parsed = SearchQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(`Ungültige Suchparameter: ${formatZodError(parsed.error)}`, parsed.error.issues);
      }
      return getDiscovery().search(parsed.data.q, {
        limit: parsed.data.limit,
        region: parsed.data.region,
        page: parsed.data.page,
      });
    },
  );

  app.get(
    '/api/discovery/suggest',
    { config: { rateLimit: RATE_LIMIT_CONFIG } },
    async (request: FastifyRequest) => {
      const parsed = SuggestQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(
          `Ungültige Suchparameter: ${formatZodError(parsed.error)}`,
          parsed.error.issues,
        );
      }
      return getDiscovery().suggest(parsed.data.q, {
        limit: parsed.data.limit,
        region: parsed.data.region,
      });
    },
  );

  app.get(
    '/api/discovery/status',
    { config: { rateLimit: RATE_LIMIT_CONFIG } },
    async (request: FastifyRequest) => {
      const parsed = StatusQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(
          `Ungültige Handle-Liste: ${formatZodError(parsed.error)}`,
          parsed.error.issues,
        );
      }
      const handles = parsed.data.handles
        .split(',')
        .map((handle) => handle.trim())
        .filter(Boolean);
      if (handles.length === 0) {
        throw new ValidationError('Mindestens ein Handle angeben');
      }
      return getDiscovery().statusForHandles(handles);
    },
  );

  app.get(
    '/api/discovery/preview/:handle',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = RoomParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        throw new ValidationError(`Ungültiger Handle-Parameter: ${formatZodError(parsed.error)}`, parsed.error.issues);
      }
      const query = PreviewQuerySchema.safeParse(request.query);
      const wantsFallback =
        query.success && (query.data.fallback === '1' || query.data.fallback === 'true');

      const flvUrl = await getDiscovery().resolvePreviewStreamUrl(parsed.data.handle);
      if (!flvUrl || !isAllowedTikTokStreamUrl(flvUrl)) {
        if (wantsFallback) {
          // The zapper keeps zapping instead of rendering an error state (#92).
          return reply.code(204).send();
        }
        throw new NotFoundError(`Kein aktiver Live-Stream für „${parsed.data.handle}“ verfügbar`);
      }

      const ac = new AbortController();
      const upstream = await fetch(flvUrl, {
        headers: {
          'user-agent':
            ctx.config.media.sourceUserAgent ||
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          referer: 'https://www.tiktok.com/',
          accept: '*/*',
        },
        signal: ac.signal,
      }).catch(() => null);

      if (!upstream || !upstream.ok || !upstream.body) {
        ac.abort();
        throw new NotFoundError(`Live-Vorschau für „${parsed.data.handle}“ konnte nicht geöffnet werden`);
      }

      const pass = new PassThrough({ highWaterMark: 512 * 1024 });
      const nodeStream = Readable.fromWeb(upstream.body as unknown as WebReadableStream);
      let closed = false;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        ac.abort();
        nodeStream.destroy();
        pass.end();
      };

      request.raw.once('close', cleanup);
      nodeStream.once('error', cleanup);
      pass.once('error', cleanup);
      nodeStream.pipe(pass);

      reply
        .header('content-type', 'video/x-flv')
        .header('cache-control', 'no-store')
        .header('x-accel-buffering', 'no')
        .header('connection', 'keep-alive');
      return reply.send(pass);
    },
  );

  app.get(
    '/api/discovery/following',
    { config: { rateLimit: RATE_LIMIT_CONFIG } },
    async (request: FastifyRequest) => {
      const parsed = FollowingQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(`Ungültige Query-Parameter: ${formatZodError(parsed.error)}`, parsed.error.issues);
      }
      return getDiscovery().following(parsed.data);
    },
  );

  app.get(
    '/api/discovery/accounts',
    async () => {
      return {
        accounts: ctx.tiktokAccounts ? ctx.tiktokAccounts.list() : [],
        active: ctx.tiktokAccounts ? ctx.tiktokAccounts.getActive() : null,
      };
    },
  );

  app.post(
    '/api/discovery/accounts',
    async (request: FastifyRequest) => {
      if (!ctx.tiktokAccounts) throw new NotFoundError('TikTok-Account-Store nicht verfügbar');
      const parsed = AddAccountBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(`Ungültige Account-Daten: ${formatZodError(parsed.error)}`, parsed.error.issues);
      }
      const account = ctx.tiktokAccounts.create(parsed.data);
      getDiscovery().clearCaches();
      return { ok: true, account };
    },
  );

  app.post(
    '/api/discovery/accounts/:id/activate',
    async (request: FastifyRequest) => {
      if (!ctx.tiktokAccounts) throw new NotFoundError('TikTok-Account-Store nicht verfügbar');
      const { id } = request.params as { id: string };
      const account = ctx.tiktokAccounts.activate(id);
      getDiscovery().clearCaches();
      return { ok: true, account };
    },
  );

  app.delete(
    '/api/discovery/accounts/:id',
    async (request: FastifyRequest) => {
      if (!ctx.tiktokAccounts) throw new NotFoundError('TikTok-Account-Store nicht verfügbar');
      const { id } = request.params as { id: string };
      ctx.tiktokAccounts.remove(id);
      getDiscovery().clearCaches();
      return { ok: true };
    },
  );

  app.get(
    '/api/discovery/room/:handle',
    { config: { rateLimit: RATE_LIMIT_CONFIG } },
    async (request: FastifyRequest) => {
      const parsed = RoomParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        throw new ValidationError(`Ungültiger Handle-Parameter: ${formatZodError(parsed.error)}`, parsed.error.issues);
      }
      const hit = await getDiscovery().roomInfo(parsed.data.handle);
      return {
        hit,
        providers: getDiscovery().providerStatuses(),
      };
    },
  );

  app.post(
    '/api/discovery/add',
    { config: { rateLimit: RATE_LIMIT_CONFIG } },
    async (request: FastifyRequest) => {
      const parsed = AddBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(`Ungültige Daten: ${formatZodError(parsed.error)}`, parsed.error.issues);
      }
      const result = getDiscovery().addStreamer(parsed.data.handle, parsed.data.name);
      return {
        ok: true,
        streamer: ctx.store.view(result.streamer),
        created: result.created,
      };
    },
  );

  app.post(
    '/api/discovery/queue',
    { config: { rateLimit: RATE_LIMIT_CONFIG } },
    async (request: FastifyRequest) => {
      const parsed = QueueBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(`Ungültige Daten: ${formatZodError(parsed.error)}`, parsed.error.issues);
      }
      const result = await getDiscovery().queueNow(parsed.data.handle, parsed.data.mode);
      return {
        ok: true,
        streamer: ctx.store.view(result.streamer),
        created: result.created,
        queue: result.queue,
        status: result.status,
      };
    },
  );

  app.post(
    '/api/discovery/switch',
    { config: { rateLimit: RATE_LIMIT_CONFIG } },
    async (request: FastifyRequest) => {
      const parsed = SwitchBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(`Ungültige Daten: ${formatZodError(parsed.error)}`, parsed.error.issues);
      }
      const result = await getDiscovery().switchToStreamer(parsed.data.handle);
      return {
        ok: true,
        streamer: ctx.store.view(result.streamer),
        created: result.created,
        status: result.status,
      };
    },
  );
}
