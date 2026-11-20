import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, StreamerSchema } from '../src/core/config/schema.js';
import { VERSION } from '../src/version.js';
import {
  buildStatusSnapshot,
  type StatusBuilderContext,
} from '../src/core/supervisor/status-builder.js';

const chat = {
  enabled: true,
  engine: 'canvas' as const,
  messages: 3,
  last_message_at: '2026-11-19T12:00:00.000Z',
  api_configured: true,
  canvas_active: true,
};

const streamer = StreamerSchema.parse({
  id: 'alpha',
  name: 'Alpha',
  tiktok: 'alpha',
});

function context(overrides: Partial<StatusBuilderContext> = {}): StatusBuilderContext {
  return {
    state: 'live',
    settings: DEFAULT_SETTINGS,
    activeStreamer: streamer,
    activePlaylist: null,
    manualScreen: null,
    startedAt: new Date(Date.now() - 5_000),
    resolving: false,
    reconnects: 2,
    lastError: null,
    reconnecting: false,
    monitorOnline: true,
    chat,
    media: null,
    ...overrides,
  };
}

describe('status builder', () => {
  it('maps the live stream state and falls back to configured defaults', () => {
    const status = buildStatusSnapshot(context());
    expect(status.state).toBe('live');
    expect(status.active_streamer_id).toBe('alpha');
    expect(status.source.online).toBe(true);
    expect(status.source.reconnects).toBe(2);
    expect(status.relay.delay_seconds).toBe(DEFAULT_SETTINGS.delay_buffer.size);
    expect(status.sink.target_bitrate_kbps).toBe(DEFAULT_SETTINGS.video.video_bitrate);
    expect(status.watchdog.stall_timeout).toBe(DEFAULT_SETTINGS.watchdog.stall_timeout);
    expect(status.chat).toEqual(chat);
    expect(status.version).toBe(VERSION);
    expect(status.uptime_seconds).toBeGreaterThanOrEqual(5);
  });

  it('exposes the active local video position', () => {
    const status = buildStatusSnapshot(
      context({
        media: { file: 'clip.mp4', duration_seconds: 120, position_seconds: 30 },
      }),
    );
    expect(status.media).toEqual({
      file: 'clip.mp4',
      duration_seconds: 120,
      position_seconds: 30,
    });
  });

  it('maps sink stats and paused screens without an active streamer', () => {    const status = buildStatusSnapshot(
      context({
        state: 'paused',
        activeStreamer: null,
        manualScreen: 'pause',
        monitorOnline: null,
        startedAt: null,
        sink: {
          running: true,
          pid: 42,
          bitrateKbps: 2100,
          targetBitrateKbps: 2400,
          fps: 25,
          droppedFrames: 4,
          speed: '1x',
          lastProgressAt: new Date('2026-11-19T12:00:00.000Z'),
          restarts: 3,
          lastError: null,
        },
        watchdog: {
          stallTimeout: 30,
          stallCount: 1,
          lastStallAt: new Date('2026-11-19T12:01:00.000Z'),
          lastError: 'stall',
        } as StatusBuilderContext['watchdog'],
      }),
    );
    expect(status.active_streamer_id).toBeNull();
    expect(status.manual_screen).toBe('pause');
    expect(status.source.online).toBeNull();
    expect(status.uptime_seconds).toBe(0);
    expect(status.sink.running).toBe(true);
    expect(status.sink.pid).toBe(42);
    expect(status.sink.restarts).toBe(3);
    expect(status.watchdog.stall_count).toBe(1);
    expect(status.watchdog.last_error).toBe('stall');
  });
});
