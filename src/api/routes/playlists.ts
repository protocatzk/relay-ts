import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../context.js';

export async function registerPlaylistRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  app.get('/api/playlists', async () => ({ playlists: ctx.supervisor.playlistsView() }));

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
