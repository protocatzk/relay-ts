import { createReadStream, existsSync, statSync, unlinkSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiContext } from '../context.js';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js';
import {
  evaluateRecordingStorage,
  listRecordings,
  recordingFilePath,
  recordingsDirectory,
  remuxRecordingClip,
} from '../../core/recording/recording-controller.js';
import {
  addRecordingMarker,
  readRecordingMarkers,
  removeMarkersFile,
  removeRecordingMarker,
} from '../../core/recording/recording-markers.js';
import { ensureDir } from '../../utils/fs.js';

const CreateMarkerBody = z.object({
  label: z.string().trim().max(100).optional(),
  offset_seconds: z.number().min(0).optional(),
  source: z.enum(['manual', 'streamdeck', 'telegram', 'chat_spike']).optional(),
});

const CreateClipBody = z.object({
  start_seconds: z.number().min(0),
  end_seconds: z.number().min(0).optional(),
  target_filename: z.string().trim().max(120).optional(),
  to_media: z.boolean().default(false),
});

export async function registerRecordingRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  const dir = recordingsDirectory(ctx.config.paths.dataDir);
  ensureDir(dir);

  app.get('/api/recordings', async () => {
    const active = ctx.supervisor.recordingFilename?.() ?? null;
    const settings = ctx.settingsService.get().recording;
    return {
      files: listRecordings(ctx.config.paths.dataDir, active),
      storage: evaluateRecordingStorage(ctx.config.paths.dataDir, settings, active),
      active,
    };
  });

  app.get('/api/recordings/:filename', async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const path = recordingFilePath(ctx.config.paths.dataDir, filename);
    if (!path) throw new ValidationError('Ungültiger Dateiname');
    if (!existsSync(path)) throw new NotFoundError('Aufzeichnung nicht gefunden');
    const stat = statSync(path);
    reply.header('cache-control', 'no-store');
    reply.header('content-disposition', `attachment; filename="${filename}"`);
    reply.header('content-length', String(stat.size));
    reply.type('video/x-matroska');
    return reply.send(createReadStream(path));
  });

  app.delete('/api/recordings/:filename', async (request) => {
    const { filename } = request.params as { filename: string };
    const path = recordingFilePath(ctx.config.paths.dataDir, filename);
    if (!path) throw new ValidationError('Ungültiger Dateiname');
    if (!existsSync(path)) throw new NotFoundError('Aufzeichnung nicht gefunden');
    if (ctx.supervisor.recordingFilename?.() === filename) {
      throw new ConflictError('Laufende Aufzeichnung kann nicht gelöscht werden');
    }
    unlinkSync(path);
    removeMarkersFile(ctx.config.paths.dataDir, filename);
    ctx.logger.info({ filename }, 'Aufzeichnung gelöscht');
    return { ok: true };
  });

  app.get('/api/recordings/:filename/markers', async (request) => {
    const { filename } = request.params as { filename: string };
    const resolved =
      filename === 'current' ? ctx.supervisor.recordingFilename?.() ?? null : filename;
    if (!resolved) return { markers: [] };
    const path = recordingFilePath(ctx.config.paths.dataDir, resolved);
    if (!path) throw new ValidationError('Ungültiger Dateiname');
    return { markers: readRecordingMarkers(ctx.config.paths.dataDir, resolved) };
  });

  app.post('/api/recordings/:filename/markers', async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const body = CreateMarkerBody.parse(request.body ?? {});
    const active = ctx.supervisor.recordingFilename?.() ?? null;

    if (filename === 'current' || (active && filename === active)) {
      if (!active) {
        throw new ValidationError('Aktuell läuft keine Aufzeichnung');
      }
      const marker = ctx.supervisor.addRecordingMarker
        ? ctx.supervisor.addRecordingMarker({ label: body.label, source: body.source })
        : addRecordingMarker(ctx.config.paths.dataDir, active, {
            offset_seconds: body.offset_seconds ?? 0,
            label: body.label,
            source: body.source,
          });
      return reply.code(201).send({ ok: true, marker });
    }

    const path = recordingFilePath(ctx.config.paths.dataDir, filename);
    if (!path) throw new ValidationError('Ungültiger Dateiname');
    if (!existsSync(path)) throw new NotFoundError('Aufzeichnung nicht gefunden');
    if (body.offset_seconds === undefined) {
      throw new ValidationError('offset_seconds ist für gespeicherte Aufzeichnungen erforderlich');
    }

    const marker = addRecordingMarker(ctx.config.paths.dataDir, filename, {
      offset_seconds: body.offset_seconds,
      label: body.label,
      source: body.source,
    });
    return reply.code(201).send({ ok: true, marker });
  });

  app.delete('/api/recordings/:filename/markers/:id', async (request) => {
    const { filename, id } = request.params as { filename: string; id: string };
    const path = recordingFilePath(ctx.config.paths.dataDir, filename);
    if (!path) throw new ValidationError('Ungültiger Dateiname');
    const removed = removeRecordingMarker(ctx.config.paths.dataDir, filename, id);
    if (!removed) throw new NotFoundError('Marker nicht gefunden');
    return { ok: true };
  });

  app.post('/api/recordings/:filename/clip', async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const path = recordingFilePath(ctx.config.paths.dataDir, filename);
    if (!path) throw new ValidationError('Ungültiger Dateiname');
    if (!existsSync(path)) throw new NotFoundError('Aufzeichnung nicht gefunden');

    const body = CreateClipBody.parse(request.body ?? {});
    const result = await remuxRecordingClip({
      ffmpegBin: ctx.config.media.ffmpegBin,
      dataDir: ctx.config.paths.dataDir,
      sourceFilename: filename,
      startSeconds: body.start_seconds,
      endSeconds: body.end_seconds,
      targetFilename: body.target_filename,
      toMedia: body.to_media,
      logger: ctx.logger,
    });

    return reply.code(201).send({ ok: true, clip: result });
  });
}
