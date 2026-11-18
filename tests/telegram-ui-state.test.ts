import { describe, expect, it } from 'vitest';
import { RefStore } from '../src/core/telegram/refs.js';
import { ConversationStore } from '../src/core/telegram/conversations.js';

describe('Telegram refs', () => {
  it('returns stable short refs per value', () => {
    const refs = new RefStore();
    const first = refs.get('streamer', 'a-very-long-streamer-id');
    const second = refs.get('streamer', 'a-very-long-streamer-id');
    expect(first).toBe(second);
    expect(first.length).toBeLessThan(20);
    expect(refs.resolve(first, 'streamer')).toBe('a-very-long-streamer-id');
  });

  it('rejects refs of another type', () => {
    const refs = new RefStore();
    const ref = refs.get('streamer', 'alpha');
    expect(refs.resolve(ref, 'playlist')).toBeNull();
    expect(refs.resolve('unknown')).toBeNull();
  });

  it('expires refs after the TTL', () => {
    let now = 0;
    const refs = new RefStore(1000, 10, () => now);
    const ref = refs.get('broadcast', 'abc');
    now = 1001;
    expect(refs.resolve(ref, 'broadcast')).toBeNull();
  });

  it('forgets a specific value', () => {
    const refs = new RefStore();
    const ref = refs.get('streamer', 'alpha');
    refs.forget('streamer', 'alpha');
    expect(refs.resolve(ref, 'streamer')).toBeNull();
  });
});

describe('Telegram conversations', () => {
  it('binds flows to chat and user', () => {
    const store = new ConversationStore();
    store.start(1, 2, 'streamer-new-id');
    expect(store.get(1, 2)?.flow).toBe('streamer-new-id');
    expect(store.get(2, 2)).toBeNull();
    expect(store.get(1, 3)).toBeNull();
  });

  it('keeps step data and clears explicitly', () => {
    const store = new ConversationStore();
    store.start(1, 2, 'streamer-new-name', { id: 'alpha' });
    expect(store.get(1, 2)?.data.id).toBe('alpha');
    store.clear(1, 2);
    expect(store.get(1, 2)).toBeNull();
  });

  it('expires stale flows', () => {
    let now = 0;
    const store = new ConversationStore(1000, () => now);
    store.start(1, 2, 'log-search');
    now = 1001;
    expect(store.get(1, 2)).toBeNull();
  });
});
