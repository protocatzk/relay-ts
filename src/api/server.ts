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
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import type { ApiContext } from './context.js';
import { AppError } from '../utils/errors.js';
import { authenticateRequest, csrfRejected, forbidden, hasScope, isSameOrigin, unauthorized } from './auth.js';
import { mapHttpAuditAction, resolveHttpActor } from './audit-middleware.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerStreamerRoutes } from './routes/streamers.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerPlaylistRoutes } from './routes/playlists.js';
import { registerQueueRoutes } from './routes/queue.js';
import { registerPlaybackRoutes } from './routes/playback.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerPauseAssetRoutes } from './routes/pause-assets.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerRecordingRoutes } from './routes/recordings.js';
import { registerPreviewRoutes } from './routes/preview.js';
import { registerYouTubeRoutes } from './routes/youtube.js';
import { registerOpenApiRoutes } from './routes/openapi.js';
import { registerSceneRoutes } from './routes/scenes.js';
import { registerScheduleRoutes } from './routes/schedules.js';
import { registerDiscoveryRoutes } from './routes/discovery.js';
import { registerAutomationRoutes } from './routes/automations.js';
import { registerMcpRoutes } from './routes/mcp.js';
import { registerApiKeyRoutes } from './routes/api-keys.js';

/**
 * Scope an API key needs for read-only (GET) access. Control-plane surfaces
 * (settings, system/backup, key management, automations) stay admin-only;
 * everything not listed falls back to `read:status`.
 */
const READ_SCOPE_ROUTES: readonly (readonly [prefix: string, scope: string])[] = [
  ['/api/settings', 'admin'],
  ['/api/api-keys', 'admin'],
  ['/api/system', 'admin'],
  ['/api/automations', 'admin'],
  ['/api/streamers', 'read:streamers'],
  ['/api/playlists', 'read:streamers'],
  ['/api/recordings', 'read:recordings'],
  ['/api/logs', 'read:logs'],
  ['/api/diagnostics', 'read:logs'],
  ['/api/audit', 'read:logs'],
  ['/api/queue', 'control:queue'],
  ['/api/scenes', 'control:overlays'],
];

function requiredScopeForRead(path: string): string {
  for (const [prefix, scope] of READ_SCOPE_ROUTES) {
    if (path.startsWith(prefix)) return scope;
  }
  return 'read:status';
}

export async function buildServer(ctx: ApiContext): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: ctx.logger.child({ module: 'http' }, { level: 'warn' }) as unknown as FastifyBaseLogger,
    bodyLimit: 512 * 1024,
    trustProxy: ctx.config.server.trustProxy,
    forceCloseConnections: true,
  });

  await app.register(cookie, { secret: ctx.config.server.sessionSecret });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024,
      files: 1,
      fields: 4,
    },
  });

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
      path === '/api/auth/telegram/check' ||
      path === '/api/youtube/oauth/callback' ||
      (path.startsWith('/api/mcp') && !ctx.settingsService.get().mcp.require_auth)
    ) {
      return;
    }
    const authInfo = authenticateRequest(request, ctx.config.server, ctx.authSessions, ctx.apiKeys);
    const mode = authInfo.mode;
    if (!mode) return unauthorized(reply);

    // Wenn per API-Key authentifiziert, prüfen wir Berechtigung / Scopes
    if (mode === 'api_key' && authInfo.apiKey) {
      // API-Key-Management selbst ist strikt Master / Admin vorbehalten
      if (path.startsWith('/api/api-keys')) {
        if (!hasScope(authInfo.apiKey.scopes, 'admin')) {
          return forbidden(reply, 'API-Keys können nur mit Admin-Rechten verwaltet werden');
        }
      }

      // Schreibende Routen
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
        if (path.startsWith('/api/streamers') && !hasScope(authInfo.apiKey.scopes, 'manage:streamers') && !hasScope(authInfo.apiKey.scopes, 'control:stream')) {
          return forbidden(reply, 'Fehlender Scope: manage:streamers oder control:stream');
        }
        if (path.startsWith('/api/queue') && !hasScope(authInfo.apiKey.scopes, 'control:queue')) {
          return forbidden(reply, 'Fehlender Scope: control:queue');
        }
        if (path.startsWith('/api/screens') && !hasScope(authInfo.apiKey.scopes, 'control:stream')) {
          return forbidden(reply, 'Fehlender Scope: control:stream');
        }
        if (path.startsWith('/api/overlays') && !hasScope(authInfo.apiKey.scopes, 'control:overlays')) {
          return forbidden(reply, 'Fehlender Scope: control:overlays');
        }
        if (path.startsWith('/api/media') && !hasScope(authInfo.apiKey.scopes, 'manage:media')) {
          return forbidden(reply, 'Fehlender Scope: manage:media');
        }
        // MCP-Tools führen Steueraktionen aus; für API-Keys nur mit Vollzugriff.
        if (path.startsWith('/api/mcp') && !hasScope(authInfo.apiKey.scopes, 'admin')) {
          return forbidden(reply, 'Fehlender Scope: admin');
        }
      } else {
        // Lesende Routen: ein Key ohne passenden Scope darf nicht alles lesen.
        const requiredReadScope = requiredScopeForRead(path);
        if (requiredReadScope && !hasScope(authInfo.apiKey.scopes, requiredReadScope)) {
          return forbidden(reply, `Fehlender Scope: ${requiredReadScope}`);
        }
      }
    }

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
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    const pathname = (request.url ?? '').split('?')[0] ?? '/';
    const contentType = String(reply.getHeader('content-type') ?? '');
    if (pathname === '/api/overlays/preview.png') {
      reply.header('cache-control', 'no-cache');
    } else if (pathname.startsWith('/api/')) {
      reply.header('cache-control', 'no-store');
    } else if (pathname.startsWith('/assets/')) {
      // Hashed build assets are immutable.
      reply.header('cache-control', 'public, max-age=31536000, immutable');
    } else if (pathname === '/manifest.webmanifest') {
      reply.header('cache-control', 'no-cache');
    } else if (pathname === '/sw.js' || contentType.startsWith('text/html')) {
      // The SPA shell (including not-found fallbacks) and the service worker
      // must never be served stale; mobile browsers otherwise keep the old
      // bundle after a deploy.
      reply.header('cache-control', 'no-store, max-age=0, must-revalidate');
    }
    if (pathname === '/sw.js') {
      reply.header('service-worker-allowed', '/');
    }
    if (ctx.config.server.secureCookies) {
      reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
    return payload;
  });

  app.addHook('onResponse', async (request, reply) => {
    if (!ctx.audit) return;
    const mapped = mapHttpAuditAction(request.method, request.url);
    if (!mapped) return;
    const { actor, source } = resolveHttpActor(request, ctx);
    ctx.audit.record({
      actor,
      source,
      action: mapped.action,
      target: mapped.target,
      result: reply.statusCode < 400 ? 'ok' : 'error',
      detail: `HTTP ${reply.statusCode}`,
    });
  });

  await registerAuthRoutes(app, ctx);
  await registerStreamerRoutes(app, ctx);
  await registerSettingsRoutes(app, ctx);
  await registerPlaylistRoutes(app, ctx);
  await registerQueueRoutes(app, ctx);
  await registerPlaybackRoutes(app, ctx);
  await registerSystemRoutes(app, ctx);
  await registerPauseAssetRoutes(app, ctx);
  await registerMediaRoutes(app, ctx);
  await registerRecordingRoutes(app, ctx);
  await registerPreviewRoutes(app, ctx);
  await registerYouTubeRoutes(app, ctx);
  await registerSceneRoutes(app, ctx);
  await registerScheduleRoutes(app, ctx);
  await registerDiscoveryRoutes(app, ctx);
  await registerAutomationRoutes(app, ctx);
  await registerMcpRoutes(app, ctx);
  await registerApiKeyRoutes(app, ctx);
  await registerOpenApiRoutes(app);

  const webRoot = ctx.config.paths.webDir;
  const indexFile = join(webRoot, 'index.html');
  if (existsSync(indexFile)) {
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: '/',
      wildcard: false,
      maxAge: 0,
      setHeaders: (res, pathName) => {
        // Hashed assets (JS/CSS chunks) and webfonts are immutable and can be aggressively cached
        if (pathName.includes('/assets/') || pathName.includes('/fonts/')) {
          res.header('cache-control', 'public, max-age=31536000, immutable');
        } else if (
          pathName.endsWith('sw.js') ||
          pathName.endsWith('manifest.webmanifest') ||
          pathName.endsWith('index.html')
        ) {
          res.header('cache-control', 'no-cache, no-store, must-revalidate');
        } else {
          // Static images, icons, logos
          res.header('cache-control', 'public, max-age=86400');
        }
      },
    });
    app.setNotFoundHandler((request, reply) => {
      const pathname = (request.url ?? '').split('?')[0] ?? '/';
      if (
        request.url.startsWith('/api/') ||
        request.url === '/health' ||
        pathname === '/sw.js' ||
        pathname === '/manifest.webmanifest'
      ) {
        return reply.code(404).send({
          error: { code: 'not_found', message: 'Endpunkt nicht gefunden' },
        });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return reply.code(405).send({
          error: { code: 'method_not_allowed', message: 'Methode nicht erlaubt' },
        });
      }
      reply.header('cache-control', 'no-store, max-age=0, must-revalidate');
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
