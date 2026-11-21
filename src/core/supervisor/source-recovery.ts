import type { Logger } from 'pino';
import type { Settings, StreamerConfig } from '../config/schema.js';
import type { StreamState } from '../events.js';
import { StreamerOfflineError, toErrorMessage } from '../../utils/errors.js';
import { incMetric } from '../metrics.js';
import type { AsyncLock } from '../../utils/process.js';
import type { WebhookDispatcher } from '../notifications/webhooks.js';
import type { SourceSession } from './source-session.js';
import type { PauseController } from './pause-controller.js';
import type { SinkController } from './sink-controller.js';
import type { OverlayRuntime } from './overlay-runtime.js';
import type { AutoRefresh } from './auto-refresh.js';
import type { PlaylistController } from './playlist-controller.js';
import type { AutoSwitchController } from './auto-switch-controller.js';
import type { MediaPlaybackController } from './media-playback-controller.js';
import type { Watchdog } from './watchdog.js';
import type { SinkOverlayInput } from '../source/ffmpeg.js';

export interface SourceRecoveryDeps {
  sourceSession: SourceSession;
  pauseController: PauseController;
  sinkController: SinkController;
  overlayRuntime: OverlayRuntime;
  autoRefresh: AutoRefresh;
  playlistController: PlaylistController;
  autoSwitch: AutoSwitchController;
  media: MediaPlaybackController;
  watchdog: Watchdog;
  lock: AsyncLock;
  logger: Logger;
  webhooks?: WebhookDispatcher;
  getSettings: () => Settings;
  getActiveStreamer: () => StreamerConfig | null;
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
  returnToPreferredOrigin: (reason: string) => Promise<boolean>;
  setLastError: (err: string | null) => void;
  setActiveTitle: (title: string) => void;
  isForceReencodeNext: () => boolean;
  setForceReencodeNext: (val: boolean) => void;
}

export class SourceRecoveryController {
  constructor(private readonly deps: SourceRecoveryDeps) {}

  reencodeSource(reconnect: boolean): boolean {
    if (this.deps.isForceReencodeNext()) return true;
    const mode = this.deps.getSettings().source.reencode;
    if (mode === 'always') return true;
    if (mode === 'on_reconnect' && reconnect) return true;
    return false;
  }

  scheduleReconnect(delayMs?: number): void {
    const streamer = this.deps.getActiveStreamer();
    if (this.deps.isShuttingDown() || !streamer || this.deps.sourceSession.reconnecting) {
      return;
    }
    incMetric('source_reconnects_total');
    const scheduled = this.deps.sourceSession.scheduleReconnect(delayMs, () => void this.reconnect());
    if (!scheduled) return;
    if (this.deps.getState() !== 'paused') {
      this.deps.transitionTo('reconnecting', 'reconnect scheduled');
    }
  }

  async reconnect(): Promise<void> {
    await this.deps.lock.run(async () => {
      const streamer = this.deps.getActiveStreamer();
      if (this.deps.isShuttingDown() || !streamer) return;
      if (this.deps.getState() === 'paused' && this.deps.pauseController.pauseReason === 'user') {
        return;
      }
      if (this.deps.sourceSession.running) return;
      this.deps.transitionTo('reconnecting');
      this.deps.emitStatus();
      try {
        const stream = await this.deps.sourceSession.resolve(streamer);
        await this.deps.pauseController.stopPause();
        this.deps.applyConfiguredDelay();
        const timestampOffset = this.deps.sourceSession.nextOffset();
        this.deps.sourceSession.start(
          streamer,
          stream,
          this.reencodeSource(true),
          timestampOffset,
        );
        if (!this.deps.sinkController.running && this.deps.sinkController.key) {
          this.deps.startSinkOrPrefill(
            this.deps.sinkController.key,
            this.deps.sinkController.filters,
            this.deps.sinkController.signature,
            this.deps.sinkController.overlayInput,
            this.deps.sinkController.logoInput,
          );
        }
        this.deps.sourceSession.markProducerStarted(timestampOffset);
        this.deps.markSinkGrace();
        this.deps.applyConfiguredDelay();
        this.deps.pauseController.clearOfflinePauseTimer();
        this.deps.setActiveTitle(stream.title);
        this.deps.pauseController.clearPauseLimit();
        this.deps.pauseController.pauseReason = null;
        this.deps.pauseController.manualScreen = null;
        this.deps.setLastError(null);
        this.deps.sourceSession.resetReconnectAttempts();
        this.deps.watchdog.clearError();
        this.deps.overlayRuntime.ensureChat(streamer);
        this.deps.transitionTo('live');
        incMetric('reconnect_success_total');
        this.deps.emitAll();
        this.deps.logger.info({ streamer: streamer.id }, 'Stream wieder verbunden');
      } catch (error) {
        const message = toErrorMessage(error);
        this.deps.setLastError(message);
        incMetric('reconnect_failures_total');
        if (this.deps.sourceSession.reconnectAttempts >= 3) {
          this.deps.webhooks?.notify('reconnect_failed', 'Neuverbindung fehlgeschlagen', message, {
            streamer: streamer.id,
            attempts: this.deps.sourceSession.reconnectAttempts,
          });
        }
        this.deps.logger.warn({ streamer: streamer.id, err: message }, 'Neuverbindung fehlgeschlagen');
        if (error instanceof StreamerOfflineError && this.deps.autoSwitch.returnTarget) {
          await this.deps.returnToPreferredOrigin('preferred streamer offline');
          this.deps.emitAll();
          return;
        }
        const playlist = this.deps.playlistController.current;
        const settings = this.deps.getSettings();
        if (error instanceof StreamerOfflineError && playlist) {
          if (playlist.playlist.auto_advance) {
            this.deps.playlistController.scheduleAdvance();
            this.deps.emitStatus();
            return;
          }
          if (
            settings.pause.enabled &&
            this.deps.sinkController.running &&
            !this.deps.pauseController.pauseRunning
          ) {
            await this.startPauseLocked();
          }
          this.deps.emitStatus();
          this.scheduleReconnect(Math.max(30, settings.watchdog.max_reconnect_delay) * 1000);
          return;
        }
        if (
          error instanceof StreamerOfflineError &&
          settings.pause.enabled &&
          this.deps.sinkController.running &&
          !this.deps.pauseController.pauseRunning &&
          this.deps.sourceSession.reconnectAttempts >= 2
        ) {
          await this.startPauseLocked();
        }
        this.deps.emitStatus();
        this.scheduleReconnect(error instanceof StreamerOfflineError ? 30_000 : undefined);
      }
    });
  }

  handleSourceExit(code: number | null = null, signal: NodeJS.Signals | null = null): void {
    if (this.deps.isShuttingDown() || this.deps.sourceSession.stopping > 0) return;
    if (this.deps.media.isPlaying) {
      const file = this.deps.media.file;
      this.deps.media.stop();
      this.deps.logger.info({ file, code, signal }, 'Lokales Playlist-Video beendet');
      void this.deps.playlistController.advanceAfterFile().catch((error) => {
        this.deps.setLastError(toErrorMessage(error));
        this.deps.logger.warn(
          { err: toErrorMessage(error) },
          'Playlist konnte nach Video nicht fortsetzen',
        );
        this.deps.emitAll();
      });
      return;
    }
    const streamer = this.deps.getActiveStreamer();
    if (!streamer) return;
    const state = this.deps.getState();
    if (!['live', 'starting'].includes(state)) return;
    incMetric('source_exits_total');
    this.deps.sourceSession.incrementReconnects();
    this.deps.setLastError('Stream-Quelle beendet');
    this.deps.pauseController.scheduleOfflinePause();
    if (!this.deps.getSettings().watchdog.auto_reconnect) {
      if (this.deps.autoSwitch.returnTarget) {
        void this.deps.lock.run(async () => {
          await this.deps.returnToPreferredOrigin('preferred source ended without reconnect');
          this.deps.emitAll();
        });
        return;
      }
      this.deps.transitionTo('error');
      this.deps.emitAll();
      return;
    }
    this.deps.transitionTo('reconnecting');
    this.deps.emitStatus();
    this.deps.logger.warn({ streamer: streamer.id }, 'Quelle unerwartet beendet – Neuverbindung');
    this.scheduleReconnect();
  }

  async startPauseLocked(): Promise<void> {
    this.deps.pauseController.clearStartupTimer();
    await this.deps.pauseController.stopStartup();
    this.deps.overlayRuntime.stopChat();
    this.deps.applyConfiguredDelay();
    const timestampOffset = this.deps.sourceSession.nextOffset();
    await this.deps.pauseController.startPause(timestampOffset);
    if (!this.deps.sinkController.running && this.deps.sinkController.key) {
      this.deps.startSinkOrPrefill(
        this.deps.sinkController.key,
        this.deps.sinkController.filters,
        this.deps.sinkController.signature,
        this.deps.sinkController.overlayInput,
        this.deps.sinkController.logoInput,
      );
    }
    this.deps.sourceSession.markProducerStarted(timestampOffset);
    this.deps.markSinkGrace();
    this.deps.pauseController.pauseReason = 'offline';
    this.deps.pauseController.manualScreen = null;
    this.deps.transitionTo('paused');
    incMetric('pause_starts_total');
    this.deps.pauseController.schedulePauseLimit();
    this.deps.logger.info('Quelle offline – Pausenscreen aktiv');
  }

  canStartOfflinePauseLocked(): boolean {
    if (
      this.deps.sourceSession.running ||
      this.deps.pauseController.pauseRunning ||
      !this.deps.sinkController.running
    ) {
      return false;
    }
    if (this.deps.playlistController.isAdvancePending) return false;
    const state = this.deps.getState();
    if (!['live', 'starting', 'reconnecting', 'paused', 'error'].includes(state)) return false;
    if (state === 'paused' && this.deps.pauseController.pauseReason === 'user') return false;
    return true;
  }

  async refreshSource(reason: string): Promise<void> {
    await this.deps.lock.run(async () => {
      const streamer = this.deps.getActiveStreamer();
      if (!streamer || this.deps.isShuttingDown()) return;
      const state = this.deps.getState();
      if (!['live', 'paused'].includes(state)) return;
      this.deps.logger.info({ reason }, 'Quell-URL wird aktualisiert');
      try {
        const stream = await this.deps.sourceSession.resolve(streamer);
        await this.deps.pauseController.stopPause();
        await this.deps.sourceSession.stop();
        const timestampOffset = this.deps.sourceSession.nextOffset();
        this.deps.sourceSession.start(
          streamer,
          stream,
          this.reencodeSource(true),
          timestampOffset,
        );
        this.deps.sourceSession.markProducerStarted(timestampOffset);
        this.deps.markSinkGrace();
        this.deps.applyConfiguredDelay();
        this.deps.pauseController.clearOfflinePauseTimer();
        this.deps.setActiveTitle(stream.title);
        this.deps.pauseController.clearPauseLimit();
        this.deps.pauseController.pauseReason = null;
        this.deps.pauseController.manualScreen = null;
        this.deps.transitionTo('live');
        this.deps.setLastError(null);
        this.deps.autoRefresh.markRefreshed();
        this.deps.overlayRuntime.ensureChat(streamer);
        this.deps.emitAll();
      } catch (error) {
        const errMessage = toErrorMessage(error);
        this.deps.setLastError(errMessage);
        this.deps.emitStatus();
        if (error instanceof StreamerOfflineError && this.deps.autoSwitch.returnTarget) {
          await this.deps.returnToPreferredOrigin('preferred streamer offline');
          return;
        }
        if (!this.deps.sourceSession.running && this.deps.getState() === 'live') {
          this.scheduleReconnect(3000);
        }
        if (error instanceof StreamerOfflineError) {
          this.deps.logger.warn('Auto-Refresh: Streamer ist offline');
          if (this.deps.playlistController.current?.playlist.auto_advance) {
            this.deps.playlistController.scheduleAdvance();
          }
        } else {
          this.deps.logger.warn({ err: errMessage }, 'Auto-Refresh fehlgeschlagen');
        }
        throw error;
      }
    });
  }

  handleCodecProblem(line: string): void {
    if (
      this.deps.isShuttingDown() ||
      this.deps.sourceSession.stopping > 0 ||
      !this.deps.getActiveStreamer()
    ) {
      return;
    }
    this.deps.logger.warn({ line }, 'Quell-Codec wird nicht unterstützt – Re-Encoding-Fallback');
    this.deps.setForceReencodeNext(true);
    void (async () => {
      await this.deps.sourceSession.stop();
      this.deps.pauseController.scheduleOfflinePause();
      this.scheduleReconnect(1000);
    })();
  }
}
