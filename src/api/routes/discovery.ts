import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ApiContext } from '../context.js';
import { formatZodError } from '../../core/config/schema.js';
import { ValidationError, NotFoundError } from '../../utils/errors.js';

const TrendingQuerySchema = z.object({
  region: z.string().max(10).optional(),
  language: z.string().max(10).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const SearchQuerySchema = z.object({
  q: z.string().max(200).optional().default(''),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  region: z.string().max(10).optional(),
});

const RoomParamsSchema = z.object({
  handle: z.string().min(1).max(100),
});

const AddBodySchema = z.object({
  handle: z.string().min(1).max(100),
  name: z.string().max(120).optional(),
});

const QueueBodySchema = z.object({
  handle: z.string().min(1).max(100),
  mode: z.enum(['now', 'next']).optional().default('now'),
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
      });
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
