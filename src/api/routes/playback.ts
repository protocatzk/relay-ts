import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ApiContext } from '../context.js';
import { formatZodError } from '../../core/config/schema.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

const SeekBodySchema = z.object({
  seconds: z.coerce.number().finite().min(0).max(24 * 60 * 60),
});

const LoopBodySchema = z.object({
  /** `off` and `all` map onto the existing queue loop flag (#94). */
  loop: z.enum(['off', 'all', 'one']),
});

/**
 * Unified playback control (#94). These routes are the single transport the
 * cockpit uses; `/api/queue/*` and `/api/playlists/*` stay as compatible
 * aliases for Telegram, MCP and older clients.
 */
export async function registerPlaybackRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  const supervisor = () => ctx.supervisor;

  app.get('/api/playback', async () => supervisor().buildPlaybackState());

  app.post('/api/playback/play', async () => {
    const state = supervisor().buildPlaybackState();
    if (state.source === 'queue') {
      const index = state.queue_index ?? 0;
      return { ok: true, status: await supervisor().queuePlay(index) };
    }
    const active = ctx.supervisor.playlistsView().find((playlist) => playlist.active);
    if (active) {
      return { ok: true, status: await supervisor().playPlaylist(active.id) };
    }
    throw new ValidationError('Es ist nichts abspielbar');
  });

  app.post('/api/playback/pause', async () => {
    // The pause screen keeps the queue entry active; resume returns to it.
    return { ok: true, status: await supervisor().showScreen('pause') };
  });

  app.post('/api/playback/resume', async () => {
    return { ok: true, status: await supervisor().hideScreen() };
  });

  app.post('/api/playback/stop', async () => {
    return { ok: true, status: await supervisor().stop() };
  });

  app.post('/api/playback/next', async () => {
    const state = supervisor().buildPlaybackState();
    if (state.source === 'queue') {
      return { ok: true, status: await supervisor().queueNext() };
    }
    if (state.source === 'playlist') {
      return { ok: true, status: await supervisor().playlistNext() };
    }
    throw new ValidationError('Es läuft keine Wiedergabeliste');
  });

  app.post('/api/playback/previous', async () => {
    const state = supervisor().buildPlaybackState();
    if (state.source === 'queue') {
      return { ok: true, status: await supervisor().queuePrevious() };
    }
    if (state.source === 'playlist') {
      return { ok: true, status: await supervisor().playlistPrevious() };
    }
    throw new ValidationError('Es läuft keine Wiedergabeliste');
  });

  app.post('/api/playback/seek', async (request: FastifyRequest) => {
    const parsed = SeekBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(
        `Ungültige Position: ${formatZodError(parsed.error)}`,
        parsed.error.issues,
      );
    }
    const state = supervisor().buildPlaybackState();
    if (state.source !== 'queue' || state.duration_seconds === null) {
      throw new ValidationError('Seek ist nur für lokale Videos verfügbar');
    }
    const position = Math.min(parsed.data.seconds, Math.max(0, state.duration_seconds - 1));
    return { ok: true, status: await supervisor().seekActiveVideo(position) };
  });

  app.post('/api/playback/loop', async (request: FastifyRequest) => {
    const parsed = LoopBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(
        `Ungültiger Loop-Modus: ${formatZodError(parsed.error)}`,
        parsed.error.issues,
      );
    }
    if (parsed.data.loop === 'one') {
      throw new ValidationError('Loop "one" ist noch nicht verfügbar');
    }
    const queue = await supervisor().queueSetLoop(parsed.data.loop === 'all');
    return { ok: true, queue, state: supervisor().buildPlaybackState() };
  });

  app.post('/api/playback/queue-now', async (request: FastifyRequest) => {
    const body = request.body as { channel?: string } | undefined;
    const channel = typeof body?.channel === 'string' ? body.channel.trim() : '';
    if (!channel) throw new NotFoundError('Kein Kanal angegeben');
    return { ok: true, status: await supervisor().queuePlayNow(channel) };
  });
}
