import { Writable } from 'node:stream';
import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync } from 'node:fs';
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

export interface LogQueryFilter {
  level?: LogLevel;
  q?: string;
  streamer?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export interface LogQueryPage {
  lines: LogEntry[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

const LEVEL_NAMES: Record<number, LogLevel> = {
  10: 'debug',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'error',
};

function matchesStreamer(entry: LogEntry, needle: string): boolean {
  const lower = needle.toLowerCase();
  const candidates = [
    entry.streamer,
    entry.streamerId,
    entry.streamer_id,
    entry.channel,
    entry.handle,
    entry.tiktok,
  ];
  for (const field of candidates) {
    if (typeof field === 'string' && field.toLowerCase().includes(lower)) return true;
  }
  const text = `${entry.msg} ${JSON.stringify(entry)}`.toLowerCase();
  return text.includes(lower);
}

export function filterLogEntries(entries: readonly LogEntry[], filter: LogQueryFilter = {}): LogEntry[] {
  const minimum = filter.level ? levelWeight(filter.level) : 0;
  const query = filter.q?.trim().toLowerCase();
  const streamer = filter.streamer?.trim();
  const sinceMs = filter.since ? Date.parse(filter.since) : Number.NaN;
  const untilMs = filter.until ? Date.parse(filter.until) : Number.NaN;

  return entries.filter((entry) => {
    if (levelWeight(entry.level) < minimum) return false;
    if (!Number.isNaN(sinceMs)) {
      const t = Date.parse(entry.time);
      if (!Number.isNaN(t) && t < sinceMs) return false;
    }
    if (!Number.isNaN(untilMs)) {
      const t = Date.parse(entry.time);
      if (!Number.isNaN(t) && t > untilMs) return false;
    }
    if (streamer && !matchesStreamer(entry, streamer)) return false;
    if (query) {
      const haystack = `${entry.msg} ${JSON.stringify(entry)}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export function parseRawLogLine(line: string): LogEntry | null {
  if (!line.trim()) return null;
  try {
    const raw = JSON.parse(line) as Record<string, unknown>;
    const rawLevel = raw.level;
    let level: LogLevel = 'info';
    if (rawLevel === 'debug' || rawLevel === 'info' || rawLevel === 'warn' || rawLevel === 'error') {
      level = rawLevel;
    } else if (typeof rawLevel === 'number' || typeof rawLevel === 'string') {
      level = LEVEL_NAMES[Number(rawLevel)] ?? 'info';
    }
    return {
      ...raw,
      time:
        typeof raw.time === 'number'
          ? new Date(raw.time).toISOString()
          : String(raw.time ?? new Date().toISOString()),
      level,
      msg: String(raw.msg ?? ''),
    };
  } catch {
    return null;
  }
}

/** Read up to the trailing `maxBytes` of a JSONL pino log file for historical search/pagination. */
export function readLogFileEntries(logFile: string, maxBytes = 2 * 1024 * 1024): LogEntry[] {
  if (!logFile || !existsSync(logFile)) return [];
  try {
    const size = statSync(logFile).size;
    if (size === 0) return [];
    const readLength = Math.min(size, maxBytes);
    const start = size - readLength;
    const buffer = Buffer.alloc(readLength);
    const fd = openSync(logFile, 'r');
    try {
      readSync(fd, buffer, 0, readLength, start);
    } finally {
      closeSync(fd);
    }
    const text = buffer.toString('utf8');
    const lines = text.split('\n');
    // Drop possibly truncated leading line when we started mid-file.
    if (start > 0) lines.shift();
    const entries: LogEntry[] = [];
    for (const line of lines) {
      const entry = parseRawLogLine(line);
      if (entry) entries.push(entry);
    }
    return entries;
  } catch {
    return [];
  }
}

export function formatLogsAsText(entries: readonly LogEntry[]): string {
  const omit = new Set(['time', 'level', 'msg', 'pid', 'hostname', 'service']);
  return entries
    .map((entry) => {
      const extra = Object.entries(entry)
        .filter(([key]) => !omit.has(key))
        .map(([key, value]) =>
          value !== null && typeof value === 'object'
            ? `${key}=${JSON.stringify(value)}`
            : `${key}=${String(value)}`,
        )
        .join(' ');
      return `${entry.time} [${entry.level.toUpperCase()}] ${entry.msg}${extra ? ` ${extra}` : ''}`;
    })
    .join('\n');
}

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

  all(): LogEntry[] {
    return [...this.entries];
  }

  list(filter: LogQueryFilter = {}): LogEntry[] {
    let result = filterLogEntries(this.entries, filter);
    if (filter.limit && filter.limit > 0) {
      result = result.slice(-filter.limit);
    }
    return result;
  }

  query(filter: LogQueryFilter = {}, logFile?: string): LogQueryPage {
    const merged: LogEntry[] = [];
    const seen = new Set<string>();
    const add = (entry: LogEntry): void => {
      const key = `${entry.time}|${entry.level}|${entry.msg}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(entry);
    };

    if (logFile) {
      for (const entry of readLogFileEntries(logFile)) add(entry);
    }
    for (const entry of this.entries) add(entry);

    const matched = filterLogEntries(merged, filter);
    const total = matched.length;
    const limit = Math.min(2000, Math.max(1, filter.limit ?? 300));
    const offset = Math.max(0, filter.offset ?? 0);
    // Offset counts backwards from the newest entry so offset=0 returns the latest page.
    const end = Math.max(0, total - offset);
    const start = Math.max(0, end - limit);
    const lines = matched.slice(start, end);

    return {
      lines,
      total,
      offset,
      limit,
      has_more: start > 0,
    };
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
          'stream_key',
          '*.stream_key',
          'api_key',
          '*.api_key',
          'sessionid',
          '*.sessionid',
          'totp_secret',
          '*.totp_secret',
          'totp_code',
          '*.totp_code',
          'recovery_codes',
          '*.recovery_codes',
          'password',
          '*.password',
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
