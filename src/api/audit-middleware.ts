import type { FastifyRequest } from 'fastify';
import type { ApiContext } from './context.js';
import { authMode, currentSession } from './auth.js';
import type { AuditSource } from '../core/audit-log.js';

export interface MappedAuditAction {
  action: string;
  target: string | null;
}

/**
 * Map mutating HTTP control routes to a normalized audit action and safe target.
 * Request bodies are intentionally ignored so secrets can never enter audit logs.
 */
export function mapHttpAuditAction(method: string, url: string): MappedAuditAction | null {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return null;
  const path = (url.split('?')[0] ?? '').replace(/\/+$/, '');

  // Streamer control & CRUD
  let match = /^\/api\/streamers\/([^/]+)\/(start|stop|switch)$/.exec(path);
  if (match && method === 'POST') {
    return { action: `stream.${match[2]}`, target: decodeURIComponent(match[1]!) };
  }
  if (path === '/api/quickstart' && method === 'POST') {
    return { action: 'stream.quickstart', target: null };
  }
  if (path === '/api/streamers' && method === 'POST') {
    return { action: 'streamer.create', target: null };
  }
  if (path === '/api/streamers/bulk' && method === 'POST') {
    return { action: 'streamer.bulk_add', target: null };
  }
  match = /^\/api\/streamers\/([^/]+)$/.exec(path);
  if (match && method === 'PUT') {
    return { action: 'streamer.update', target: decodeURIComponent(match[1]!) };
  }
  if (match && method === 'DELETE') {
    return { action: 'streamer.delete', target: decodeURIComponent(match[1]!) };
  }

  // Screens & pause
  match = /^\/api\/screens\/([^/]+)\/start$/.exec(path);
  if (match && method === 'POST') {
    return { action: 'screen.start', target: decodeURIComponent(match[1]!) };
  }
  if (path === '/api/screens/stop' && method === 'POST') {
    return { action: 'screen.stop', target: null };
  }
  if (path === '/api/pause/start' && method === 'POST') {
    return { action: 'screen.start', target: 'pause' };
  }
  if (path === '/api/pause/stop' && method === 'POST') {
    return { action: 'screen.stop', target: 'pause' };
  }

  // Playlists
  if (path === '/api/playlists/next' && method === 'POST') {
    return { action: 'playlist.next', target: null };
  }
  if (path === '/api/playlists/previous' && method === 'POST') {
    return { action: 'playlist.previous', target: null };
  }
  if (path === '/api/playlists/stop' && method === 'POST') {
    return { action: 'playlist.stop', target: null };
  }
  match = /^\/api\/playlists\/([^/]+)\/play$/.exec(path);
  if (match && method === 'POST') {
    return { action: 'playlist.play', target: decodeURIComponent(match[1]!) };
  }
  match = /^\/api\/playlists\/([^/]+)\/tune\/([^/]+)$/.exec(path);
  if (match && method === 'POST') {
    return {
      action: 'playlist.tune',
      target: `${decodeURIComponent(match[1]!)}:${decodeURIComponent(match[2]!)}`,
    };
  }
  if (path === '/api/playlists' && method === 'POST') {
    return { action: 'playlist.create', target: null };
  }
  match = /^\/api\/playlists\/([^/]+)$/.exec(path);
  if (match && method === 'PUT') {
    return { action: 'playlist.update', target: decodeURIComponent(match[1]!) };
  }
  if (match && method === 'DELETE') {
    return { action: 'playlist.delete', target: decodeURIComponent(match[1]!) };
  }

  // Regie queue
  if (path === '/api/queue/play' && method === 'POST') return { action: 'queue.play', target: null };
  if (path === '/api/queue/next' && method === 'POST') return { action: 'queue.next', target: null };
  if (path === '/api/queue/stop' && method === 'POST') return { action: 'queue.stop', target: null };
  if (path === '/api/queue/now' && method === 'POST') return { action: 'queue.now', target: null };
  if (path === '/api/queue/seek' && method === 'POST') return { action: 'queue.seek', target: null };
  if (path === '/api/queue/entries' && method === 'POST') {
    return { action: 'queue.add', target: null };
  }
  if (path === '/api/queue/move' && method === 'POST') return { action: 'queue.move', target: null };
  if (path === '/api/queue/loop' && method === 'PUT') return { action: 'queue.loop', target: null };
  match = /^\/api\/queue\/entries\/([^/]+)\/duplicate$/.exec(path);
  if (match && method === 'POST') {
    return { action: 'queue.duplicate', target: decodeURIComponent(match[1]!) };
  }
  match = /^\/api\/queue\/entries\/([^/]+)$/.exec(path);
  if (match && method === 'PUT') {
    return { action: 'queue.update_entry', target: decodeURIComponent(match[1]!) };
  }
  if (match && method === 'DELETE') {
    return { action: 'queue.remove', target: decodeURIComponent(match[1]!) };
  }
  if (path === '/api/queue' && method === 'DELETE') return { action: 'queue.clear', target: null };

  // Discovery
  if (path === '/api/discovery/add' && method === 'POST') {
    return { action: 'discovery.add', target: null };
  }
  if (path === '/api/discovery/queue' && method === 'POST') {
    return { action: 'discovery.queue', target: null };
  }
  if (path === '/api/discovery/switch' && method === 'POST') {
    return { action: 'discovery.switch', target: null };
  }

  // System, settings, overlays
  if (path === '/api/system/restart-sink' && method === 'POST') {
    return { action: 'system.restart_sink', target: 'sink' };
  }
  if (path === '/api/system/refresh' && method === 'POST') {
    return { action: 'system.refresh_source', target: 'source' };
  }
  if (path === '/api/reload' && method === 'POST') {
    return { action: 'system.reload', target: null };
  }
  if (path === '/api/settings' && method === 'PUT') {
    return { action: 'settings.update', target: 'settings' };
  }
  if (path === '/api/overlays' && method === 'PUT') {
    return { action: 'overlays.update', target: 'overlays' };
  }
  if (path === '/api/webhooks/test' && method === 'POST') {
    return { action: 'webhooks.test', target: 'webhooks' };
  }

  // Overlay scenes
  if (path === '/api/scenes' && method === 'POST') {
    return { action: 'scene.create', target: null };
  }
  match = /^\/api\/scenes\/([^/]+)\/activate$/.exec(path);
  if (match && method === 'POST') {
    return { action: 'scene.activate', target: decodeURIComponent(match[1]!) };
  }
  match = /^\/api\/scenes\/([^/]+)$/.exec(path);
  if (match && method === 'PUT') {
    return { action: 'scene.update', target: decodeURIComponent(match[1]!) };
  }
  if (match && method === 'DELETE') {
    return { action: 'scene.delete', target: decodeURIComponent(match[1]!) };
  }

  // Stream schedules
  if (path === '/api/schedules' && method === 'POST') {
    return { action: 'schedule.create', target: null };
  }
  match = /^\/api\/schedules\/([^/]+)\/run$/.exec(path);
  if (match && method === 'POST') {
    return { action: 'schedule.run', target: decodeURIComponent(match[1]!) };
  }
  match = /^\/api\/schedules\/([^/]+)$/.exec(path);
  if (match && method === 'PUT') {
    return { action: 'schedule.update', target: decodeURIComponent(match[1]!) };
  }
  if (match && method === 'DELETE') {
    return { action: 'schedule.delete', target: decodeURIComponent(match[1]!) };
  }

  // Auth & security
  if (path === '/api/auth/totp/enable' && method === 'POST') {
    return { action: 'auth.totp_enable', target: 'totp' };
  }
  if (path === '/api/auth/totp/disable' && method === 'POST') {
    return { action: 'auth.totp_disable', target: 'totp' };
  }
  match = /^\/api\/auth\/sessions\/([^/]+)\/revoke$/.exec(path);
  if (match && method === 'POST') {
    return { action: 'auth.session_revoke', target: decodeURIComponent(match[1]!) };
  }
  if (path === '/api/auth/sessions/revoke-all' && method === 'POST') {
    return { action: 'auth.sessions_revoke_all', target: 'all' };
  }

  // Media & recordings
  if (path === '/api/media' && method === 'POST') return { action: 'media.upload', target: null };
  match = /^\/api\/media\/([^/]+)$/.exec(path);
  if (match && method === 'DELETE') {
    return { action: 'media.delete', target: decodeURIComponent(match[1]!) };
  }
  match = /^\/api\/recordings\/([^/]+)\/markers\/([^/]+)$/.exec(path);
  if (match && method === 'DELETE') {
    return {
      action: 'recording.marker_delete',
      target: `${decodeURIComponent(match[1]!)}:${decodeURIComponent(match[2]!)}`,
    };
  }
  match = /^\/api\/recordings\/([^/]+)\/markers$/.exec(path);
  if (match && method === 'POST') {
    return { action: 'recording.marker_create', target: decodeURIComponent(match[1]!) };
  }
  match = /^\/api\/recordings\/([^/]+)\/clip$/.exec(path);
  if (match && method === 'POST') {
    return { action: 'recording.clip_create', target: decodeURIComponent(match[1]!) };
  }
  match = /^\/api\/recordings\/([^/]+)$/.exec(path);
  if (match && method === 'DELETE') {
    return { action: 'recording.delete', target: decodeURIComponent(match[1]!) };
  }
  if (path === '/api/system/restore' && method === 'POST') {
    return { action: 'system.restore', target: null };
  }

  // YouTube
  if (path === '/api/youtube/broadcasts' && method === 'POST') {
    return { action: 'youtube.broadcast_create', target: null };
  }
  match = /^\/api\/youtube\/broadcasts\/([^/]+)\/transition$/.exec(path);
  if (match && method === 'POST') {
    return { action: 'youtube.broadcast_transition', target: decodeURIComponent(match[1]!) };
  }
  match = /^\/api\/youtube\/broadcasts\/([^/]+)$/.exec(path);
  if (match && method === 'DELETE') {
    return { action: 'youtube.broadcast_delete', target: decodeURIComponent(match[1]!) };
  }

  return null;
}

export function resolveHttpActor(
  request: FastifyRequest,
  ctx: ApiContext,
): { actor: string; source: AuditSource } {
  const mode = authMode(request, ctx.config.server, ctx.authSessions);
  if (mode === 'cookie') {
    const session = currentSession(request, ctx.config.server, ctx.authSessions);
    return { actor: `web:${session?.user ?? 'Dashboard'}`, source: 'web' };
  }
  if (mode === 'token') return { actor: 'api:token', source: 'api' };
  if (mode === 'basic') return { actor: 'api:basic', source: 'api' };
  if (mode === 'public') return { actor: 'web:public', source: 'web' };
  return { actor: `anon:${request.ip}`, source: 'api' };
}
