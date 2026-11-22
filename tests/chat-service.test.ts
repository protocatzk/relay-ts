import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, StreamerSchema } from '../src/core/config/schema.js';
import { ChatService, type ChatMessage } from '../src/core/overlays/chat-service.js';

const logger = pino({ level: 'silent' });
const streamer = StreamerSchema.parse({
  id: 'chat-test',
  name: 'Chat Test',
  tiktok: 'chat_test',
});

describe('ChatService', () => {
  it('keeps the last overlay messages when stopped without clearing', () => {
    const updates: ChatMessage[][] = [];
    const service = new ChatService({
      streamer,
      chat: DEFAULT_SETTINGS.overlays.chat,
      settings: DEFAULT_SETTINGS,
      logger,
      onMessages: (messages) => updates.push(messages),
    });
    service.injectMessage('viewer', 'Hallo');
    expect(updates.at(-1)).toHaveLength(1);

    service.stop(false);
    expect(updates.at(-1)).toHaveLength(1);

    service.stop();
    expect(updates.at(-1)).toEqual([]);
  });

  it('deduplicates identical messages arriving via different IDs or channels', () => {
    const updates: ChatMessage[][] = [];
    const service = new ChatService({
      streamer,
      chat: DEFAULT_SETTINGS.overlays.chat,
      settings: DEFAULT_SETTINGS,
      logger,
      onMessages: (messages) => updates.push(messages),
    });

    service.injectMessage('user1', 'Hallo Welt');
    expect(updates.at(-1)).toHaveLength(1);

    // Incoming duplicate via different ID, nickname vs username, and 15s poll skew
    (service as any).addIncomingMessage({
      id: 'webcast-msg-123',
      username: 'User One',
      displayName: 'user1',
      text: 'Hallo Welt',
      receivedAt: new Date(Date.now() + 15_000),
      timestamp: new Date(Date.now() - 15_000),
    });

    // Should remain 1 because it is deduplicated
    expect(updates.at(-1)).toHaveLength(1);

    // Different message should be added
    const delayMs = (service as any).delayMilliseconds();
    (service as any).addIncomingMessage({
      id: 'webcast-msg-456',
      username: 'user2',
      text: 'Zweite Nachricht',
      receivedAt: new Date(Date.now() - delayMs - 1000),
    });
    expect(updates.at(-1)).toHaveLength(2);

    service.stop();
  });
});
