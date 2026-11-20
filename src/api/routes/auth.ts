import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ApiContext } from '../context.js';
import {
  authMode,
  authRequired,
  clearSessionCookie,
  currentSession,
  isSecureRequest,
  safeEqual,
  setSessionCookie,
  unauthorized,
} from '../auth.js';
import { VERSION } from '../../version.js';

function clientInfo(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = value?.split(',')[0]?.trim() || request.ip;
  const agent = String(request.headers['user-agent'] ?? '').trim();
  return agent ? `${ip} · ${agent.slice(0, 80)}` : ip;
}

export async function registerAuthRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  const { config } = ctx;

  function verifyPasswordSecret(password: string): boolean {
    return Boolean(
      (config.server.password && safeEqual(password, config.server.password)) ||
        (config.server.apiToken && safeEqual(password, config.server.apiToken)),
    );
  }

  function passwordAuthConfigured(): boolean {
    return Boolean(config.server.password || config.server.apiToken);
  }

  app.get('/api/auth/methods', async () => ({
    auth_required: authRequired(config.server),
    password_auth: passwordAuthConfigured(),
    totp_enabled: ctx.totp?.isEnabled() ?? false,
    telegram_auth: config.server.telegramAuth,
    telegram_bot_username: ctx.telegramBot?.botUsername ?? '',
  }));

  app.post(
    '/api/auth/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      if (!authRequired(config.server)) {
        return { ok: true, auth_required: false };
      }
      const body = request.body as { password?: unknown; totp_code?: unknown } | undefined;
      const password = typeof body?.password === 'string' ? body.password : '';
      const totpCode = typeof body?.totp_code === 'string' ? body.totp_code.trim() : '';
      if (!password) {
        return reply.code(400).send({
          error: { code: 'validation_failed', message: 'Passwort fehlt' },
        });
      }
      if (!verifyPasswordSecret(password)) {
        ctx.logger.warn({ ip: request.ip }, 'Fehlgeschlagene Dashboard-Anmeldung');
        return reply.code(401).send({
          error: { code: 'invalid_credentials', message: 'Passwort ist falsch' },
        });
      }

      let recoveryCodeUsed = false;
      if (ctx.totp?.isEnabled()) {
        if (!totpCode) {
          return reply.code(401).send({
            error: {
              code: 'totp_required',
              message: 'Bestätigungscode (2FA) oder Recovery-Code erforderlich',
            },
          });
        }
        const verified = ctx.totp.verify(totpCode);
        if (!verified.valid) {
          ctx.logger.warn({ ip: request.ip }, 'Fehlgeschlagene 2FA-Prüfung bei Anmeldung');
          return reply.code(401).send({
            error: { code: 'invalid_totp', message: 'Ungültiger 2FA- oder Recovery-Code' },
          });
        }
        recoveryCodeUsed = verified.usedRecoveryCode;
        if (recoveryCodeUsed) {
          ctx.logger.warn(
            {
              ip: request.ip,
              remaining: ctx.totp.status().recovery_codes_remaining,
            },
            'Dashboard-Anmeldung per 2FA-Recovery-Code',
          );
        }
      }

      setSessionCookie(
        reply,
        config.server,
        ctx.authSessions,
        'Dashboard',
        'password',
        isSecureRequest(request, config.server),
      );
      return {
        ok: true,
        ...(recoveryCodeUsed
          ? {
              recovery_code_used: true,
              recovery_codes_remaining: ctx.totp?.status().recovery_codes_remaining ?? 0,
            }
          : {}),
      };
    },
  );

  app.post(
    '/api/auth/telegram/request',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const auth = ctx.telegramAuth;
      const bot = ctx.telegramBot;
      if (!config.server.telegramAuth || !auth) {
        return reply.code(503).send({
          error: { code: 'telegram_disabled', message: 'Telegram-Login ist nicht konfiguriert' },
        });
      }
      if (!bot?.botUsername) {
        return reply.code(503).send({
          error: { code: 'telegram_offline', message: 'Telegram-Bot ist noch nicht verbunden' },
        });
      }
      const entry = auth.create(clientInfo(request));
      return {
        token: entry.token,
        bot_username: bot.botUsername,
        deep_link: `https://t.me/${bot.botUsername}?start=login_${entry.token}`,
        expires_in: 600,
      };
    },
  );

  app.post(
    '/api/auth/telegram/check',
    {
      config: { rateLimit: { max: 90, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const auth = ctx.telegramAuth;
      if (!auth) {
        return reply.code(503).send({
          error: { code: 'telegram_disabled', message: 'Telegram-Login ist nicht konfiguriert' },
        });
      }
      const body = request.body as { token?: unknown } | undefined;
      const token = typeof body?.token === 'string' ? body.token : '';
      if (!token) {
        return reply.code(400).send({
          error: { code: 'validation_failed', message: 'Token fehlt' },
        });
      }
      const entry = auth.get(token);
      if (!entry) return { status: 'expired' };
      if (entry.status === 'approved') {
        setSessionCookie(
          reply,
          config.server,
          ctx.authSessions,
          entry.user,
          'telegram',
          isSecureRequest(request, config.server),
        );
        auth.delete(token);
        ctx.logger.info({ user: entry.user }, 'Dashboard-Anmeldung per Telegram');
        return { status: 'approved', user: entry.user };
      }
      return { status: entry.status };
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    clearSessionCookie(reply, request, ctx.authSessions);
    return { ok: true };
  });

  app.get('/api/auth/sessions', async (request, reply) => {
    const mode = authMode(request, config.server, ctx.authSessions);
    if (!mode) return unauthorized(reply);
    const current = currentSession(request, config.server, ctx.authSessions);
    return {
      sessions: ctx.authSessions.list().map((session) => ({
        id: session.id,
        user: session.user,
        provider: session.provider,
        created_at: new Date(session.createdAt).toISOString(),
        last_seen_at: new Date(session.lastSeenAt).toISOString(),
        expires_at: new Date(session.expiresAt).toISOString(),
        current: session.id === current?.id,
      })),
    };
  });

  app.post('/api/auth/sessions/:id/revoke', async (request, reply) => {
    const mode = authMode(request, config.server, ctx.authSessions);
    if (!mode) return unauthorized(reply);
    const { id } = request.params as { id: string };
    const current = currentSession(request, config.server, ctx.authSessions);
    ctx.authSessions.revoke(id);
    if (current?.id === id) clearSessionCookie(reply, request, ctx.authSessions);
    return { ok: true };
  });

  app.post('/api/auth/sessions/revoke-all', async (request, reply) => {
    const mode = authMode(request, config.server, ctx.authSessions);
    if (!mode) return unauthorized(reply);
    const removed = ctx.authSessions.revokeAll();
    clearSessionCookie(reply, request, ctx.authSessions);
    return { ok: true, removed };
  });

  app.get('/api/auth/totp', async (request, reply) => {
    const mode = authMode(request, config.server, ctx.authSessions);
    if (!mode) return unauthorized(reply);
    const status = ctx.totp?.status() ?? {
      enabled: false,
      enabled_at: null,
      recovery_codes_remaining: 0,
      pending_setup: false,
    };
    return {
      ...status,
      password_configured: passwordAuthConfigured(),
    };
  });

  app.post(
    '/api/auth/totp/setup',
    {
      config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    },
    async (request, reply) => {
      const mode = authMode(request, config.server, ctx.authSessions);
      if (!mode) return unauthorized(reply);
      if (!ctx.totp) {
        return reply.code(503).send({
          error: { code: 'totp_unavailable', message: '2FA ist auf dieser Instanz nicht verfügbar' },
        });
      }
      if (!passwordAuthConfigured()) {
        return reply.code(400).send({
          error: {
            code: 'password_required',
            message: '2FA setzt ein konfiguriertes Dashboard-Passwort oder API-Token voraus',
          },
        });
      }
      if (ctx.totp.isEnabled()) {
        return reply.code(409).send({
          error: { code: 'totp_already_enabled', message: '2FA ist bereits aktiviert' },
        });
      }
      return ctx.totp.beginSetup();
    },
  );

  app.post(
    '/api/auth/totp/enable',
    {
      config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    },
    async (request, reply) => {
      const mode = authMode(request, config.server, ctx.authSessions);
      if (!mode) return unauthorized(reply);
      if (!ctx.totp) {
        return reply.code(503).send({
          error: { code: 'totp_unavailable', message: '2FA ist auf dieser Instanz nicht verfügbar' },
        });
      }
      const body = request.body as { code?: unknown } | undefined;
      const code = typeof body?.code === 'string' ? body.code.trim() : '';
      if (!code) {
        return reply.code(400).send({
          error: { code: 'validation_failed', message: 'Bestätigungscode fehlt' },
        });
      }
      const result = ctx.totp.confirmSetup(code);
      if (!result) {
        return reply.code(400).send({
          error: {
            code: 'invalid_totp',
            message: 'Code ungültig oder Einrichtung abgelaufen',
          },
        });
      }
      ctx.logger.info('TOTP-Zwei-Faktor-Authentifizierung aktiviert');
      return {
        ok: true,
        status: {
          ...ctx.totp.status(),
          password_configured: passwordAuthConfigured(),
        },
        recovery_codes: result.recoveryCodes,
      };
    },
  );

  app.post(
    '/api/auth/totp/disable',
    {
      config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    },
    async (request, reply) => {
      const mode = authMode(request, config.server, ctx.authSessions);
      if (!mode) return unauthorized(reply);
      if (!ctx.totp) {
        return reply.code(503).send({
          error: { code: 'totp_unavailable', message: '2FA ist auf dieser Instanz nicht verfügbar' },
        });
      }
      const body = request.body as { password?: unknown } | undefined;
      const password = typeof body?.password === 'string' ? body.password : '';
      if (!password) {
        return reply.code(400).send({
          error: { code: 'validation_failed', message: 'Passwort zur Bestätigung erforderlich' },
        });
      }
      if (!verifyPasswordSecret(password)) {
        return reply.code(401).send({
          error: { code: 'invalid_credentials', message: 'Passwort ist falsch' },
        });
      }
      ctx.totp.disable();
      ctx.logger.info('TOTP-Zwei-Faktor-Authentifizierung deaktiviert');
      return {
        ok: true,
        status: {
          ...ctx.totp.status(),
          password_configured: passwordAuthConfigured(),
        },
      };
    },
  );

  app.get('/api/auth/me', async (request, reply) => {
    if (!authRequired(config.server)) {
      return { authenticated: true, auth_required: false, version: VERSION, user: null };
    }
    const mode = authMode(request, config.server, ctx.authSessions);
    if (!mode) return unauthorized(reply);
    const session = currentSession(request, config.server, ctx.authSessions);
    const user =
      session?.user ??
      (mode === 'token' ? 'API-Token' : mode === 'basic' ? 'Basic Auth' : null);
    return {
      authenticated: true,
      auth_required: true,
      version: VERSION,
      user,
      mode,
    };
  });
}
