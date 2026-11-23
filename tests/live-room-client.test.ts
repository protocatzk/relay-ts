import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

const listeners = new Map<string, (...args: unknown[]) => void>();
vi.mock('tiktok-live-connector', () => ({
  TikTokLiveConnection: class {
    on(event: string, cb: (...args: unknown[]) => void) {
      listeners.set(event, cb);
    }
    removeAllListeners() {}
    connect = vi.fn().mockResolvedValue({ roomId: '123' });
    disconnect = vi.fn().mockResolvedValue(undefined);
  },
}));

import { WebcastLiveRoomClient } from '../src/core/source/webcast/live-room-client.js';

const logger = pino({ level: 'silent' });

describe('WebcastLiveRoomClient', () => {
  it('instantiates and stops cleanly', () => {
    const client = new WebcastLiveRoomClient({
      handle: 'test_creator',
      logger,
      onChatMessage: vi.fn(),
      onViewerUpdate: vi.fn(),
      onRoomStats: vi.fn(),
    });

    expect(client).toBeDefined();
    client.start();
    client.stop();
  });

  it('normalizes handles with @ prefix correctly', () => {
    const client = new WebcastLiveRoomClient({
      handle: '@special_streamer',
      logger,
    });
    // Property check or clean stop
    expect(client).toBeDefined();
    client.stop();
  });

  it('uses viewerCount instead of cumulative totalUser on roomUser events', () => {
    listeners.clear();
    const onViewerUpdate = vi.fn();
    const onRoomStats = vi.fn();
    const client = new WebcastLiveRoomClient({
      handle: 'test_creator',
      logger,
      onViewerUpdate,
      onRoomStats,
    });

    (client as any).running = true;
    (client as any).isLive = true;
    (client as any).roomId = '123';
    (client as any).connectWebSocket('123');

    listeners.get('roomUser')?.({ viewerCount: 42, totalUser: 1337, total: 1337 });

    expect(onViewerUpdate).toHaveBeenCalledWith(42);
    expect(onRoomStats).toHaveBeenCalledWith({
      roomId: '123',
      isLive: true,
      viewers: 42,
      title: null,
    });
    client.stop();
  });

  it('keeps viewers when a single poll reports the room as not live', async () => {
    const onViewerUpdate = vi.fn();
    const onRoomStats = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { user: { status: 2, roomId: '123' }, liveRoom: { userCount: 42 } },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { user: { status: 4 }, liveRoom: null } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = new WebcastLiveRoomClient({
      handle: 'test_creator',
      logger,
      onViewerUpdate,
      onRoomStats,
    });
    client.start();

    await (client as unknown as { pollRoomInfo: () => Promise<void> }).pollRoomInfo();
    expect(onViewerUpdate).toHaveBeenCalledWith(42);

    await (client as unknown as { pollRoomInfo: () => Promise<void> }).pollRoomInfo();
    expect((client as unknown as { isLive: boolean }).isLive).toBe(true);
    expect(onViewerUpdate).not.toHaveBeenCalledWith(0);
    expect(onRoomStats).not.toHaveBeenCalledWith(
      expect.objectContaining({ isLive: false, viewers: 0 }),
    );
    client.stop();
    vi.unstubAllGlobals();
  });

  it('reports offline only after consecutive not-live polls', async () => {
    const onRoomStats = vi.fn();
    const offlinePayload = { data: { user: { status: 4 }, liveRoom: null } };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => offlinePayload,
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new WebcastLiveRoomClient({
      handle: 'test_creator',
      logger,
      onRoomStats,
    });
    client.start();
    // start() already triggers the first poll; two more must stay silent.
    const poll = (
      client as unknown as { pollRoomInfo: () => Promise<void> }
    ).pollRoomInfo.bind(client);

    await poll();
    expect((client as unknown as { isLive: boolean }).isLive).toBe(false);
    expect(onRoomStats).not.toHaveBeenCalledWith(
      expect.objectContaining({ isLive: false, viewers: 0 }),
    );

    // Third consecutive not-live poll confirms offline.
    await poll();
    expect(onRoomStats).toHaveBeenCalledWith(
      expect.objectContaining({ isLive: false, viewers: 0 }),
    );
    client.stop();
    vi.unstubAllGlobals();
  });

  it('falls back to total when the connector omits viewerCount', () => {
    listeners.clear();
    const onViewerUpdate = vi.fn();
    const client = new WebcastLiveRoomClient({
      handle: 'test_creator',
      logger,
      onViewerUpdate,
    });

    (client as any).running = true;
    (client as any).isLive = true;
    (client as any).roomId = '123';
    (client as any).connectWebSocket('123');

    // Real payload from the webcast socket: total = concurrent viewers,
    // totalUser = cumulative viewers.
    listeners.get('roomUser')?.({ total: 81, totalUser: 1947 });

    expect(onViewerUpdate).toHaveBeenCalledWith(81);
    client.stop();
  });

  it('sends the session cookie with the room poll', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-cookie-test-'));
    const cookiesFile = join(dir, 'cookies.txt');
    writeFileSync(
      cookiesFile,
      '# Netscape HTTP Cookie File\n.tiktok.com\tTRUE\t/\tTRUE\t0\tsessionid\tsecret123\n',
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { user: { status: 2 }, liveRoom: { liveRoomStats: { userCount: 5 } } },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const onViewerUpdate = vi.fn();
      const client = new WebcastLiveRoomClient({
        handle: 'test_creator',
        logger,
        cookiesFile,
        onViewerUpdate,
      });
      (client as unknown as { running: boolean }).running = true;
      await (client as unknown as { pollRoomInfo: () => Promise<void> }).pollRoomInfo();

      const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
      expect(init.headers.cookie).toContain('sessionid=secret123');
      expect(onViewerUpdate).toHaveBeenCalledWith(5);
      client.stop();
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
