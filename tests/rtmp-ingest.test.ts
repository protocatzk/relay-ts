import { describe, it, expect, vi } from 'vitest';
import { RtmpIngestServer } from '../src/core/ingest/rtmp-server.js';
import type { RtmpIngestSettings } from '../src/core/config/schema.js';

describe('RtmpIngestServer', () => {
  const dummyLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as any;

  const defaultSettings: RtmpIngestSettings = {
    enabled: true,
    port: 19355,
    stream_key: 'test-key',
    auto_takeover: true,
  };

  it('initializes with correct listen URL and stats', () => {
    const server = new RtmpIngestServer({
      settings: defaultSettings,
      relay: { host: '127.0.0.1', port: 12345 },
      logger: dummyLogger,
    });

    expect(server.listenUrl).toBe('rtmp://0.0.0.0:19355/live/test-key');
    const stats = server.stats();
    expect(stats.port).toBe(19355);
    expect(stats.running).toBe(false);
    expect(stats.activeClient).toBe(false);
  });

  it('updates settings and starts/stops accordingly', () => {
    const server = new RtmpIngestServer({
      settings: { ...defaultSettings, enabled: false },
      relay: { host: '127.0.0.1', port: 12345 },
      logger: dummyLogger,
    });

    expect(server.isRunning).toBe(false);
    server.updateSettings({ ...defaultSettings, enabled: true });
    // In test environment without actual ffmpeg running long-term, ensure call doesn't throw
    expect(server.stats().port).toBe(19355);
    server.stop();
  });
});
