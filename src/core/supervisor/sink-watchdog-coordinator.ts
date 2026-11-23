import type { Logger } from 'pino';
import type { StreamerConfig, Settings } from '../config/schema.js';
import type { StreamState } from '../events.js';
import { incMetric } from '../metrics.js';
import type { WebhookDispatcher } from '../notifications/webhooks.js';
import type { AsyncLock } from '../../utils/process.js';
import type { PauseController } from './pause-controller.js';
import type { PlaylistController } from './playlist-controller.js';
import type { SinkController } from './sink-controller.js';
import type { SourceSession } from './source-session.js';
import type { OverlayRuntime } from './overlay-runtime.js';
import type { MpegTsRelay } from '../relay/relay-server.js';

export interface SinkWatchdogDeps {
  sinkController: SinkController;
  sourceSession: SourceSession;
  pauseController: PauseController;
  playlistController: PlaylistController;
  overlayRuntime: OverlayRuntime;
  relay: MpegTsRelay;
  lock: AsyncLock;
  logger: Logger;
  webhooks?: WebhookDispatcher;
  getSettings: () => Settings;
  getState: () => StreamState;
  getActiveStreamer: () => StreamerConfig | null;
  isShuttingDown: () => boolean;
  setLastError: (err: string | null) => void;
  scheduleReconnect: (delayMs?: number) => void;
  emitAll: () => void;
}

export class SinkWatchdogCoordinator {
  private consecutiveQuickSinkExits = 0;

  constructor(private readonly deps: SinkWatchdogDeps) {}

  resetQuickExits(): void {
    this.consecutiveQuickSinkExits = 0;
  }

  handleSinkExit(): void {
    if (this.deps.sinkController.stopping || this.deps.isShuttingDown()) return;
    if (
      (!this.deps.getActiveStreamer() &&
        !this.deps.pauseController.manualScreen) ||
      !this.deps.sinkController.key
    ) {
      return;
    }
    if (['idle', 'stopping'].includes(this.deps.getState())) return;
    this.deps.overlayRuntime.detachEngine();
    const ranMs = this.deps.sinkController.startedAt
      ? Date.now() - this.deps.sinkController.startedAt.getTime()
      : 0;
    if (ranMs < 15_000) {
      this.consecutiveQuickSinkExits += 1;
    } else {
      this.consecutiveQuickSinkExits = 0;
    }
    const delayMs =
      this.consecutiveQuickSinkExits > 0
        ? Math.min(15_000, 3000 * 2 ** (this.consecutiveQuickSinkExits - 1))
        : 3000;
    this.deps.logger.warn(
      { delayMs, consecutiveQuickExits: this.consecutiveQuickSinkExits },
      'YouTube-Sink beendet – Neustart geplant',
    );
    this.scheduleSinkRestart(delayMs);
  }

  async handleSinkUnhealthy(reason: string): Promise<void> {
    await this.deps.lock.run(async () => {
      if (this.deps.isShuttingDown() || !this.deps.sinkController.key) return;
      if (this.deps.playlistController.isAdvancePending) return;
      this.deps.setLastError(reason);
      incMetric('watchdog_triggers_total');
      this.deps.logger.warn({ reason }, 'YouTube-Sink instabil – kontrollierter Neustart');
      this.deps.webhooks?.notify('stream_error', 'YouTube-Sink instabil', reason, {
        streamer: this.deps.getActiveStreamer()?.id ?? null,
      });
      await this.restartSinkLocked();
    });
  }

  scheduleSinkRestart(delayMs: number): void {
    this.deps.sinkController.scheduleRestart(
      delayMs,
      () => this.restartSinkLocked(),
      () =>
        !this.deps.isShuttingDown() &&
        Boolean(this.deps.sinkController.key) &&
        !['idle', 'stopping'].includes(this.deps.getState()),
    );
  }

  async restartSinkLocked(): Promise<void> {
    if (!this.deps.sinkController.key) return;
    incMetric('sink_restarts_total');
    await this.deps.sinkController.restart();
    this.deps.emitAll();
  }

  async handleRelayStall(ageSeconds: number): Promise<void> {
    await this.deps.lock.run(async () => {
      if (!this.deps.getActiveStreamer() || this.deps.isShuttingDown()) return;
      if (!['live', 'reconnecting'].includes(this.deps.getState())) return;
      if (this.deps.playlistController.isAdvancePending) return;
      const last = this.deps.relay.lastData;
      const settings = this.deps.getSettings();
      if (last && Date.now() - last.getTime() < settings.watchdog.stall_timeout * 1000) {
        return;
      }
      this.deps.setLastError(`Quelle liefert seit ${ageSeconds}s keine Daten`);
      incMetric('watchdog_triggers_total');
      this.deps.logger.warn({ ageSeconds }, 'Quelle wird wegen Stall neu gestartet');
      if (this.deps.sinkController.running) {
        this.deps.pauseController.markDisconnectProtection(true);
      }
      await this.deps.sourceSession.stop();
      this.deps.pauseController.scheduleOfflinePause();
      this.deps.scheduleReconnect(1000);
    });
  }

  async handleLowBitrate(kbps: number): Promise<void> {
    await this.deps.lock.run(async () => {
      if (!this.deps.getActiveStreamer() || this.deps.isShuttingDown()) return;
      if (this.deps.getState() !== 'live') return;
      incMetric('watchdog_triggers_total');
      this.deps.logger.warn(
        { kbps: Math.round(kbps), minimum: this.deps.getSettings().watchdog.min_bitrate },
        'Quell-Bitrate niedrig – Stream bleibt aktiv',
      );
    });
  }

  async handleLowSourceRate(percent: number): Promise<void> {
    await this.handleSourceProblem(`Quellrate zu niedrig (${percent} %)`, { percent });
  }

  async handleSourceProblem(
    reason: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.lock.run(async () => {
      if (!this.deps.getActiveStreamer() || this.deps.isShuttingDown()) return;
      if (this.deps.getState() !== 'live' || this.deps.playlistController.isAdvancePending) return;
      this.deps.setLastError(reason);
      incMetric('watchdog_triggers_total');
      this.deps.logger.warn({ ...context, reason }, 'Quelle wird neu gestartet');
      await this.deps.sourceSession.stop();
      this.deps.pauseController.scheduleOfflinePause();
      this.deps.scheduleReconnect(2000);
    });
  }

  async handleSinkStall(ageSeconds: number): Promise<void> {
    await this.deps.lock.run(async () => {
      if (this.deps.isShuttingDown() || !this.deps.sinkController.key) return;
      if (this.deps.playlistController.isAdvancePending) return;
      const last = this.deps.sinkController.lastProgressAt;
      const settings = this.deps.getSettings();
      if (last && Date.now() - last.getTime() < settings.watchdog.stall_timeout * 1000) {
        return;
      }
      this.deps.setLastError(`Encoder liefert seit ${ageSeconds}s keinen Fortschritt`);
      incMetric('watchdog_triggers_total');
      this.deps.logger.warn({ ageSeconds }, 'Sink wird neu gestartet');
      await this.restartSinkLocked();
    });
  }
}
