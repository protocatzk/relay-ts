import { createReadStream, createWriteStream, existsSync, statSync, unlinkSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../context.js';
import { ensureDir } from '../../utils/fs.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import {
  listMediaFiles,
  mediaDirectory,
  mediaFilePath,
  probeMediaFile,
  safeMediaNameFromOriginal,
  type MediaProbe,
} from '../../core/media/media-files.js';

const MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;

function contentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.mkv')) return 'video/x-matroska';
  if (lower.endsWith('.m4v')) return 'video/x-m4v';
  return 'video/mp4';
}

export async function registerMediaRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  const dir = mediaDirectory(ctx.config.paths.dataDir);
  ensureDir(dir);
  const writeLimit = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

  app.get('/api/media', async () => ({
    files: listMediaFiles(ctx.config.paths.dataDir),
  }));

  app.post('/api/media', writeLimit, async (request, reply) => {
    let upload;
    try {
      upload = await request.file({ limits: { fileSize: MAX_MEDIA_BYTES } });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({
          error: { code: 'file_too_large', message: 'Datei ist größer als 2 GB' },
        });
      }
      throw error;
    }
    if (!upload) {
      return reply.code(400).send({
        error: { code: 'validation_failed', message: 'Keine Datei übermittelt' },
      });
    }

    const filename = safeMediaNameFromOriginal(upload.filename);
    if (!filename) {
      // Drain the stream so the connection can be reused/closed cleanly.
      upload.file.resume();
      return reply.code(400).send({
        error: {
          code: 'validation_failed',
          message: 'Ungültiges Dateiformat. Erlaubt: .mp4 .webm .mov .mkv .m4v',
        },
      });
    }

    const filePath = join(dir, filename);
    try {
      await pipeline(upload.file, createWriteStream(filePath, { mode: 0o600, flags: 'w' }));
    } catch (error) {
      upload.file.destroy();
      if (existsSync(filePath)) unlinkSync(filePath);
      throw error;
    }
    if (upload.file.truncated) {
      if (existsSync(filePath)) unlinkSync(filePath);
      return reply.code(413).send({
        error: { code: 'file_too_large', message: 'Datei ist größer als 2 GB' },
      });
    }

    const stat = statSync(filePath);
    let probe: MediaProbe = { isH264: false, height: null, duration: null };
    try {
      probe = await probeMediaFile(ctx.config.media.ffmpegBin, filePath);
    } catch {
      /* probe is best-effort; playback re-probes as needed */
    }

    ctx.logger.info(
      { filename, size: stat.size, isH264: probe.isH264, height: probe.height },
      'Video hochgeladen',
    );
    return reply.code(201).send({
      file: {
        filename,
        size: stat.size,
        modified_at: new Date(stat.mtimeMs).toISOString(),
        is_h264: probe.isH264,
        height: probe.height,
      },
    });
  });

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

  app.delete('/api/media/:filename', writeLimit, async (request) => {
    const { filename } = request.params as { filename: string };
    const path = mediaFilePath(ctx.config.paths.dataDir, filename);
    if (!path) throw new ValidationError('Ungültiger Dateiname');
    if (!existsSync(path)) throw new NotFoundError('Videodatei nicht gefunden');
    unlinkSync(path);
    ctx.logger.info({ filename }, 'Video gelöscht');
    return { ok: true };
  });
}
