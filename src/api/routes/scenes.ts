import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../context.js';
import { AppError } from '../../utils/errors.js';

export async function registerSceneRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  const requireScenes = () => {
    if (!ctx.scenes) throw new AppError('scenes_unavailable', 'Szenen-Store nicht verfügbar', 503);
    return ctx.scenes;
  };

  app.get('/api/scenes', async () => {
    const store = requireScenes();
    return {
      scenes: store.list(),
      active_scene_id: store.activeId(),
    };
  });

  app.post('/api/scenes', async (request, reply) => {
    const store = requireScenes();
    const current = ctx.settingsService.get();
    const scene = store.create(request.body, {
      overlays: current.overlays,
      video_layout: current.video.layout,
    });
    return reply.code(201).send({
      scene,
      active_scene_id: store.activeId(),
    });
  });

  app.put('/api/scenes/:id', async (request) => {
    const store = requireScenes();
    const { id } = request.params as { id: string };
    const current = ctx.settingsService.get();
    const scene = store.update(id, request.body, {
      overlays: current.overlays,
      video_layout: current.video.layout,
    });
    return {
      scene,
      active_scene_id: store.activeId(),
    };
  });

  app.delete('/api/scenes/:id', async (request) => {
    const store = requireScenes();
    const { id } = request.params as { id: string };
    store.remove(id);
    return {
      ok: true,
      active_scene_id: store.activeId(),
    };
  });

  app.post('/api/scenes/:id/activate', async (request) => {
    const { id } = request.params as { id: string };
    const result = await ctx.supervisor.activateScene(id);
    return {
      ok: true,
      scene: result.scene,
      status: result.status,
    };
  });
}
