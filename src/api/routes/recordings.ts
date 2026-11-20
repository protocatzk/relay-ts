import { createReadStream, existsSync, statSync, unlinkSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../context.js';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js';
import {
  evaluateRecordingStorage,
  listRecordings,
  recordingFilePath,
  recordingsDirectory,
} from '../../core/recording/recording-controller.js';
import { ensureDir } from '../../utils/fs.js';

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
    ctx.logger.info({ filename }, 'Aufzeichnung gelöscht');
    return { ok: true };
  });
}
