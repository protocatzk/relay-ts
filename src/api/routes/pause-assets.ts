import {
  createReadStream,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiContext } from '../context.js';
import { ensureDir } from '../../utils/fs.js';
import { runCommand } from '../../utils/process.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import {
  inspectPauseAsset,
  isSafePauseFilename,
  mimeForPauseAsset,
  safePauseAssetName,
} from '../../core/overlays/pause-assets.js';

const MAX_FILE_BYTES = 50 * 1024 * 1024;

interface PauseAsset {
  filename: string;
  path: string;
  size: number;
  kind: 'image' | 'video' | 'font';
  mime: string;
  animated: boolean;
  loopable: boolean;
  width: number | null;
  height: number | null;
  duration: number | null;
  warning: string | null;
}

function pauseDir(ctx: ApiContext): string {
  return join(ctx.config.paths.dataDir, 'pause');
}

function toPublicPath(ctx: ApiContext, filename: string): string {
  return join(pauseDir(ctx), filename);
}

async function probe(ctx: ApiContext, filePath: string): Promise<{
  width: number | null;
  height: number | null;
  duration: number | null;
}> {
  const ffprobe = ctx.config.media.ffmpegBin.replace(/ffmpeg([^/]*)$/, 'ffprobe$1');
  try {
    const result = await runCommand(
      ffprobe,
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,width,height:format=duration',
        '-of',
        'json',
        filePath,
      ],
      { timeoutMs: 15_000 },
    );
    if (result.code !== 0) return { width: null, height: null, duration: null };
    const parsed = JSON.parse(result.stdout) as {
      streams?: { codec_type?: string; width?: number; height?: number }[];
      format?: { duration?: string };
    };
    const stream = parsed.streams?.find((entry) => entry.codec_type === 'video');
    return {
      width: typeof stream?.width === 'number' ? stream.width : null,
      height: typeof stream?.height === 'number' ? stream.height : null,
      duration: parsed.format?.duration ? Number(parsed.format.duration) : null,
    };
  } catch {
    return { width: null, height: null, duration: null };
  }
}

async function assetInfo(ctx: ApiContext, filename: string): Promise<PauseAsset> {
  const filePath = toPublicPath(ctx, filename);
  const stat = statSync(filePath);
  const info = inspectPauseAsset(readFileSync(filePath), filename);
  const metadata =
    info.kind === 'font' || filename.toLowerCase().endsWith('.svg')
      ? { width: null, height: null, duration: null }
      : await probe(ctx, filePath);
  return {
    filename,
    path: filePath,
    size: stat.size,
    kind: info.kind,
    mime: info.mime,
    animated: info.animated,
    loopable: info.kind === 'video' || info.animated,
    ...metadata,
    warning: info.warning ?? null,
  };
}

function safeAssetOrThrow(ctx: ApiContext, filename: string): string {
  if (!isSafePauseFilename(basename(filename))) {
    throw new ValidationError('Ungültiger Dateiname');
  }
  const filePath = toPublicPath(ctx, basename(filename));
  if (!existsSync(filePath)) throw new NotFoundError('Pause-Asset nicht gefunden');
  return filePath;
}

function sendFile(request: FastifyRequest, reply: FastifyReply, filePath: string): void {
  const stat = statSync(filePath);
  const mime = mimeForPauseAsset(filePath);
  const range = request.headers.range;
  reply.header('accept-ranges', 'bytes');
  reply.header('cache-control', 'no-store');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : stat.size - 1;
      if (start <= end && end < stat.size) {
        reply.code(206);
        reply.header('content-range', `bytes ${start}-${end}/${stat.size}`);
        reply.header('content-length', String(end - start + 1));
        reply.type(mime).send(createReadStream(filePath, { start, end }));
        return;
      }
    }
  }
  reply.header('content-length', String(stat.size));
  reply.type(mime).send(createReadStream(filePath));
}

export async function registerPauseAssetRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  const dir = pauseDir(ctx);
  ensureDir(dir);

  app.get('/api/pause/assets', async () => ({
    assets: readdirSync(dir)
      .filter((filename) => isSafePauseFilename(filename))
      .map((filename) => {
        const filePath = join(dir, filename);
        const stat = statSync(filePath);
        return {
          filename,
          path: filePath,
          size: stat.size,
          mime: mimeForPauseAsset(filename),
        };
      }),
  }));

  app.post('/api/pause/assets', async (request, reply) => {
    let upload;
    try {
      upload = await request.file();
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({
          error: { code: 'file_too_large', message: 'Datei ist größer als 50 MB' },
        });
      }
      throw error;
    }
    if (!upload) {
      return reply.code(400).send({
        error: { code: 'validation_failed', message: 'Keine Datei übermittelt' },
      });
    }
    if (upload.file.truncated) {
      return reply.code(413).send({
        error: { code: 'file_too_large', message: 'Datei ist größer als 50 MB' },
      });
    }

    const buffer = await upload.toBuffer().catch((error) => {
      const code = (error as { code?: string }).code;
      if (code === 'FST_REQ_FILE_TOO_LARGE') return null;
      throw error;
    });
    if (!buffer) {
      return reply.code(413).send({
        error: { code: 'file_too_large', message: 'Datei ist größer als 50 MB' },
      });
    }
    if (buffer.length === 0) {
      return reply.code(400).send({
        error: { code: 'validation_failed', message: 'Datei ist leer' },
      });
    }

    const originalName = basename(upload.filename);
    const info = inspectPauseAsset(buffer, originalName);
    if (buffer.length > MAX_FILE_BYTES) {
      return reply.code(413).send({
        error: { code: 'file_too_large', message: 'Datei ist größer als 50 MB' },
      });
    }

    const filename = safePauseAssetName(info.extension);
    const filePath = join(dir, filename);
    writeFileSync(filePath, buffer, { mode: 0o600 });
    const asset = await assetInfo(ctx, filename);
    ctx.logger.info(
      { filename, kind: info.kind, size: asset.size, animated: info.animated },
      'Pause-Asset hochgeladen',
    );
    return reply.code(201).send({ asset });
  });

  app.get('/api/pause/assets/:filename', async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const filePath = safeAssetOrThrow(ctx, filename);
    sendFile(request, reply, filePath);
    return reply;
  });

  app.delete('/api/pause/assets/:filename', async (request) => {
    const { filename } = request.params as { filename: string };
    const filePath = safeAssetOrThrow(ctx, filename);
    unlinkSync(filePath);
    ctx.logger.info({ filename }, 'Pause-Asset gelöscht');
    return { ok: true };
  });
}
