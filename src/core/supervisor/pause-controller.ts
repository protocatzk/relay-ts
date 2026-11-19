import type { Logger } from 'pino';
import type { Settings } from '../config/schema.js';
import type { PauseScreen } from '../overlays/pause-screen.js';
import type { AsyncLock } from '../../utils/process.js';
import { pauseLimitDelayMs } from './pause-limit.js';

export interface PauseControllerHooks {
  isShuttingDown(): boolean;
  isPaused(): boolean;
  nextOffset(): number;
  markProducerStarted(offset: number): void;
  emitStatus(): void;
  emitAll(): void;
  canScheduleOfflinePause(): boolean;
  canStartOfflinePause(): boolean;
  startOfflinePause(): Promise<void>;
  onPauseLimit(minutes: number): Promise<void>;
}

export interface PauseControllerDeps {
  pauseScreen: PauseScreen;
  startupScreen: PauseScreen;
  settings: Settings;
  logger: Logger;
  lock: AsyncLock;
  hooks: PauseControllerHooks;
}

/** Owns pause/startup screen processes, manual screen state and pause timers. */
export class PauseController {
  private readonly pauseScreen: PauseScreen;
  private readonly startupScreen: PauseScreen;
  private settings: Settings;
  private readonly logger: Logger;
  private readonly lock: AsyncLock;
  private readonly hooks: PauseControllerHooks;

  private pauseRestartTimer?: NodeJS.Timeout;
  private pauseLimitTimer?: NodeJS.Timeout;
  private startupTimer?: NodeJS.Timeout;
  private offlinePauseTimer?: NodeJS.Timeout;
  private pauseReasonState: 'user' | 'offline' | null = null;
  private manualScreenState: 'startup' | 'pause' | null = null;

  constructor(deps: PauseControllerDeps) {
    this.pauseScreen = deps.pauseScreen;
    this.startupScreen = deps.startupScreen;
    this.settings = deps.settings;
    this.logger = deps.logger;
    this.lock = deps.lock;
    this.hooks = deps.hooks;
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
    this.pauseScreen.updateSettings(settings);
    this.startupScreen.updateSettings(settings);
  }

  get manualScreen(): 'startup' | 'pause' | null {
    return this.manualScreenState;
  }

  set manualScreen(value: 'startup' | 'pause' | null) {
    this.manualScreenState = value;
  }

  get pauseReason(): 'user' | 'offline' | null {
    return this.pauseReasonState;
  }

  set pauseReason(value: 'user' | 'offline' | null) {
    this.pauseReasonState = value;
  }

  get pauseRunning(): boolean {
    return this.pauseScreen.running;
  }

  get startupRunning(): boolean {
    return this.startupScreen.running;
  }

  screen(type: 'startup' | 'pause'): PauseScreen {
    return type === 'startup' ? this.startupScreen : this.pauseScreen;
  }

  async startPause(offset: number): Promise<void> {
    await this.pauseScreen.start(undefined, undefined, offset);
  }

  async startStartup(offset: number): Promise<void> {
    await this.startupScreen.start(undefined, undefined, offset);
  }

  async stopPause(): Promise<void> {
    await this.pauseScreen.stop();
  }

  async stopStartup(): Promise<void> {
    await this.startupScreen.stop();
  }

  async stopScreens(): Promise<void> {
    if (this.pauseScreen.running) await this.pauseScreen.stop();
    if (this.startupScreen.running) await this.startupScreen.stop();
  }

  clearState(): void {
    this.pauseReasonState = null;
    this.manualScreenState = null;
  }

  scheduleStartupFinish(delaySeconds: number, onFinish: () => void): void {
    this.clearStartupTimer();
    this.startupTimer = setTimeout(() => {
      this.startupTimer = undefined;
      onFinish();
    }, delaySeconds * 1000);
    this.startupTimer.unref?.();
  }

  clearStartupTimer(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = undefined;
  }

  scheduleOfflinePause(): void {
    if (this.offlinePauseTimer || !this.settings.pause.enabled || !this.hooks.canScheduleOfflinePause()) {
      return;
    }
    const delayMs = Math.max(0, this.settings.pause.grace_seconds) * 1000;
    this.offlinePauseTimer = setTimeout(() => {
      this.offlinePauseTimer = undefined;
      void this.lock.run(async () => {
        if (this.hooks.isShuttingDown() || !this.hooks.canStartOfflinePause()) return;
        await this.hooks.startOfflinePause();
        this.hooks.emitAll();
      });
    }, delayMs);
  }

  clearOfflinePauseTimer(): void {
    if (this.offlinePauseTimer) clearTimeout(this.offlinePauseTimer);
    this.offlinePauseTimer = undefined;
  }

  schedulePauseLimit(): void {
    this.clearPauseLimit();
    const minutes = this.settings.pause.max_minutes;
    const delayMs = pauseLimitDelayMs(minutes);
    if (delayMs === null) return;
    this.pauseLimitTimer = setTimeout(() => {
      this.pauseLimitTimer = undefined;
      void this.lock.run(async () => {
        if (this.hooks.isShuttingDown() || !this.hooks.isPaused()) return;
        this.logger.warn({ minutes }, 'Maximale Pausendauer erreicht – Stream wird gestoppt');
        await this.hooks.onPauseLimit(minutes);
      });
    }, delayMs);
    this.pauseLimitTimer.unref?.();
  }

  clearPauseLimit(): void {
    if (this.pauseLimitTimer) clearTimeout(this.pauseLimitTimer);
    this.pauseLimitTimer = undefined;
  }

  handlePauseScreenExit(): void {
    if (this.hooks.isShuttingDown() || !this.hooks.isPaused()) return;
    this.schedulePauseRestart();
  }

  schedulePauseRestart(): void {
    if (this.pauseRestartTimer || this.hooks.isShuttingDown()) return;
    this.pauseRestartTimer = setTimeout(() => {
      this.pauseRestartTimer = undefined;
      void this.lock.run(async () => {
        if (this.hooks.isShuttingDown() || !this.hooks.isPaused() || this.pauseScreen.running) return;
        const timestampOffset = this.hooks.nextOffset();
        await this.pauseScreen.start(undefined, undefined, timestampOffset);
        this.hooks.markProducerStarted(timestampOffset);
        this.hooks.emitStatus();
      });
    }, 2000);
    this.pauseRestartTimer.unref?.();
  }

  clearTimers(): void {
    this.clearStartupTimer();
    this.clearOfflinePauseTimer();
    this.clearPauseLimit();
    if (this.pauseRestartTimer) clearTimeout(this.pauseRestartTimer);
    this.pauseRestartTimer = undefined;
  }
}
