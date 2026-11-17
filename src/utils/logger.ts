import { Writable } from 'node:stream';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pino, { type Logger } from 'pino';

export type { Logger };

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  time: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

const LEVEL_NAMES: Record<number, LogLevel> = {
  10: 'debug',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'error',
};

export class LogRing {
  private readonly entries: LogEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 1500) {
    this.maxEntries = maxEntries;
  }

  push(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
  }

  list(filter: { level?: LogLevel; q?: string; limit?: number } = {}): LogEntry[] {
    const minimum = filter.level ? levelWeight(filter.level) : 0;
    const query = filter.q?.trim().toLowerCase();
    let result = this.entries.filter((entry) => {
      if (levelWeight(entry.level) < minimum) return false;
      if (query) {
        const haystack = `${entry.msg} ${JSON.stringify(entry)}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    if (filter.limit && filter.limit > 0) {
      result = result.slice(-filter.limit);
    }
    return result;
  }

  clear(): void {
    this.entries.length = 0;
  }
}

function levelWeight(level: LogLevel): number {
  return { debug: 0, info: 1, warn: 2, error: 3 }[level];
}

class RingStream extends Writable {
  constructor(
    private readonly ring: LogRing,
    private readonly onEntry?: (entry: LogEntry) => void,
  ) {
    super({ objectMode: false });
  }

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
    const text = chunk.toString();
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const raw = JSON.parse(line) as Record<string, unknown>;
        const entry: LogEntry = {
          ...raw,
          time:
            typeof raw.time === 'number'
              ? new Date(raw.time).toISOString()
              : String(raw.time ?? new Date().toISOString()),
          level: LEVEL_NAMES[Number(raw.level)] ?? 'info',
          msg: String(raw.msg ?? ''),
        };
        this.ring.push(entry);
        this.onEntry?.(entry);
      } catch {
        // Ignore malformed fragments from concurrent writes.
      }
    }
    callback();
  }
}

export interface LoggerOptions {
  level?: LogLevel;
  logFile?: string;
  redact?: string[];
  ring?: LogRing;
  onEntry?: (entry: LogEntry) => void;
  pretty?: boolean;
}

export interface LoggerBundle {
  logger: Logger;
  ring: LogRing;
  flush: () => Promise<void>;
}

export function createLogger(options: LoggerOptions = {}): LoggerBundle {
  const ring = options.ring ?? new LogRing();
  const level = options.level ?? 'info';
  const streams: pino.StreamEntry[] = [
    { level, stream: process.stdout },
    { level, stream: new RingStream(ring, options.onEntry) },
  ];

  let fileDestination: pino.DestinationStream | undefined;
  if (options.logFile) {
    mkdirSync(dirname(options.logFile), { recursive: true });
    fileDestination = pino.destination({ dest: options.logFile, sync: false, mkdir: true });
    streams.push({ level, stream: fileDestination });
  }

  const logger = pino(
    {
      level,
      base: { service: 'restreamer-ts', pid: process.pid },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'youtube_key',
          '*.youtube_key',
          'streamKey',
          '*.streamKey',
          'api_key',
          '*.api_key',
          'sessionid',
          '*.sessionid',
        ],
        censor: '***',
      },
    },
    pino.multistream(streams, { dedupe: false }),
  );

  return {
    logger,
    ring,
    flush: async () => {
      await new Promise<void>((resolve) => {
        if (!fileDestination) return resolve();
        const destination = fileDestination as unknown as { flush?: (callback: () => void) => void };
        if (destination.flush) destination.flush(() => resolve());
        else resolve();
        setTimeout(resolve, 500);
      });
    },
  };
}

/** Redact secrets from free-form text (ffmpeg/yt-dlp output, RTMP URLs, ...). */
export function redactSecrets(text: string, secrets: Iterable<string>): string {
  let result = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) {
      result = result.split(secret).join('***');
    }
  }
  return result;
}

export function secretRedactor(): { add: (secret: string | undefined | null) => void; apply: (text: string) => string } {
  const secrets = new Set<string>();
  return {
    add(secret) {
      if (secret && secret.length >= 4) secrets.add(secret);
    },
    apply(text) {
      return redactSecrets(text, secrets);
    },
  };
}
