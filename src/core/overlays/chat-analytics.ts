import type { ChatMessage } from './chat-service.js';

export interface ChatAnalyticsSnapshot {
  window_minutes: number;
  total_messages: number;
  messages_per_minute: number;
  peak_per_minute: number;
  unique_chatters: number;
  series: number[];
  top_chatters: { username: string; count: number }[];
  top_badges: { badge: string; count: number }[];
}

interface RecordedEvent {
  at: number;
  username: string;
  badges: string[];
}

const WINDOW_MINUTES = 30;
const WINDOW_MS = WINDOW_MINUTES * 60_000;
const MAX_SEEN_IDS = 5000;

/**
 * In-memory rolling 30-minute chat activity tracker (#37).
 * Consumes messages already fetched by ChatService without extra API calls.
 */
export class ChatAnalytics {
  private events: RecordedEvent[] = [];
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];

  record(messages: ChatMessage[], now = Date.now()): void {
    for (const msg of messages) {
      if (this.seen.has(msg.id)) continue;
      this.seen.add(msg.id);
      this.seenOrder.push(msg.id);
      if (this.seenOrder.length > MAX_SEEN_IDS) {
        const dropped = this.seenOrder.shift();
        if (dropped) this.seen.delete(dropped);
      }
      const at = msg.timestamp?.getTime() ?? msg.receivedAt.getTime();
      const clampedAt = Number.isFinite(at) ? at : now;
      const event: RecordedEvent = {
        at: clampedAt,
        username: msg.displayName || msg.username || 'Chat',
        badges: Array.isArray(msg.badges) ? msg.badges.filter(Boolean) : [],
      };
      if (this.events.length === 0 || clampedAt >= this.events[this.events.length - 1]!.at) {
        this.events.push(event);
      } else {
        let low = 0;
        let high = this.events.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (this.events[mid]!.at <= clampedAt) low = mid + 1;
          else high = mid;
        }
        this.events.splice(low, 0, event);
      }
    }
    this.prune(now);
  }

  reset(): void {
    this.events = [];
    this.seen.clear();
    this.seenOrder.length = 0;
  }

  snapshot(now = Date.now()): ChatAnalyticsSnapshot {
    this.prune(now);
    const series = new Array<number>(WINDOW_MINUTES).fill(0);
    const chatterCounts = new Map<string, number>();
    const badgeCounts = new Map<string, number>();

    const endMinute = Math.floor(now / 60_000);
    const startMinute = endMinute - (WINDOW_MINUTES - 1);

    for (const ev of this.events) {
      const minute = Math.floor(ev.at / 60_000);
      const bucket = minute - startMinute;
      if (bucket >= 0 && bucket < WINDOW_MINUTES) {
        series[bucket] = (series[bucket] ?? 0) + 1;
      }
      chatterCounts.set(ev.username, (chatterCounts.get(ev.username) ?? 0) + 1);
      for (const badge of ev.badges) {
        badgeCounts.set(badge, (badgeCounts.get(badge) ?? 0) + 1);
      }
    }

    const total = this.events.length;
    const peak = series.reduce((max, value) => (value > max ? value : max), 0);
    // Use the last 5 minutes for a responsive current rate, falling back to full window.
    const recent5 = series.slice(-5).reduce((sum, v) => sum + v, 0);
    const messagesPerMinute = Math.round((recent5 / 5) * 10) / 10;

    const topChatters = [...chatterCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([username, count]) => ({ username, count }));

    const topBadges = [...badgeCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([badge, count]) => ({ badge, count }));

    return {
      window_minutes: WINDOW_MINUTES,
      total_messages: total,
      messages_per_minute: messagesPerMinute,
      peak_per_minute: peak,
      unique_chatters: chatterCounts.size,
      series,
      top_chatters: topChatters,
      top_badges: topBadges,
    };
  }

  private prune(now: number): void {
    const cutoff = now - WINDOW_MS;
    let cutoffIdx = 0;
    while (cutoffIdx < this.events.length && this.events[cutoffIdx]!.at < cutoff) {
      cutoffIdx += 1;
    }
    if (cutoffIdx > 0) {
      this.events.splice(0, cutoffIdx);
    }
  }
}
