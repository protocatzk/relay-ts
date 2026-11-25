import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiContext } from '../context.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import { MAX_SOUND_UPLOAD_BYTES } from '../../core/soundboard/types.js';

const SoundUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  kind: z.enum(['sfx', 'music']).optional(),
  gain_db: z.number().min(-30).max(12).optional(),
  color: z.string().min(1).max(24).optional(),
  hotkey: z.string().max(4).optional(),
});

const PlayBodySchema = z
  .object({
    gain_db: z.number().min(-30).max(12).optional(),
    target: z.enum(['sfx', 'music']).optional(),
  })
  .optional();

const VolumeBodySchema = z.object({
  master_gain_db: z.number().min(-40).max(12).optional(),
  sfx_gain_db: z.number().min(-40).max(12).optional(),
  music_gain_db: z.number().min(-40).max(12).optional(),
});

const MusicLoopBodySchema = z.object({
  loop: z.enum(['off', 'one', 'all']),
});

export async function registerSoundboardRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  const writeLimit = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };

  app.get('/api/soundboard', async () => ctx.supervisor.getSoundboardState());

  app.post('/api/soundboard/sounds', writeLimit, async (request, reply) => {
    const file = await request.file();
    if (!file) throw new ValidationError('Keine Audiodatei übermittelt');
    const buffer = await file.toBuffer();
    if (buffer.byteLength === 0) throw new ValidationError('Audiodatei ist leer');
    if (buffer.byteLength > MAX_SOUND_UPLOAD_BYTES) {
      throw new ValidationError('Audiodatei überschreitet 50 MB');
    }

    const fields = file.fields as Record<string, { value?: string } | undefined>;
    const rawKind = fields.kind?.value;
    const kind = rawKind === 'music' ? 'music' : 'sfx';
    const name = typeof fields.name?.value === 'string' ? fields.name.value : undefined;
    const color = typeof fields.color?.value === 'string' ? fields.color.value : undefined;
    const hotkey = typeof fields.hotkey?.value === 'string' ? fields.hotkey.value : undefined;
    const gainRaw = fields.gain_db?.value !== undefined ? Number(fields.gain_db.value) : undefined;
    const gain_db = gainRaw !== undefined && Number.isFinite(gainRaw) ? gainRaw : undefined;

    try {
      const sound = await ctx.supervisor.soundboard.store.addFromBuffer({
        originalName: file.filename || 'sound.mp3',
        buffer,
        kind,
        name,
        color,
        hotkey,
        gain_db,
      });
      ctx.supervisor.soundboard.engine.onSoundsChanged();
      return reply.code(201).send({ ok: true, sound, state: ctx.supervisor.getSoundboardState() });
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : String(error));
    }
  });

  app.put('/api/soundboard/sounds/:id', writeLimit, async (request) => {
    const { id } = request.params as { id: string };
    const body = SoundUpdateSchema.parse(request.body ?? {});
    try {
      const updated = ctx.supervisor.soundboard.store.update(id, body);
      if (!updated) throw new NotFoundError(`Sound "${id}" nicht gefunden`);
      ctx.supervisor.soundboard.engine.onSoundsChanged();
      return { ok: true, sound: updated, state: ctx.supervisor.getSoundboardState() };
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new ValidationError(error instanceof Error ? error.message : String(error));
    }
  });

  app.delete('/api/soundboard/sounds/:id', writeLimit, async (request) => {
    const { id } = request.params as { id: string };
    const removed = ctx.supervisor.soundboard.store.delete(id);
    if (!removed) throw new NotFoundError(`Sound "${id}" nicht gefunden`);
    ctx.supervisor.soundboard.engine.onSoundsChanged();
    return { ok: true, state: ctx.supervisor.getSoundboardState() };
  });

  app.post('/api/soundboard/play/:id', writeLimit, async (request) => {
    const { id } = request.params as { id: string };
    const body = PlayBodySchema.parse(request.body);
    try {
      const sound = await ctx.supervisor.soundboard.engine.play(id, body);
      return { ok: true, sound, state: ctx.supervisor.getSoundboardState() };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('nicht gefunden')) throw new NotFoundError(msg);
      throw new ValidationError(msg);
    }
  });

  app.post('/api/soundboard/stop', writeLimit, async (request) => {
    const { scope } = (request.query as { scope?: string }) ?? {};
    const validScope = scope === 'sfx' || scope === 'music' ? scope : 'all';
    ctx.supervisor.soundboard.engine.stop(validScope);
    return { ok: true, state: ctx.supervisor.getSoundboardState() };
  });

  app.post('/api/soundboard/music/next', writeLimit, async () => {
    const sound = await ctx.supervisor.soundboard.engine.nextMusic();
    return { ok: true, sound, state: ctx.supervisor.getSoundboardState() };
  });

  app.post('/api/soundboard/music/pause', writeLimit, async () => {
    const paused = ctx.supervisor.soundboard.engine.toggleMusicPause();
    return { ok: true, paused, state: ctx.supervisor.getSoundboardState() };
  });

  app.post('/api/soundboard/music/loop', writeLimit, async (request) => {
    const { loop } = MusicLoopBodySchema.parse(request.body ?? {});
    ctx.supervisor.soundboard.engine.setMusicLoop(loop);
    return { ok: true, loop, state: ctx.supervisor.getSoundboardState() };
  });

  app.post('/api/soundboard/volume', writeLimit, async (request) => {
    const patch = VolumeBodySchema.parse(request.body ?? {});
    ctx.supervisor.soundboard.engine.setVolume(patch);
    const current = ctx.settingsService.get();
    await ctx.settingsService.update({
      soundboard: {
        ...current.soundboard,
        ...patch,
      },
    });
    return { ok: true, state: ctx.supervisor.getSoundboardState() };
  });
}
