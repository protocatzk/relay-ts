import type { Logger } from 'pino';
import type { Settings } from '../config/schema.js';
import type { SinkOverlayInput } from '../source/ffmpeg.js';
import type { YouTubeSink } from '../sink/youtube-sink.js';
import { AsyncLock } from '../../utils/process.js';
import { toErrorMessage } from '../../utils/errors.js';

export interface YouTubeHooks {
  streamStarted?: (streamKey: string) => void | Promise<void>;
  streamStopped?: (streamKey: string) => void | Promise<void>;
}

export interface SinkControllerDeps {
  sink: YouTubeSink;
  settings: Settings;
  logger: Logger;
  lock: AsyncLock;
  isShuttingDown: () => boolean;
  canStartDelayed: () => boolean;
  onStarted: () => void;
  onStopping: () => void;
  onPrefillDone: () => void;
  youtube: () => YouTubeHooks | undefined;
}

export interface SinkStartOptions {
  key: string;
  filters: string[];
  signature: string;
  overlayInput?: SinkOverlayInput;
  delaySeconds: number;
  bufferedSeconds: number;
}

/** Owns the YouTube sink process, prefill/restart timers and YouTube hooks. */
export class SinkController {
  private readonly sink: YouTubeSink;
  private settings: Settings;
  private readonly logger: Logger;
  private readonly lock: AsyncLock;
  private readonly isShuttingDown: () => boolean;
  private readonly canStartDelayed: () => boolean;
  private readonly onStarted: () => void;
  private readonly onStopping: () => void;
  private readonly onPrefillDone: () => void;
  private readonly youtube: () => YouTubeHooks | undefined;

  private currentKey = '';
  private currentFilters: string[] = [];
  private currentOverlayInput?: SinkOverlayInput;
  private currentSignature = '';
  private delaySeconds = 0;
  private startTimer?: NodeJS.Timeout;
  private restartTimer?: NodeJS.Timeout;
  private youtubeStartTimer?: NodeJS.Timeout;
  private startPending = false;
  private stopPending = false;
  private sinkGraceUntil = 0;

  constructor(deps: SinkControllerDeps) {
    this.sink = deps.sink;
    this.settings = deps.settings;
    this.logger = deps.logger;
    this.lock = deps.lock;
    this.isShuttingDown = deps.isShuttingDown;
    this.canStartDelayed = deps.canStartDelayed;
    this.onStarted = deps.onStarted;
    this.onStopping = deps.onStopping;
    this.onPrefillDone = deps.onPrefillDone;
    this.youtube = deps.youtube;
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
    this.sink.updateSettings(settings);
  }

  get key(): string {
    return this.currentKey;
  }

  set key(value: string) {
    this.currentKey = value;
  }

  get filters(): string[] {
    return this.currentFilters;
  }

  set filters(value: string[]) {
    this.currentFilters = value;
  }

  get overlayInput(): SinkOverlayInput | undefined {
    return this.currentOverlayInput;
  }

  set overlayInput(value: SinkOverlayInput | undefined) {
    this.currentOverlayInput = value;
  }

  get signature(): string {
    return this.currentSignature;
  }

  set signature(value: string) {
    this.currentSignature = value;
  }

  get running(): boolean {
    return this.sink.running;
  }

  get starting(): boolean {
    return this.startPending;
  }

  get stopping(): boolean {
    return this.stopPending;
  }

  get graceUntil(): number {
    return this.sinkGraceUntil;
  }

  get lastProgressAt(): Date | null {
    return this.sink.lastProgressAt;
  }

  get startedAt(): Date | null {
    return this.sink.startedAt;
  }

  stats(): ReturnType<YouTubeSink['stats']> {
    return this.sink.stats();
  }

  overlayStream(): NodeJS.WritableStream | null {
    return this.sink.overlayStream();
  }

  startOrPrefill(options: SinkStartOptions): void {
    this.currentKey = options.key;
    this.currentFilters = options.filters;
    this.currentSignature = options.signature;
    this.currentOverlayInput = options.overlayInput;
    this.delaySeconds = options.delaySeconds;
    const remaining = Math.max(0, options.delaySeconds - options.bufferedSeconds);
    if (remaining <= 0) {
      this.startNow();
      return;
    }
    this.startPending = true;
    this.logger.info(
      {
        delaySeconds: options.delaySeconds,
        bufferedSeconds: options.bufferedSeconds,
        waitSeconds: remaining,
      },
      'Sink startet nach Delay-Prefill',
    );
    this.startTimer = setTimeout(() => {
      this.startTimer = undefined;
      this.startPending = false;
      void this.lock.run(async () => {
        if (this.isShuttingDown() || this.sink.running || this.currentKey !== options.key) return;
        if (!this.canStartDelayed()) {
          this.logger.warn('Delay-Prefill beendet, aber keine Quelle aktiv');
          return;
        }
        this.startNow();
        this.onPrefillDone();
      });
    }, remaining * 1000 + 250);
    this.startTimer.unref?.();
  }

  async stop(): Promise<void> {
    this.clearStartTimer();
    this.clearYouTubeStartTimer();
    this.stopPending = true;
    this.onStopping();
    try {
      await this.sink.stop();
    } finally {
      this.stopPending = false;
    }
  }

  async restart(): Promise<void> {
    if (!this.currentKey) return;
    this.clearStartTimer();
    this.clearRestartTimer();
    await this.stop();
    this.startNow();
  }

  markGrace(): void {
    const delay = this.settings.delay_buffer.enabled ? this.settings.delay_buffer.size : 0;
    this.sinkGraceUntil = Date.now() + (delay + 5) * 1000;
  }

  notifyStopped(key: string): void {
    const hook = this.youtube()?.streamStopped;
    if (!hook || !key) return;
    void Promise.resolve()
      .then(() => hook(key))
      .catch((error: unknown) => {
        this.logger.warn({ err: toErrorMessage(error) }, 'YouTube-Autostop fehlgeschlagen');
      });
  }

  scheduleRestart(
    delayMs: number,
    restart: () => Promise<void>,
    canRestart: () => boolean,
  ): void {
    if (this.restartTimer || this.isShuttingDown()) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      void this.lock.run(async () => {
        if (this.stopPending || this.isShuttingDown() || this.sink.running || !canRestart()) return;
        await restart();
      });
    }, delayMs);
    this.restartTimer.unref?.();
  }

  clearTimers(): void {
    this.clearStartTimer();
    this.clearRestartTimer();
    this.clearYouTubeStartTimer();
  }

  clearStartTimer(): void {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = undefined;
    this.startPending = false;
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
  }

  private clearYouTubeStartTimer(): void {
    if (this.youtubeStartTimer) clearTimeout(this.youtubeStartTimer);
    this.youtubeStartTimer = undefined;
  }

  private startNow(): void {
    this.clearStartTimer();
    this.stopPending = false;
    const key = this.currentKey;
    const delay = this.settings.delay_buffer.enabled ? this.settings.delay_buffer.size : 0;
    this.sinkGraceUntil = Date.now() + (delay + 5) * 1000;
    this.sink.start(key, this.currentFilters, this.currentOverlayInput);
    this.scheduleYouTubeStarted(key);
    if (this.currentOverlayInput) this.onStarted();
  }

  private scheduleYouTubeStarted(key: string): void {
    this.clearYouTubeStartTimer();
    if (!key) return;
    this.youtubeStartTimer = setTimeout(() => {
      this.youtubeStartTimer = undefined;
      if (this.isShuttingDown() || !this.sink.running || this.currentKey !== key) return;
      const hook = this.youtube()?.streamStarted;
      if (!hook) return;
      void Promise.resolve()
        .then(() => hook(key))
        .catch((error: unknown) => {
          this.logger.warn({ err: toErrorMessage(error) }, 'YouTube-Autostart fehlgeschlagen');
        });
    }, 5000);
    this.youtubeStartTimer.unref?.();
  }
}
