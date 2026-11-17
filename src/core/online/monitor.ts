import type { Logger } from 'pino';
import type { Settings, StreamerConfig } from '../config/schema.js';
import { normalizeHandle } from '../../utils/format.js';

export interface OnlineMonitorOptions {
  settings: Settings;
  logger: Logger;
  onStatuses: (statuses: Map<string, boolean>) => void;
}

const TRUE_VALUES = new Set(['live', 'online', 'true', '1', 'yes', 'streaming']);
const FALSE_VALUES = new Set(['offline', 'false', '0', 'no', 'ended']);

export const TOKTRACKER_OVERVIEW_URL = 'https://positronium.dev/track/api/public/overview';

export function isTokTrackerUrl(sourceUrl: string): boolean {
  try {
    const url = new URL(sourceUrl);
    return (
      url.hostname.endsWith('positronium.dev') &&
      url.pathname.replace(/\/+$/, '').endsWith('/track/api/public/overview')
    );
  } catch {
    return false;
  }
}

/**
 * TokTracker's public overview returns:
 * { streamers: [{ username, display_name, is_live, is_tracking_active, ... }] }
 * Only `is_live` is authoritative for our status display.
 */
export function parseTokTrackerStatuses(payload: unknown): Map<string, boolean> {
  const result = new Map<string, boolean>();
  if (!payload || typeof payload !== 'object') return result;
  const record = payload as Record<string, unknown>;
  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray(record.streamers)
      ? record.streamers
      : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const handle =
      item.username ?? item.unique_id ?? item.uniqueId ?? item.handle ?? item.tiktok;
    if (typeof handle !== 'string') continue;
    const live = parseLiveValue(item.is_live ?? item.isLive ?? item.live);
    if (live === null) continue;
    const normalized = normalizeHandle(handle);
    if (normalized) result.set(normalized, live);
  }
  return result;
}

const METADATA_KEYS = new Set([
  'enabled',
  'ok',
  'success',
  'error',
  'count',
  'total',
  'limit',
  'offset',
  'page',
  'period',
  'streamer_count',
  'live_count',
  'tracking_count',
  'totals',
  'banner',
  'rates',
  'recent_gifts',
  'last_seen_at',
  'updated_at',
  'checked_at',
]);

const CONTAINER_KEYS = [
  'streamers',
  'data',
  'items',
  'results',
  'result',
  'channels',
  'list',
] as const;

/**
 * Polls an external overview API (e.g. TokTracker) and maps handles to a
 * live/offline boolean. The parser accepts common API shapes, so users are not
 * locked into a single provider.
 */
export class OnlineMonitor {
  private options: OnlineMonitorOptions;
  private timer?: NodeJS.Timeout;
  private statuses = new Map<string, boolean>();
  private lastErrorLog = 0;
  private lastPollAt: Date | null = null;

  constructor(options: OnlineMonitorOptions) {
    this.options = options;
  }

  start(): void {
    this.stop();
    const { enabled, source_url, interval } = this.options.settings.online;
    if (!enabled || !source_url.trim()) {
      if (this.statuses.size > 0) {
        this.statuses.clear();
        this.options.onStatuses(new Map());
      }
      return;
    }
    void this.poll();
    this.timer = setInterval(() => void this.poll(), Math.max(10, interval) * 1000);
    this.options.logger.info({ interval }, 'Online-Monitor gestartet');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  updateSettings(settings: Settings): void {
    const previous = this.options.settings;
    this.options.settings = settings;
    if (
      previous.online.enabled !== settings.online.enabled ||
      previous.online.source_url !== settings.online.source_url ||
      previous.online.api_key !== settings.online.api_key ||
      previous.online.interval !== settings.online.interval
    ) {
      this.start();
    }
  }

  isOnline(streamer: StreamerConfig): boolean | null {
    const handle = normalizeHandle(streamer.tiktok);
    if (this.statuses.has(handle)) return this.statuses.get(handle)!;
    if (this.statuses.has(streamer.id.toLowerCase())) return this.statuses.get(streamer.id.toLowerCase())!;
    return null;
  }

  get lastPoll(): Date | null {
    return this.lastPollAt;
  }

  async checkNow(): Promise<void> {
    await this.poll();
  }

  private async poll(): Promise<void> {
    const { source_url, api_key } = this.options.settings.online;
    if (!source_url) return;
    try {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (api_key) headers['x-api-key'] = api_key;
      const response = await fetch(source_url, { headers, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) {
        this.logError(`HTTP ${response.status}`);
        return;
      }
      const payload = (await response.json()) as unknown;
      this.statuses = isTokTrackerUrl(source_url)
        ? parseTokTrackerStatuses(payload)
        : parseOnlineStatuses(payload);
      this.lastPollAt = new Date();
      this.options.onStatuses(this.statuses);
    } catch (error) {
      this.logError(error instanceof Error ? error.message : String(error));
    }
  }

  private logError(message: string): void {
    const now = Date.now();
    if (now - this.lastErrorLog < 300_000) return;
    this.lastErrorLog = now;
    this.options.logger.warn({ err: message }, 'Online-Monitor: Abruf fehlgeschlagen');
  }
}

export function parseOnlineStatuses(payload: unknown): Map<string, boolean> {
  const result = new Map<string, boolean>();

  const setStatus = (handle: unknown, live: unknown): void => {
    if (typeof handle !== 'string') return;
    const normalized = normalizeHandle(handle);
    if (!normalized || METADATA_KEYS.has(normalized)) return;
    const parsed = parseLiveValue(live);
    if (parsed !== null) result.set(normalized, parsed);
  };

  const liveOf = (record: Record<string, unknown>): unknown =>
    record.live ?? record.is_live ?? record.isLive ?? record.online ?? record.status;

  const handleRecord = (record: Record<string, unknown>): void => {
    const liveValue = liveOf(record);
    const handleValue =
      record.tiktok ??
      record.handle ??
      record.uniqueId ??
      record.unique_id ??
      record.username ??
      record.name ??
      record.id;
    if (handleValue !== undefined && liveValue !== undefined) {
      setStatus(handleValue, liveValue);
    }
  };

  const visit = (value: unknown, depth = 0): void => {
    if (depth > 5 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        const before = result.size;
        handleRecord(record);
        if (result.size === before) {
          visit(record.data ?? record.streamer ?? record.user, depth + 1);
        }
      }
      return;
    }
    if (typeof value !== 'object') return;

    const record = value as Record<string, unknown>;
    // A single streamer object (not a map): use its own handle directly.
    if (
      (record.username || record.uniqueId || record.unique_id || record.tiktok || record.handle) &&
      (record.live !== undefined ||
        record.is_live !== undefined ||
        record.isLive !== undefined ||
        record.online !== undefined ||
        record.status !== undefined)
    ) {
      handleRecord(record);
      return;
    }

    for (const key of CONTAINER_KEYS) {
      if (key in record) visit(record[key], depth + 1);
    }

    for (const [key, item] of Object.entries(record)) {
      if (CONTAINER_KEYS.includes(key as (typeof CONTAINER_KEYS)[number])) continue;
      if (METADATA_KEYS.has(key.toLowerCase())) continue;
      if (typeof item === 'boolean') {
        setStatus(key, item);
      } else if (typeof item === 'string' || typeof item === 'number') {
        setStatus(key, item);
      } else if (item && typeof item === 'object' && !Array.isArray(item)) {
        const nested = item as Record<string, unknown>;
        const liveValue = liveOf(nested);
        if (liveValue !== undefined) setStatus(key, liveValue);
        else handleRecord(nested);
      }
    }
  };

  visit(payload);
  return result;
}

function parseLiveValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
  }
  return null;
}
