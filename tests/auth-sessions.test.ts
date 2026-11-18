import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthSessionStore } from '../src/api/session-store.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('AuthSessionStore', () => {
  it('creates, touches and revokes sessions', () => {
    const store = new AuthSessionStore();
    const session = store.create('Kiyan', 'telegram');
    expect(store.get(session.id)).toMatchObject({ user: 'Kiyan', provider: 'telegram' });
    expect(store.size).toBe(1);
    expect(store.revoke(session.id)).toBe(true);
    expect(store.get(session.id)).toBeNull();
    expect(store.size).toBe(0);
  });

  it('expires sessions', () => {
    vi.useFakeTimers();
    const store = new AuthSessionStore(undefined, 1000);
    const session = store.create('User', 'password');
    vi.advanceTimersByTime(1001);
    expect(store.get(session.id)).toBeNull();
  });

  it('persists sessions and reloads them from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-sessions-'));
    const path = join(dir, 'sessions.json');
    const store = new AuthSessionStore(path);
    const session = store.create('Kiyan', 'telegram');

    const reloaded = new AuthSessionStore(path);
    expect(reloaded.get(session.id)).toMatchObject({ user: 'Kiyan', provider: 'telegram' });
  });

  it('revokes all sessions except an optional current one', () => {
    const store = new AuthSessionStore();
    const current = store.create('Current', 'password');
    store.create('Other', 'telegram');
    expect(store.revokeAll(current.id)).toBe(1);
    expect(store.size).toBe(1);
    expect(store.get(current.id)).not.toBeNull();
  });
});
