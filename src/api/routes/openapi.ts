import type { FastifyInstance } from 'fastify';
import { openApiDocument } from '../openapi.js';

/** Serves the generated OpenAPI document; the global API auth hook protects it. */
export async function registerOpenApiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/openapi.json', async (_request, reply) => {
    return reply.header('cache-control', 'no-store').send(openApiDocument);
  });
}
