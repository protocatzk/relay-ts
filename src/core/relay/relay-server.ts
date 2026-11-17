import { createServer, type Server, type Socket } from 'node:net';
import type { Logger } from 'pino';
import type { DelayBuffer } from './delay-buffer.js';

export interface RelayOptions {
  host: string;
  port: number;
  logger: Logger;
  buffer: DelayBuffer;
}

/**
 * MPEG-TS ingest endpoint. ffmpeg sources publish raw MPEG-TS here; the
 * packets are pushed through the delay buffer and forwarded to the sink.
 * If a second source connects (e.g. after a reconnect), it replaces the old one.
 */
export class MpegTsRelay {
  private readonly options: RelayOptions;
  private server?: Server;
  private source?: Socket;
  private lastDataAt: Date | null = null;
  private totalBytes = 0;
  private sourceConnections = 0;
  private readonly startedAt = new Date();

  constructor(options: RelayOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    this.server = createServer({ allowHalfOpen: false }, (socket) => this.handleSource(socket));
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server?.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.server?.off('error', onError);
        resolve();
      };
      this.server!.once('error', onError);
      this.server!.once('listening', onListening);
      this.server!.listen(this.options.port, this.options.host);
    });
    this.options.logger.info({ port: this.options.port }, 'MPEG-TS-Relay gestartet');
  }

  async stop(): Promise<void> {
    this.source?.destroy();
    this.source = undefined;
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
  }

  private handleSource(socket: Socket): void {
    socket.setNoDelay(true);
    if (this.source && this.source !== socket) {
      this.options.logger.warn('Neue Quelle verbunden; alte Quelle wird getrennt');
      this.source.destroy();
    }
    this.source = socket;
    this.sourceConnections += 1;
    this.options.logger.info(
      { remote: `${socket.remoteAddress}:${socket.remotePort}`, connections: this.sourceConnections },
      'Stream-Quelle verbunden',
    );
    socket.on('data', (chunk: Buffer) => {
      this.lastDataAt = new Date();
      this.totalBytes += chunk.length;
      this.options.buffer.enqueue(chunk);
    });
    socket.on('error', (error) => {
      this.options.logger.warn({ err: error.message }, 'Quellen-Socket-Fehler');
    });
    socket.on('close', () => {
      if (this.source === socket) {
        this.source = undefined;
        this.options.logger.warn('Stream-Quelle getrennt');
      }
    });
  }

  get connected(): boolean {
    return Boolean(this.source && !this.source.destroyed && !this.source.readableEnded);
  }

  get lastData(): Date | null {
    return this.lastDataAt;
  }

  stats(): {
    ingestClients: number;
    connected: boolean;
    lastDataAt: Date | null;
    totalBytes: number;
    uptimeSeconds: number;
  } {
    return {
      ingestClients: this.connected ? 1 : 0,
      connected: this.connected,
      lastDataAt: this.lastDataAt,
      totalBytes: this.totalBytes,
      uptimeSeconds: Math.round((Date.now() - this.startedAt.getTime()) / 1000),
    };
  }
}
