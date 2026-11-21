import type { Logger } from 'pino';
import type { StreamerConfig, Settings } from '../config/schema.js';
import { StreamerSchema, resolveStreamKey } from '../config/schema.js';
import { sortStreamersByPriority } from '../streamer-order.js';
import { AppError, ValidationError } from '../../utils/errors.js';
import { incMetric } from '../metrics.js';
import type { PauseController } from './pause-controller.js';
import type { SinkController } from './sink-controller.js';
import type { SourceSession } from './source-session.js';
import type { DelayBuffer } from '../relay/delay-buffer.js';
import type { OverlayManager } from '../overlays/overlay-manager.js';
import type { OverlayRuntime } from './overlay-runtime.js';
import type { QueueController } from './queue-controller.js';
import type { StreamerStore } from '../store/streamer-store.js';
import type { AutoRefresh } from './auto-refresh.js';
import type { StreamState } from '../events.js';
import type { SinkOverlayInput } from '../source/ffmpeg.js';

export function resolveScreenTarget(
  streamers: StreamerConfig[],
  activeStreamer: StreamerConfig | null,
  activeSinkKey: string | null,
): { streamer: StreamerConfig | null; key: string } {
  if (activeStreamer && activeSinkKey) {
    return { streamer: activeStreamer, key: activeSinkKey };
  }
  const ordered = [
    ...sortStreamersByPriority(streamers.filter((item) => item.enabled && item.preferred)),
    ...sortStreamersByPriority(streamers.filter((item) => item.enabled && !item.preferred)),
    ...sortStreamersByPriority(streamers.filter((item) => !item.enabled)),
  ];
  for (const streamer of ordered) {
    const { key } = resolveStreamKey(streamer);
    if (key) return { streamer, key };
  }
  return { streamer: null, key: resolveStreamKey({}).key };
}

export function screenFallbackStreamer(
  streamers: StreamerConfig[],
  activeStreamer: StreamerConfig | null,
): StreamerConfig {
  return (
    activeStreamer ??
    streamers[0] ??
    StreamerSchema.parse({ id: 'screen', name: 'Screen', tiktok: 'screen' })
  );
}

export interface ScreenPlaybackDeps {
  pauseController: PauseController;
  sinkController: SinkController;
  sourceSession: SourceSession;
  buffer: DelayBuffer;
  overlays: OverlayManager;
  overlayRuntime: OverlayRuntime;
  queue: QueueController;
  store: StreamerStore;
  logger: Logger;
  registerSecret: (secret: string) => void;
  transitionTo: (state: StreamState, reason?: string) => void;
  markSinkGrace: () => void;
  applyConfiguredDelay: () => void;
  startSinkOrPrefill: (
    key: string,
    filters: string[],
    signature: string,
    input?: SinkOverlayInput,
    logoInput?: SinkOverlayInput,
  ) => void;
  stopSourceAndChat: () => Promise<void>;
  stopSink: () => Promise<void>;
  autoRefresh: AutoRefresh;
  emitAll: () => void;
  isShuttingDown: () => boolean;
  getSettings: () => Settings;
}

export class ScreenPlaybackController {
  constructor(private readonly deps: ScreenPlaybackDeps) {}

  async showScreenLocked(
    type: 'startup' | 'pause',
    activeStreamer: StreamerConfig | null,
  ): Promise<void> {
    if (this.deps.isShuttingDown()) {
      throw new AppError('shutting_down', 'Der Dienst wird beendet', 503);
    }
    const settings = this.deps.getSettings();
    if (type === 'startup' && !settings.startup.enabled) {
      throw new ValidationError('Der Startbildschirm ist in den Einstellungen deaktiviert');
    }
    if (type === 'pause' && !settings.pause.enabled) {
      throw new ValidationError('Der Pausenscreen ist in den Einstellungen deaktiviert');
    }
    this.deps.pauseController.clearStartupTimer();
    this.deps.pauseController.clearOfflinePauseTimer();
    this.deps.pauseController.clearPauseLimit();
    this.deps.sourceSession.clearReconnectTimer();
    this.deps.sinkController.clearStartTimer();
    await this.deps.stopSourceAndChat();
    this.deps.queue.clearPlayback();

    let pendingSink: {
      key: string;
      filters: string[];
      signature: string;
      input?: SinkOverlayInput;
    } | null = null;

    if (activeStreamer && this.deps.sinkController.key) {
      if (!this.deps.sinkController.running) {
        this.deps.buffer.reset();
        this.deps.sourceSession.resetTimeline();
        pendingSink = {
          key: this.deps.sinkController.key,
          filters: this.deps.sinkController.filters,
          signature: this.deps.sinkController.signature,
          input: this.deps.sinkController.overlayInput,
        };
      }
    } else {
      const target = resolveScreenTarget(
        this.deps.store.list(),
        activeStreamer,
        this.deps.sinkController.key,
      );
      if (!target.key) {
        throw new ValidationError(
          'Kein YouTube-Stream-Key gefunden – der Screen kann nicht gesendet werden',
        );
      }
      this.deps.registerSecret(target.key);
      if (!this.deps.sinkController.running || this.deps.sinkController.key !== target.key) {
        if (this.deps.sinkController.running) await this.deps.stopSink();
        this.deps.overlayRuntime.stopEngine();
        this.deps.sinkController.logoInput = undefined;
        this.deps.overlayRuntime.resetMessages(false, false);
        this.deps.buffer.reset();
        this.deps.sourceSession.resetTimeline();
        const prepared = this.deps.overlays.prepare();
        pendingSink = {
          key: target.key,
          filters: prepared.filters,
          signature: this.deps.overlayRuntime.signature(prepared.filters, undefined),
        };
      }
    }
    this.deps.applyConfiguredDelay();
    const offset = this.deps.sourceSession.nextOffset();
    const screen = this.deps.pauseController.screen(type);
    if (screen === this.deps.pauseController.screen('startup')) {
      await this.deps.pauseController.startStartup(offset);
    } else {
      await this.deps.pauseController.startPause(offset);
    }
    if (pendingSink) {
      this.deps.startSinkOrPrefill(
        pendingSink.key,
        pendingSink.filters,
        pendingSink.signature,
        pendingSink.input,
        this.deps.sinkController.logoInput,
      );
    }
    this.deps.sourceSession.markProducerStarted(offset);
    this.deps.markSinkGrace();
    this.deps.pauseController.manualScreen = type;
    this.deps.pauseController.pauseReason = 'user';
    incMetric('manual_screens_total');
    this.deps.transitionTo('paused', `manual ${type} screen`);
    this.deps.autoRefresh.stop();
    this.deps.emitAll();
    this.deps.logger.info(
      { screen: type, streamer: activeStreamer?.id ?? null },
      'Manueller Screen aktiviert',
    );
  }
}
