import { afterEach, describe, expect, it, vi } from 'vitest';
import { StreamerSchema, type StreamerConfig } from '../src/core/config/schema.js';
import { resolveRelayIngestKey } from '../src/core/youtube/ingest.js';
import type { StreamerStore } from '../src/core/store/streamer-store.js';

function makeStreamer(patch: Partial<StreamerConfig> & { id: string }): StreamerConfig {
  return StreamerSchema.parse({ name: patch.id, tiktok: patch.id, ...patch });
}

function storeOf(streamers: StreamerConfig[]): Pick<StreamerStore, 'list'> {
  return { list: () => streamers };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveRelayIngestKey', () => {
  it('prefers the active streamer over a preferred one', () => {
    const store = storeOf([
      makeStreamer({ id: 'alpha', youtube_key: 'key-alpha' }),
      makeStreamer({ id: 'beta', youtube_key: 'key-beta', preferred: true }),
    ]);
    expect(resolveRelayIngestKey(store, 'alpha')).toBe('key-alpha');
  });

  it('falls back to the preferred streamer when none is active', () => {
    const store = storeOf([
      makeStreamer({ id: 'alpha', youtube_key: 'key-alpha' }),
      makeStreamer({ id: 'beta', youtube_key: 'key-beta', preferred: true }),
    ]);
    expect(resolveRelayIngestKey(store, null)).toBe('key-beta');
  });

  it('orders preferred streamers by priority', () => {
    const store = storeOf([
      makeStreamer({ id: 'alpha', youtube_key: 'key-alpha', preferred: true, priority: 20 }),
      makeStreamer({ id: 'beta', youtube_key: 'key-beta', preferred: true, priority: 5 }),
    ]);
    expect(resolveRelayIngestKey(store, null)).toBe('key-beta');
  });

  it('skips disabled and keyless streamers', () => {
    const store = storeOf([
      makeStreamer({ id: 'alpha', youtube_key: 'key-alpha', enabled: false }),
      makeStreamer({ id: 'beta' }),
      makeStreamer({ id: 'gamma', youtube_key: 'key-gamma' }),
    ]);
    expect(resolveRelayIngestKey(store, null)).toBe('key-gamma');
  });

  it('uses YOUTUBE_STREAM_KEY as the last resort', () => {
    vi.stubEnv('YOUTUBE_STREAM_KEY', 'env-key');
    const store = storeOf([makeStreamer({ id: 'alpha' })]);
    expect(resolveRelayIngestKey(store, null)).toBe('env-key');
  });

  it('fails loudly when no ingest is configured', () => {
    vi.stubEnv('YOUTUBE_STREAM_KEY', '');
    const store = storeOf([makeStreamer({ id: 'alpha' })]);
    expect(() => resolveRelayIngestKey(store, null)).toThrow(/Kein RELAY-Ingest/);
  });
});
