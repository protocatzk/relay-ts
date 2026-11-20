import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { YouTubeAuthStore } from '../src/core/youtube/auth-store.js';
import { YouTubeAuthService } from '../src/core/youtube/service.js';

const logger = pino({ level: 'silent' });
const dirs: string[] = [];

function createService() {
  const dir = mkdtempSync(join(tmpdir(), 'relay-yt-chat-'));
  dirs.push(dir);
  const store = new YouTubeAuthStore(join(dir, 'youtube-auth.json'), logger);
  store.write({
    version: 1,
    account: { channel_id: 'ch-1', channel_title: 'Test Channel' },
    tokens: {
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      scope: 'https://www.googleapis.com/auth/youtube.force-ssl',
      token_type: 'Bearer',
      expiry_date: Date.now() + 3600_000,
    },
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return new YouTubeAuthService({
    config: {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://example.test/api/youtube/oauth/callback',
    },
    store,
    logger,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  while (dirs.length > 0) {
    const dir = dirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('YouTube Live Chat (#22)', () => {
  it('resolves activeLiveChatId once, caches it, and enforces minimum 10s polling interval', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        urls.push(url);
        if (url.includes('/videos')) {
          return new Response(
            JSON.stringify({
              items: [{ liveStreamingDetails: { activeLiveChatId: 'chat-xyz' } }],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.includes('/liveChat/messages')) {
          return new Response(
            JSON.stringify({
              nextPageToken: 'next-tok-1',
              pollingIntervalMillis: 3000,
              items: [
                {
                  id: 'm1',
                  snippet: {
                    displayMessage: 'Hallo YouTube!',
                    publishedAt: '2026-11-20T22:00:00Z',
                  },
                  authorDetails: {
                    displayName: 'ModUser',
                    profileImageUrl: 'https://example.test/avatar.png',
                    isChatModerator: true,
                    isChatOwner: false,
                    isChatSponsor: false,
                  },
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        throw new Error(`Unexpected URL: ${url}`);
      }),
    );

    const service = createService();
    const first = await service.liveChatMessages('bc-1');
    expect(first.live_chat_id).toBe('chat-xyz');
    expect(first.next_page_token).toBe('next-tok-1');
    expect(first.polling_interval_ms).toBe(10_000);
    expect(first.offline).toBe(false);
    expect(first.messages).toHaveLength(1);
    expect(first.messages[0]).toMatchObject({
      id: 'm1',
      author: 'ModUser',
      is_moderator: true,
      text: 'Hallo YouTube!',
    });

    // Second call uses cached liveChatId (no second /videos call) and forwards pageToken.
    await service.liveChatMessages('bc-1', 'next-tok-1');
    expect(urls.filter((u) => u.includes('/videos'))).toHaveLength(1);
    expect(urls.some((u) => u.includes('pageToken=next-tok-1'))).toBe(true);
  });

  it('returns offline state when broadcast has no activeLiveChatId', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ items: [{ liveStreamingDetails: {} }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const service = createService();
    const page = await service.liveChatMessages('bc-offline');
    expect(page.offline).toBe(true);
    expect(page.live_chat_id).toBeNull();
    expect(page.messages).toEqual([]);
  });
});
