import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../context.js';
import { authRequired, clearSessionCookie, isAuthenticated, safeEqual, setSessionCookie, unauthorized } from '../auth.js';
import { VERSION } from '../../version.js';

export async function registerAuthRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  const { config } = ctx;
  app.post(
    '/api/auth/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      if (!authRequired(config.server)) {
        return { ok: true, auth_required: false };
      }
      const body = request.body as { password?: unknown } | undefined;
      const password = typeof body?.password === 'string' ? body.password : '';
      if (!password) {
        return reply.code(400).send({
          error: { code: 'validation_failed', message: 'Passwort fehlt' },
        });
      }
      const valid =
        (config.server.password && safeEqual(password, config.server.password)) ||
        (config.server.apiToken && safeEqual(password, config.server.apiToken));
      if (!valid) {
        ctx.logger.warn({ ip: request.ip }, 'Fehlgeschlagene Dashboard-Anmeldung');
        return reply.code(401).send({
          error: { code: 'invalid_credentials', message: 'Passwort ist falsch' },
        });
      }
      setSessionCookie(reply, config.server);
      return { ok: true };
    },
  );

  app.post('/api/auth/logout', async (_request, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (request, reply) => {
    if (!authRequired(config.server)) {
      return { authenticated: true, auth_required: false, version: VERSION };
    }
    if (!isAuthenticated(request, config.server)) return unauthorized(reply);
    return { authenticated: true, auth_required: true, version: VERSION };
  });
}
