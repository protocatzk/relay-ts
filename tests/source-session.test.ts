import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, StreamerSchema } from '../src/core/config/schema.js';
import type { TikTokSource } from '../src/core/source/tiktok-source.js';
import { SourceSession } from '../src/core/supervisor/source-session.js';

const streamer = StreamerSchema.parse({ id: 'alpha', name: 'Alpha', tiktok: 'alpha' });
const stream = {
  url: 'https://cdn.example/stream.flv',
  vcodec: 'avc1',
  height: 720,
  formatId: 'h264',
  isH264: true,
  title: 'Live',
  resolvedAt: new Date(),
};

function setup() {
  const source = {
    running: true,
    currentStreamer: streamer,
    startedAt: new Date(),
    outputTimeSeconds: 1,
    bitrateKbps: 2000,
    resolved: stream,
    start: vi.fn(),
    stop: vi.fn(async () => undefined),
    stats: vi.fn(() => ({ pid: 1 })),
  };
  const resolver = { resolve: vi.fn(async () => stream) };
  const session = new SourceSession({
    source: source as unknown as TikTokSource,
    resolver,
    settings: DEFAULT_SETTINGS,
  });
  return { session, source, resolver };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('source session', () => {
  it('delegates start, stop and resolve to the source', async () => {
    const { session, source, resolver } = setup();
    session.start(streamer, stream, false, 12);
    expect(source.start).toHaveBeenCalledWith(streamer, stream, false, 12);
    await session.stop();
    expect(source.stop).toHaveBeenCalledTimes(1);
    await expect(session.resolve(streamer)).resolves.toBe(stream);
    expect(resolver.resolve).toHaveBeenCalledWith(streamer);
  });

  it('keeps producer timestamps monotonic and exposes reconnect state', async () => {
    vi.useFakeTimers({ now: 0 });
    const { session } = setup();
    expect(session.nextOffset()).toBe(0);
    session.markProducerStarted(10);
    vi.advanceTimersByTime(5_000);
    expect(session.nextOffset()).toBe(16);

    const onReconnect = vi.fn();
    expect(session.scheduleReconnect(5_000, onReconnect)).toEqual({
      attempt: 1,
      delayMs: 5_000,
    });
    expect(session.reconnecting).toBe(true);
    session.scheduleReconnect(5_000, onReconnect);
    expect(session.reconnectAttempts).toBe(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(session.reconnecting).toBe(false);
    session.resetReconnectAttempts();
    expect(session.reconnectAttempts).toBe(0);
    session.resetTimeline();
    expect(session.nextOffset()).toBe(0);
  });

  it('tracks resolve and stop guards', async () => {
    const { session } = setup();
    session.beginResolve();
    expect(session.resolving).toBe(true);
    session.endResolve();
    expect(session.resolving).toBe(false);
    expect(session.stopping).toBe(0);
  });
});
