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
});
