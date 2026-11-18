import { describe, expect, it } from 'vitest';
import { ConfirmationStore } from '../src/core/telegram/confirmations.js';

describe('Telegram confirmations', () => {
  it('binds nonces to chat and user', () => {
    const store = new ConfirmationStore();
    const nonce = store.create(10, 20, { type: 'stop' });
    expect(store.consume(nonce, 11, 20)).toBeNull();
    expect(store.consume(nonce, 10, 21)).toBeNull();
    expect(store.consume(nonce, 10, 20)).toEqual({ type: 'stop' });
  });

  it('allows a nonce only once', () => {
    const store = new ConfirmationStore();
    const nonce = store.create(10, 20, { type: 'youtube-publish', id: 'bc-1' });
    expect(store.consume(nonce, 10, 20)).toEqual({ type: 'youtube-publish', id: 'bc-1' });
    expect(store.consume(nonce, 10, 20)).toBeNull();
  });

  it('expires nonces after the TTL', () => {
    let now = 1_000;
    const store = new ConfirmationStore(60_000, 200, () => now);
    const nonce = store.create(10, 20, { type: 'stop' });
    now += 60_001;
    expect(store.consume(nonce, 10, 20)).toBeNull();
  });

  it('cancels a pending action exactly once', () => {
    const store = new ConfirmationStore();
    const nonce = store.create(10, 20, { type: 'stop' });
    expect(store.cancel(nonce, 10, 20)).toBe(true);
    expect(store.cancel(nonce, 10, 20)).toBe(false);
    expect(store.consume(nonce, 10, 20)).toBeNull();
  });

  it('caps the number of pending confirmations', () => {
    const store = new ConfirmationStore(60_000, 2);
    const first = store.create(1, 1, { type: 'stop' });
    store.create(1, 1, { type: 'stop' });
    store.create(1, 1, { type: 'stop' });
    expect(store.consume(first, 1, 1)).toBeNull();
  });
});
