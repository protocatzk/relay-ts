import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelegramAuthStore } from '../src/core/telegram/auth-store.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('TelegramAuthStore', () => {
  it('creates and approves a pending login token', () => {
    const store = new TelegramAuthStore();
    const entry = store.create('127.0.0.1 · Browser');
    expect(store.get(entry.token)?.status).toBe('pending');
    expect(store.approve(entry.token, '@kiyan')).toBe(true);
    expect(store.get(entry.token)).toMatchObject({ status: 'approved', user: '@kiyan' });
    expect(store.approve(entry.token, '@other')).toBe(false);
  });

  it('can deny a token and cannot approve it afterwards', () => {
    const store = new TelegramAuthStore();
    const entry = store.create('test');
    expect(store.deny(entry.token)).toBe(true);
    expect(store.get(entry.token)?.status).toBe('denied');
    expect(store.approve(entry.token, 'user')).toBe(false);
  });

  it('expires tokens after ten minutes', () => {
    vi.useFakeTimers();
    const store = new TelegramAuthStore();
    const entry = store.create('test');
    vi.advanceTimersByTime(TelegramAuthStore.TOKEN_TTL_MS + 1);
    expect(store.get(entry.token)).toBeNull();
  });
});
