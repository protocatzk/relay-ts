import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiContext } from '../context.js';
import { normalizeHandle } from '../../utils/format.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import { resolveHttpActor } from '../audit-middleware.js';

const StartBody = z.object({}).passthrough();

const QuickStartBody = z.object({
  tiktok: z.string().min(1),
  youtube_key: z.string().min(1),
  name: z.string().optional(),
  quality: z.enum(['best', '1080p', '720p', '480p', '360p']).optional(),
});

const BulkAddBody = z.object({
  channels: z.array(z.string().min(1)).min(1).max(200),
  playlist_id: z.string().optional(),
  group: z.string().trim().max(64).optional(),
  tiktok_account: z.string().trim().max(64).optional(),
});

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/^@+/, '')
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'streamer'
  );
}

function viewById(ctx: ApiContext, id: string) {
  return ctx.supervisor.streamersView().find((streamer) => streamer.id === id);
}

/** Rejects unknown TikTok account ids before they reach the store (#95). */
function assertTikTokAccount(ctx: ApiContext, body: unknown): void {
  const id = (body as { tiktok_account?: unknown } | null)?.tiktok_account;
  if (typeof id !== 'string' || !id.trim()) return;
  if (!ctx.tiktokAccounts) {
    throw new ValidationError('TikTok-Konten sind auf dieser Instanz nicht verfügbar');
  }
  if (!ctx.tiktokAccounts.getById(id.trim())) {
    throw new ValidationError(`TikTok-Konto "${id.trim()}" wurde nicht gefunden`);
  }
}

function auditAccountChange(
  ctx: ApiContext,
  request: Parameters<typeof resolveHttpActor>[0],
  streamerId: string,
  previous: string,
  next: string,
): void {
  if (previous === next) return;
  const actorInfo = resolveHttpActor(request, ctx);
  ctx.audit?.record({
    actor: actorInfo.actor,
    source: actorInfo.source,
    action: 'streamer.tiktok_account',
    target: streamerId,
    result: 'ok',
    detail: `Konto: ${previous || 'aktiv'} → ${next || 'aktiv'}`,
  });
}

export async function registerStreamerRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  app.get('/api/streamers', async () => ({ streamers: ctx.supervisor.streamersView() }));

  app.get('/api/streamers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const view = viewById(ctx, id);
    if (!view) {
      return reply.code(404).send({
        error: { code: 'not_found', message: `Streamer "${id}" wurde nicht gefunden` },
      });
    }
    return { streamer: view };
  });

  app.get('/api/streamers/:id/title', async (request) => {
    const { id } = request.params as { id: string };
    return ctx.supervisor.titleFor(id);
  });

  app.post('/api/streamers', async (request, reply) => {
    assertTikTokAccount(ctx, request.body);
    const streamer = ctx.store.create(request.body);
    auditAccountChange(ctx, request, streamer.id, '', streamer.tiktok_account ?? '');
    ctx.supervisor.notifyStreamersChanged();
    const view = viewById(ctx, streamer.id);
    return reply.code(201).send({ streamer: view });
  });

  app.post('/api/streamers/bulk', async (request, reply) => {
    const parsed = BulkAddBody.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Ungültige Sammel-Anlage', parsed.error.issues);
    }
    assertTikTokAccount(ctx, parsed.data);
    const created: string[] = [];
    const skipped: string[] = [];
    const seen = new Set<string>();
    for (const raw of parsed.data.channels) {
      const handle = normalizeHandle(raw);
      if (!handle || seen.has(handle)) {
        if (handle) skipped.push(handle);
        continue;
      }
      seen.add(handle);
      const exists = ctx.store.list().some(
        (streamer) =>
          streamer.id.toLowerCase() === handle ||
          streamer.tiktok.replace(/^@+/, '').toLowerCase() === handle,
      );
      if (exists) {
        skipped.push(handle);
        continue;
      }
      const base = slugify(handle);
      let id = base;
      let suffix = 1;
      while (ctx.store.get(id)) {
        suffix += 1;
        id = `${base}-${suffix}`;
      }
      ctx.store.create({
        id,
        name: handle,
        tiktok: handle,
        quality: 'best',
        enabled: true,
        ...(parsed.data.group ? { group: parsed.data.group } : {}),
        ...(parsed.data.tiktok_account ? { tiktok_account: parsed.data.tiktok_account } : {}),
      });
      created.push(id);
    }

    let playlistId: string | null = null;
    if (parsed.data.playlist_id && created.length > 0) {
      const playlist = ctx.store.playlist(parsed.data.playlist_id);
      if (!playlist) {
        throw new NotFoundError(`Playlist "${parsed.data.playlist_id}" wurde nicht gefunden`);
      }
      const channels = [...playlist.channels];
      for (const id of created) {
        const streamer = ctx.store.get(id);
        if (!streamer) continue;
        const handle = normalizeHandle(streamer.tiktok);
        if (!channels.some((channel) => normalizeHandle(channel) === handle)) {
          channels.push(streamer.tiktok);
        }
      }
      ctx.store.updatePlaylist(playlist.id, { channels });
      playlistId = playlist.id;
    }

    ctx.supervisor.notifyStreamersChanged();
    return reply.code(201).send({
      created: created
        .map((id) => viewById(ctx, id))
        .filter((view): view is NonNullable<typeof view> => Boolean(view)),
      skipped,
      playlist_id: playlistId,
    });
  });

  app.put('/api/streamers/:id', async (request) => {
    const { id } = request.params as { id: string };
    assertTikTokAccount(ctx, request.body);
    const previous = ctx.store.get(id)?.tiktok_account ?? '';
    const streamer = ctx.store.update(id, request.body);
    auditAccountChange(
      ctx,
      request,
      id,
      previous,
      (request.body as { tiktok_account?: string } | null)?.tiktok_account?.trim() ?? previous,
    );
    ctx.supervisor.notifyStreamersChanged();
    return { streamer: viewById(ctx, streamer.id) };
  });

  app.delete('/api/streamers/:id', async (request) => {
    const { id } = request.params as { id: string };
    if (ctx.supervisor.buildStatus().active_streamer_id === id) {
      await ctx.supervisor.stop();
    }
    ctx.store.remove(id);
    ctx.supervisor.notifyStreamersChanged();
    return { ok: true };
  });

  app.post('/api/streamers/:id/start', async (request) => {
    const { id } = request.params as { id: string };
    StartBody.parse(request.body ?? {});
    return { ok: true, status: await ctx.supervisor.start(id) };
  });

  app.post('/api/streamers/:id/stop', async () => {
    return { ok: true, status: await ctx.supervisor.stop() };
  });

  app.post('/api/streamers/:id/switch', async (request) => {
    const { id } = request.params as { id: string };
    return { ok: true, status: await ctx.supervisor.switchTo(id) };
  });

  app.post('/api/quickstart', async (request, reply) => {
    const parsed = QuickStartBody.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Ungültige Schnellstart-Daten', parsed.error.issues);
    }
    const handle = normalizeHandle(parsed.data.tiktok);
    let id = slugify(handle);
    let suffix = 1;
    while (ctx.store.get(id)) {
      suffix += 1;
      id = `${slugify(handle)}-${suffix}`;
    }
    const streamer = ctx.store.create({
      id,
      name: parsed.data.name?.trim() || handle,
      tiktok: parsed.data.tiktok.trim(),
      youtube_key: parsed.data.youtube_key,
      quality: parsed.data.quality ?? 'best',
      enabled: true,
    });
    ctx.supervisor.notifyStreamersChanged();
    try {
      const status = await ctx.supervisor.start(streamer.id);
      return reply.code(201).send({ streamer: viewById(ctx, streamer.id), status });
    } catch (error) {
      // Keep the newly created streamer so the user can retry after fixing the
      // problem (offline handle, expired cookie, ...).
      ctx.supervisor.notifyStreamersChanged();
      throw error;
    }
  });
}
