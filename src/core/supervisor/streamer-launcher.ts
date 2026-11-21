import type { Logger } from 'pino';
import type { Settings, StreamerConfig } from '../config/schema.js';
import { resolveStreamKey } from '../config/schema.js';
import type { StatusSnapshot, StreamState } from '../events.js';
import {
  AppError,
  MissingStreamKeyError,
  StreamerOfflineError,
  toErrorMessage,
} from '../../utils/errors.js';
import { incMetric } from '../metrics.js';
import type { AsyncLock } from '../../utils/process.js';
import type { SourceSession } from './source-session.js';
import type { SinkController } from './sink-controller.js';
import type { OverlayRuntime } from './overlay-runtime.js';
import type { OverlayManager } from '../overlays/overlay-manager.js';
import type { PauseController } from './pause-controller.js';
import type { DelayBuffer } from '../relay/delay-buffer.js';
import type { AutoRefresh } from './auto-refresh.js';
import type { Watchdog } from './watchdog.js';
import type { EarningsMonitor } from '../earnings/monitor.js';
import type { PlaylistController, PlaylistRunState } from './playlist-controller.js';
import type { AutoSwitchController } from './auto-switch-controller.js';
import type { MediaPlaybackController } from './media-playback-controller.js';
import type { QueueController } from './queue-controller.js';
import type { ResolvedStream } from '../source/tiktok.js';
import type { SinkOverlayInput } from '../source/ffmpeg.js';

export interface StartStreamerOptions {
  key?: string;
  playlist?: PlaylistRunState;
  allowOfflineWait?: boolean;
  intro?: boolean;
  forceReencode?: boolean;
  preservePreferredReturn?: boolean;
}

export interface StreamerLauncherDeps {
  sourceSession: SourceSession;
  sinkController: SinkController;
  overlayRuntime: OverlayRuntime;
  overlays: OverlayManager;
  pauseController: PauseController;
  buffer: DelayBuffer;
  autoRefresh: AutoRefresh;
  watchdog: Watchdog;
  earnings: EarningsMonitor;
  playlistController: PlaylistController;
  autoSwitch: AutoSwitchController;
  media: MediaPlaybackController;
  queue: QueueController;
  lock: AsyncLock;
  logger: Logger;
  registerSecret: (secret: string) => void;
  getSettings: () => Settings;
  getState: () => StreamState;
  isShuttingDown: () => boolean;
  transitionTo: (state: StreamState, reason?: string) => void;
  emitStatus: () => void;
  emitAll: () => void;
  applyConfiguredDelay: () => void;
  markSinkGrace: () => void;
  startSinkOrPrefill: (
    key: string,
    filters: string[],
    signature: string,
    input?: SinkOverlayInput,
    logoInput?: SinkOverlayInput,
  ) => void;
  stopSourceAndChat: () => Promise<void>;
  stopSink: () => Promise<void>;
  startPauseLocked: () => Promise<void>;
  scheduleReconnect: (delayMs?: number) => void;
  reencodeSource: (reconnect: boolean) => boolean;
  buildStatus: () => StatusSnapshot;
  getActiveStreamer: () => StreamerConfig | null;
  setActiveStreamer: (streamer: StreamerConfig | null) => void;
  setActiveTitle: (title: string) => void;
  setStartedAt: (date: Date | null) => void;
  setLastError: (err: string | null) => void;
  setForceReencodeNext: (val: boolean) => void;
}

export class StreamerLauncher {
  constructor(private readonly deps: StreamerLauncherDeps) {}

  async startStreamerLocked(
    streamer: StreamerConfig,
    options: StartStreamerOptions,
  ): Promise<StatusSnapshot> {
    if (this.deps.isShuttingDown()) throw new AppError('shutting_down', 'Der Dienst wird beendet', 503);
    if (!options.preservePreferredReturn) this.deps.autoSwitch.clearReturnTarget();
    this.deps.media.stop();
    this.deps.sinkController.clearStartTimer();
    const key = options.key ?? resolveStreamKey(streamer).key;
    if (!key) throw new MissingStreamKeyError();
    this.deps.registerSecret(key);

    const activeStreamer = this.deps.getActiveStreamer();
    const state = this.deps.getState();
    if (
      activeStreamer?.id === streamer.id &&
      state === 'live' &&
      this.deps.sinkController.key === key &&
      !options.forceReencode
    ) {
      return this.deps.buildStatus();
    }

    this.deps.sourceSession.clearReconnectTimer();
    const previousState = state;
    this.deps.transitionTo('starting');
    this.deps.setLastError(null);
    this.deps.sourceSession.beginResolve();
    this.deps.emitStatus();

    let stream: ResolvedStream;
    try {
      stream = await this.deps.sourceSession.resolve(streamer);
    } catch (error) {
      this.deps.sourceSession.endResolve();
      const message = toErrorMessage(error);
      this.deps.setLastError(message);
      if (
        error instanceof StreamerOfflineError &&
        options.allowOfflineWait &&
        this.deps.getSettings().pause.enabled
      ) {
        await this.beginWaitingSessionLocked(streamer, key, options, message);
        return this.deps.buildStatus();
      }
      this.deps.transitionTo(
        previousState === 'live' || previousState === 'paused' ? previousState : 'error',
        'start failed',
      );
      this.deps.emitAll();
      throw error;
    }
    this.deps.sourceSession.endResolve();

    const previousKey = this.deps.sinkController.key;
    const prepared = this.deps.overlays.prepare();
    const candidateEngine = this.deps.overlayRuntime.createEngine();
    const candidateLogo = this.deps.overlayRuntime.createLogoEngine();
    const overlayInput = candidateEngine?.panel;
    const logoInput = candidateLogo?.panel;
    const signature = this.deps.overlayRuntime.signature(
      prepared.filters,
      candidateEngine,
      candidateLogo,
    );
    const reusable =
      this.deps.sinkController.running &&
      previousKey === key &&
      this.deps.sinkController.signature === signature;
    const timestampOffset = reusable ? this.deps.sourceSession.nextOffset() : 0;

    await this.deps.stopSourceAndChat();

    if (!reusable) {
      this.deps.buffer.reset();
      this.deps.sourceSession.resetTimeline();
      if (previousKey && previousKey !== key) this.deps.sinkController.notifyStopped(previousKey);
      if (this.deps.sinkController.running) await this.deps.stopSink();
      this.deps.overlayRuntime.replaceEngine(candidateEngine, candidateLogo);
    } else if (
      (!this.deps.overlayRuntime.engine && candidateEngine) ||
      (!this.deps.overlayRuntime.logo && candidateLogo)
    ) {
      this.deps.overlayRuntime.adoptEngine(
        candidateEngine,
        candidateLogo,
        this.deps.sinkController.overlayStream(),
        this.deps.sinkController.logoStream(),
      );
    }
    this.deps.applyConfiguredDelay();

    this.deps.setActiveStreamer(streamer);
    this.deps.media.stop();
    this.deps.queue.clearPlayback();
    this.deps.sinkController.key = key;
    this.deps.sinkController.filters = prepared.filters;
    this.deps.sinkController.overlayInput = overlayInput;
    this.deps.sinkController.logoInput = logoInput;
    this.deps.sinkController.signature = signature;
    this.deps.setStartedAt(new Date());
    this.deps.setActiveTitle(stream.title);
    this.deps.pauseController.pauseReason = null;
    this.deps.pauseController.manualScreen = null;
    this.deps.pauseController.clearPauseLimit();
    this.deps.sourceSession.resetReconnectAttempts();
    this.deps.setForceReencodeNext(options.forceReencode ?? false);

    const settings = this.deps.getSettings();
    const introSeconds =
      options.intro !== false &&
      !options.playlist &&
      previousState === 'idle' &&
      settings.startup.enabled
        ? Math.max(0, settings.startup.duration_seconds)
        : 0;

    if (introSeconds > 0) {
      incMetric('startup_screens_total');
      await this.deps.pauseController.startStartup(timestampOffset);
      this.deps.sourceSession.markProducerStarted(timestampOffset);
      this.deps.markSinkGrace();
      this.deps.pauseController.clearOfflinePauseTimer();
      this.deps.earnings.setActive();
      this.deps.watchdog.reset();
      this.deps.watchdog.clearError();
      this.deps.transitionTo('starting', 'startup screen');
      this.scheduleStartupFinishLocked(streamer, stream, introSeconds);
    } else {
      this.deps.sourceSession.start(
        streamer,
        stream,
        this.deps.reencodeSource(false),
        timestampOffset,
      );
      this.deps.sourceSession.markProducerStarted(timestampOffset);
      this.deps.markSinkGrace();
      this.deps.pauseController.clearOfflinePauseTimer();
      this.deps.overlayRuntime.startChat(streamer);
      this.deps.earnings.setActive();
      this.deps.autoRefresh.start();
      this.deps.watchdog.reset();
      this.deps.watchdog.clearError();
      this.deps.transitionTo('live');
    }
    if (!reusable) {
      this.deps.startSinkOrPrefill(key, prepared.filters, signature, overlayInput, logoInput);
    }
    this.deps.playlistController.activate(options.playlist ?? null);
    this.deps.emitAll();
    this.deps.logger.info(
      { streamer: streamer.id, key: '***', reusedSink: reusable, introSeconds },
      introSeconds > 0 ? 'Startbildschirm aktiv' : 'Stream gestartet',
    );
    return this.deps.buildStatus();
  }

  scheduleStartupFinishLocked(
    streamer: StreamerConfig,
    stream: ResolvedStream,
    introSeconds: number,
  ): void {
    this.deps.pauseController.scheduleStartupFinish(introSeconds, () => {
      void this.deps.lock.run(async () => {
        if (
          this.deps.isShuttingDown() ||
          this.deps.getState() !== 'starting' ||
          this.deps.getActiveStreamer()?.id !== streamer.id
        ) {
          return;
        }
        await this.deps.pauseController.stopStartup();
        if (this.deps.sourceSession.running) return;
        const offset = this.deps.sourceSession.nextOffset();
        this.deps.sourceSession.start(
          streamer,
          stream,
          this.deps.reencodeSource(false),
          offset,
        );
        this.deps.sourceSession.markProducerStarted(offset);
        this.deps.markSinkGrace();
        this.deps.pauseController.clearOfflinePauseTimer();
        this.deps.overlayRuntime.startChat(streamer);
        this.deps.autoRefresh.start();
        this.deps.transitionTo('live', 'startup finished');
        this.deps.emitAll();
      });
    });
  }

  async beginWaitingSessionLocked(
    streamer: StreamerConfig,
    key: string,
    options: StartStreamerOptions,
    message: string,
  ): Promise<void> {
    this.deps.sourceSession.clearReconnectTimer();
    this.deps.pauseController.clearOfflinePauseTimer();
    const prepared = this.deps.overlays.prepare();
    const candidateEngine = this.deps.overlayRuntime.createEngine();
    const candidateLogo = this.deps.overlayRuntime.createLogoEngine();
    const overlayInput = candidateEngine?.panel;
    const logoInput = candidateLogo?.panel;
    const signature = this.deps.overlayRuntime.signature(
      prepared.filters,
      candidateEngine,
      candidateLogo,
    );
    const reusable =
      this.deps.sinkController.running &&
      this.deps.sinkController.key === key &&
      this.deps.sinkController.signature === signature;

    await this.deps.stopSourceAndChat();
    if (!reusable) {
      this.deps.buffer.reset();
      this.deps.sourceSession.resetTimeline();
      if (this.deps.sinkController.running) await this.deps.stopSink();
      this.deps.overlayRuntime.replaceEngine(candidateEngine, candidateLogo);
    } else if (
      (!this.deps.overlayRuntime.engine && candidateEngine) ||
      (!this.deps.overlayRuntime.logo && candidateLogo)
    ) {
      this.deps.overlayRuntime.adoptEngine(
        candidateEngine,
        candidateLogo,
        this.deps.sinkController.overlayStream(),
        this.deps.sinkController.logoStream(),
      );
    }

    this.deps.setActiveStreamer(streamer);
    this.deps.sinkController.key = key;
    this.deps.sinkController.filters = prepared.filters;
    this.deps.sinkController.overlayInput = overlayInput;
    this.deps.sinkController.logoInput = logoInput;
    this.deps.sinkController.signature = signature;
    this.deps.setStartedAt(new Date());
    this.deps.setActiveTitle(streamer.name);
    this.deps.sourceSession.resetReconnectAttempts();
    this.deps.setForceReencodeNext(false);
    this.deps.applyConfiguredDelay();
    this.deps.autoRefresh.stop();
    this.deps.watchdog.reset();
    this.deps.watchdog.clearError();

    this.deps.playlistController.activate(options.playlist ?? null);

    await this.deps.startPauseLocked();
    this.deps.earnings.setActive();
    this.deps.setLastError(message);
    this.deps.emitAll();
    this.deps.scheduleReconnect(30_000);
    this.deps.logger.info(
      { streamer: streamer.id, err: message },
      'Streamer offline – Wartemodus mit Pausenscreen',
    );
  }
}
