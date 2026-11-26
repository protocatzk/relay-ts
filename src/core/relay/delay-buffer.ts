import { createServer, type Server, type Socket } from 'node:net';
import type { Logger } from 'pino';

export interface DelayBufferOptions {
  host: string;
  port: number;
  delaySeconds: number;
  enabled: boolean;
  maxBytes: number;
  fallbackBitrateKbps?: number;
  catchupRate?: number;
  autoTick?: boolean;
  logger: Logger;
}

interface BufferEntry {
  at: number;
  data: Buffer;
}

const PACING_WINDOW_SEC = 60;
const PACING_MIN_WINDOW_SEC = 3;
const MAX_BURST_BYTES = 512 * 1024;
const MIN_STEADY_BURST_BYTES = 64 * 1024;
const STEADY_BURST_MS = 150;
const MAX_WRITE_AHEAD_BYTES = 8 * 1024 * 1024;
const TICK_MS = 10;
const CATCHUP_START_EXCESS_MS = 500;
const CATCHUP_STOP_EXCESS_MS = 100;
const ZERO_DELAY_CATCHUP_START_MS = 250;
const ZERO_DELAY_CATCHUP_STOP_MS = 50;

function clampCatchupRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1.01;
  return Math.min(1.1, Math.max(1, Math.round(rate * 1000) / 1000));
}

/**
 * Lossless delay line between source and output.
 *
 * The source ffmpeg writes MPEG-TS to the relay's ingest port. This class
 * listens on the playback port, holds packets for the configured delay and
 * forwards them paced at the measured source bitrate, so the encoder never
 * receives TikTok's network bursts. When excess buffer accumulates, a gentle
 * catch-up multiplier (1.01x by default) drains the backlog smoothly.
 */
export class DelayBuffer {
  private readonly options: DelayBufferOptions;
  private readonly queue: BufferEntry[] = [];
  private head = 0;
  private bytes = 0;
  private totalBytes = 0;
  private droppedBytes = 0;
  private forwardedBytes = 0;
  private arrivalBuckets = new Map<number, number>();
  private forwardedBuckets = new Map<number, number>();
  private tokens = MAX_BURST_BYTES;
  private lastTick: number | null = null;
  private server?: Server;
  private output?: Socket;
  private timer?: NodeJS.Timeout;
  private delaySeconds: number;
  private enabled: boolean;
  private maxBytes: number;
  private catchupRate: number;
  private catchingUp = false;
  private initialBurstPending = false;

  constructor(options: DelayBufferOptions) {
    this.options = options;
    this.delaySeconds = options.enabled ? options.delaySeconds : 0;
    this.enabled = options.enabled;
    this.maxBytes = options.maxBytes;
    this.catchupRate = clampCatchupRate(options.catchupRate ?? 1.01);
  }

  async start(): Promise<void> {
    this.server = createServer({ allowHalfOpen: false }, (socket) => this.handlePlaybackClient(socket));
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
    if (this.options.autoTick !== false) {
      this.timer = setInterval(() => this.tick(), TICK_MS);
      this.timer.unref();
    }
    this.options.logger.info(
      {
        port: this.options.port,
        delaySeconds: this.delaySeconds,
        enabled: this.enabled,
        catchupRate: this.catchupRate,
      },
      'Delay-Puffer gestartet',
    );
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.output?.destroy();
    this.output = undefined;
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = undefined;
    }
  }

  private handlePlaybackClient(socket: Socket): void {
    socket.setNoDelay(true);
    if (this.output && this.output !== socket) {
      this.options.logger.warn('Neuer Ausgabe-Client verbunden; alter Client wird getrennt');
      this.output.destroy();
    }
    this.output = socket;
    if (this.delaySeconds === 0) {
      // On zero-delay reconnects, drop stale backlog older than 2s so the sink
      // immediately receives fresh live packets instead of old mid-GOP data.
      this.trimToMaxAge(Date.now(), 2_000);
    }
    this.initialBurstPending = true;
    this.tokens = Math.min(MAX_BURST_BYTES, Math.max(this.tokens, 256 * 1024));
    this.options.logger.info({ remote: `${socket.remoteAddress}:${socket.remotePort}` }, 'Playback-Client verbunden');
    socket.on('close', () => {
      if (this.output === socket) {
        this.output = undefined;
        this.options.logger.warn('Playback-Client getrennt');
      }
    });
    socket.on('error', (error) => {
      this.options.logger.warn({ err: error.message }, 'Playback-Client-Fehler');
    });
    this.tick();
  }

  enqueue(data: Buffer, now = Date.now()): void {
    if (data.length === 0) return;
    this.queue.push({ at: now, data });
    this.bytes += data.length;
    this.totalBytes += data.length;
    const sec = Math.floor(now / 1000);
    this.arrivalBuckets.set(sec, (this.arrivalBuckets.get(sec) ?? 0) + data.length);
    this.trim(now);
  }

  reset(): void {
    if (this.bytes > 0) {
      this.options.logger.info({ bytes: this.bytes }, 'Delay-Puffer wird geleert');
    }
    this.queue.length = 0;
    this.head = 0;
    this.bytes = 0;
    this.arrivalBuckets.clear();
    this.forwardedBuckets.clear();
    this.catchingUp = false;
    this.lastTick = null;
    this.initialBurstPending = false;
    this.tokens = Math.min(MAX_BURST_BYTES, Math.max(this.tokens, 128 * 1024));
  }

  setDelay(seconds: number, enabled = this.enabled): void {
    this.delaySeconds = enabled ? Math.max(0, seconds) : 0;
    this.enabled = enabled;
    this.trim(Date.now());
  }

  setMaxBytes(bytes: number): void {
    this.maxBytes = Math.max(1024, bytes);
    this.trim(Date.now());
  }

  setCatchupRate(rate: number): void {
    this.catchupRate = clampCatchupRate(rate);
    if (this.catchupRate <= 1) {
      this.catchingUp = false;
    }
  }

  private trim(now: number): void {
    const maxAge =
      this.delaySeconds > 0
        ? Math.max(120_000, this.delaySeconds * 1000 + 60_000)
        : 12_000;
    this.trimToMaxAge(now, maxAge);
  }

  private trimToMaxAge(now: number, maxAge: number): void {
    while (this.head < this.queue.length && now - this.queue[this.head]!.at > maxAge) {
      this.droppedBytes += this.queue[this.head]!.data.length;
      this.bytes -= this.queue[this.head]!.data.length;
      this.head += 1;
    }
    while (this.bytes > this.maxBytes && this.head < this.queue.length - 1) {
      const entry = this.queue[this.head]!;
      this.droppedBytes += entry.data.length;
      this.bytes -= entry.data.length;
      this.head += 1;
    }
    if (this.head > 1024) {
      this.queue.splice(0, this.head);
      this.head = 0;
    }
  }

  private measureRate(now: number): number {
    const currentSec = Math.floor(now / 1000);
    const cutoffSec = currentSec - PACING_WINDOW_SEC;
    for (const sec of this.arrivalBuckets.keys()) {
      if (sec < cutoffSec) this.arrivalBuckets.delete(sec);
    }
    for (const sec of this.forwardedBuckets.keys()) {
      if (sec < cutoffSec) this.forwardedBuckets.delete(sec);
    }

    if (this.arrivalBuckets.size >= 2) {
      let minSec = Infinity;
      let maxSec = -Infinity;
      let totalBytes = 0;
      for (const [sec, bytes] of this.arrivalBuckets) {
        if (sec < minSec) minSec = sec;
        if (sec > maxSec) maxSec = sec;
        totalBytes += bytes;
      }
      const spanSec = maxSec - minSec;
      if (spanSec >= PACING_MIN_WINDOW_SEC && totalBytes > 0) {
        return totalBytes / spanSec;
      }
    }
    return ((this.options.fallbackBitrateKbps ?? 6000) * 1000) / 8;
  }

  /** Exposed for deterministic tests. */
  tick(now = Date.now()): void {
    const elapsed = this.lastTick === null ? 0 : Math.max(0, Math.min(now - this.lastTick, 1000));
    this.lastTick = now;
    this.trim(now);

    const delayMs = this.delaySeconds * 1000;
    const oldestAt = this.head < this.queue.length ? this.queue[this.head]!.at : null;
    const bufferAgeMs = oldestAt !== null ? Math.max(0, now - oldestAt) : 0;
    const excessMs = Math.max(0, bufferAgeMs - delayMs);
    const startThreshold = delayMs > 0 ? CATCHUP_START_EXCESS_MS : ZERO_DELAY_CATCHUP_START_MS;
    const stopThreshold = delayMs > 0 ? CATCHUP_STOP_EXCESS_MS : ZERO_DELAY_CATCHUP_STOP_MS;

    if (this.catchupRate <= 1 || oldestAt === null) {
      this.catchingUp = false;
    } else if (!this.catchingUp && excessMs > startThreshold) {
      this.catchingUp = true;
    } else if (this.catchingUp && excessMs <= stopThreshold) {
      this.catchingUp = false;
    }

    const baseRate = this.measureRate(now);
    const multiplier = this.catchingUp
      ? excessMs > 4_000
        ? Math.max(this.catchupRate, 1.06)
        : this.catchupRate
      : 1;
    const effectiveRate = baseRate * multiplier;
    const burstCap = this.initialBurstPending
      ? MAX_BURST_BYTES
      : Math.min(
          MAX_BURST_BYTES,
          Math.max(MIN_STEADY_BURST_BYTES, Math.round((effectiveRate * STEADY_BURST_MS) / 1000)),
        );
    this.tokens = Math.min(burstCap, this.tokens + (effectiveRate * elapsed) / 1000);

    const output = this.output;
    if (!output || output.destroyed || !output.writable) return;
    while (this.head < this.queue.length) {
      const entry = this.queue[this.head]!;
      if (now - entry.at < delayMs) break;
      if (output.writableLength > MAX_WRITE_AHEAD_BYTES) break;
      if (this.tokens < entry.data.length) break;
      output.write(entry.data);
      this.initialBurstPending = false;
      this.tokens -= entry.data.length;
      this.forwardedBytes += entry.data.length;
      const sec = Math.floor(now / 1000);
      this.forwardedBuckets.set(sec, (this.forwardedBuckets.get(sec) ?? 0) + entry.data.length);
      this.bytes -= entry.data.length;
      this.head += 1;
    }

    if (this.head >= this.queue.length) {
      this.catchingUp = false;
    }

    if (this.head > 0 && (this.head > 1024 || this.head === this.queue.length)) {
      this.queue.splice(0, this.head);
      this.head = 0;
    }
  }

  private rateFromBuckets(buckets: Map<number, number>): number | null {
    if (buckets.size < 2) return null;
    let minSec = Infinity;
    let maxSec = -Infinity;
    let totalBytes = 0;
    for (const [sec, bytes] of buckets) {
      if (sec < minSec) minSec = sec;
      if (sec > maxSec) maxSec = sec;
      totalBytes += bytes;
    }
    const spanSec = maxSec - minSec;
    if (spanSec < 1 || totalBytes <= 0) return null;
    return (totalBytes / spanSec) * 8 / 1000;
  }

  stats(now = Date.now()): {
    outputConnected: boolean;
    bufferedBytes: number;
    bufferSeconds: number;
    excessSeconds: number;
    catchingUp: boolean;
    pacingMultiplier: number;
    catchupRate: number;
    droppedBytes: number;
    delaySeconds: number;
    pacingKbps: number | null;
    totalBytes: number;
    forwardedBytes: number;
  } {
    const oldest = this.head < this.queue.length ? this.queue[this.head]!.at : null;
    const bufferMs = oldest !== null ? Math.max(0, now - oldest) : 0;
    const excessMs = Math.max(0, bufferMs - this.delaySeconds * 1000);
    return {
      outputConnected: Boolean(this.output && !this.output.destroyed),
      bufferedBytes: this.bytes,
      bufferSeconds: oldest !== null ? Math.round(bufferMs / 100) / 10 : 0,
      excessSeconds: oldest !== null ? Math.round(excessMs / 100) / 10 : 0,
      catchingUp: this.catchingUp,
      pacingMultiplier: this.catchingUp ? this.catchupRate : 1,
      catchupRate: this.catchupRate,
      droppedBytes: this.droppedBytes,
      delaySeconds: this.delaySeconds,
      pacingKbps: this.rateFromBuckets(this.forwardedBuckets) ?? this.rateFromBuckets(this.arrivalBuckets),
      totalBytes: this.totalBytes,
      forwardedBytes: this.forwardedBytes,
    };
  }
}
