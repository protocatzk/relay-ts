import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ServerConfig } from '../core/config/loader.js';

export type AuthMode = 'public' | 'cookie' | 'token' | 'basic' | null;

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

/** Returns how the current request authenticated, or null if it did not. */
export function authMode(request: FastifyRequest, config: ServerConfig): AuthMode {
  if (!authRequired(config)) return 'public';

  const header = request.headers.authorization;
  if (config.apiToken && header?.startsWith('Bearer ')) {
    if (safeEqual(header.slice(7).trim(), config.apiToken)) return 'token';
  }

  const cookie = request.cookies?.rs_auth;
  if (cookie) {
    const unsigned = request.unsignCookie(cookie);
    if (unsigned.valid && unsigned.value === 'ok') return 'cookie';
  }

  const basic = basicCredentials(header);
  if (basic) {
    if (config.password && safeEqual(basic.password, config.password)) return 'basic';
    if (config.apiToken && safeEqual(basic.password, config.apiToken)) return 'basic';
  }

  return null;
}

export function isAuthenticated(request: FastifyRequest, config: ServerConfig): boolean {
  return authMode(request, config) !== null;
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
  secure = config.secureCookies,
): void {
  reply.setCookie('rs_auth', 'ok', {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 30 * 24 * 3600,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie('rs_auth', { path: '/' });
}

export function unauthorized(reply: FastifyReply): FastifyReply {
  return reply.code(401).send({
    error: { code: 'unauthorized', message: 'Anmeldung erforderlich' },
  });
}

export function csrfRejected(reply: FastifyReply): FastifyReply {
  return reply.code(403).send({
    error: { code: 'csrf_rejected', message: 'Origin für diese Anfrage nicht erlaubt' },
  });
}
