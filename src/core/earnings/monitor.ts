import type { Logger } from 'pino';
import type { Settings, StreamerConfig } from '../config/schema.js';
import { normalizeHandle } from '../../utils/format.js';
import { incMetric } from '../metrics.js';

export const EARNINGS_PERIOD_LABELS: Record<string, string> = {
  today: 'Heute',
  '24h': 'Letzte 24 h',
  '7d': 'Letzte 7 Tage',
  '30d': 'Letzte 30 Tage',
  all: 'Gesamt',
};

export interface EarningsRates {
  usd_per_diamond: number | null;
  gross_usd_per_coin: number | null;
  usd_to_eur_rate: number | null;
}

export interface EarningsTopGift {
  name: string;
  coins: number | null;
  count: number | null;
}

export interface EarningsTopGifter {
  username: string;
  display_name: string | null;
  coins: number | null;
}

export interface EarningsSession {
  id: string | null;
  started_at: string | null;
  ended_at: string | null;
  status: string | null;
  peak_viewers: number | null;
  last_fan_tickets: number | null;
  coins: number | null;
  gifts: number | null;
  net: number | null;
  gross: number | null;
  currency: 'EUR' | 'USD';
}

export interface EarningsDiagnostics {
  state: string | null;
  is_running: boolean | null;
  connected_since: string | null;
  last_event_at: string | null;
  last_message: string | null;
  reconnect_attempts: number | null;
  current_viewers: number | null;
  peak_viewers: number | null;
  room_fan_tickets: number | null;
  gifts_received_session: number | null;
  coins_received_session: number | null;
  session_id: string | null;
}

export type EarningsStatus =
  | 'unconfigured'
  | 'disabled'
  | 'inactive'
  | 'checking'
  | 'missing'
  | 'error'
  | 'ok';

export interface EarningsSnapshot {
  enabled: boolean;
  configured: boolean;
  status: EarningsStatus;
  streamer_id: string | null;
  streamer_name: string | null;
  streamer_handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  room_id: string | null;
  is_live: boolean | null;
  period: string;
  period_label: string;
  view: 'compact' | 'standard' | 'detailed';
  net: number | null;
  gross: number | null;
  coins: number | null;
  viewers: number | null;
  followers: number | null;
  gifts: number | null;
  gifts_sent: number | null;
  gifters: number | null;
  currency: 'EUR' | 'USD';
  session: EarningsSession | null;
  top_gift: EarningsTopGift | null;
  top_gifter: EarningsTopGifter | null;
  rates: EarningsRates | null;
  diagnostics: EarningsDiagnostics | null;
  last_seen_at: string | null;
  source: string | null;
  updated_at: string | null;
  last_run_at: string | null;
  missing: boolean;
  error: string | null;
}

export interface EarningsMonitorOptions {
  settings: Settings;
  logger: Logger;
  getActive: () => StreamerConfig | null;
  onUpdate: (snapshot: EarningsSnapshot, overlayText: string) => void;
}

type ParsedEarnings = Pick<
  EarningsSnapshot,
  | 'display_name'
  | 'avatar_url'
  | 'room_id'
  | 'is_live'
  | 'period'
  | 'net'
  | 'gross'
  | 'coins'
  | 'viewers'
  | 'followers'
  | 'gifts'
  | 'gifts_sent'
  | 'gifters'
  | 'currency'
  | 'session'
  | 'top_gift'
  | 'top_gifter'
  | 'rates'
  | 'diagnostics'
  | 'last_seen_at'
>;

function emptySnapshot(settings: Settings): EarningsSnapshot {
  const configured = Boolean(settings.earnings.source_url.trim());
  return {
    enabled: settings.earnings.enabled && configured,
    configured,
    status: !configured ? 'unconfigured' : settings.earnings.enabled ? 'inactive' : 'disabled',
    streamer_id: null,
    streamer_name: null,
    streamer_handle: null,
    display_name: null,
    avatar_url: null,
    room_id: null,
    is_live: null,
    period: settings.earnings.period,
    period_label: EARNINGS_PERIOD_LABELS[settings.earnings.period] ?? settings.earnings.period,
    view: settings.earnings.view,
    net: null,
    gross: null,
    coins: null,
    viewers: null,
    followers: null,
    gifts: null,
    gifts_sent: null,
    gifters: null,
    currency: 'EUR',
    session: null,
    top_gift: null,
    top_gifter: null,
    rates: null,
    diagnostics: null,
    last_seen_at: null,
    source: safeSource(settings.earnings.source_url),
    updated_at: null,
    last_run_at: null,
    missing: false,
    error: null,
  };
}

function safeSource(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return null;
  }
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    let text = value.trim().replace(/\s/g, '');
    for (const marker of ['EUR', 'USD', '€', '$']) text = text.replaceAll(marker, '');
    if (text.includes(',') && text.includes('.')) {
      text = text.lastIndexOf(',') > text.lastIndexOf('.')
        ? text.replaceAll('.', '').replace(',', '.')
        : text.replaceAll(',', '');
    } else if (text.includes(',')) {
      text = text.replace(',', '.');
    }
    const parsed = Number(text);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function boolOrNull(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'live', 'online', 'streaming'].includes(text)) return true;
  if (['0', 'false', 'no', 'off', 'offline', 'ended', 'not_live'].includes(text)) return false;
  return null;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
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
    const value = stringOrNull(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function pickBool(record: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = boolOrNull(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function handleOf(item: Record<string, unknown>): string {
  const value =
    item.username ??
    item.unique_id ??
    item.uniqueId ??
    item.handle ??
    item.tiktok ??
    item.streamer_username ??
    item.streamerUsername ??
    item.id;
  if (value && typeof value === 'object') {
    const nested = value as Record<string, unknown>;
    return normalizeHandle(
      String(nested.username ?? nested.unique_id ?? nested.uniqueId ?? nested.handle ?? ''),
    );
  }
  return typeof value === 'string' ? normalizeHandle(value) : '';
}

function mergeMissing(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (target[key] === undefined || target[key] === null || target[key] === '') {
      target[key] = value;
    }
  }
}

function extractEntries(payload: unknown): {
  entries: Record<string, unknown>[];
  rates: EarningsRates;
  period: string;
  single: boolean;
} {
  const rates = { ...emptyRates() };
  let period = '';
  if (!payload || typeof payload !== 'object') {
    return { entries: [], rates, period, single: false };
  }
  const root = payload as Record<string, unknown>;
  mergeRates(rates, recordOrNull(root.rates));
  mergeRates(rates, recordOrNull(root.settings));
  const data = recordOrNull(root.data);
  if (data) {
    mergeRates(rates, recordOrNull(data.rates));
    mergeRates(rates, recordOrNull(data.settings));
  }
  if (typeof root.period === 'string') period = root.period.trim();

  const detail = recordOrNull(root.streamer);
  if (detail && handleOf(detail)) {
    const merged = { ...detail };
    mergeMissing(merged, recordOrNull(root.summary) ?? {});
    mergeMissing(merged, recordOrNull(root.totals) ?? {});
    if (Array.isArray(root.sessions)) merged.__sessions = root.sessions;
    if (recordOrNull(root.active_session)) merged.active_session = root.active_session;
    if (recordOrNull(root.worker_diagnostics)) {
      merged.worker_diagnostics = root.worker_diagnostics;
    }
    mergeRates(rates, recordOrNull(root.rates));
    return { entries: [merged], rates, period, single: true };
  }

  const lists = [root.streamers, root.data, root.items, root.results, root.channels, payload];
  for (const candidate of lists) {
    if (Array.isArray(candidate)) {
      return {
        entries: candidate.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === 'object' && !Array.isArray(item),
        ),
        rates,
        period,
        single: candidate === payload,
      };
    }
    const record = recordOrNull(candidate);
    if (record) {
      for (const nestedKey of ['streamers', 'items', 'results', 'channels']) {
        const nested = record[nestedKey];
        if (Array.isArray(nested)) {
          return {
            entries: nested.filter(
              (item): item is Record<string, unknown> =>
                Boolean(item) && typeof item === 'object' && !Array.isArray(item),
            ),
            rates,
            period,
            single: false,
          };
        }
      }
      if (handleOf(record)) {
        return { entries: [record], rates, period, single: true };
      }
    }
  }
  return { entries: [], rates, period, single: false };
}

function emptyRates(): EarningsRates {
  return { usd_per_diamond: null, gross_usd_per_coin: null, usd_to_eur_rate: null };
}

function mergeRates(target: EarningsRates, source: Record<string, unknown> | null): void {
  if (!source) return;
  target.usd_per_diamond ??=
    pickNumber(source, ['usd_per_diamond', 'usdPerDiamond']);
  target.gross_usd_per_coin ??=
    pickNumber(source, ['gross_usd_per_coin', 'grossUsdPerCoin']);
  target.usd_to_eur_rate ??=
    pickNumber(source, ['usd_to_eur_rate', 'usdToEurRate']);
}

function parseTopGift(value: unknown): EarningsTopGift | null {
  if (typeof value === 'string' && value.trim()) {
    return { name: value.trim(), coins: null, count: null };
  }
  const record = recordOrNull(value);
  if (!record) return null;
  const name = pickString(record, ['gift_name', 'giftName', 'name', 'title']);
  if (!name) return null;
  return {
    name,
    coins: pickNumber(record, ['coins', 'total_coins', 'diamond_count']),
    count: pickNumber(record, ['count', 'total', 'qty', 'quantity']),
  };
}

function parseTopGifter(value: unknown): EarningsTopGifter | null {
  if (typeof value === 'string' && value.trim()) {
    return { username: value.trim(), display_name: null, coins: null };
  }
  const record = recordOrNull(value);
  if (!record) return null;
  const username = pickString(record, [
    'sender_username',
    'senderUsername',
    'username',
    'unique_id',
    'name',
  ]);
  if (!username) return null;
  return {
    username,
    display_name: pickString(record, ['display_name', 'displayName', 'nickname']),
    coins: pickNumber(record, ['coins', 'total_coins', 'diamond_count']),
  };
}

function parseDiagnostics(value: unknown): EarningsDiagnostics | null {
  const record = recordOrNull(value);
  if (!record) return null;
  const parsed: EarningsDiagnostics = {
    state: pickString(record, ['state', 'status']),
    is_running: pickBool(record, ['is_running', 'isRunning', 'running']),
    connected_since: pickString(record, ['connected_since', 'connectedSince']),
    last_event_at: pickString(record, ['last_event_at', 'lastEventAt']),
    last_message: pickString(record, ['last_message', 'lastMessage']),
    reconnect_attempts: pickNumber(record, ['reconnect_attempts', 'reconnectAttempts']),
    current_viewers: pickNumber(record, ['current_viewers', 'currentViewers']),
    peak_viewers: pickNumber(record, ['peak_viewers', 'peakViewers']),
    room_fan_tickets: pickNumber(record, ['room_fan_tickets', 'roomFanTickets']),
    gifts_received_session: pickNumber(record, [
      'gifts_received_session',
      'giftsReceivedSession',
      'gift_events',
    ]),
    coins_received_session: pickNumber(record, [
      'coins_received_session',
      'coinsReceivedSession',
      'session_coins',
    ]),
    session_id: stringOrNull(record.session_id ?? record.sessionId),
  };
  return Object.values(parsed).some((item) => item !== null) ? parsed : null;
}

function parseSession(
  item: Record<string, unknown>,
  rates: EarningsRates,
  fallbackCurrency: 'EUR' | 'USD',
): EarningsSession | null {
  const active = recordOrNull(item.active_session) ?? recordOrNull(item.activeSession);
  const sessions = Array.isArray(item.__sessions)
    ? item.__sessions.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
      )
    : [];
  const selected =
    active ??
    sessions.find((entry) => String(entry.status ?? '').toLowerCase() === 'active') ??
    sessions[0] ??
    null;
  const worker = recordOrNull(item.worker_diagnostics) ?? recordOrNull(item.workerDiagnostics);

  const coins =
    pickNumber(selected ?? {}, ['session_coins', 'total_coins', 'coins']) ??
    pickNumber(worker ?? {}, ['coins_received_session', 'session_coins']);
  let usdNet =
    pickNumber(selected ?? {}, ['usd_net', 'usdNet']) ??
    (coins !== null && rates.usd_per_diamond !== null ? coins * rates.usd_per_diamond : null);
  let eurNet =
    pickNumber(selected ?? {}, ['eur_net', 'eurNet']) ??
    (usdNet !== null && rates.usd_to_eur_rate !== null ? usdNet * rates.usd_to_eur_rate : null);
  let usdGross =
    pickNumber(selected ?? {}, ['usd_gross', 'usdGross']) ??
    (coins !== null && rates.gross_usd_per_coin !== null
      ? coins * rates.gross_usd_per_coin
      : null);
  let eurGross =
    pickNumber(selected ?? {}, ['eur_gross', 'eurGross']) ??
    (usdGross !== null && rates.usd_to_eur_rate !== null ? usdGross * rates.usd_to_eur_rate : null);

  const hasSession =
    selected !== null ||
    worker !== null ||
    coins !== null ||
    usdNet !== null ||
    eurNet !== null;
  if (!hasSession) return null;

  const currency: 'EUR' | 'USD' =
    eurNet !== null || eurGross !== null
      ? 'EUR'
      : usdNet !== null || usdGross !== null
        ? 'USD'
        : fallbackCurrency;
  usdNet = usdNet === null ? null : Math.round(usdNet * 100) / 100;
  eurNet = eurNet === null ? null : Math.round(eurNet * 100) / 100;
  usdGross = usdGross === null ? null : Math.round(usdGross * 100) / 100;
  eurGross = eurGross === null ? null : Math.round(eurGross * 100) / 100;

  return {
    id:
      stringOrNull(selected?.id ?? selected?.session_id ?? worker?.session_id) ?? null,
    started_at:
      pickString(selected ?? {}, ['started_at', 'startedAt']) ??
      pickString(worker ?? {}, ['connected_since', 'connectedSince']),
    ended_at: pickString(selected ?? {}, ['ended_at', 'endedAt']),
    status: pickString(selected ?? {}, ['status']),
    peak_viewers:
      pickNumber(selected ?? {}, ['peak_viewers', 'peakViewers']) ??
      pickNumber(worker ?? {}, ['peak_viewers', 'peakViewers']),
    last_fan_tickets:
      pickNumber(selected ?? {}, ['last_fan_tickets', 'lastFanTickets']) ??
      pickNumber(worker ?? {}, ['room_fan_tickets', 'roomFanTickets']),
    coins,
    gifts:
      pickNumber(selected ?? {}, ['gift_events', 'gifts_received_session']) ??
      pickNumber(worker ?? {}, ['gifts_received_session', 'gift_events']),
    net: currency === 'EUR' ? eurNet ?? usdNet : usdNet,
    gross: currency === 'EUR' ? eurGross : usdGross,
    currency,
  };
}

function parseEntry(
  entry: Record<string, unknown>,
  rates: EarningsRates,
  period: string,
): ParsedEarnings {
  mergeRates(rates, recordOrNull(entry.rates));
  mergeRates(rates, recordOrNull(entry.__rates));
  const coins = pickNumber(entry, ['total_coins', 'coins', 'diamonds', 'diamond_count']);
  let usdNet = pickNumber(entry, ['usd_net', 'usdNet', 'net_usd']);
  let eurNet = pickNumber(entry, ['eur_net', 'eurNet', 'net_eur']);
  let usdGross = pickNumber(entry, ['usd_gross', 'usdGross', 'gross_usd']);
  let eurGross = pickNumber(entry, ['eur_gross', 'eurGross', 'gross_eur']);

  if (coins !== null) {
    if (usdNet === null && rates.usd_per_diamond !== null) usdNet = coins * rates.usd_per_diamond;
    if (usdGross === null && rates.gross_usd_per_coin !== null) {
      usdGross = coins * rates.gross_usd_per_coin;
    }
  }
  if (usdNet !== null && eurNet === null && rates.usd_to_eur_rate !== null) {
    eurNet = usdNet * rates.usd_to_eur_rate;
  }
  if (usdGross !== null && eurGross === null && rates.usd_to_eur_rate !== null) {
    eurGross = usdGross * rates.usd_to_eur_rate;
  }

  const currency: 'EUR' | 'USD' =
    eurNet !== null || eurGross !== null
      ? 'EUR'
      : usdNet !== null || usdGross !== null
        ? 'USD'
        : 'EUR';
  const round = (value: number | null): number | null =>
    value === null ? null : Math.round(value * 100) / 100;

  return {
    display_name: pickString(entry, ['display_name', 'displayName', 'nickname', 'name']),
    avatar_url: pickString(entry, ['avatar_url', 'avatarUrl', 'avatar', 'profile_picture']),
    room_id: pickString(entry, ['room_id', 'roomId']),
    is_live: pickBool(entry, ['is_live', 'isLive', 'live', 'online', 'is_online', 'isOnline']),
    period,
    net: currency === 'EUR' ? round(eurNet) ?? round(usdNet) : round(usdNet),
    gross: currency === 'EUR' ? round(eurGross) : round(usdGross),
    coins,
    viewers: pickNumber(entry, ['current_viewers', 'currentViewers', 'viewers', 'user_count']),
    followers: pickNumber(entry, ['follower_count', 'followerCount', 'followers']),
    gifts: pickNumber(entry, ['gift_events_count', 'giftEventsCount', 'gift_events']),
    gifts_sent: pickNumber(entry, ['total_gifts_sent', 'totalGiftsSent', 'gifts_sent']),
    gifters: pickNumber(entry, ['unique_gifters', 'uniqueGifters', 'gifters']),
    currency,
    session: parseSession(entry, rates, currency),
    top_gift: parseTopGift(entry.top_gift ?? entry.topGift),
    top_gifter: parseTopGifter(
      entry.top_gifter ?? entry.topGifter ?? entry.top_supporter ?? entry.topSupporter,
    ),
    rates: { ...rates },
    diagnostics:
      parseDiagnostics(entry.worker_diagnostics) ??
      parseDiagnostics(entry.workerDiagnostics),
    last_seen_at: pickString(entry, ['last_seen_at', 'lastSeenAt', 'last_seen']),
  };
}

export function parseEarningsPayload(
  payload: unknown,
  streamer: StreamerConfig | null,
): ParsedEarnings | null {
  if (!payload || typeof payload !== 'object' || !streamer) return null;
  const { entries, rates, period, single } = extractEntries(payload);
  const wanted = normalizeHandle(streamer.tiktok);
  const handles = new Set([wanted, streamer.id.toLowerCase(), normalizeHandle(streamer.name)]);
  let entry = entries.find((item) => handles.has(handleOf(item))) ?? null;
  if (!entry && single && entries.length === 1) entry = entries[0] ?? null;
  if (!entry) return null;
  return parseEntry(entry, rates, period);
}

export function formatEarningsOverlay(template: string, snapshot: EarningsSnapshot): string {
  const value = (number: number | null, digits = 2): string =>
    number === null ? '–' : number.toFixed(digits);
  const session = snapshot.session;
  return template
    .replaceAll('{period}', snapshot.period_label || snapshot.period || '–')
    .replaceAll('{net}', value(snapshot.net))
    .replaceAll('{gross}', value(snapshot.gross))
    .replaceAll('{coins}', snapshot.coins === null ? '–' : String(Math.round(snapshot.coins)))
    .replaceAll('{gifts}', snapshot.gifts === null ? '–' : String(Math.round(snapshot.gifts)))
    .replaceAll('{gifters}', snapshot.gifters === null ? '–' : String(Math.round(snapshot.gifters)))
    .replaceAll('{session_net}', value(session?.net ?? null))
    .replaceAll('{session_gross}', value(session?.gross ?? null))
    .replaceAll(
      '{session_coins}',
      session?.coins === null || session?.coins === undefined
        ? '–'
        : String(Math.round(session.coins)),
    )
    .replaceAll('{viewers}', snapshot.viewers === null ? '–' : String(Math.round(snapshot.viewers)))
    .replaceAll(
      '{followers}',
      snapshot.followers === null ? '–' : String(Math.round(snapshot.followers)),
    )
    .replaceAll('{live}', snapshot.is_live === null ? '–' : snapshot.is_live ? 'LIVE' : 'offline')
    .replaceAll('{top_gift}', snapshot.top_gift?.name ?? '–')
    .replaceAll('{top_gifter}', snapshot.top_gifter?.username ?? '–')
    .replaceAll('{display_name}', snapshot.display_name ?? snapshot.streamer_name ?? '–')
    .replaceAll('{last_seen}', snapshot.last_seen_at ?? '–')
    .replaceAll('{name}', snapshot.streamer_name ?? '–')
    .replaceAll('{username}', snapshot.streamer_handle ?? '–')
    .replaceAll('{currency}', snapshot.currency);
}

/**
 * Optional TokTracker-compatible earnings source. Polls the active streamer's
 * earnings and feeds both the dashboard and an optional text overlay.
 */
export class EarningsMonitor {
  private options: EarningsMonitorOptions;
  private timer?: NodeJS.Timeout;
  private snapshot: EarningsSnapshot;
  private lastErrorLog = 0;

  constructor(options: EarningsMonitorOptions) {
    this.options = options;
    this.snapshot = emptySnapshot(options.settings);
  }

  start(): void {
    this.stop();
    const settings = this.options.settings.earnings;
    const configured = Boolean(settings.source_url.trim());
    this.snapshot = {
      ...emptySnapshot(this.options.settings),
      enabled: settings.enabled && configured,
      configured,
      status: !configured ? 'unconfigured' : settings.enabled ? 'inactive' : 'disabled',
      source: safeSource(settings.source_url),
    };
    this.emit();
    if (!settings.enabled || !configured) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), Math.max(30, settings.interval) * 1000);
    this.options.logger.info({ interval: settings.interval }, 'Earnings-Monitor gestartet');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  updateSettings(settings: Settings): void {
    const previous = this.options.settings;
    this.options.settings = settings;
    this.snapshot = {
      ...this.snapshot,
      enabled: settings.earnings.enabled && Boolean(settings.earnings.source_url.trim()),
      configured: Boolean(settings.earnings.source_url.trim()),
      period: settings.earnings.period,
      period_label: EARNINGS_PERIOD_LABELS[settings.earnings.period] ?? settings.earnings.period,
      view: settings.earnings.view,
      source: safeSource(settings.earnings.source_url),
    };
    if (
      previous.earnings.enabled !== settings.earnings.enabled ||
      previous.earnings.source_url !== settings.earnings.source_url ||
      previous.earnings.api_key !== settings.earnings.api_key ||
      previous.earnings.interval !== settings.earnings.interval ||
      previous.earnings.period !== settings.earnings.period
    ) {
      this.start();
    } else {
      this.emit();
    }
  }

  setActive(): void {
    const active = this.options.getActive();
    const settings = this.options.settings.earnings;
    const sameStreamer = active?.id === this.snapshot.streamer_id;
    const next: EarningsSnapshot = {
      ...(sameStreamer
        ? this.snapshot
        : {
            ...emptySnapshot(this.options.settings),
            enabled: settings.enabled && Boolean(settings.source_url.trim()),
            configured: Boolean(settings.source_url.trim()),
          }),
      streamer_id: active?.id ?? null,
      streamer_name: active?.name ?? null,
      streamer_handle: active ? normalizeHandle(active.tiktok) : null,
    };
    if (!sameStreamer) {
      next.status = !next.configured
        ? 'unconfigured'
        : !next.enabled
          ? 'disabled'
          : active
            ? 'checking'
            : 'inactive';
      next.missing = false;
      next.error = null;
    }
    this.snapshot = next;
    this.emit();
    if (this.snapshot.configured && this.snapshot.enabled && active) void this.poll();
  }

  get(): EarningsSnapshot {
    const active = this.options.getActive();
    return {
      ...this.snapshot,
      streamer_id: active?.id ?? null,
      streamer_name: active?.name ?? null,
      streamer_handle: active ? normalizeHandle(active.tiktok) : null,
    };
  }

  async refresh(): Promise<EarningsSnapshot> {
    await this.poll();
    return this.get();
  }

  private emit(): void {
    const snapshot = this.get();
    this.options.onUpdate(
      snapshot,
      formatEarningsOverlay(this.options.settings.earnings.overlay_template, snapshot),
    );
  }

  private prepareUrl(streamer: StreamerConfig): string {
    const raw = this.options.settings.earnings.source_url.trim();
    if (!raw) return '';
    let url = raw;
    if (url.includes('{username}') || url.includes('{streamer}')) {
      const handle = encodeURIComponent(normalizeHandle(streamer.tiktok));
      url = url.replaceAll('{username}', handle).replaceAll('{streamer}', handle);
    }
    try {
      const parsed = new URL(url);
      if (!parsed.searchParams.has('period')) {
        parsed.searchParams.set('period', this.options.settings.earnings.period);
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }

  private async poll(): Promise<void> {
    const settings = this.options.settings.earnings;
    const configured = Boolean(settings.source_url.trim());
    const enabled = settings.enabled && configured;
    const streamer = this.options.getActive();
    const base: EarningsSnapshot = {
      ...this.snapshot,
      enabled,
      configured,
      period: settings.period,
      period_label: EARNINGS_PERIOD_LABELS[settings.period] ?? settings.period,
      view: settings.view,
      source: safeSource(settings.source_url),
      streamer_id: streamer?.id ?? null,
      streamer_name: streamer?.name ?? null,
      streamer_handle: streamer ? normalizeHandle(streamer.tiktok) : null,
      last_run_at: new Date().toISOString(),
    };
    if (!configured || !enabled || !streamer) {
      this.snapshot = {
        ...base,
        status: !configured ? 'unconfigured' : !enabled ? 'disabled' : 'inactive',
        missing: false,
        error: null,
        updated_at: null,
        ...emptyValues(),
      };
      this.emit();
      return;
    }
    try {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (settings.api_key) headers['x-api-key'] = settings.api_key;
      const response = await fetch(this.prepareUrl(streamer), {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as unknown;
      const parsed = parseEarningsPayload(payload, streamer);
      if (!parsed) {
        this.snapshot = {
          ...base,
          status: 'missing',
          missing: true,
          error: null,
          updated_at: base.last_run_at,
          ...emptyValues(),
        };
        this.emit();
        return;
      }
      this.snapshot = {
        ...base,
        ...parsed,
        status: 'ok',
        missing: false,
        error: null,
        updated_at: base.last_run_at,
      };
      this.emit();
    } catch (error) {
      incMetric('earnings_poll_errors_total');
      const message = error instanceof Error ? error.message : String(error);
      this.snapshot = {
        ...base,
        status: 'error',
        missing: false,
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

function emptyValues(): Pick<
  EarningsSnapshot,
  | 'display_name'
  | 'avatar_url'
  | 'room_id'
  | 'is_live'
  | 'net'
  | 'gross'
  | 'coins'
  | 'viewers'
  | 'followers'
  | 'gifts'
  | 'gifts_sent'
  | 'gifters'
  | 'session'
  | 'top_gift'
  | 'top_gifter'
  | 'rates'
  | 'diagnostics'
  | 'last_seen_at'
  | 'currency'
> {
  return {
    display_name: null,
    avatar_url: null,
    room_id: null,
    is_live: null,
    net: null,
    gross: null,
    coins: null,
    viewers: null,
    followers: null,
    gifts: null,
    gifts_sent: null,
    gifters: null,
    session: null,
    top_gift: null,
    top_gifter: null,
    rates: null,
    diagnostics: null,
    last_seen_at: null,
    currency: 'EUR',
  };
}
