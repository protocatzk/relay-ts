import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiKeyStore, hashApiKey, safeHashCompare } from '../src/api/api-key-store.js';
import { hasScope } from '../src/api/auth.js';

describe('ApiKeyStore', () => {
  let store: ApiKeyStore;

  beforeEach(() => {
    store = new ApiKeyStore(); // in-memory
  });

  it('hashes keys consistently and safely compares', () => {
    const rawKey = 'rel_live_abc123';
    const hash = hashApiKey(rawKey);
    expect(safeHashCompare(rawKey, hash)).toBe(true);
    expect(safeHashCompare('rel_live_wrong', hash)).toBe(false);
  });

  it('creates an API key with correct format and prefix', () => {
    const res = store.create({
      name: 'Stream Deck',
      scopes: ['control:stream', 'read:status'],
    });

    expect(res.key).toMatch(/^rel_live_[a-f0-9]{48}$/);
    expect(res.record.prefix).toMatch(/^rel_live_[a-f0-9]{6}\.\.\.$/);
    expect(res.record.name).toBe('Stream Deck');
    expect(res.record.scopes).toEqual(['control:stream', 'read:status']);
    expect(res.record.status).toBe('active');
  });

  it('authenticates a valid key and updates last_used_at and last_used_ip', () => {
    const res = store.create({ name: 'Bot' });
    const auth = store.authenticate(res.key, '192.168.1.100');
    expect(auth).not.toBeNull();
    expect(auth?.id).toBe(res.record.id);
    expect(auth?.last_used_ip).toBe('192.168.1.100');
    expect(auth?.last_used_at).toBeDefined();

    const listed = store.list().find((k) => k.id === res.record.id);
    expect(listed?.last_used_ip).toBe('192.168.1.100');
  });

  it('rejects revoked or expired keys', () => {
    const res = store.create({ name: 'Temporary', expiresInDays: -1 });
    expect(store.authenticate(res.key)).toBeNull();

    const activeRes = store.create({ name: 'Will Revoke' });
    expect(store.authenticate(activeRes.key)).not.toBeNull();
    store.revoke(activeRes.record.id);
    expect(store.authenticate(activeRes.key)).toBeNull();
  });

  it('evaluates scopes and wildcards correctly', () => {
    expect(hasScope(['*'], 'control:stream')).toBe(true);
    expect(hasScope(['admin'], 'manage:streamers')).toBe(true);
    expect(hasScope(['control:*'], 'control:stream')).toBe(true);
    expect(hasScope(['control:*'], 'control:queue')).toBe(true);
    expect(hasScope(['control:*'], 'read:status')).toBe(false);
    expect(hasScope(['read:status', 'control:stream'], 'read:status')).toBe(true);
    expect(hasScope(['read:status'], 'manage:media')).toBe(false);
  });

  it('persists asynchronously and flushes to disk on demand', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'relay-keys-')), 'api-keys.json');
    const store = new ApiKeyStore(file);
    const created = store.create({ name: 'Persist', scopes: ['read:status'] });

    await store.flush();

    const reloaded = new ApiKeyStore(file);
    const auth = reloaded.authenticate(created.key, '10.0.0.1');
    expect(auth).not.toBeNull();
    expect(auth?.last_used_ip).toBe('10.0.0.1');

    await reloaded.flush();
    const afterUsage = new ApiKeyStore(file);
    expect(afterUsage.list()[0]?.last_used_ip).toBe('10.0.0.1');
    expect(afterUsage.list()[0]?.revoked).toBe(false);
  });

  it('keeps the stored secret when updates omit the usage write on shutdown', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'relay-keys-')), 'api-keys.json');
    const store = new ApiKeyStore(file);
    const created = store.create({ name: 'Throttle' });

    // Usage-only updates in quick succession must still be visible in memory
    // and persisted by a final flush, not by a sync write per request.
    expect(store.authenticate(created.key, '10.0.0.2')).not.toBeNull();
    expect(store.authenticate(created.key, '10.0.0.2')).not.toBeNull();
    expect(store.list()[0]?.last_used_ip).toBe('10.0.0.2');

    await store.flush();
    const after = new ApiKeyStore(file);
    expect(after.list()[0]?.last_used_ip).toBe('10.0.0.2');
    expect(after.authenticate(created.key)).not.toBeNull();
  });
});
