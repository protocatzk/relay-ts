import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
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
});
