import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import type { ApiContext } from './context.js';
import { AppError } from '../utils/errors.js';
import { authMode, csrfRejected, isSameOrigin, unauthorized } from './auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerStreamerRoutes } from './routes/streamers.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerPlaylistRoutes } from './routes/playlists.js';
import { registerSystemRoutes } from './routes/system.js';

export async function buildServer(ctx: ApiContext): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: ctx.logger.child({ module: 'http' }, { level: 'warn' }) as unknown as FastifyBaseLogger,
    bodyLimit: 512 * 1024,
    trustProxy: ctx.config.server.trustProxy,
    forceCloseConnections: true,
  });

  await app.register(cookie, { secret: ctx.config.server.sessionSecret });
  await app.register(rateLimit, { global: false });

  if (ctx.config.server.corsOrigin) {
    const origins = ctx.config.server.corsOrigin
      .split(',')
      .map((origin: string) => origin.trim())
      .filter(Boolean);
    await app.register(cors, {
      origin: origins.length === 1 ? origins[0] : origins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    });
  }

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split('?')[0] ?? '/';
    if (request.method === 'OPTIONS') return;
    if (path === '/health') return;
    if (!path.startsWith('/api/')) return;
    if (
      path === '/api/auth/login' ||
      path === '/api/auth/me' ||
      path === '/api/auth/methods' ||
      path === '/api/auth/telegram/request' ||
      path === '/api/auth/telegram/check'
    ) {
      return;
    }
    const mode = authMode(request, ctx.config.server);
    if (!mode) return unauthorized(reply);
    if (mode === 'cookie' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      const allowedOrigins = ctx.config.server.corsOrigin
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
      if (!isSameOrigin(request, allowedOrigins)) return csrfRejected(reply);
    }
    return undefined;
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (request.url.startsWith('/api/')) {
      reply.header('cache-control', 'no-store');
    }
    if (ctx.config.server.secureCookies) {
      reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
    return payload;
  });

  await registerAuthRoutes(app, ctx);
  await registerStreamerRoutes(app, ctx);
  await registerSettingsRoutes(app, ctx);
  await registerPlaylistRoutes(app, ctx);
  await registerSystemRoutes(app, ctx);

  const webRoot = ctx.config.paths.webDir;
  const indexFile = join(webRoot, 'index.html');
  if (existsSync(indexFile)) {
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: '/',
      wildcard: false,
      maxAge: 0,
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.url === '/health') {
        return reply.code(404).send({
          error: { code: 'not_found', message: 'Endpunkt nicht gefunden' },
        });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return reply.code(405).send({
          error: { code: 'method_not_allowed', message: 'Methode nicht erlaubt' },
        });
      }
      reply.header('cache-control', 'no-cache');
      return reply.type('text/html').sendFile('index.html');
    });
  } else {
    ctx.logger.warn(
      { webDir: webRoot },
      'Dashboard-Build nicht gefunden – zuerst "npm run build:web" ausführen',
    );
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({
          error: { code: 'not_found', message: 'Endpunkt nicht gefunden' },
        });
      }
      return reply
        .code(503)
        .type('text/html')
        .send(
          '<!doctype html><html lang="de"><meta charset="utf-8"><title>RELAY</title>' +
            '<body style="font-family:system-ui;background:#0e1116;color:#eee;padding:3rem">' +
            '<h1>Dashboard nicht gebaut</h1><p>Bitte <code>npm run build</code> ausführen.</p></body></html>',
        );
    });
  }

  app.setErrorHandler((error, request, reply) => {
    const err = error as Error & { statusCode?: number; code?: string };
    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        ctx.logger.error({ err: error.message, code: error.code, path: request.url }, 'API-Fehler');
      }
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      });
    }
    if (error instanceof z.ZodError) {
      return reply.code(400).send({
        error: {
          code: 'validation_failed',
          message: 'Ungültige Eingaben',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
    }
    const statusCode = typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({
        error: {
          code: err.code ?? 'request_failed',
          message: err.message,
        },
      });
    }
    ctx.logger.error(
      { err: err.stack ?? err.message, path: request.url, method: request.method },
      'Unbehandelter Fehler',
    );
    return reply.code(500).send({
      error: {
        code: 'internal_error',
        message: 'Interner Serverfehler',
      },
    });
  });

  return app;
}
