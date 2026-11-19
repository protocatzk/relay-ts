import { existsSync } from 'node:fs';
import type { Logger } from 'pino';
import { readJsonFile, writeJsonFile } from '../../utils/fs.js';

export type EarningsPeriod = 'today' | '24h' | '7d' | '30d' | 'all';

export const EARNINGS_PERIODS: readonly EarningsPeriod[] = [
  'today',
  '24h',
  '7d',
  '30d',
  'all',
] as const;

export interface EarningsHistoryPoint {
  at: string;
  streamer_id: string;
  period: EarningsPeriod;
  net: number | null;
  gross: number | null;
  coins: number | null;
  currency: 'EUR' | 'USD';
}

export interface EarningsDelta {
  net: number | null;
  gross: number | null;
  coins: number | null;
  since: string | null;
}

interface HistoryFile {
  version: 1;
  points: EarningsHistoryPoint[];
}

const MAX_POINTS = 4000;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MIN_APPEND_INTERVAL_MS = 5 * 60 * 1000;

export function periodStart(period: EarningsPeriod, now = Date.now()): number | null {
  switch (period) {
    case 'today': {
      const date = new Date(now);
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    }
    case '24h':
      return now - 24 * 60 * 60 * 1000;
    case '7d':
      return now - 7 * 24 * 60 * 60 * 1000;
    case '30d':
      return now - 30 * 24 * 60 * 60 * 1000;
    case 'all':
    default:
      return null;
  }
}

function sameValues(left: EarningsHistoryPoint, right: EarningsHistoryPoint): boolean {
  return (
    left.net === right.net &&
    left.gross === right.gross &&
    left.coins === right.coins &&
    left.currency === right.currency
  );
}

/**
 * Compact, privacy-friendly earnings history: only aggregate values per
 * streamer and period are stored. No usernames or gift details.
 */
export class EarningsHistoryStore {
  private readonly path: string | null;
  private readonly logger: Logger;
  private points: EarningsHistoryPoint[] = [];
  private loaded = false;

  constructor(path: string | null, logger: Logger) {
    this.path = path;
    this.logger = logger;
  }

  append(point: EarningsHistoryPoint): void {
    this.load();
    if (point.net == null && point.gross == null && point.coins == null) return;
    const last = [...this.points]
      .reverse()
      .find((item) => item.streamer_id === point.streamer_id && item.period === point.period);
    if (last) {
      const elapsed = Date.parse(point.at) - Date.parse(last.at);
      if (
        Number.isFinite(elapsed) &&
        elapsed >= 0 &&
        elapsed < MIN_APPEND_INTERVAL_MS &&
        sameValues(last, point)
      ) {
        return;
      }
    }
    this.points.push(point);
    this.prune();
    this.persist();
  }

  query(
    streamerId: string | null,
    period: EarningsPeriod,
    limit = 240,
    now = Date.now(),
  ): EarningsHistoryPoint[] {
    this.load();
    const start = periodStart(period, now);
    const filtered = this.points.filter((point) => {
      if (streamerId && point.streamer_id !== streamerId) return false;
      if (point.period !== period) return false;
      if (start !== null && Date.parse(point.at) < start) return false;
      return true;
    });
    return filtered.slice(-Math.max(1, Math.min(limit, 1000)));
  }

  delta(streamerId: string | null, period: EarningsPeriod, now = Date.now()): EarningsDelta | null {
    const points = this.query(streamerId, period, 1000, now);
    if (points.length < 2) return null;
    const first = points[0]!;
    const last = points[points.length - 1]!;
    return {
      net: diff(last.net, first.net),
      gross: diff(last.gross, first.gross),
      coins: diff(last.coins, first.coins),
      since: first.at,
    };
  }

  private prune(): void {
    const cutoff = Date.now() - RETENTION_MS;
    this.points = this.points.filter((point) => {
      const at = Date.parse(point.at);
      return Number.isFinite(at) ? at >= cutoff : false;
    });
    if (this.points.length > MAX_POINTS) {
      this.points = this.points.slice(-MAX_POINTS);
    }
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.path || !existsSync(this.path)) return;
    const raw = readJsonFile<HistoryFile | null>(this.path, null);
    if (!raw || !Array.isArray(raw.points)) return;
    this.points = raw.points.filter((point) => {
      if (!point || typeof point !== 'object') return false;
      if (typeof point.at !== 'string' || typeof point.streamer_id !== 'string') return false;
      if (!EARNINGS_PERIODS.includes(point.period)) return false;
      if (typeof point.currency !== 'string') return false;
      return true;
    });
    this.prune();
  }

  private persist(): void {
    if (!this.path) return;
    try {
      writeJsonFile(this.path, { version: 1, points: this.points } satisfies HistoryFile);
    } catch (error) {
      this.logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'Earnings-Historie konnte nicht gespeichert werden',
      );
    }
  }
}

function diff(current: number | null, baseline: number | null): number | null {
  if (current == null || baseline == null) return null;
  const value = current - baseline;
  return Math.round(value * 100) / 100;
}
