import type { Logger } from 'pino';
import { TikTokLiveConnection } from 'tiktok-live-connector';
import type { ChatMessage } from '../../overlays/chat-service.js';
import { readCookieHeader } from '../resolver.js';

export interface WebcastLiveRoomStats {
  roomId: string | null;
  isLive: boolean;
  viewers: number | null;
  title: string | null;
}

export interface WebcastLiveRoomOptions {
  handle: string;
  logger: Logger;
  cookiesFile?: string;
  onChatMessage?: (msg: ChatMessage) => void;
  onGift?: (gift: { username: string; giftName: string; coins: number; count: number }) => void;
  onViewerUpdate?: (viewers: number) => void;
  onRoomStats?: (stats: WebcastLiveRoomStats) => void;
}

type LiveConnectionInstance = InstanceType<typeof TikTokLiveConnection> & {
  removeAllListeners: () => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  disconnect: () => Promise<void>;
  connect: (roomId?: string) => Promise<{ roomId?: string }>;
};

export class WebcastLiveRoomClient {
  /** Consecutive not-live polls required before the room is reported offline. */
  private static readonly OFFLINE_POLL_THRESHOLD = 3;
  /** A webcast socket with an event inside this window is considered live. */
  private static readonly WEBCAST_EVENT_GRACE_MS = 120_000;

  private readonly handle: string;
  private readonly logger: Logger;
  private readonly cookiesFile?: string;
  private running = false;
  private pollTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private roomId: string | null = null;
  private liveConnection?: LiveConnectionInstance;
  private isLive = false;
  private currentViewers: number | null = null;
  private currentTitle: string | null = null;
  private notLivePolls = 0;
  private lastWebcastEventAt: number | null = null;

  private onChatMessage?: (msg: ChatMessage) => void;
  private onGift?: (gift: { username: string; giftName: string; coins: number; count: number }) => void;
  private onViewerUpdate?: (viewers: number) => void;
  private onRoomStats?: (stats: WebcastLiveRoomStats) => void;

  constructor(options: WebcastLiveRoomOptions) {
    this.handle = options.handle.replace(/^@+/, '');
    this.logger = options.logger;
    this.cookiesFile = options.cookiesFile;
    this.onChatMessage = options.onChatMessage;
    this.onGift = options.onGift;
    this.onViewerUpdate = options.onViewerUpdate;
    this.onRoomStats = options.onRoomStats;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.notLivePolls = 0;
    this.lastWebcastEventAt = null;
    void this.pollRoomInfo();
    // Poll room info every 15 seconds to update viewer counts / title / live status reliably
    this.pollTimer = setInterval(() => void this.pollRoomInfo(), 15_000);
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.pollTimer = undefined;
    this.reconnectTimer = undefined;
    this.disconnectLiveConnection();
  }

  private disconnectLiveConnection(): void {
    if (this.liveConnection) {
      try {
        this.liveConnection.removeAllListeners();
        void this.liveConnection.disconnect();
      } catch {
        // Best-effort cleanup
      }
      this.liveConnection = undefined;
    }
  }

  /**
   * Polls api-live/user/room to get current room status, viewer count and roomId.
   * On live room discovery, connects the real-time WebSocket connection.
   */
  private async pollRoomInfo(): Promise<void> {
    if (!this.running) return;
    try {
      const url = `https://www.tiktok.com/api-live/user/room?aid=1988&sourceType=54&uniqueId=${encodeURIComponent(this.handle)}`;
      // Without a TikTok session cookie the endpoint answers with a stub
      // (status 2, empty title, liveRoomStats.userCount = 0), which used to
      // overwrite the real viewer count every poll.
      const cookie = this.cookiesFile ? readCookieHeader(this.cookiesFile) : null;
      const res = await fetch(url, {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          referer: `https://www.tiktok.com/@${this.handle}/live`,
          accept: 'application/json',
          ...(cookie ? { cookie } : {}),
        },
        signal: AbortSignal.timeout(6000),
      });

      if (!res.ok) return;
      const json = (await res.json()) as Record<string, unknown>;
      const data = json.data as Record<string, unknown> | undefined;
      if (!data) return;

      const user = data.user as Record<string, unknown> | undefined;
      const liveRoom = data.liveRoom as Record<string, unknown> | undefined;

      const status = Number(user?.status ?? liveRoom?.status ?? 0);
      const isLive = status === 2;

      // A single not-live result from the unauthenticated poll must not zero
      // the viewer count while the webcast socket still delivers events.
      // Report offline only after consecutive failures, or when the socket is
      // silent. The authoritative offline signal remains the streamEnd event.
      if (isLive) {
        this.notLivePolls = 0;
        this.isLive = true;
      } else if (!this.confirmOfflinePoll()) {
        return;
      }
      const roomIsLive = this.isLive;

      const liveRoomStats = liveRoom?.liveRoomStats as Record<string, unknown> | undefined;
      const rawViewers = roomIsLive
        ? (liveRoom?.userCount ??
          liveRoom?.user_count ??
          liveRoom?.aliveUserCount ??
          liveRoomStats?.userCount ??
          liveRoomStats?.user_count)
        : 0;

      const viewers = !roomIsLive
        ? 0
        : typeof rawViewers === 'number'
          ? rawViewers
          : typeof rawViewers === 'string'
            ? parseInt(rawViewers, 10) || 0
            : null;

      // The unauthenticated poll may return 0 while the webcast socket is
      // already delivering accurate counts; keep the socket authoritative.
      const socketFresh =
        this.liveConnection !== undefined &&
        this.lastWebcastEventAt !== null &&
        Date.now() - this.lastWebcastEventAt < WebcastLiveRoomClient.WEBCAST_EVENT_GRACE_MS;
      if (!socketFresh && viewers !== null && viewers >= 0) {
        this.currentViewers = viewers;
        this.onViewerUpdate?.(viewers);
      }

      const title = typeof liveRoom?.title === 'string' ? liveRoom.title.trim() : null;
      if (title) this.currentTitle = title;

      const roomId = user?.roomId ? String(user.roomId) : liveRoom?.roomId ? String(liveRoom.roomId) : null;
      if (roomId) this.roomId = roomId;

      this.onRoomStats?.({
        roomId: this.roomId,
        isLive: this.isLive,
        viewers: this.currentViewers,
        title: this.currentTitle,
      });

      // If live and WebSocket not yet connected, initiate connection
      if (roomIsLive && !this.liveConnection && this.running) {
        this.connectWebSocket(this.roomId);
      } else if (!roomIsLive && this.liveConnection) {
        this.disconnectLiveConnection();
      }
    } catch (err) {
      this.logger.debug({ handle: this.handle, err }, 'Live-Room Info Poll fehlgeschlagen');
    }
  }

  /**
   * Decide whether a not-live poll should be reported. False while the
   * webcast socket has delivered an event recently or the consecutive
   * not-live count is below the threshold; the caller keeps its state.
   */
  private confirmOfflinePoll(): boolean {
    if (
      this.liveConnection &&
      this.lastWebcastEventAt !== null &&
      Date.now() - this.lastWebcastEventAt < WebcastLiveRoomClient.WEBCAST_EVENT_GRACE_MS
    ) {
      this.notLivePolls = 0;
      return false;
    }
    this.notLivePolls += 1;
    const confirmed = this.notLivePolls >= WebcastLiveRoomClient.OFFLINE_POLL_THRESHOLD;
    if (confirmed) this.isLive = false;
    return confirmed;
  }

  private connectWebSocket(roomId: string | null): void {
    if (!this.running || this.liveConnection) return;

    try {
      const conn = new TikTokLiveConnection(this.handle, {
        processInitialData: true,
      }) as unknown as LiveConnectionInstance;

      this.liveConnection = conn;

      conn.on('chat', (raw: unknown) => {
        if (!this.running) return;
        this.lastWebcastEventAt = Date.now();
        const data = raw as Record<string, unknown>;
        const userObj = data.user as Record<string, unknown> | undefined;
        const username = String(userObj?.uniqueId || userObj?.displayId || userObj?.nickname || 'Gast');
        const displayName = String(userObj?.nickname || username);
        const text = String(data.content || data.comment || '');
        if (!text) return;

        const common = data.common as Record<string, unknown> | undefined;
        const msgId = String(common?.msgId || `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
        const rawCreateTime = Number(common?.createTime);
        const timestamp =
          Number.isFinite(rawCreateTime) && rawCreateTime > 0
            ? new Date(rawCreateTime < 1e12 ? rawCreateTime * 1000 : rawCreateTime)
            : undefined;

        this.onChatMessage?.({
          id: msgId,
          username,
          displayName,
          text,
          receivedAt: new Date(),
          timestamp,
        });
      });

      conn.on('roomUser', (raw: unknown) => {
        if (!this.running) return;
        this.lastWebcastEventAt = Date.now();
        const data = raw as Record<string, unknown>;
        // `total` is the active viewer count; `totalUser` is cumulative.
        // Newer connector versions expose it as viewerCount (often absent).
        const rawCount = data.viewerCount ?? data.total;
        if (rawCount === undefined || rawCount === null) return;
        const viewerCount = Number(rawCount);
        if (Number.isFinite(viewerCount) && viewerCount >= 0) {
          this.currentViewers = viewerCount;
          this.onViewerUpdate?.(viewerCount);
          this.onRoomStats?.({
            roomId: this.roomId,
            isLive: this.isLive,
            viewers: viewerCount,
            title: this.currentTitle,
          });
        }
      });

      conn.on('gift', (raw: unknown) => {
        if (!this.running || !this.onGift) return;
        this.lastWebcastEventAt = Date.now();
        const data = raw as Record<string, unknown>;
        const userObj = data.user as Record<string, unknown> | undefined;
        const username = String(userObj?.nickname || userObj?.uniqueId || 'Supporter');
        const giftName = String(data.giftName || (data.gift as Record<string, unknown>)?.name || 'Geschenk');
        const coins = Number(data.diamondCount || (data.gift as Record<string, unknown>)?.diamond_count || 1);
        const count = Number(data.repeatCount || data.comboCount || 1);
        this.onGift({ username, giftName, coins, count });
      });

      conn.on('streamEnd', () => {
        this.logger.info({ handle: this.handle }, 'TikTok Live Stream beendet (streamEnd)');
        this.isLive = false;
        this.notLivePolls = 0;
        this.lastWebcastEventAt = null;
        this.onRoomStats?.({
          roomId: this.roomId,
          isLive: false,
          viewers: 0,
          title: this.currentTitle,
        });
        this.disconnectLiveConnection();
      });

      conn.on('disconnected', () => {
        this.logger.debug({ handle: this.handle }, 'TikTok Live WebSocket getrennt');
        this.disconnectLiveConnection();
        // Reconnect after delay if still marked live and running
        if (this.running && this.isLive && !this.reconnectTimer) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            if (this.running && this.isLive) {
              this.connectWebSocket(this.roomId);
            }
          }, 5000);
        }
      });

      conn.on('error', (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.debug({ handle: this.handle, err: msg }, 'TikTok Live WebSocket Fehler');
      });

      // Connect asynchronously
      void (roomId ? conn.connect(roomId) : conn.connect())
        .then((state) => {
          if (!this.running) {
            void conn.disconnect();
            return;
          }
          if (state?.roomId) this.roomId = String(state.roomId);
          this.logger.info({ handle: this.handle, roomId: this.roomId }, 'TikTok Live Room verbunden (WebSocket)');
        })
        .catch((err) => {
          this.logger.debug(
            { handle: this.handle, err: err instanceof Error ? err.message : String(err) },
            'TikTok Live WebSocket Verbindungsaufbau fehlgeschlagen (nutze Polling-Fallback)',
          );
          this.disconnectLiveConnection();
        });
    } catch (err) {
      this.logger.debug({ handle: this.handle, err }, 'Fehler beim Initialisieren der TikTok Live Verbindung');
      this.disconnectLiveConnection();
    }
  }
}
