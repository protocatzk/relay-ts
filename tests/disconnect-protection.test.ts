import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { SettingsSchema } from '../src/core/config/schema.js';
import { Watchdog } from '../src/core/supervisor/watchdog.js';
import { SinkWatchdogCoordinator } from '../src/core/supervisor/sink-watchdog-coordinator.js';
import { AsyncLock } from '../src/utils/process.js';

describe('Disconnect Protection (#62)', () => {
  it('triggers fast stall detection after disconnect_stall_seconds before normal stall_timeout', () => {
    const settings = SettingsSchema.parse({
      watchdog: { stall_timeout: 30, disconnect_stall_seconds: 4, interval: 1 },
    });
    const onRelayStall = vi.fn();
    const now = Date.now();

    const watchdog = new Watchdog({
      settings,
      logger: pino({ level: 'silent' }),
      snapshot: () => ({
        state: 'live',
        relayLastDataAt: new Date(now - 5_000),
        sinkRunning: true,
        sinkStarting: false,
        sinkLastProgressAt: new Date(now),
        sourceRunning: true,
        sourceStartedAt: new Date(now - 20_000),
        sinkStartedAt: new Date(now - 20_000),
        sourceBitrateKbps: 2000,
        sourceOutputSeconds: 15,
        suppressStall: false,
        sinkGraceUntil: 0,
      }),
      onRelayStall,
      onSinkDown: vi.fn(),
      onSinkStall: vi.fn(),
      onLowBitrate: vi.fn(),
      onLowSourceRate: vi.fn(),
    });

    (watchdog as unknown as { check: () => void }).check();
    expect(onRelayStall).toHaveBeenCalledTimes(1);
    expect(onRelayStall).toHaveBeenCalledWith(5);
  });

  it('activates disconnect protection and immediately starts the disconnect slate on stall', async () => {
    const settings = SettingsSchema.parse({
      watchdog: { stall_timeout: 30, disconnect_stall_seconds: 4 },
      pause: { enabled: true, disconnect_max_minutes: 5 },
    });

    let dpActive = false;
    const stopSource = vi.fn().mockResolvedValue(undefined);
    const startOfflinePauseNow = vi.fn().mockResolvedValue(undefined);
    const scheduleOfflinePause = vi.fn();
    const scheduleReconnect = vi.fn();
    const emitAll = vi.fn();

    const coordinator = new SinkWatchdogCoordinator({
      sinkController: { running: true, key: 'yt-key' } as never,
      sourceSession: { stop: stopSource } as never,
      pauseController: {
        markDisconnectProtection: (active: boolean) => {
          dpActive = active;
        },
        get isDisconnectProtectionActive() {
          return dpActive;
        },
        scheduleOfflinePause,
      } as never,
      playlistController: { isAdvancePending: false } as never,
      overlayRuntime: { detachEngine: vi.fn() } as never,
      relay: { lastData: new Date(Date.now() - 6_000) } as never,
      lock: new AsyncLock(),
      logger: pino({ level: 'silent' }),
      getSettings: () => settings,
      getState: () => 'live',
      getActiveStreamer: () => ({ id: 'streamer-1', name: 'Streamer 1' }) as never,
      isShuttingDown: () => false,
      setLastError: vi.fn(),
      scheduleReconnect,
      canStartOfflinePause: () => true,
      startOfflinePauseNow,
      emitAll,
    });

    await coordinator.handleRelayStall(6);

    expect(dpActive).toBe(true);
    expect(stopSource).toHaveBeenCalledTimes(1);
    expect(startOfflinePauseNow).toHaveBeenCalledTimes(1);
    expect(scheduleOfflinePause).not.toHaveBeenCalled();
    expect(scheduleReconnect).toHaveBeenCalledWith(1000);
    expect(emitAll).toHaveBeenCalledTimes(1);
  });
});
