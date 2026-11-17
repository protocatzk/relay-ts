import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../context.js';

export async function registerPlaylistRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  app.get('/api/playlists', async () => ({ playlists: ctx.supervisor.playlistsView() }));

  app.post('/api/playlists', async (request, reply) => {
    const playlist = ctx.store.createPlaylist(request.body);
    ctx.supervisor.notifyStreamersChanged();
    const view = ctx.supervisor.playlistsView().find((item) => item.id === playlist.id);
    return reply.code(201).send({ playlist: view });
  });

  app.put('/api/playlists/:id', async (request) => {
    const { id } = request.params as { id: string };
    const playlist = ctx.store.updatePlaylist(id, request.body);
    ctx.supervisor.notifyStreamersChanged();
    return { playlist: ctx.supervisor.playlistsView().find((item) => item.id === playlist.id) };
  });

  app.delete('/api/playlists/:id', async (request) => {
    const { id } = request.params as { id: string };
    if (ctx.supervisor.buildStatus().active_playlist?.id === id) {
      await ctx.supervisor.stop();
    }
    ctx.store.removePlaylist(id);
    ctx.supervisor.notifyStreamersChanged();
    return { ok: true };
  });

  app.post('/api/playlists/next', async () => ({
    ok: true,
    status: await ctx.supervisor.playlistNext(),
  }));

  app.post('/api/playlists/stop', async () => ({
    ok: true,
    status: await ctx.supervisor.stopPlaylist(),
  }));

  app.post('/api/playlists/:id/play', async (request) => {
    const { id } = request.params as { id: string };
    return { ok: true, status: await ctx.supervisor.playPlaylist(id) };
  });
}
