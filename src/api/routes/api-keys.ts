import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ApiContext } from '../context.js';
import { ALL_SCOPES } from '../api-key-store.js';

const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(64),
  scopes: z.array(z.string()).optional(),
  expires_in_days: z.number().int().min(1).max(365).nullable().optional(),
});

export async function registerApiKeyRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  app.get('/api/api-keys/scopes', async () => {
    return { scopes: ALL_SCOPES };
  });

  app.get('/api/api-keys', async () => {
    const list = ctx.apiKeys?.list() ?? [];
    return { keys: list };
  });

  app.post('/api/api-keys', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!ctx.apiKeys) {
      return reply.code(503).send({ error: { code: 'service_unavailable', message: 'API-Key-Store nicht verfügbar' } });
    }

    const parsed = CreateApiKeySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'validation_failed', message: parsed.error.issues[0]?.message ?? 'Ungültige Parameter' },
      });
    }

    const result = ctx.apiKeys.create({
      name: parsed.data.name,
      scopes: parsed.data.scopes,
      expiresInDays: parsed.data.expires_in_days,
    });

    return reply.code(201).send({
      key: result.key,
      record: result.record,
    });
  });

  app.post('/api/api-keys/:id/revoke', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!ctx.apiKeys) {
      return reply.code(503).send({ error: { code: 'service_unavailable', message: 'API-Key-Store nicht verfügbar' } });
    }
    const ok = ctx.apiKeys.revoke(request.params.id);
    if (!ok) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'API-Key nicht gefunden' } });
    }
    return { success: true };
  });

  app.delete('/api/api-keys/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!ctx.apiKeys) {
      return reply.code(503).send({ error: { code: 'service_unavailable', message: 'API-Key-Store nicht verfügbar' } });
    }
    const ok = ctx.apiKeys.delete(request.params.id);
    if (!ok) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'API-Key nicht gefunden' } });
    }
    return { success: true };
  });
}
