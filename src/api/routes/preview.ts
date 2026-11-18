import { PassThrough } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../context.js';

const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

/**
 * Raw MPEG-TS tap for the dashboard preview. It intentionally bypasses the
 * sink, so starting/stopping the player never restarts the YouTube encoder.
 */
export async function registerPreviewRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  app.get('/api/preview.ts', async (request, reply) => {
    const stream = new PassThrough({ highWaterMark: 1024 * 1024 });
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      stream.end();
    };
    const unsubscribe = ctx.supervisor.subscribePreview((chunk) => {
      if (closed) return;
      if (stream.writableLength > MAX_BUFFERED_BYTES) {
        cleanup();
        stream.destroy();
        return;
      }
      stream.write(chunk);
    });
    request.raw.once('close', cleanup);

    reply
      .header('content-type', 'video/mp2t')
      .header('cache-control', 'no-store')
      .header('x-accel-buffering', 'no')
      .header('connection', 'keep-alive');
    return reply.send(stream);
  });
}
