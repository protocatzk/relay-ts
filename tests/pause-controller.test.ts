import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PauseScreen } from '../src/core/overlays/pause-screen.js';
import { DEFAULT_SETTINGS } from '../src/core/config/schema.js';
import { AsyncLock } from '../src/utils/process.js';
import {
  PauseController,
  type PauseControllerHooks,
} from '../src/core/supervisor/pause-controller.js';

class FakeScreen {
  running = false;
  async start(): Promise<void> {
    this.running = true;
  }
  async stop(): Promise<void> {
    this.running = false;
  }
  updateSettings(): void {
    /* noop */
  }
}

const settings = {
  ...DEFAULT_SETTINGS,
  pause: { ...DEFAULT_SETTINGS.pause, enabled: true, grace_seconds: 2, max_minutes: 1 },
};

function setup(overrides: Partial<PauseControllerHooks> = {}) {
  const pauseScreen = new FakeScreen();
  const startupScreen = new FakeScreen();
  const hooks: PauseControllerHooks = {
    isShuttingDown: () => false,
    isPaused: () => true,
    nextOffset: () => 12,
    markProducerStarted: vi.fn(),
    emitStatus: vi.fn(),
    emitAll: vi.fn(),
    canScheduleOfflinePause: () => true,
    canStartOfflinePause: () => true,
    startOfflinePause: vi.fn(async () => undefined),
    onPauseLimit: vi.fn(async () => undefined),
    ...overrides,
  };
  const controller = new PauseController({
    pauseScreen: pauseScreen as unknown as PauseScreen,
    startupScreen: startupScreen as unknown as PauseScreen,
    settings,
    logger: { warn: vi.fn(), info: vi.fn() } as never,
    lock: new AsyncLock(),
    hooks,
  });
  return { controller, hooks, pauseScreen, startupScreen };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('pause controller', () => {
  it('starts the offline pause after the grace period', async () => {
    vi.useFakeTimers();
    const { controller, hooks } = setup();
    controller.scheduleOfflinePause();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(hooks.startOfflinePause).toHaveBeenCalledTimes(1);
    expect(hooks.emitAll).toHaveBeenCalledTimes(1);
  });

  it('stops the stream when the pause limit is reached', async () => {
    vi.useFakeTimers();
    const { controller, hooks } = setup();
    controller.schedulePauseLimit();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(hooks.onPauseLimit).toHaveBeenCalledWith(1);
  });

  it('restarts the pause screen with a monotonic offset', async () => {
    vi.useFakeTimers();
    const { controller, hooks, pauseScreen } = setup();
    controller.handlePauseScreenExit();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(pauseScreen.running).toBe(true);
    expect(hooks.markProducerStarted).toHaveBeenCalledWith(12);
    expect(hooks.emitStatus).toHaveBeenCalledTimes(1);
  });
});
