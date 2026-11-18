import { mkdtempSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/core/config/loader.js';
import { YouTubeAuthStore } from '../src/core/youtube/auth-store.js';
import { YouTubeAuthService } from '../src/core/youtube/service.js';

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

function harness(options: { configured?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'relay-youtube-'));
  const file = join(dir, 'youtube-auth.json');
  const store = new YouTubeAuthStore(file, logger);
  let now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const service = new YouTubeAuthService({
    config: options.configured === false ? { clientId: '', clientSecret: '', redirectUri: '' } : CREDENTIALS,
    store,
    logger,
    now: () => now,
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
});
