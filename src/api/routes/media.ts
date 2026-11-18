import { createReadStream, existsSync, statSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../context.js';
import { ensureDir } from '../../utils/fs.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import {
  listMediaFiles,
  mediaDirectory,
  mediaFilePath,
} from '../../core/media/media-files.js';

function contentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.mkv')) return 'video/x-matroska';
  if (lower.endsWith('.m4v')) return 'video/x-m4v';
  return 'video/mp4';
}

export async function registerMediaRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  ensureDir(mediaDirectory(ctx.config.paths.dataDir));

  app.get('/api/media', async () => ({
    files: listMediaFiles(ctx.config.paths.dataDir),
  }));

  app.get('/api/media/:filename', async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const path = mediaFilePath(ctx.config.paths.dataDir, filename);
    if (!path) throw new ValidationError('Ungültiger Dateiname');
    if (!existsSync(path)) throw new NotFoundError('Videodatei nicht gefunden');
    const stat = statSync(path);
    reply.header('cache-control', 'no-store');
    reply.header('content-length', String(stat.size));
    reply.type(contentType(filename));
    return reply.send(createReadStream(path));
  });
}
