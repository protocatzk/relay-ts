import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ServerConfig } from '../core/config/loader.js';
import type { AuthProvider, AuthSession, AuthSessionStore } from './session-store.js';
import type { ApiKeyRecord, ApiKeyStore } from './api-key-store.js';

export const SESSION_COOKIE = 'rs_session';
const LEGACY_COOKIE = 'rs_auth';

export type AuthMode = 'public' | 'cookie' | 'token' | 'api_key' | 'basic' | null;

export interface RequestAuthInfo {
  mode: AuthMode;
  apiKey?: ApiKeyRecord;
}

export function authRequired(config: ServerConfig): boolean {
  return Boolean(config.password || config.apiToken || config.telegramAuth);
}

export function isSecureRequest(request: FastifyRequest, config: ServerConfig): boolean {
  if (config.secureCookies) return true;
  const proto = request.headers['x-forwarded-proto'];
  const value = Array.isArray(proto) ? proto[0] : proto;
  return value?.split(',')[0]?.trim().toLowerCase() === 'https';
}

export function safeEqual(left: string, right: string): boolean {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
}

function basicCredentials(header: string | undefined): { user: string; password: string } | null {
  if (!header?.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return null;
    return { user: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

export function signedSessionId(request: FastifyRequest): string | null {
  const cookie = request.cookies?.[SESSION_COOKIE];
  if (!cookie) return null;
  const unsigned = request.unsignCookie(cookie);
  return unsigned.valid ? unsigned.value : null;
}

export function currentSession(
  request: FastifyRequest,
  config: ServerConfig,
  sessions: AuthSessionStore,
): AuthSession | null {
  if (!authRequired(config)) return null;
  return sessions.get(signedSessionId(request));
}

/** Returns how the current request authenticated, or null if it did not. */
export function authMode(
  request: FastifyRequest,
  config: ServerConfig,
  sessions: AuthSessionStore,
  apiKeys?: ApiKeyStore,
): AuthMode {
  return authenticateRequest(request, config, sessions, apiKeys).mode;
}

export function authenticateRequest(
  request: FastifyRequest,
  config: ServerConfig,
  sessions: AuthSessionStore,
  apiKeys?: ApiKeyStore,
): RequestAuthInfo {
  if (!authRequired(config)) return { mode: 'public' };

  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (token.startsWith('rel_live_') && apiKeys) {
      const record = apiKeys.authenticate(token, request.ip);
      if (record) return { mode: 'api_key', apiKey: record };
    }
    if (config.apiToken && safeEqual(token, config.apiToken)) {
      return { mode: 'token' };
    }
  }

  if (sessions.get(signedSessionId(request))) return { mode: 'cookie' };

  const basic = basicCredentials(header);
  if (basic) {
    if (config.password && safeEqual(basic.password, config.password)) return { mode: 'basic' };
    if (config.apiToken && safeEqual(basic.password, config.apiToken)) return { mode: 'basic' };
    if (basic.password.startsWith('rel_live_') && apiKeys) {
      const record = apiKeys.authenticate(basic.password, request.ip);
      if (record) return { mode: 'api_key', apiKey: record };
    }
  }

  return { mode: null };
}

export function isAuthenticated(
  request: FastifyRequest,
  config: ServerConfig,
  sessions: AuthSessionStore,
  apiKeys?: ApiKeyStore,
): boolean {
  return authMode(request, config, sessions, apiKeys) !== null;
}

/**
 * Cookie-authenticated writes must come from the same origin. API tokens and
 * Basic Auth are exempt because they are not sent automatically by browsers.
 */
export function isSameOrigin(request: FastifyRequest, allowedOrigins: string[] = []): boolean {
  const originHeader = request.headers.origin ?? request.headers.referer;
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  if (!origin) return false;
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  const forwardedHost = request.headers['x-forwarded-host'];
  const hostHeader = request.headers.host;
  const host = String(
    (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ?? hostHeader ?? '',
  )
    .split(',')[0]!
    .trim()
    .toLowerCase();
  if (!host) return false;

  const stripDefaultPort = (value: string): string => value.replace(/:(80|443)$/, '');
  const originHost = originUrl.host.toLowerCase();
  if (originHost === host || stripDefaultPort(originHost) === stripDefaultPort(host)) {
    return true;
  }

  return allowedOrigins.some((allowed) => {
    try {
      const allowedUrl = new URL(allowed);
      return (
        allowedUrl.host.toLowerCase() === originHost ||
        stripDefaultPort(allowedUrl.host.toLowerCase()) === stripDefaultPort(originHost)
      );
    } catch {
      return false;
    }
  });
}

export function setSessionCookie(
  reply: FastifyReply,
  config: ServerConfig,
  sessions: AuthSessionStore,
  user: string,
  provider: AuthProvider,
  secure = config.secureCookies,
): AuthSession {
  const session = sessions.create(user, provider);
  reply.setCookie(SESSION_COOKIE, session.id, {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 30 * 24 * 3600,
  });
  reply.clearCookie(LEGACY_COOKIE, { path: '/' });
  return session;
}

export function clearSessionCookie(
  reply: FastifyReply,
  request: FastifyRequest,
  sessions: AuthSessionStore,
): void {
  sessions.revoke(signedSessionId(request));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  reply.clearCookie(LEGACY_COOKIE, { path: '/' });
}

export function hasScope(grantedScopes: string[], requiredScope: string): boolean {
  if (grantedScopes.includes('*') || grantedScopes.includes('admin')) return true;
  if (grantedScopes.includes(requiredScope)) return true;
  // Wildcards wie read:* oder control:* unterstützen
  const [category] = requiredScope.split(':');
  if (category && grantedScopes.includes(`${category}:*`)) return true;
  return false;
}

export function unauthorized(reply: FastifyReply): FastifyReply {
  return reply.code(401).send({
    error: { code: 'unauthorized', message: 'Anmeldung erforderlich' },
  });
}

export function forbidden(reply: FastifyReply, message = 'Keine ausreichende Berechtigung für diese Aktion'): FastifyReply {
  return reply.code(403).send({
    error: { code: 'forbidden', message },
  });
}

export function csrfRejected(reply: FastifyReply): FastifyReply {
  return reply.code(403).send({
    error: { code: 'csrf_rejected', message: 'Origin für diese Anfrage nicht erlaubt' },
  });
}
