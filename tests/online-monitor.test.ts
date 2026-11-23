import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings, type StreamerConfig } from '../src/core/config/schema.js';
import { OnlineMonitor, parseTokTrackerStatuses } from '../src/core/online/monitor.js';

const logger = pino({ level: 'silent' });

function settingsWith(overrides: Partial<Settings['online']>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    online: { ...DEFAULT_SETTINGS.online, enabled: true, interval: 30, ...overrides },
  };
}

function streamer(id: string, enabled = true): StreamerConfig {
  return { id, name: id, tiktok: id, enabled } as unknown as StreamerConfig;
}

function livePayload(handle: string): unknown {
  return {
    data: {
      user: { uniqueId: handle, status: 2 },
      liveRoom: { status: 2, title: `${handle} live`, liveRoomStats: { userCount: 42 } },
    },
  };
}

function offlinePayload(handle: string): unknown {
  return { data: { user: { uniqueId: handle, status: 4 } } };
}

describe('OnlineMonitor', () => {
  it('checks enabled streamers directly through the TikTok Live-API', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('alice')) {
        return { ok: true, json: async () => livePayload('alice') };
      }
      return { ok: true, json: async () => offlinePayload('bob') };
    });
    vi.stubGlobal('fetch', fetchMock);

    const statuses: Array<Map<string, boolean>> = [];
    const monitor = new OnlineMonitor({
      settings: settingsWith({ provider: 'tiktok' }),
      logger,
      onStatuses: (value) => statuses.push(value),
      listStreamers: () => [streamer('alice'), streamer('bob'), streamer('disabled', false)],
      cookiesFile: '/nonexistent/cookies.txt',
    });

    await monitor.checkNow();

    const last = statuses.at(-1)!;
    expect(last.get('alice')).toBe(true);
    expect(last.get('bob')).toBe(false);
    expect(last.has('disabled')).toBe(false);
    // Only enabled streamers are requested.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    monitor.stop();
    vi.unstubAllGlobals();
  });

  it('keeps the previous status when a TikTok check fails', async () => {
    let failCarol = false;
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes('carol')) {
        if (failCarol) throw new Error('network down');
        return { ok: true, json: async () => livePayload('carol') };
      }
      return { ok: true, json: async () => livePayload('dave') };
    });
    vi.stubGlobal('fetch', fetchMock);

    const statuses: Array<Map<string, boolean>> = [];
    const monitor = new OnlineMonitor({
      settings: settingsWith({ provider: 'tiktok' }),
      logger,
      onStatuses: (value) => statuses.push(value),
      listStreamers: () => [streamer('carol'), streamer('dave')],
    });

    await monitor.checkNow();
    expect(statuses.at(-1)!.get('carol')).toBe(true);

    failCarol = true;
    await monitor.checkNow();
    expect(statuses.at(-1)!.get('carol')).toBe(true);
    monitor.stop();
    vi.unstubAllGlobals();
  });

  it('still supports the external overview provider', () => {
    const parsed = parseTokTrackerStatuses({
      streamers: [
        { username: 'alice', is_live: true },
        { username: '@bob', is_live: false },
      ],
    });
    expect(parsed.get('alice')).toBe(true);
    expect(parsed.get('bob')).toBe(false);
  });

  it('uses the selected TikTok account session for checks', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => livePayload('alice'),
    });
    vi.stubGlobal('fetch', fetchMock);

    const monitor = new OnlineMonitor({
      settings: settingsWith({ provider: 'tiktok', account_id: 'acc_1' }),
      logger,
      onStatuses: () => {},
      listStreamers: () => [streamer('alice')],
      cookiesFile: '/nonexistent/cookies.txt',
      accountCookie: (id) => (id === 'acc_1' ? 'sessionid=acc-session; tt-target-idc=useast2b' : null),
    });

    await monitor.checkNow();

    const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(init.headers.cookie).toBe('sessionid=acc-session; tt-target-idc=useast2b');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('uniqueId=alice');
    monitor.stop();
    vi.unstubAllGlobals();
  });

  it('falls back to the cookie file when the selected account is unknown', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-online-cookie-'));
    const cookiesFile = join(dir, 'cookies.txt');
    writeFileSync(
      cookiesFile,
      '# Netscape HTTP Cookie File\n.tiktok.com\tTRUE\t/\tTRUE\t0\tsessionid\tfile-session\n',
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => livePayload('alice'),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const monitor = new OnlineMonitor({
        settings: settingsWith({ provider: 'tiktok', account_id: 'missing' }),
        logger,
        onStatuses: () => {},
        listStreamers: () => [streamer('alice')],
        cookiesFile,
        accountCookie: () => null,
      });

      await monitor.checkNow();

      const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
      expect(init.headers.cookie).toContain('sessionid=file-session');
      monitor.stop();
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
