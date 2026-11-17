import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ServerConfig } from '../core/config/loader.js';

export function authRequired(config: ServerConfig): boolean {
  return Boolean(config.password || config.apiToken);
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

export function isAuthenticated(request: FastifyRequest, config: ServerConfig): boolean {
  if (!authRequired(config)) return true;

  const header = request.headers.authorization;
  if (config.apiToken && header?.startsWith('Bearer ')) {
    if (safeEqual(header.slice(7).trim(), config.apiToken)) return true;
  }

  const cookie = request.cookies?.rs_auth;
  if (cookie) {
    const unsigned = request.unsignCookie(cookie);
    if (unsigned.valid && unsigned.value === 'ok') return true;
  }

  const basic = basicCredentials(header);
  if (basic) {
    if (config.password && safeEqual(basic.password, config.password)) return true;
    if (config.apiToken && safeEqual(basic.password, config.apiToken)) return true;
  }

  const query = request.query as Record<string, unknown> | undefined;
  if (config.apiToken && typeof query?.token === 'string' && safeEqual(query.token, config.apiToken)) {
    return true;
  }
  return false;
}

export function setSessionCookie(reply: FastifyReply, config: ServerConfig): void {
  reply.setCookie('rs_auth', 'ok', {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
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
