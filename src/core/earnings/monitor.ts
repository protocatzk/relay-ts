import type { Logger } from 'pino';
import type { Settings, StreamerConfig } from '../config/schema.js';
import { normalizeHandle } from '../../utils/format.js';

export interface EarningsSnapshot {
  enabled: boolean;
  configured: boolean;
  streamer_id: string | null;
  net: number | null;
  gross: number | null;
  coins: number | null;
  viewers: number | null;
  currency: 'EUR' | 'USD';
  top_gift: string | null;
  updated_at: string | null;
  error: string | null;
}

export interface EarningsMonitorOptions {
  settings: Settings;
  logger: Logger;
  getActive: () => StreamerConfig | null;
  onUpdate: (snapshot: EarningsSnapshot, overlayText: string) => void;
}

const EMPTY: EarningsSnapshot = {
  enabled: false,
  configured: false,
  streamer_id: null,
  net: null,
  gross: null,
  coins: null,
  viewers: null,
  currency: 'EUR',
  top_gift: null,
  updated_at: null,
  error: null,
};

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = numberOrNull(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (value && typeof value === 'object') {
      const nested = value as Record<string, unknown>;
      const name = nested.gift_name ?? nested.name ?? nested.title;
      if (typeof name === 'string' && name.trim()) return name;
    }
  }
  return null;
}

export function parseEarningsPayload(
  payload: unknown,
  streamer: StreamerConfig | null,
): Omit<EarningsSnapshot, 'enabled' | 'configured' | 'streamer_id' | 'updated_at' | 'error'> {
  const empty = {
    net: null,
    gross: null,
    coins: null,
    viewers: null,
    currency: 'EUR' as const,
    top_gift: null,
  };
  if (!payload || typeof payload !== 'object' || !streamer) return empty;
  const record = payload as Record<string, unknown>;
  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray(record.streamers)
      ? record.streamers
      : [record];
  const handles = new Set([
    normalizeHandle(streamer.tiktok),
    streamer.id.toLowerCase(),
    normalizeHandle(streamer.name),
  ]);
  let entry: Record<string, unknown> | null = null;
  for (const item of entries) {
    if (!item || typeof item !== 'object') continue;
    const itemRecord = item as Record<string, unknown>;
    const handle = itemRecord.username ?? itemRecord.unique_id ?? itemRecord.tiktok ?? itemRecord.id;
    if (typeof handle === 'string' && handles.has(normalizeHandle(handle))) {
      entry = itemRecord;
      break;
    }
  }
  if (!entry && entries.length === 1 && !Array.isArray(record.streamers)) {
    entry = (entries[0] as Record<string, unknown>) ?? null;
  }
  if (!entry) return empty;

  const eurNet = pickNumber(entry, ['eur_net', 'eurNet']);
  const usdNet = pickNumber(entry, ['usd_net', 'usdNet']);
  const eurGross = pickNumber(entry, ['eur_gross', 'eurGross']);
  const usdGross = pickNumber(entry, ['usd_gross', 'usdGross']);
  const currency: 'EUR' | 'USD' = eurNet !== null || eurGross !== null ? 'EUR' : 'USD';
  return {
    net:
      eurNet ??
      usdNet ??
      pickNumber(entry, ['net', 'net_earnings', 'earnings', 'total_earnings', 'revenue']),
    gross:
      eurGross ??
      usdGross ??
      pickNumber(entry, ['gross', 'gross_earnings', 'revenue_gross']),
    coins: pickNumber(entry, ['total_coins', 'coins', 'diamonds', 'diamond_count']),
    viewers: pickNumber(entry, ['current_viewers', 'viewers', 'user_count', 'viewer_count']),
    currency,
    top_gift: pickString(entry, ['top_gift', 'topGift', 'top_gifter', 'top_supporter']),
  };
}

export function formatEarningsOverlay(template: string, snapshot: EarningsSnapshot): string {
  const value = (number: number | null, digits = 2): string =>
    number === null ? '–' : number.toFixed(digits);
  return template
    .replaceAll('{net}', value(snapshot.net))
    .replaceAll('{gross}', value(snapshot.gross))
    .replaceAll('{coins}', snapshot.coins === null ? '–' : String(Math.round(snapshot.coins)))
    .replaceAll('{viewers}', snapshot.viewers === null ? '–' : String(Math.round(snapshot.viewers)))
    .replaceAll('{top_gift}', snapshot.top_gift ?? '–')
    .replaceAll('{currency}', snapshot.currency);
}

/**
 * Optional TokTracker-compatible earnings source. Polls the active streamer's
 * earnings and feeds both the dashboard and an optional text overlay.
 */
export class EarningsMonitor {
  private options: EarningsMonitorOptions;
  private timer?: NodeJS.Timeout;
  private snapshot: EarningsSnapshot = { ...EMPTY };
  private lastErrorLog = 0;

  constructor(options: EarningsMonitorOptions) {
    this.options = options;
  }

  start(): void {
    this.stop();
    const { enabled, source_url, interval } = this.options.settings.earnings;
    this.snapshot = {
      ...EMPTY,
      enabled,
      configured: Boolean(enabled && source_url.trim()),
    };
    this.emit();
    if (!enabled || !source_url.trim()) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), Math.max(30, interval) * 1000);
    this.options.logger.info({ interval }, 'Earnings-Monitor gestartet');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  updateSettings(settings: Settings): void {
    const previous = this.options.settings;
    this.options.settings = settings;
    if (
      previous.earnings.enabled !== settings.earnings.enabled ||
      previous.earnings.source_url !== settings.earnings.source_url ||
      previous.earnings.api_key !== settings.earnings.api_key ||
      previous.earnings.interval !== settings.earnings.interval
    ) {
      this.start();
    }
  }

  setActive(): void {
    this.snapshot = {
      ...this.snapshot,
      streamer_id: this.options.getActive()?.id ?? null,
    };
    this.emit();
    if (this.snapshot.configured) void this.poll();
  }

  get(): EarningsSnapshot {
    return { ...this.snapshot, streamer_id: this.options.getActive()?.id ?? null };
  }

  async refresh(): Promise<EarningsSnapshot> {
    await this.poll();
    return this.get();
  }

  private emit(): void {
    const active = this.options.getActive();
    const snapshot: EarningsSnapshot = {
      ...this.snapshot,
      streamer_id: active?.id ?? null,
    };
    this.options.onUpdate(
      snapshot,
      formatEarningsOverlay(this.options.settings.earnings.overlay_template, snapshot),
    );
  }

  private async poll(): Promise<void> {
    const { enabled, source_url, api_key } = this.options.settings.earnings;
    if (!enabled || !source_url.trim()) return;
    const streamer = this.options.getActive();
    if (!streamer) {
      this.snapshot = {
        ...this.snapshot,
        enabled: true,
        configured: true,
        streamer_id: null,
        updated_at: new Date().toISOString(),
        error: null,
      };
      this.emit();
      return;
    }
    try {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (api_key) headers['x-api-key'] = api_key;
      const response = await fetch(source_url, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as unknown;
      const values = parseEarningsPayload(payload, streamer);
      this.snapshot = {
        enabled: true,
        configured: true,
        streamer_id: streamer.id,
        ...values,
        updated_at: new Date().toISOString(),
        error: null,
      };
      this.emit();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.snapshot = {
        ...this.snapshot,
        enabled: true,
        configured: true,
        streamer_id: streamer.id,
        error: message,
      };
      const now = Date.now();
      if (now - this.lastErrorLog > 300_000) {
        this.lastErrorLog = now;
        this.options.logger.warn({ err: message }, 'Earnings-Monitor: Abruf fehlgeschlagen');
      }
      this.emit();
    }
  }
}
