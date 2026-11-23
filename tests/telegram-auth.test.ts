import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelegramAuthStore, validateTelegramWebAppData } from '../src/core/telegram/auth-store.js';

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

describe('validateTelegramWebAppData', () => {
  const botToken = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();

  function makeInitData(params: Record<string, string>): string {
    const sortedKeys = Object.keys(params).sort();
    const checkString = sortedKeys.map((key) => `${key}=${params[key]}`).join('\n');
    const hash = createHmac('sha256', secretKey).update(checkString).digest('hex');
    const searchParams = new URLSearchParams(params);
    searchParams.set('hash', hash);
    return searchParams.toString();
  }

  it('validates authentic initData for allowed user', () => {
    const now = Math.floor(Date.now() / 1000);
    const initData = makeInitData({
      auth_date: String(now),
      query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
      user: JSON.stringify({ id: 12345, first_name: 'Max', username: 'maxmuster' }),
    });

    const result = validateTelegramWebAppData(initData, botToken, [12345, 67890]);
    expect(result.valid).toBe(true);
    expect(result.user).toEqual({
      id: 12345,
      first_name: 'Max',
      last_name: undefined,
      username: 'maxmuster',
      language_code: undefined,
    });
  });

  it('rejects tampered hash', () => {
    const now = Math.floor(Date.now() / 1000);
    const valid = makeInitData({
      auth_date: String(now),
      user: JSON.stringify({ id: 12345, username: 'max' }),
    });
    const tampered = `${valid.slice(0, -4)}dead`;
    const result = validateTelegramWebAppData(tampered, botToken, [12345]);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_hash');
  });

  it('rejects expired auth_date', () => {
    const past = Math.floor(Date.now() / 1000) - 100_000;
    const initData = makeInitData({
      auth_date: String(past),
      user: JSON.stringify({ id: 12345, username: 'max' }),
    });
    const result = validateTelegramWebAppData(initData, botToken, [12345]);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('expired');
  });

  it('rejects user not in allowedUserIds', () => {
    const now = Math.floor(Date.now() / 1000);
    const initData = makeInitData({
      auth_date: String(now),
      user: JSON.stringify({ id: 99999, username: 'stranger' }),
    });
    const result = validateTelegramWebAppData(initData, botToken, [12345]);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('user_not_allowed');
  });
});
