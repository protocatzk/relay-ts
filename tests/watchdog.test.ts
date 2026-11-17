import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Watchdog, type WatchdogSnapshot } from '../src/core/supervisor/watchdog.js';
import { DEFAULT_SETTINGS, type Settings } from '../src/core/config/schema.js';

const logger = pino({ level: 'silent' });

function settings(overrides: Partial<Settings['watchdog']> = {}): Settings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    watchdog: { ...DEFAULT_SETTINGS.watchdog, interval: 1, stall_timeout: 30, min_bitrate: 500, ...overrides },
  };
}

function snapshot(overrides: Partial<WatchdogSnapshot> = {}): WatchdogSnapshot {
  const now = new Date();
  return {
    state: 'live',
    relayLastDataAt: now,
    sinkRunning: true,
    sinkLastProgressAt: now,
    sourceRunning: true,
    sourceStartedAt: now,
    sinkStartedAt: now,
    sourceBitrateKbps: 4000,
    suppressStall: false,
    sinkGraceUntil: 0,
    ...overrides,
  };
}

let watchdog: Watchdog | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
});

afterEach(() => {
  watchdog?.stop();
  watchdog = null;
  vi.useRealTimers();
});

describe('Watchdog', () => {
  it('detects a relay stall and reports it once per timeout', () => {
    const onRelayStall = vi.fn();
    watchdog = new Watchdog({
      settings: settings(),
      logger,
      snapshot: () =>
        snapshot({ relayLastDataAt: new Date(Date.now() - 40_000) }),
      onRelayStall,
      onSinkDown: vi.fn(),
      onSinkStall: vi.fn(),
      onLowBitrate: vi.fn(),
    });
    watchdog.start();
    vi.advanceTimersByTime(1100);
    expect(onRelayStall).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(onRelayStall).toHaveBeenCalledTimes(1);
  });

  it('restarts the source after three low-bitrate samples', () => {
    const onLowBitrate = vi.fn();
    watchdog = new Watchdog({
      settings: settings(),
      logger,
      snapshot: () => snapshot({ sourceBitrateKbps: 100 }),
      onRelayStall: vi.fn(),
      onSinkDown: vi.fn(),
      onSinkStall: vi.fn(),
      onLowBitrate,
    });
    watchdog.start();
    vi.advanceTimersByTime(1100);
    expect(onLowBitrate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onLowBitrate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onLowBitrate).toHaveBeenCalledWith(100);
  });

  it('reports a missing sink', () => {
    const onSinkDown = vi.fn();
    watchdog = new Watchdog({
      settings: settings(),
      logger,
      snapshot: () => snapshot({ sinkRunning: false }),
      onRelayStall: vi.fn(),
      onSinkDown,
      onSinkStall: vi.fn(),
      onLowBitrate: vi.fn(),
    });
    watchdog.start();
    vi.advanceTimersByTime(1100);
    expect(onSinkDown).toHaveBeenCalledTimes(1);
  });

  it('waits for the delay buffer during the sink grace period', () => {
    const onSinkStall = vi.fn();
    watchdog = new Watchdog({
      settings: settings(),
      logger,
      snapshot: () =>
        snapshot({
          sinkLastProgressAt: new Date(Date.now() - 60_000),
          sinkGraceUntil: Date.now() + 10_000,
        }),
      onRelayStall: vi.fn(),
      onSinkDown: vi.fn(),
      onSinkStall,
      onLowBitrate: vi.fn(),
    });
    watchdog.start();
    vi.advanceTimersByTime(11_000);
    expect(onSinkStall).not.toHaveBeenCalled();
  });

  it('does nothing while idle or during a playlist switch', () => {
    const onRelayStall = vi.fn();
    watchdog = new Watchdog({
      settings: settings(),
      logger,
      snapshot: () => snapshot({ state: 'idle' }),
      onRelayStall,
      onSinkDown: vi.fn(),
      onSinkStall: vi.fn(),
      onLowBitrate: vi.fn(),
    });
    watchdog.start();
    vi.advanceTimersByTime(5000);
    expect(onRelayStall).not.toHaveBeenCalled();

    watchdog.stop();
    const suppressed = vi.fn();
    watchdog = new Watchdog({
      settings: settings(),
      logger,
      snapshot: () => snapshot({ suppressStall: true, sourceBitrateKbps: 10 }),
      onRelayStall: suppressed,
      onSinkDown: vi.fn(),
      onSinkStall: vi.fn(),
      onLowBitrate: suppressed,
    });
    watchdog.start();
    vi.advanceTimersByTime(5000);
    expect(suppressed).not.toHaveBeenCalled();
  });
});
