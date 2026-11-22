import type { Logger } from 'pino';
import type { ChatMessage } from '../../overlays/chat-service.js';

export interface WebcastLiveRoomOptions {
  handle: string;
  logger: Logger;
  cookiesFile?: string;
  onChatMessage?: (msg: ChatMessage) => void;
  onGift?: (gift: { username: string; giftName: string; coins: number; count: number }) => void;
}

export class WebcastLiveRoomClient {
  private readonly handle: string;
  private readonly logger: Logger;
  private running = false;
  private pollTimer?: NodeJS.Timeout;
  private roomId: string | null = null;
  private onChatMessage?: (msg: ChatMessage) => void;
  private onGift?: (gift: { username: string; giftName: string; coins: number; count: number }) => void;

  constructor(options: WebcastLiveRoomOptions) {
    this.handle = options.handle.replace(/^@+/, '');
    this.logger = options.logger;
    this.onChatMessage = options.onChatMessage;
    this.onGift = options.onGift;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.initRoom();
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  private async initRoom(): Promise<void> {
    try {
      // 1. Resolve room ID from tiktok web info
      const url = `https://www.tiktok.com/api-live/user/room?aid=1988&sourceType=54&uniqueId=${encodeURIComponent(this.handle)}`;
      const res = await fetch(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          referer: `https://www.tiktok.com/@${this.handle}/live`,
        },
        signal: AbortSignal.timeout(6000),
      });

      if (!res.ok) return;
      const json = (await res.json()) as Record<string, unknown>;
      const liveRoom = (json.data as Record<string, unknown>)?.liveRoom as Record<string, unknown> | undefined;
      const roomId = liveRoom?.roomId ? String(liveRoom.roomId) : null;

      if (!roomId) {
        return;
      }

      this.roomId = roomId;
      this.logger.info({ handle: this.handle, roomId }, 'Webcast Live-Room Client initialisiert');

      // Poll Webcast IM Fetch
      void this.pollWebcast();
      this.pollTimer = setInterval(() => void this.pollWebcast(), 3000);
    } catch {
      // Best-effort
    }
  }

  private async pollWebcast(): Promise<void> {
    if (!this.running || !this.roomId) return;
    try {
      const imUrl = new URL('https://webcast.tiktok.com/webcast/im/fetch/');
      imUrl.searchParams.set('room_id', this.roomId);
      imUrl.searchParams.set('aid', '1988');
      imUrl.searchParams.set('device_platform', 'web');

      const res = await fetch(imUrl.toString(), {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          referer: 'https://www.tiktok.com/',
        },
        signal: AbortSignal.timeout(4000),
      });

      if (!res.ok) return;
      const json = (await res.json()) as Record<string, unknown>;
      const messages = Array.isArray((json.data as { messages?: unknown[] })?.messages)
        ? (json.data as { messages: Record<string, unknown>[] }).messages
        : [];

      for (const m of messages) {
        const type = String(m.method || '');
        if (type === 'WebcastChatMessage' && this.onChatMessage) {
          const userObj = m.user as { nickname?: string; display_id?: string } | undefined;
          const user = String(userObj?.nickname || userObj?.display_id || 'Gast');
          const content = String(m.content || '');
          if (content) {
            this.onChatMessage({
              id: String(m.id || Date.now()),
              username: user,
              displayName: user,
              text: content,
              receivedAt: new Date(),
            });
          }
        } else if (type === 'WebcastGiftMessage' && this.onGift) {
          const userObj = m.user as { nickname?: string; display_id?: string } | undefined;
          const user = String(userObj?.nickname || userObj?.display_id || 'Supporter');
          const giftObj = m.gift as { name?: string; diamond_count?: number; coins?: number } | undefined;
          const giftName = String(giftObj?.name || 'Geschenk');
          const coins = Number(giftObj?.diamond_count || giftObj?.coins || 1);
          const count = Number((m as { repeat_count?: number; combo_count?: number }).repeat_count || (m as { combo_count?: number }).combo_count || 1);
          this.onGift({ username: user, giftName, coins, count });
        }
      }
    } catch {
      // Silent on background errors
    }
  }
}
