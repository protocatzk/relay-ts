import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, StreamerSchema } from '../src/core/config/schema.js';
import { ChatService, type ChatMessage } from '../src/core/overlays/chat-service.js';

const logger = pino({ level: 'silent' });
const streamer = StreamerSchema.parse({
  id: 'chat-test',
  name: 'Chat Test',
  tiktok: 'chat_test',
  overlays: { chat: { enabled: true, engine: 'canvas' } },
});

describe('ChatService', () => {
  it('keeps the last overlay messages when stopped without clearing', () => {
    const updates: ChatMessage[][] = [];
    const service = new ChatService({
      streamer,
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
});
