import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { TikTokAccountStore } from '../src/core/account/tiktok-account-store.js';
import { resolveStreamerSession } from '../src/core/account/tiktok-session.js';
import { StreamerStore } from '../src/core/store/streamer-store.js';
import { StreamerSchema } from '../src/core/config/schema.js';

const logger = pino({ level: 'silent' });
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'relay-session-'));
  dirs.push(dir);
  return dir;
}

function makeStore(dir: string): TikTokAccountStore {
  return new TikTokAccountStore({
    filePath: join(dir, 'tiktok-accounts.json'),
    cookiesFile: join(dir, 'cookies.txt'),
    cookiesDir: join(dir, 'cookies'),
    logger,
  });
}

describe('per-streamer TikTok sessions (#95)', () => {
  it('keeps the schema default empty so existing streamers stay on the active account', () => {
    const parsed = StreamerSchema.parse({ id: 'alpha', name: 'Alpha', tiktok: 'alpha' });
    expect(parsed.tiktok_account).toBe('');
  });

  it('writes a per-account cookie file with mode 0600', () => {
    const dir = tempDir();
    const accounts = makeStore(dir);
    const account = accounts.create({
      label: 'Hauptkonto',
      sessionId: 'session-abc',
      targetIdc: 'useast2b',
    });

    const session = resolveStreamerSession(
      { id: 'alpha', tiktok_account: account.id },
      { accounts, fallbackCookieFile: join(dir, 'cookies.txt') },
    );

    expect(session.accountId).toBe(account.id);
    expect(session.accountLabel).toBe('Hauptkonto');
    expect(session.missing).toBe(false);
    expect(session.cookieFile).toBe(join(dir, 'cookies', `${account.id}.txt`));
    expect(existsSync(session.cookieFile!)).toBe(true);
    expect(statSync(session.cookieFile!).mode & 0o777).toBe(0o600);
    const content = readFileSync(session.cookieFile!, 'utf8');
    expect(content).toContain('\tsessionid\tsession-abc');
    expect(content).toContain('\ttt-target-idc\tuseast2b');
    expect(session.cookieHeader).toBe('sessionid=session-abc; tt-target-idc=useast2b');
  });

  it('falls back to the active account file when no account is pinned', () => {
    const dir = tempDir();
    const accounts = makeStore(dir);
    accounts.create({ label: 'Hauptkonto', sessionId: 'session-abc' });

    const session = resolveStreamerSession(
      { id: 'alpha', tiktok_account: '' },
      { accounts, fallbackCookieFile: join(dir, 'cookies.txt') },
    );

    expect(session.cookieFile).toBe(join(dir, 'cookies.txt'));
    expect(session.accountLabel).toBe('');
    expect(session.missing).toBe(false);
    // The active account is materialized into the global file on creation.
    expect(readFileSync(join(dir, 'cookies.txt'), 'utf8')).toContain('sessionid\tsession-abc');
  });

  it('warns once and falls back when the pinned account no longer exists', () => {
    const dir = tempDir();
    const accounts = makeStore(dir);
    const warned = new Set<string>();
    const options = {
      accounts,
      fallbackCookieFile: join(dir, 'cookies.txt'),
      logger,
      warned,
    };

    const first = resolveStreamerSession({ id: 'alpha', tiktok_account: 'gone' }, options);
    const second = resolveStreamerSession({ id: 'alpha', tiktok_account: 'gone' }, options);

    expect(first.missing).toBe(true);
    expect(first.cookieFile).toBe(join(dir, 'cookies.txt'));
    expect(second.missing).toBe(true);
    expect(warned).toEqual(new Set(['alpha:gone']));
  });

  it('deletes the per-account cookie file when the account is removed', () => {
    const dir = tempDir();
    const accounts = makeStore(dir);
    const account = accounts.create({ label: 'Weg damit', sessionId: 'session-xyz' });
    const file = accounts.cookieFileFor(account.id);
    expect(existsSync(file)).toBe(true);

    accounts.remove(account.id);

    expect(existsSync(file)).toBe(false);
    expect(accounts.list()).toHaveLength(0);
  });

  it('exposes the account label and a missing flag in the streamer view', () => {
    const dir = tempDir();
    const accounts = makeStore(dir);
    const account = accounts.create({ label: 'Zweitkonto', sessionId: 'session-2' });
    const store = new StreamerStore(join(dir, 'streamers.yml'), { streamers: [], playlists: [] }, logger);
    store.create({
      id: 'alpha',
      name: 'Alpha',
      tiktok: 'alpha',
      tiktok_account: account.id,
    });
    store.create({ id: 'beta', name: 'Beta', tiktok: 'beta', tiktok_account: 'gone' });

    const alpha = store.view(store.require('alpha'), null, null, accounts);
    const beta = store.view(store.require('beta'), null, null, accounts);

    expect(alpha.tiktok_account).toBe(account.id);
    expect(alpha.tiktok_account_label).toBe('Zweitkonto');
    expect(alpha.tiktok_account_missing).toBe(false);
    expect(beta.tiktok_account_missing).toBe(true);
  });
});
