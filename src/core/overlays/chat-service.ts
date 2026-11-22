import type { Logger } from 'pino';
import type { ChatOverlayConfig, Settings, StreamerConfig } from '../config/schema.js';
import { normalizeHandle } from '../../utils/format.js';
import { incMetric } from '../metrics.js';
import { WebcastLiveRoomClient } from '../source/webcast/live-room-client.js';

export interface ChatMessage {
  id: string;
  username: string;
  displayName?: string;
  text: string;
  badges?: string[];
  tier?: string;
  receivedAt: Date;
  timestamp?: Date;
}

export interface ChatServiceOptions {
  streamer: StreamerConfig;
  chat: Settings['overlays']['chat'];
  settings: Settings;
  logger: Logger;
  onMessages: (messages: ChatMessage[]) => void;
  onViewerUpdate?: (viewers: number) => void;
  onRoomStats?: (stats: { roomId: string | null; isLive: boolean; viewers: number | null; title: string | null }) => void;
}

interface ParsedMessage {
  id?: string;
  user?: string;
  displayName?: string;
  text?: string;
  timestamp?: number;
  streamer?: string;
  badges?: string[];
  tier?: string;
}

const MAX_SEEN = 500;

export class ChatService {
  private readonly options: ChatServiceOptions;
  private timer?: NodeJS.Timeout;
  private pump?: NodeJS.Timeout;
  private messages: ChatMessage[] = [];
  private seen = new Set<string>();
  private seenOrder: string[] = [];
  private stopped = false;
  private lastErrorLog = 0;
  private lastFingerprint = '';
  private config: ChatOverlayConfig;
  private webcastClient?: WebcastLiveRoomClient;

  constructor(options: ChatServiceOptions) {
    this.options = options;
    this.config = options.chat;
  }

  private get apiUrl(): string {
    return (this.config.api_url || this.options.settings.chat.api_url || '').trim();
  }

  private get apiKey(): string {
    return (this.config.api_key || this.options.settings.chat.api_key || '').trim();
  }

  start(): void {
    if (!this.config.enabled) return;

    // Start direct Webcast client for real-time messages and viewer stats
    this.webcastClient = new WebcastLiveRoomClient({
      handle: this.options.streamer.tiktok,
      logger: this.options.logger,
      onChatMessage: (msg) => {
        this.addIncomingMessage(msg);
      },
      onViewerUpdate: (viewers) => {
        this.options.onViewerUpdate?.(viewers);
      },
      onRoomStats: (stats) => {
        this.options.onRoomStats?.(stats);
      },
    });
    this.webcastClient.start();

    if (!this.apiUrl && !this.config.api_url) {
      this.options.logger.info(
        { streamer: this.options.streamer.id },
        'Chat-Overlay aktiv, aber keine Chat-API-URL konfiguriert',
      );
      return;
    }
    this.stopped = false;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), Math.max(1, this.config.poll_interval) * 1000);
    this.pump = setInterval(() => this.publish(), 1000);
    this.options.logger.info(
      { streamer: this.options.streamer.id, interval: this.config.poll_interval },
      'Chat-Overlay gestartet',
    );
  }

  stop(clear = true): void {
    this.stopped = true;
    if (this.webcastClient) {
      this.webcastClient.stop();
      this.webcastClient = undefined;
    }
    if (this.timer) clearInterval(this.timer);
    if (this.pump) clearInterval(this.pump);
    this.timer = undefined;
    this.pump = undefined;
    if (!clear) return;
    this.messages = [];
    this.seen.clear();
    this.seenOrder = [];
    this.options.onMessages([]);
  }

  private addIncomingMessage(msg: ChatMessage, immediatePublish = true): boolean {
    if (this.seen.has(msg.id)) return false;

    // Deduplication by user (username or displayName) + text within a 60-second window
    // (Prevents identical messages coming from both WebSocket Webcast & REST API polling
    // even when IDs, username vs nickname, or poll/clock timestamps differ)
    const msgNames = [msg.username, msg.displayName]
      .filter((v): v is string => Boolean(v && v.trim()))
      .map((v) => v.toLowerCase().trim());
    const normalizedText = (msg.text || '').trim();
    const msgTime = (msg.timestamp ?? msg.receivedAt).getTime();
    const msgReceived = msg.receivedAt.getTime();

    const isDuplicate = this.messages.some((existing) => {
      if (existing.id === msg.id) return true;
      const existingText = (existing.text || '').trim();
      if (existingText !== normalizedText) return false;
      const existingNames = [existing.username, existing.displayName]
        .filter((v): v is string => Boolean(v && v.trim()))
        .map((v) => v.toLowerCase().trim());
      if (!msgNames.some((n) => existingNames.includes(n))) return false;
      const existingTime = (existing.timestamp ?? existing.receivedAt).getTime();
      const existingReceived = existing.receivedAt.getTime();
      return (
        Math.abs(msgTime - existingTime) < 60_000 ||
        Math.abs(msgReceived - existingReceived) < 60_000
      );
    });

    if (isDuplicate) return false;

    this.seen.add(msg.id);
    this.seenOrder.push(msg.id);
    if (this.seenOrder.length > MAX_SEEN) {
      const dropped = this.seenOrder.shift();
      if (dropped) this.seen.delete(dropped);
    }

    this.messages.push(msg);
    if (this.messages.length > 80) this.messages = this.messages.slice(-80);

    if (immediatePublish) {
      // If delay is 0, publish directly; otherwise timer pump or publish handles it
      const delayMs = this.delayMilliseconds();
      if (delayMs === 0) {
        this.publish();
      } else {
        // Also call onMessages directly for real-time subscribers if delay is disabled
        this.publish();
      }
    }
    return true;
  }

  private buildUrl(): string {
    const template = this.apiUrl;
    if (!template) return '';
    const handle = normalizeHandle(this.options.streamer.tiktok);
    let result = template;
    if (template.includes('{handle}')) result = template.replaceAll('{handle}', encodeURIComponent(handle));
    else if (template.includes('{tiktok}')) {
      result = template.replaceAll('{tiktok}', encodeURIComponent(this.options.streamer.tiktok));
    }
    try {
      const parsed = new URL(result);
      // TokTracker-compatible chat APIs accept these pagination parameters.
      // DESC gives us the newest batch; it is reversed before storing so the
      // overlay shows messages in chronological order.
      if (!parsed.searchParams.has('limit')) parsed.searchParams.set('limit', '100');
      if (!parsed.searchParams.has('order_dir')) parsed.searchParams.set('order_dir', 'DESC');
      return parsed.toString();
    } catch {
      return result;
    }
  }

  private async poll(): Promise<void> {
    if (this.stopped) return;
    const url = this.buildUrl();
    if (!url) return;
    try {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (this.apiKey) {
        headers['x-api-key'] = this.apiKey;
        headers.authorization = `Bearer ${this.apiKey}`;
      }
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        this.logError(`Chat-API antwortete mit HTTP ${response.status}`);
        return;
      }
      const payload = (await response.json()) as unknown;
      const parsed = extractMessages(payload);
      let descending = false;
      try {
        descending = new URL(url).searchParams.get('order_dir')?.toUpperCase() === 'DESC';
      } catch {
        descending = false;
      }
      if (descending) parsed.reverse();
      const activeHandle = normalizeHandle(this.options.streamer.tiktok);
      let added = 0;
      for (const item of parsed) {
        if (!item.text) continue;
        if (item.streamer && normalizeHandle(item.streamer) !== activeHandle) continue;
        const id = item.id || `${item.user ?? ''}:${item.text}:${item.timestamp ?? ''}`;
        const didAdd = this.addIncomingMessage({
          id,
          username: (item.user || 'Chat').slice(0, 40),
          displayName: item.displayName?.slice(0, 60),
          text: item.text.slice(0, 300),
          badges: item.badges,
          tier: item.tier,
          receivedAt: new Date(),
          timestamp:
            item.timestamp !== undefined
              ? new Date(item.timestamp < 1e12 ? item.timestamp * 1000 : item.timestamp)
              : undefined,
        }, false);
        if (didAdd) added += 1;
      }
      if (added > 0) this.publish();
    } catch (error) {
      this.logError(error instanceof Error ? error.message : String(error));
    }
  }

  private logError(message: string): void {
    incMetric('chat_poll_errors_total');
    const now = Date.now();
    if (now - this.lastErrorLog < 120_000) return;
    this.lastErrorLog = now;
    this.options.logger.warn({ streamer: this.options.streamer.id, err: message }, 'Chat-Overlay: Abruf fehlgeschlagen');
  }

  private delayMilliseconds(): number {
    const configured = Math.max(0, this.config.delay);
    const delaySeconds =
      configured === 0 && this.options.settings.delay_buffer.enabled
        ? this.options.settings.delay_buffer.size
        : configured;
    return delaySeconds * 1000;
  }

  private publish(): void {
    if (this.stopped) return;
    const now = Date.now();
    // Align chat with the delayed video: 0 means "use the delay buffer size".
    const delayMs = this.delayMilliseconds();
    const visible = this.messages.filter((message) => message.receivedAt.getTime() + delayMs <= now);
    const fingerprint = visible.map((message) => `${message.id}:${message.text}`).join('\n');
    if (fingerprint === this.lastFingerprint) return;
    this.lastFingerprint = fingerprint;
    this.options.onMessages(visible);
  }

  /** Used by the dashboard's overlay test button. */
  injectMessage(username: string, text: string): ChatMessage[] {
    const delayMs = this.delayMilliseconds();
    const message: ChatMessage = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      username: username.slice(0, 40) || 'Test',
      text: text.slice(0, 300) || 'Testnachricht',
      receivedAt: new Date(Date.now() - delayMs - 1000),
      timestamp: new Date(),
    };
    this.messages.push(message);
    if (this.messages.length > 80) this.messages = this.messages.slice(-80);
    this.publish();
    return this.messages.filter(
      (item) => item.receivedAt.getTime() + delayMs <= Date.now(),
    );
  }
}

function extractArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  for (const key of ['messages', 'comments', 'chat', 'items', 'data', 'result', 'results']) {
    const value = record[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      const nested = extractArray(value);
      if (nested.length > 0) return nested;
    }
  }
  // Map of handle -> messages
  const flattened: unknown[] = [];
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) flattened.push(...value);
  }
  return flattened;
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function extractMessages(payload: unknown): ParsedMessage[] {
  const items = extractArray(payload);
  const result: ParsedMessage[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const userRecord =
      record.user && typeof record.user === 'object' ? (record.user as Record<string, unknown>) : {};
    const user =
      record.username ??
      (typeof record.user === 'string' ? record.user : undefined) ??
      record.uniqueId ??
      record.unique_id ??
      record.nickname ??
      record.display_name ??
      record.displayName ??
      record.author ??
      userRecord.uniqueId ??
      userRecord.unique_id ??
      userRecord.nickname ??
      userRecord.display_name ??
      userRecord.displayName;
    const text = record.comment ?? record.text ?? record.message ?? record.content ?? record.msg;
    if (typeof text !== 'string') continue;
    const displayName =
      record.nickname ??
      record.display_name ??
      record.displayName ??
      userRecord.nickname ??
      userRecord.display_name ??
      userRecord.displayName;
    const tierValue = record.whale_tier ?? record.whaleTier ?? record.tier;
    const badges: string[] = [];
    const badgeValue = record.badges ?? record.user_badges ?? userRecord.badges;
    if (Array.isArray(badgeValue)) {
      for (const badge of badgeValue) {
        if (typeof badge === 'string') badges.push(badge);
      }
    } else if (typeof badgeValue === 'string') {
      badges.push(badgeValue);
    }
    if (record.is_whale || record.isWhale) badges.push('whale');
    const id =
      record.id ??
      record.msgId ??
      record.messageId ??
      record.message_id ??
      record.commentId ??
      record.cursor ??
      record.createTime ??
      undefined;
    const timestamp =
      numberOrUndefined(record.createTime) ??
      numberOrUndefined(record.created_at) ??
      numberOrUndefined(record.timestamp) ??
      numberOrUndefined(record.time) ??
      numberOrUndefined(record.ts);
    result.push({
      id: id !== undefined ? String(id) : undefined,
      user: typeof user === 'string' ? user : 'Chat',
      displayName: typeof displayName === 'string' ? displayName : undefined,
      text,
      timestamp,
      badges: badges.length > 0 ? badges : undefined,
      tier: typeof tierValue === 'string' ? tierValue.toLowerCase() : undefined,
      streamer:
        typeof (record.streamer_username ?? record.streamer ?? record.channel) === 'string'
          ? String(record.streamer_username ?? record.streamer ?? record.channel)
          : undefined,
    });
  }
  return result;
}
