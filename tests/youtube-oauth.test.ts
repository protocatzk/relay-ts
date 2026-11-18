import { mkdtempSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/core/config/loader.js';
import { YouTubeAuthStore } from '../src/core/youtube/auth-store.js';
import { YouTubeAuthService } from '../src/core/youtube/service.js';
import type { AutomationSettings } from '../src/core/youtube/automation.js';

const logger = pino({ level: 'silent' });

const CREDENTIALS = {
  clientId: 'client-id.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-secret',
  redirectUri: 'https://relay.example/api/youtube/oauth/callback',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const DEFAULT_AUTOMATION: AutomationSettings = {
  auto_transition: true,
  auto_start: true,
  auto_stop: true,
  default_privacy: 'unlisted',
  default_dvr: true,
};

function harness(options: { configured?: boolean; automation?: AutomationSettings } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'relay-youtube-'));
  const file = join(dir, 'youtube-auth.json');
  const store = new YouTubeAuthStore(file, logger);
  let now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const service = new YouTubeAuthService({
    config: options.configured === false ? { clientId: '', clientSecret: '', redirectUri: '' } : CREDENTIALS,
    store,
    logger,
    now: () => now,
    automation: () => options.automation ?? DEFAULT_AUTOMATION,
  });
  return {
    service,
    store,
    file,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function mockGoogle(options: {
  token?: unknown;
  tokenStatus?: number;
  channel?: unknown;
  channelStatus?: number;
} = {}) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return jsonResponse(
        options.token ?? {
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/youtube.force-ssl',
          token_type: 'Bearer',
        },
        options.tokenStatus ?? 200,
      );
    }
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) {
      return new Response('', { status: 200 });
    }
    if (url.startsWith('https://www.googleapis.com/youtube/v3/channels')) {
      return jsonResponse(
        options.channel ?? { items: [{ id: 'UC123', snippet: { title: 'Testkanal' } }] },
        options.channelStatus ?? 200,
      );
    }
    throw new Error(`unexpected fetch ${url} ${init?.method ?? 'GET'}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function connect(service: YouTubeAuthService): Promise<void> {
  const { url } = service.begin();
  const state = new URL(url).searchParams.get('state') ?? '';
  const result = await service.complete({ code: 'auth-code', state });
  expect(result).toEqual({ ok: true });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('YouTube OAuth', () => {
  it('parses the Google credentials from the environment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-youtube-config-'));
    const config = loadConfig({
      cwd: dir,
      env: {
        GOOGLE_CLIENT_ID: CREDENTIALS.clientId,
        GOOGLE_CLIENT_SECRET: CREDENTIALS.clientSecret,
        GOOGLE_REDIRECT_URI: CREDENTIALS.redirectUri,
        LOG_LEVEL: 'silent',
      },
    });
    expect(config.youtube).toEqual(CREDENTIALS);
  });

  it('falls back to a localhost callback when no redirect URI is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-youtube-config-'));
    const config = loadConfig({
      cwd: dir,
      env: { SERVER_PORT: '4567', LOG_LEVEL: 'silent' },
    });
    expect(config.youtube.redirectUri).toBe('http://localhost:4567/api/youtube/oauth/callback');
  });

  it('ships automation defaults and allows env overrides', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-youtube-config-'));
    const config = loadConfig({ cwd: dir, env: { LOG_LEVEL: 'silent' } });
    expect(config.settings.youtube).toEqual(DEFAULT_AUTOMATION);

    const overridden = loadConfig({
      cwd: dir,
      env: {
        LOG_LEVEL: 'silent',
        SETTINGS_ENV_OVERRIDES: 'true',
        YOUTUBE_AUTO_TRANSITION: 'false',
        YOUTUBE_AUTO_STOP: 'false',
        YOUTUBE_DEFAULT_PRIVACY: 'public',
        YOUTUBE_DEFAULT_DVR: 'false',
      },
    });
    expect(overridden.settings.youtube).toMatchObject({
      auto_transition: false,
      auto_start: true,
      auto_stop: false,
      default_privacy: 'public',
      default_dvr: false,
    });
  });

  it('refuses to start without credentials', () => {
    const { service } = harness({ configured: false });
    expect(service.configured).toBe(false);
    expect(() => service.begin()).toThrowError(/Google-Client-ID/);
  });

  it('builds an authorization URL with PKCE and state', () => {
    const { service } = harness();
    const { url } = service.begin();
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://accounts.google.com');
    expect(parsed.searchParams.get('client_id')).toBe(CREDENTIALS.clientId);
    expect(parsed.searchParams.get('redirect_uri')).toBe(CREDENTIALS.redirectUri);
    expect(parsed.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/youtube.force-ssl',
    );
    expect(parsed.searchParams.get('state')).toBeTruthy();
    expect(parsed.searchParams.get('code_challenge')).toBeTruthy();
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('access_type')).toBe('offline');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
  });

  it('stores tokens with mode 0600 and reports the channel', async () => {
    const { service, file } = harness();
    mockGoogle();
    await connect(service);

    expect(statSync(file).mode & 0o777).toBe(0o600);
    const status = service.status();
    expect(status.connected).toBe(true);
    expect(status.account).toEqual({ channel_id: 'UC123', channel_title: 'Testkanal' });
    expect(status.scopes).toEqual(['https://www.googleapis.com/auth/youtube.force-ssl']);
    expect(JSON.stringify(status)).not.toContain('access-1');
    expect(JSON.stringify(status)).not.toContain('refresh-1');

    const stored = JSON.parse(readFileSync(file, 'utf8'));
    expect(stored.tokens.access_token).toBe('access-1');
    expect(stored.tokens.refresh_token).toBe('refresh-1');
  });

  it('rejects unknown and reused states', async () => {
    const { service } = harness();
    const fetchMock = mockGoogle();
    expect(await service.complete({ code: 'x', state: 'nope' })).toEqual({
      ok: false,
      reason: 'state_invalid',
    });

    const { url } = service.begin();
    const state = new URL(url).searchParams.get('state') ?? '';
    expect((await service.complete({ code: 'auth-code', state })).ok).toBe(true);
    expect(await service.complete({ code: 'auth-code', state })).toEqual({
      ok: false,
      reason: 'state_invalid',
    });
    // Only the token exchange and one channel lookup ran for the successful call.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects expired authorizations', async () => {
    const { service, advance } = harness();
    mockGoogle();
    const { url } = service.begin();
    const state = new URL(url).searchParams.get('state') ?? '';
    advance(11 * 60 * 1000);
    expect(await service.complete({ code: 'auth-code', state })).toEqual({
      ok: false,
      reason: 'state_invalid',
    });
  });

  it('reports a cancelled consent', async () => {
    const { service } = harness();
    const { url } = service.begin();
    const state = new URL(url).searchParams.get('state') ?? '';
    expect(await service.complete({ error: 'access_denied', state })).toEqual({
      ok: false,
      reason: 'cancelled',
    });
  });

  it('keeps the grant when the channel lookup fails', async () => {
    const { service } = harness();
    mockGoogle({ channelStatus: 403, channel: { error: { errors: [{ reason: 'forbidden' }] } } });
    await connect(service);
    expect(service.status().connected).toBe(true);
    expect(service.status().account.channel_id).toBe('');
  });

  it('returns the cached access token while it is valid', async () => {
    const { service } = harness();
    const fetchMock = mockGoogle();
    await connect(service);
    fetchMock.mockClear();
    expect(await service.accessToken()).toBe('access-1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes an expiring token and keeps the refresh token', async () => {
    const { service, advance, file } = harness();
    const fetchMock = mockGoogle();
    await connect(service);
    advance(3600 * 1000);
    fetchMock.mockClear();

    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return jsonResponse({ access_token: 'access-2', expires_in: 3600, token_type: 'Bearer' });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    expect(await service.accessToken()).toBe('access-2');
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    expect(stored.tokens.access_token).toBe('access-2');
    expect(stored.tokens.refresh_token).toBe('refresh-1');
  });

  it('clears the grant when Google reports an invalid refresh token', async () => {
    const { service, advance, file } = harness();
    const fetchMock = mockGoogle();
    await connect(service);
    advance(3600 * 1000);

    fetchMock.mockImplementation(async () =>
      jsonResponse({ error: 'invalid_grant', error_description: 'Token expired' }, 400),
    );

    await expect(service.accessToken()).rejects.toMatchObject({
      code: 'youtube_reconnect_required',
    });
    expect(existsSync(file)).toBe(false);
    expect(service.status().connected).toBe(false);
  });

  it('revokes the token and clears the stored grant on disconnect', async () => {
    const { service, file } = harness();
    const fetchMock = mockGoogle();
    await connect(service);
    fetchMock.mockClear();
    await service.disconnect();

    const revokeCall = fetchMock.mock.calls.find(([input]) =>
      String(input).startsWith('https://oauth2.googleapis.com/revoke'),
    );
    expect(revokeCall).toBeTruthy();
    expect(existsSync(file)).toBe(false);
    expect(service.status()).toMatchObject({ connected: false, scopes: [] });
  });

  it('requires a connection before handing out access tokens', async () => {
    const { service } = harness();
    await expect(service.accessToken()).rejects.toMatchObject({ code: 'youtube_not_connected' });
  });

  it('lists broadcasts without leaking ingest keys', async () => {
    const { service, advance } = harness();
    const fetchMock = mockGoogle();
    await connect(service);
    advance(1000);
    fetchMock.mockClear();

    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/youtube/v3/liveBroadcasts')) {
        return jsonResponse({
          items: [
            {
              id: 'done-1',
              snippet: { title: 'Alt', scheduledStartTime: '2026-01-01T10:00:00Z' },
              status: { lifeCycleStatus: 'complete', privacyStatus: 'public' },
            },
            {
              id: 'live-1',
              snippet: {
                title: 'Jetzt',
                scheduledStartTime: '2026-01-02T10:00:00Z',
                actualStartTime: '2026-01-02T10:01:00Z',
                thumbnails: { default: { url: 'https://img/1.jpg' } },
              },
              status: { lifeCycleStatus: 'live', privacyStatus: 'unlisted' },
              contentDetails: { boundStreamId: 'stream-1' },
            },
          ],
        });
      }
      if (url.includes('/youtube/v3/liveStreams')) {
        return jsonResponse({
          items: [
            {
              id: 'stream-1',
              status: { streamStatus: 'active', healthStatus: { status: 'good' } },
              cdn: { ingestionInfo: { streamName: 'secret-key-should-not-leak' } },
            },
          ],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const list = await service.broadcasts();
    expect(list.items.map((item) => item.id)).toEqual(['live-1', 'done-1']);
    expect(list.items[0]).toMatchObject({
      title: 'Jetzt',
      status: 'live',
      privacy: 'unlisted',
      bound_stream_id: 'stream-1',
      stream_status: 'active',
      stream_health: 'good',
      watch_url: 'https://www.youtube.com/watch?v=live-1',
    });
    expect(JSON.stringify(list)).not.toContain('secret-key');
  });

  it('caches broadcast listings for 20 seconds', async () => {
    const { service, advance } = harness();
    const fetchMock = mockGoogle();
    await connect(service);
    advance(1000);
    fetchMock.mockClear();
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/liveBroadcasts')) return jsonResponse({ items: [] });
      if (url.includes('/liveStreams')) return jsonResponse({ items: [] });
      throw new Error(`unexpected fetch ${url}`);
    });

    await service.broadcasts();
    const callsAfterFirst = fetchMock.mock.calls.length;
    advance(5000);
    await service.broadcasts();
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
    advance(20_000);
    await service.broadcasts();
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst + 2);
  });

  it('requires a connection before listing broadcasts', async () => {
    const { service } = harness();
    await expect(service.broadcasts()).rejects.toMatchObject({ code: 'youtube_not_connected' });
  });
});

describe('YouTube broadcast management', () => {
  function setup() {
    const harnessed = harness();
    const fetchMock = mockGoogle();
    return { ...harnessed, fetchMock };
  }

  async function connected(): Promise<ReturnType<typeof setup> & { ready: true }> {
    const context = setup();
    await connect(context.service);
    context.advance(1000);
    context.fetchMock.mockClear();
    return { ...context, ready: true };
  }

  function broadcastApi(handlers: {
    streams?: () => Response;
    broadcasts?: () => Response;
    onCreate?: (body: unknown) => void;
    onBind?: (url: string) => void;
    onTransition?: (url: string) => void;
    onUpdate?: (body: unknown) => void;
    onDelete?: (url: string) => void;
  }) {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/youtube/v3/liveStreams') && method === 'POST') {
        return jsonResponse({ id: 'stream-new', status: { streamStatus: 'ready' } });
      }
      if (url.includes('/youtube/v3/liveStreams')) {
        return handlers.streams?.() ?? jsonResponse({ items: [] });
      }
      if (url.includes('/youtube/v3/liveBroadcasts/bind')) {
        handlers.onBind?.(url);
        return jsonResponse({ id: 'bc-1', contentDetails: { boundStreamId: 'stream-1' } });
      }
      if (url.includes('/youtube/v3/liveBroadcasts/transition')) {
        handlers.onTransition?.(url);
        return jsonResponse({ id: 'bc-1', status: { lifeCycleStatus: 'live' } });
      }
      if (url.includes('/youtube/v3/liveBroadcasts') && method === 'POST') {
        handlers.onCreate?.(JSON.parse(String(init?.body)));
        return jsonResponse({
          id: 'bc-1',
          snippet: { title: 'Neu', scheduledStartTime: '2026-01-02T10:00:00.000Z' },
          status: { lifeCycleStatus: 'created', privacyStatus: 'unlisted' },
        });
      }
      if (url.includes('/youtube/v3/liveBroadcasts') && method === 'PUT') {
        handlers.onUpdate?.(JSON.parse(String(init?.body)));
        return jsonResponse({
          id: 'bc-1',
          snippet: { title: 'Neu', scheduledStartTime: '2026-01-02T10:00:00.000Z' },
          status: { lifeCycleStatus: 'created', privacyStatus: 'public' },
          contentDetails: { boundStreamId: 'stream-1' },
        });
      }
      if (url.includes('/youtube/v3/liveBroadcasts') && method === 'DELETE') {
        handlers.onDelete?.(url);
        return new Response(null, { status: 204 });
      }
      if (url.includes('/youtube/v3/liveBroadcasts')) {
        return handlers.broadcasts?.() ?? jsonResponse({ items: [] });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    });
  }

  it('uses automation defaults unless the request overrides them', async () => {
    const { service, fetchMock } = await connected();
    const bodies: Record<string, unknown>[] = [];
    fetchMock.mockImplementation(
      broadcastApi({
        onCreate: (body) => bodies.push(body as Record<string, unknown>),
      }),
    );

    await service.createBroadcast({
      title: 'Default',
      scheduled_start: '2026-01-02T11:00:00Z',
    });
    await service.createBroadcast({
      title: 'Override',
      scheduled_start: '2026-01-02T12:00:00Z',
      privacy: 'private',
      enable_dvr: false,
    });

    expect(bodies[0]).toMatchObject({
      status: { privacyStatus: 'unlisted' },
      contentDetails: { enableDvr: true },
    });
    expect(bodies[1]).toMatchObject({
      status: { privacyStatus: 'private' },
      contentDetails: { enableDvr: false },
    });
  });

  it('skips automation entirely when the policy is disabled', async () => {
    const context = harness({
      automation: { ...DEFAULT_AUTOMATION, auto_transition: false },
    });
    const fetchMock = mockGoogle();
    await connect(context.service);
    context.advance(1000);
    fetchMock.mockClear();

    await context.service.onStreamStarted('streamer-key');
    await context.service.onStreamStopped('streamer-key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates a new ingest, broadcast and binding', async () => {
    const { service, fetchMock } = await connected();
    let created: Record<string, unknown> | null = null;
    let bound = '';
    fetchMock.mockImplementation(
      broadcastApi({
        onCreate: (body) => {
          created = body as Record<string, unknown>;
        },
        onBind: (url) => {
          bound = url;
        },
      }),
    );

    const summary = await service.createBroadcast({
      title: 'Neu',
      scheduled_start: '2026-01-02T11:00:00Z',
      privacy: 'unlisted',
    });

    expect(summary.id).toBe('bc-1');
    expect(summary.bound_stream_id).toBe('stream-new');
    expect(created).toMatchObject({
      snippet: { title: 'Neu', scheduledStartTime: '2026-01-02T11:00:00.000Z' },
      status: { privacyStatus: 'unlisted' },
    });
    expect(bound).toContain('streamId=stream-new');
    const calls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(calls.some((url) => url.includes('/liveStreams') && url.includes('part='))).toBe(true);
  });

  it('binds to an existing ingest matching a streamer key', async () => {
    const { service, fetchMock } = await connected();
    let bindUrl = '';
    fetchMock.mockImplementation(
      broadcastApi({
        streams: () =>
          jsonResponse({
            items: [{ id: 'stream-1', cdn: { ingestionInfo: { streamName: 'streamer-key' } } }],
          }),
        onBind: (url) => {
          bindUrl = url;
        },
      }),
    );

    const summary = await service.createBroadcast(
      {
        title: 'Zugeordnet',
        scheduled_start: '2026-01-02T11:00:00Z',
        privacy: 'private',
      },
      'streamer-key',
    );

    expect(summary.bound_stream_id).toBe('stream-1');
    expect(bindUrl).toContain('streamId=stream-1');
    const calls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(calls.some((url) => url.includes('/liveStreams') && url.includes('POST'))).toBe(false);
  });

  it('refuses to bind when no ingest matches the streamer key', async () => {
    const { service, fetchMock } = await connected();
    fetchMock.mockImplementation(
      broadcastApi({ streams: () => jsonResponse({ items: [] }) }),
    );
    await expect(
      service.createBroadcast(
        { title: 'X', scheduled_start: '2026-01-02T11:00:00Z', privacy: 'unlisted' },
        'missing-key',
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('publishes a broadcast by updating its privacy', async () => {
    const { service, fetchMock } = await connected();
    let updateBody: Record<string, unknown> | null = null;
    fetchMock.mockImplementation(
      broadcastApi({
        broadcasts: () =>
          jsonResponse({
            items: [
              {
                id: 'bc-1',
                snippet: { title: 'Neu' },
                status: { lifeCycleStatus: 'ready', privacyStatus: 'unlisted' },
                contentDetails: { boundStreamId: 'stream-1' },
              },
            ],
          }),
        onUpdate: (body) => {
          updateBody = body as Record<string, unknown>;
        },
      }),
    );

    const summary = await service.publishBroadcast('bc-1');
    expect(updateBody).toMatchObject({ id: 'bc-1', status: { privacyStatus: 'public' } });
    expect(summary.privacy).toBe('public');
  });

  it('transitions and deletes broadcasts', async () => {
    const { service, fetchMock } = await connected();
    const transitions: string[] = [];
    const deletes: string[] = [];
    fetchMock.mockImplementation(
      broadcastApi({
        onTransition: (url) => transitions.push(url),
        onDelete: (url) => deletes.push(url),
      }),
    );

    await service.transitionBroadcastById('bc-1', 'live');
    await service.deleteBroadcastById('bc-1');

    expect(transitions[0]).toContain('broadcastStatus=live');
    expect(deletes[0]).toContain('id=bc-1');
  });

  it('brings the nearest scheduled broadcast live and completes it on stop', async () => {
    const { service, fetchMock } = await connected();
    const transitions: string[] = [];
    const broadcasts = [
      {
        id: 'bc-live',
        snippet: { scheduledStartTime: '2026-01-02T10:00:00Z' },
        status: { lifeCycleStatus: 'live' },
        contentDetails: { boundStreamId: 'stream-1' },
      },
      {
        id: 'bc-ready',
        snippet: { scheduledStartTime: '2026-01-02T11:00:00Z' },
        status: { lifeCycleStatus: 'ready' },
        contentDetails: { boundStreamId: 'stream-1' },
      },
    ];
    fetchMock.mockImplementation(
      broadcastApi({
        streams: () =>
          jsonResponse({
            items: [{ id: 'stream-1', cdn: { ingestionInfo: { streamName: 'streamer-key' } } }],
          }),
        broadcasts: () => jsonResponse({ items: broadcasts }),
        onTransition: (url) => transitions.push(url),
      }),
    );

    await service.onStreamStarted('streamer-key');
    expect(transitions.some((url) => url.includes('id=bc-ready') && url.includes('broadcastStatus=live'))).toBe(true);
    expect(transitions.some((url) => url.includes('id=bc-live'))).toBe(false);

    transitions.length = 0;
    broadcasts[0]!.status.lifeCycleStatus = 'live';
    broadcasts[1]!.status.lifeCycleStatus = 'live';
    await service.onStreamStopped('streamer-key');
    expect(transitions.filter((url) => url.includes('broadcastStatus=complete'))).toHaveLength(2);
  });
});
