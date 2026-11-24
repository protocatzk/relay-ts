import { join } from 'node:path';
import type { Logger } from 'pino';
import type { LoadedConfig } from '../config/loader.js';
import {
  resolveStreamKey,
  type PlaylistConfig,
  type Settings,
  type StreamerConfig,
} from '../config/schema.js';
import { AsyncLock, runCommand } from '../../utils/process.js';
import {
  AppError,
  NotFoundError,
  ValidationError,
  toErrorMessage,
} from '../../utils/errors.js';
import { VERSION } from '../../version.js';
import type {
  EventBus,
  PlaybackState,
  QueueEntryKind,
  StatusSnapshot,
  StreamState,
} from '../events.js';
import type { SettingsService } from '../store/settings-service.js';
import type { StreamerStore, StreamerView } from '../store/streamer-store.js';
import { DelayBuffer } from '../relay/delay-buffer.js';
import { MpegTsRelay } from '../relay/relay-server.js';
import type { ResolvedStream } from '../source/tiktok.js';
import { OutputFanout } from './output-fanout.js';
import type { ClipOptions, ClipResult } from '../recording/recording-controller.js';
import type { MarkerSource, RecordingMarker } from '../recording/recording-markers.js';
import { MediaPlaybackController } from './media-playback-controller.js';
import { AutoSwitchController, type PreferredReturnTarget } from './auto-switch-controller.js';
import {
  ScreenPlaybackController,
  resolveScreenTarget,
  screenFallbackStreamer,
} from './screen-controller.js';
import { SourceRecoveryController } from './source-recovery.js';
import { StreamerLauncher, type StartStreamerOptions } from './streamer-launcher.js';
import { SinkWatchdogCoordinator } from './sink-watchdog-coordinator.js';
import { QueuePlaybackCoordinator } from './queue-playback-coordinator.js';
import { PlaybackService } from './playback-service.js';
import type { RtmpIngestServer } from '../ingest/rtmp-server.js';
import {
  formatStreamTitle,
  buildStreamersView,
  buildPlaylistsView,
  type PlaylistView,
} from './supervisor-views.js';
export type { PlaylistView };
import { applySupervisorSettings, type SettingsApplyHost } from './settings-applier.js';
import { createSupervisorSubsystems, type SupervisorWiringHost } from './supervisor-wiring.js';
import { OverlayManager } from '../overlays/overlay-manager.js';
import type { ChatMessage } from '../overlays/chat-service.js';
import { OnlineMonitor } from '../online/monitor.js';
import type { TikTokAccountStore } from '../account/tiktok-account-store.js';
import { EarningsMonitor } from '../earnings/monitor.js';
import type { EarningsPeriod } from '../earnings/history.js';
import type { PreviewAspect } from '../overlays/studio-preview.js';
import { Watchdog } from './watchdog.js';
import { AutoRefresh } from './auto-refresh.js';
import { SupervisorStateMachine } from './state-machine.js';
import { buildStatusSnapshot } from './status-builder.js';
import { OverlayRuntime } from './overlay-runtime.js';
import { SinkController } from './sink-controller.js';
import { PauseController } from './pause-controller.js';
import { SourceSession } from './source-session.js';
import {
  PlaylistController,
  type PlaylistStartOptions,
} from './playlist-controller.js';
import { probeMediaFile } from '../media/media-files.js';
import type { SinkOverlayInput } from '../source/ffmpeg.js';
import { QueueController, QUEUE_PLAYLIST_ID, type QueuePlayback } from './queue-controller.js';
import type { QueueSnapshot } from '../events.js';
import { SceneStore, type OverlayScene } from '../overlays/scene-store.js';
import type { WebhookDispatcher } from '../notifications/webhooks.js';

export interface SupervisorDeps {
  config: LoadedConfig;
  settingsService: SettingsService;
  store: StreamerStore;
  logger: Logger;
  bus: EventBus;
  redact: (text: string) => string;
  registerSecret: (secret: string | undefined) => void;
  /** Injectable for tests; defaults to the real TikTok resolver. */
  resolver?: { resolve(streamer: StreamerConfig): Promise<ResolvedStream> };
  /** Optional YouTube broadcast automation; failures must never affect the stream. */
  youtube?: {
    streamStarted?: (streamKey: string) => void | Promise<void>;
    streamStopped?: (streamKey: string) => void | Promise<void>;
  };
  scenes?: SceneStore;
  webhooks?: WebhookDispatcher;
  /** Optional TikTok account store; used by the online monitor. */
  tiktokAccounts?: TikTokAccountStore;
}

export class Supervisor {
  private readonly deps: SupervisorDeps;
  private readonly lock = new AsyncLock();
  private settings: Settings;

  private buffer!: DelayBuffer;
  private relay!: MpegTsRelay;
  private sourceSession!: SourceSession;
  private sinkController!: SinkController;
  private outputFanout!: OutputFanout;
  private overlays!: OverlayManager;
  private pauseController!: PauseController;
  private watchdog!: Watchdog;
  private autoRefresh!: AutoRefresh;
  private online!: OnlineMonitor;
  private earnings!: EarningsMonitor;
  private overlayRuntime!: OverlayRuntime;
  private screenController!: ScreenPlaybackController;
  private sourceRecovery!: SourceRecoveryController;
  private streamerLauncher!: StreamerLauncher;
  private sinkWatchdog!: SinkWatchdogCoordinator;
  private rtmpIngest!: RtmpIngestServer;

  private readonly stateMachine: SupervisorStateMachine;
  private activeStreamer: StreamerConfig | null = null;
  startingStreamerId: string | null = null;
  private readonly media = new MediaPlaybackController();
  private readonly autoSwitch = new AutoSwitchController();
  private statusTicks = 0;
  private readonly playlistController: PlaylistController;
  private readonly queue: QueueController;
  private readonly queueCoordinator: QueuePlaybackCoordinator;
  private readonly playbackService: PlaybackService;
  private lastPlaybackSignature = '';
  private startedAt: Date | null = null;
  private lastError: string | null = null;
  private activeTitle = '';
  private statusTimer?: NodeJS.Timeout;
  private autoStartTimer?: NodeJS.Timeout;
  private shuttingDown = false;
  private forceReencodeNext = false;
  private readonly scenes: SceneStore;
  private applyingScene = false;
  private lastDiskWarning: string | null = null;

  constructor(deps: SupervisorDeps) {
    this.deps = deps;
    this.settings = deps.settingsService.get();
    this.scenes = deps.scenes ?? new SceneStore(join(deps.config.paths.dataDir, 'scenes.json'));
    this.stateMachine = new SupervisorStateMachine('idle', deps.logger);
    this.queue = new QueueController({
      path: join(deps.config.paths.dataDir, 'queue.json'),
      dataDir: deps.config.paths.dataDir,
      store: deps.store,
      logger: deps.logger,
    });
    this.playlistController = new PlaylistController({
      store: deps.store,
      logger: deps.logger,
      lock: this.lock,
      isShuttingDown: () => this.shuttingDown,
      resolvePlaylist: (id) => this.resolvePlaylist(id),
      startStreamer: (streamer, options) => this.startStreamerLocked(streamer, options),
      startFile: (file, options) => this.startFileLocked(file, options),
      startScreen: (type) => this.showScreenLocked(type),
      resolveQueueKey: () => this.resolveQueueKey(),
      repeatCurrent: () =>
        this.playlistController.current?.playlist.id === QUEUE_PLAYLIST_ID &&
        this.queue.loopModeValue() === 'one',
      onEntryStart: (playlistId, channel) => {
        if (playlistId === QUEUE_PLAYLIST_ID) this.queue.recordHistory(channel);
      },
      buildStatus: () => this.buildStatus(),
      stopAll: () => this.stopInternalLocked(),
      transition: (state, reason) => this.transitionTo(state, reason),
      emitStatus: () => this.emitStatus(),
      emitAll: () => this.emitAll(),
      setLastError: (message) => {
        this.lastError = message;
      },
    });
    this.queueCoordinator = new QueuePlaybackCoordinator({
      queue: this.queue,
      playlistController: this.playlistController,
      media: this.media,
      getSinkKey: () => this.sinkController?.key ?? null,
      lock: this.lock,
      logger: deps.logger,
      emitQueue: () => this.emitQueue(),
      stopInternalLocked: () => this.stopInternalLocked(),
      stop: () => this.stop(),
      startFileLocked: (f, o) => this.startFileLocked(f, o),
    });

    this.playbackService = new PlaybackService({
      queue: this.queue,
      status: () => this.buildStatus(),
      activePlaylist: () => this.playlistController.current,
      resolveChannelLabel: (channel) => this.channelInfo(channel),
      held: () => this.playlistController.isHeld(),
      resolvePlaylistChannel: (playlistId, index) => {
        const playlist =
          playlistId === QUEUE_PLAYLIST_ID
            ? null
            : (this.deps.store.playlists().find((entry) => entry.id === playlistId) ?? null);
        const channel = playlist?.channels[index];
        return channel ? this.channelInfo(channel) : null;
      },
    });
  }

  /** Normalises a channel string into a playback entry (#94). */
  private channelInfo(channel: string): { label: string; kind: QueueEntryKind; channel: string } {
    if (channel.startsWith('file:')) {
      return { label: channel.slice('file:'.length), kind: 'file', channel };
    }
    if (channel === 'screen:pause') return { label: 'Pausenscreen', kind: 'screen', channel };
    if (channel === 'screen:startup') return { label: 'Startbildschirm', kind: 'screen', channel };
    const streamer = this.deps.store.findForChannel(channel);
    return { label: streamer?.name ?? channel, kind: 'streamer', channel };
  }

  private get state(): StreamState {
    return this.stateMachine.state;
  }

  private transitionTo(next: StreamState, reason = ''): void {
    this.stateMachine.transition(next, reason);
  }

  get currentSettings(): Settings {
    return structuredClone(this.settings);
  }

  async init(): Promise<void> {
    const { config, logger } = this.deps;
    const subsystems = await createSupervisorSubsystems(this as unknown as SupervisorWiringHost);
    this.buffer = subsystems.buffer;
    this.relay = subsystems.relay;
    this.sourceSession = subsystems.sourceSession;
    this.sinkController = subsystems.sinkController;
    this.outputFanout = subsystems.outputFanout;
    this.overlays = subsystems.overlays;
    this.pauseController = subsystems.pauseController;
    this.watchdog = subsystems.watchdog;
    this.autoRefresh = subsystems.autoRefresh;
    this.online = subsystems.online;
    this.earnings = subsystems.earnings;
    this.overlayRuntime = subsystems.overlayRuntime;
    this.screenController = subsystems.screenController;
    this.sourceRecovery = subsystems.sourceRecovery;
    this.streamerLauncher = subsystems.streamerLauncher;
    this.sinkWatchdog = subsystems.sinkWatchdog;
    this.rtmpIngest = subsystems.rtmpIngest;

    if (this.settings.rtmp_ingest.enabled) {
      this.rtmpIngest.start();
    }

    this.rtmpIngest.on('publish_started', () => {
      this.deps.logger.info('RTMP-Ingest: Gaming-Streamer hat Übertragung gestartet!');
      this.emitStatus();
      if (this.settings.rtmp_ingest.auto_takeover && this.state !== 'live') {
        // Auto-Takeover: Start sink if idle or in pause
        const resolved = resolveStreamKey({});
        const key = resolved.key;
        if (key) {
          const prepared = this.overlays.prepare();
          const logoEngine = this.overlayRuntime.createLogoEngine();
          const signature = this.overlayRuntime.signature(prepared.filters, undefined, logoEngine);
          this.sinkController.key = key;
          this.sinkController.filters = prepared.filters;
          this.sinkController.logoInput = logoEngine?.panel;
          this.sinkController.signature = signature;
          this.startSinkOrPrefillLocked(key, prepared.filters, signature, undefined, logoEngine?.panel);
          this.transitionTo('live', 'rtmp_ingest_takeover');
        }
      }
    });

    this.rtmpIngest.on('publish_stopped', () => {
      this.deps.logger.info('RTMP-Ingest: Gaming-Streamer hat Übertragung beendet.');
      this.emitStatus();
      if (this.settings.rtmp_ingest.auto_takeover && this.state === 'live' && !this.activeStreamer && !this.media.file) {
        // Switch to pause screen gracefully
        void this.startPauseLocked();
      }
    });

    this.online.start();
    this.earnings.start();
    this.watchdog.start();
    this.statusTimer = setInterval(() => {
      this.emitStatus();
      this.statusTicks += 1;
      if (this.statusTicks % 5 === 0) this.persistMediaProgress();
      const warning = this.outputFanout.diskWarning();
      if (warning && warning !== this.lastDiskWarning) {
        this.deps.webhooks?.notify('disk_warning', 'Speicher-Warnung (Aufzeichnung)', warning);
      }
      this.lastDiskWarning = warning;
    }, 2000);
    this.emitAll();
    void this.checkBinaries();
    if (config.autoStart) {
      this.autoStartTimer = setTimeout(() => void this.autoStart(), 1500);
    }
    const resume = this.queue.getPlayback();
    if (
      resume &&
      resume.channel.startsWith('file:') &&
      resume.position_seconds > 1 &&
      (resume.duration_seconds <= 0 || resume.position_seconds < resume.duration_seconds - 2)
    ) {
      this.media.scheduleResume(resume, async (p) => {
        await this.resumeQueuePlayback(p);
      });
    }
    logger.info({ version: VERSION, relayPort: config.media.relayPort }, 'Supervisor bereit');
  }

  private markSinkGrace(): void {
    this.sinkController.markGrace();
  }

  /**
   * Delay buffer capacity: the configured floor, but at least enough for the
   * requested delay plus headroom (source bitrate can exceed the target bitrate
   * for pass-through streams).
   */
  private bufferMaxBytes(settings: Settings): number {
    const byDelay = Math.ceil(
      ((settings.video.video_bitrate * 1000) / 8) * (settings.delay_buffer.size + 15) * 2,
    );
    return Math.min(
      512 * 1024 * 1024,
      Math.max(settings.delay_buffer.max_bytes * 1024 * 1024, byDelay),
    );
  }

  private applyConfiguredDelay(): void {
    this.buffer.setDelay(this.settings.delay_buffer.size, this.settings.delay_buffer.enabled);
    this.buffer.setCatchupRate(this.settings.delay_buffer.catchup_rate);
  }

  private async checkBinaries(): Promise<void> {
    const { media } = this.deps.config;
    for (const [name, command, args] of [
      ['ffmpeg', media.ffmpegBin, ['-version']],
      ['yt-dlp', media.ytdlpBin, ['--version']],
    ] as const) {
      try {
        const result = await runCommand(command, [...args], { timeoutMs: 8000 });
        if (result.code === 0) {
          this.deps.logger.info({ binary: name }, 'Externe Abhängigkeit gefunden');
        } else {
          this.deps.logger.warn(
            { binary: name, code: result.code },
            'Externe Abhängigkeit antwortet unerwartet',
          );
        }
      } catch (error) {
        this.deps.logger.warn(
          { binary: name, err: toErrorMessage(error) },
          `${name} ist nicht verfügbar – Streaming wird fehlschlagen (Docker-Image verwenden oder Binary installieren)`,
        );
      }
    }
  }

  /**
   * Preferred-streamer takeover. A preferred streamer that comes online may
   * interrupt a running streamer or playlist. The previous target is captured
   * so it can be restored once the preferred stream ends.
   */
  private async maybeAutoSwitchPreferred(): Promise<void> {
    if (
      this.shuttingDown ||
      !this.settings.online.enabled ||
      !this.settings.online.auto_switch_preferred ||
      this.playlistController.isAdvancePending ||
      this.state === 'stopping'
    ) {
      return;
    }
    if (this.state === 'paused' && this.pauseController.pauseReason === 'user') return;

    const candidate = this.autoSwitch.findPreferredCandidate(
      this.activeStreamer,
      this.deps.store.list(),
      (streamer) => this.online?.isOnline(streamer) ?? false,
      (streamer) => resolveStreamKey(streamer).key,
    );
    if (!candidate) return;

    await this.lock.run(async () => {
      if (
        this.shuttingDown ||
        this.playlistController.isAdvancePending ||
        this.activeStreamer?.id === candidate.id ||
        this.autoSwitch.isSuppressed(candidate.id)
      ) {
        return;
      }
      const key = resolveStreamKey(candidate).key;
      if (!key) return;

      const previousTarget = this.autoSwitch.returnTarget;
      if (!previousTarget) {
        this.autoSwitch.setReturnTarget(this.capturePreferredReturnTarget());
      }
      this.deps.logger.info(
        { streamer: candidate.id, priority: candidate.priority },
        'Bevorzugter Streamer ist online – automatischer Wechsel',
      );
      try {
        await this.startStreamerLocked(candidate, {
          key,
          allowOfflineWait: true,
          preservePreferredReturn: true,
        });
      } catch (error) {
        if (!previousTarget && this.activeStreamer?.id !== candidate.id) {
          this.autoSwitch.clearReturnTarget();
        }
        this.deps.logger.warn(
          { streamer: candidate.id, err: toErrorMessage(error) },
          'Automatischer Wechsel zum bevorzugten Streamer fehlgeschlagen',
        );
      }
    });
  }

  private handleOnlineStatuses(): void {
    this.autoSwitch.cleanEnded(
      Date.now(),
      (id) => {
        const streamer = this.deps.store.get(id);
        return streamer ? this.online.isOnline(streamer) : null;
      },
      (id) => Boolean(this.deps.store.get(id)),
    );
    this.emitStreamers();
    void this.maybeAutoSwitchPreferred();
  }

  /** Snapshot of what was playing before a preferred takeover. */
  private capturePreferredReturnTarget(): PreferredReturnTarget | null {
    return this.autoSwitch.captureReturnTarget(
      this.sinkController.key,
      this.activeStreamer,
      this.media.file,
      this.media.currentPosition(),
      this.playlistController.current,
    );
  }

  /**
   * Restore the streamer/playlist that was active before the automatic
   * takeover. Returns false when there is nothing to restore.
   */
  private async returnToPreferredOriginLocked(reason: string): Promise<boolean> {
    const target = this.autoSwitch.returnTarget;
    if (!target) return false;
    this.autoSwitch.clearReturnTarget();
    this.pauseController.clearOfflinePauseTimer();
    const ended = this.activeStreamer;
    const endedId = ended?.preferred ? ended.id : undefined;
    if (endedId) this.autoSwitch.markEnded(endedId);

    this.deps.logger.info(
      {
        from: endedId ?? null,
        to: target.kind === 'streamer' ? target.streamer?.id : target.file,
        reason,
      },
      'Bevorzugter Streamer beendet – Rückkehr zum vorherigen Ziel',
    );
    try {
      if (target.kind === 'streamer' && target.streamer) {
        const streamer = this.deps.store.get(target.streamer.id) ?? target.streamer;
        await this.startStreamerLocked(streamer, {
          key: target.key,
          playlist: target.playlist
            ? this.autoSwitch.refreshReturnPlaylist(target.playlist, (id) => this.resolvePlaylist(id))
            : undefined,
          allowOfflineWait: true,
          intro: false,
          preservePreferredReturn: true,
        });
      } else if (target.kind === 'file' && target.file && target.playlist) {
        await this.startFileLocked(target.file, {
          key: target.key,
          playlist: this.autoSwitch.refreshReturnPlaylist(target.playlist, (id) => this.resolvePlaylist(id)),
          seekSeconds: target.seekSeconds,
        });
      }
      return true;
    } catch (error) {
      this.lastError = toErrorMessage(error);
      this.deps.logger.warn(
        { err: this.lastError },
        'Rückkehr zum vorherigen Streamer ist fehlgeschlagen',
      );
      if (this.settings.pause.enabled && this.sinkController.running) {
        if (!this.pauseController.pauseRunning) await this.startPauseLocked();
      } else {
        await this.stopInternalLocked();
      }
      return true;
    }
  }

  private async autoStart(): Promise<void> {
    const candidates = this.autoSwitch.autoStartCandidates(this.deps.store.list());
    for (const candidate of candidates) {
      try {
        this.deps.logger.info(
          { streamer: candidate.id, priority: candidate.priority },
          'Auto-Start',
        );
        await this.start(candidate.id);
        return;
      } catch (error) {
        this.deps.logger.warn(
          { streamer: candidate.id, err: toErrorMessage(error) },
          'Auto-Start fehlgeschlagen',
        );
      }
    }
  }

  async start(id: string): Promise<StatusSnapshot> {
    return this.lock.run(async () => {
      const streamer = this.deps.store.require(id);
      if (!streamer.enabled) {
        throw new ValidationError(`Streamer "${id}" ist deaktiviert`);
      }
      return this.startStreamerLocked(streamer, { allowOfflineWait: true });
    });
  }

  async switchTo(id: string): Promise<StatusSnapshot> {
    return this.start(id);
  }

  private rebuildChatEngineLocked(): void {
    const rebuilt = this.overlayRuntime.rebuildEngine(
      this.sinkController.filters,
      Boolean(this.activeStreamer),
    );
    this.sinkController.overlayInput = rebuilt.panel;
    this.sinkController.logoInput = rebuilt.logoPanel;
    this.sinkController.signature = rebuilt.signature;
  }

  private async startFileLocked(
    file: string,
    options: PlaylistStartOptions,
  ): Promise<StatusSnapshot> {
    if (this.shuttingDown) throw new AppError('shutting_down', 'Der Dienst wird beendet', 503);
    this.autoSwitch.clearReturnTarget();
    const path = this.media.validateMediaFile(this.deps.config.paths.dataDir, file);
    const seekSeconds = Math.max(0, options.seekSeconds ?? 0);
    this.sinkController.clearStartTimer();
    const probe = await probeMediaFile(this.deps.config.media.ffmpegBin, path);
    const prepared = this.overlays.prepare();
    const filters = [...prepared.filters];
    this.media.start(file, seekSeconds, probe.duration);
    const countdown = this.media.prepareCountdownFilter(
      this.settings,
      prepared.fontFile,
      seekSeconds,
    );
    if (countdown) filters.push(countdown);
    const logoEngine = this.overlayRuntime.createLogoEngine();
    const signature = this.overlayRuntime.signature(filters, undefined, logoEngine);
    await this.stopSourceAndChatLocked();
    if (this.sinkController.running) await this.stopSinkLocked();
    this.buffer.reset();
    this.sourceSession.resetTimeline();
    this.overlayRuntime.stopEngine();
    this.overlayRuntime.replaceEngine(undefined, logoEngine);
    this.overlayRuntime.resetMessages();
    this.applyConfiguredDelay();

    this.activeStreamer = null;
    this.sinkController.key = options.key;
    this.sinkController.filters = filters;
    this.sinkController.overlayInput = undefined;
    this.sinkController.logoInput = logoEngine?.panel;
    this.sinkController.signature = signature;
    this.startedAt = new Date();
    this.activeTitle = file;
    this.pauseController.pauseReason = null;
    this.pauseController.manualScreen = null;
    this.pauseController.clearPauseLimit();
    this.sourceSession.resetReconnectAttempts();
    this.forceReencodeNext = false;

    const { synthetic, resolved } = this.media.buildSyntheticStreamerAndResolved(
      file,
      path,
      probe.isH264,
      probe.height,
    );
    const offset = 0;
    this.sourceSession.start(synthetic, resolved, false, offset, seekSeconds);
    this.startSinkOrPrefillLocked(options.key, filters, signature, undefined, logoEngine?.panel);
    this.sourceSession.markProducerStarted(offset);
    this.markSinkGrace();
    this.earnings.setActive();
    this.autoRefresh.stop();
    this.watchdog.reset();
    this.watchdog.clearError();
    this.playlistController.activate(options.playlist);
    this.transitionTo('live');
    this.media.persistProgress(this.queue, options.playlist.playlist.id);
    this.emitAll();
    this.deps.logger.info({ file, playlist: options.playlist.playlist.id }, 'Lokales Video gestartet');
    return this.buildStatus();
  }

  private async startStreamerLocked(
    streamer: StreamerConfig,
    options: StartStreamerOptions,
  ): Promise<StatusSnapshot> {
    return this.streamerLauncher.startStreamerLocked(streamer, options);
  }

  /**
   * On a cold start the delay line would hold the first packets for the whole
   * configured delay, leaving YouTube without media. Start the producer first
   * and connect the sink once the buffer has been primed.
   */
  private startSinkOrPrefillLocked(
    key: string,
    filters: string[],
    signature: string,
    overlayInput?: SinkOverlayInput,
    logoInput?: SinkOverlayInput,
  ): void {
    const delaySeconds = this.settings.delay_buffer.enabled
      ? Math.max(0, this.settings.delay_buffer.size)
      : 0;
    const bufferedSeconds = this.buffer?.stats().bufferSeconds ?? 0;
    this.sinkController.startOrPrefill({
      key,
      filters,
      signature,
      overlayInput,
      logoInput,
      delaySeconds,
      bufferedSeconds,
    });
    this.outputFanout.start(this.activeStreamer?.id ?? this.media.file ?? 'stream');
  }

  private async stopSinkLocked(): Promise<void> {
    await this.sinkController.stop();
  }

  private async stopSourceAndChatLocked(): Promise<void> {
    this.media.stop();
    this.overlayRuntime.stopChat();
    await this.sourceSession.stop();
    await this.pauseController.stopScreens();
  }

  async stop(): Promise<StatusSnapshot> {
    return this.lock.run(async () => {
      // A user-initiated stop should not resume the last video after a restart.
      this.queue.clearPlayback();
      return this.stopInternalLocked();
    });
  }

  private async stopInternalLocked(): Promise<StatusSnapshot> {
    this.sinkController.clearTimers();
    const stoppingKey = this.sinkController.key;
    this.transitionTo('stopping');
    this.pauseController.clearState();
    this.clearAllTimers();
    this.autoRefresh.stop();
    this.watchdog.reset();
    await this.stopSourceAndChatLocked();
    await this.outputFanout.stop();
    await this.stopSinkLocked();
    // A container restart is not a user stop. Keep the broadcast for the next
    // start instead of completing it on every deploy.
    if (!this.shuttingDown) this.sinkController.notifyStopped(stoppingKey);
    this.overlayRuntime.stopEngine();
    this.buffer.reset();
    this.overlays.clear();
    this.overlayRuntime.resetMessages();
    this.activeStreamer = null;
    this.media.stop();
    this.playlistController.detach();
    this.autoSwitch.clearReturnTarget();
    this.sinkController.key = '';
    this.sinkController.filters = [];
    this.sinkController.overlayInput = undefined;
    this.sinkController.logoInput = undefined;
    this.sinkController.signature = '';
    this.startedAt = null;
    this.activeTitle = '';
    this.lastError = null;
    this.forceReencodeNext = false;
    this.sinkWatchdog?.resetQuickExits();
    this.sourceSession.resetReconnectAttempts();
    this.sourceSession.resetTimeline();
    this.earnings.resetLiveStats();
    this.earnings.setActive();
    this.transitionTo('idle');
    this.emitAll();
    this.deps.logger.info('Stream gestoppt');
    return this.buildStatus();
  }

  async pause(): Promise<StatusSnapshot> {
    return this.showScreen('pause');
  }

  /**
   * Streamer config used to prepare overlays when a screen runs without an
   * active source. Overlays are global, so any streamer works as a carrier.
   */
  private screenFallbackStreamer(): StreamerConfig {
    return screenFallbackStreamer(this.deps.store.list(), this.activeStreamer);
  }

  /**
   * RTMP target for a manual screen. An active stream keeps its running key;
   * otherwise the preferred/enabled streamer key is used and the global
   * YOUTUBE_STREAM_KEY acts as the last fallback.
   */
  private resolveScreenTarget(): { streamer: StreamerConfig | null; key: string } {
    return resolveScreenTarget(
      this.deps.store.list(),
      this.activeStreamer,
      this.sinkController.key,
    );
  }

  private resolvePlaylist(id: string): PlaylistConfig | null {
    if (id === QUEUE_PLAYLIST_ID) return this.queue.playlist();
    return this.deps.store.playlist(id) ?? null;
  }

  private resolveQueueKey(): string {
    if (this.sinkController.key) return this.sinkController.key;
    return this.resolveScreenTarget().key;
  }

  async showScreen(type: 'startup' | 'pause'): Promise<StatusSnapshot> {
    return this.lock.run(() => this.showScreenLocked(type));
  }

  private async showScreenLocked(type: 'startup' | 'pause'): Promise<StatusSnapshot> {
    await this.screenController.showScreenLocked(type, this.activeStreamer);
    return this.buildStatus();
  }

  /** Hold: keep the entry, show the pause screen, stop auto-advance (#94). */
  async holdPlayback(): Promise<StatusSnapshot> {
    this.playlistController.hold();
    const status = await this.showScreen('pause');
    this.emitPlayback();
    return status;
  }

  /** Release a hold and continue with the kept entry (#94). */
  async resumePlayback(): Promise<StatusSnapshot> {
    this.playlistController.release();
    const status = await this.hideScreen();
    this.emitPlayback();
    return status;
  }

  async hideScreen(): Promise<StatusSnapshot> {
    return this.lock.run(async () => {
      const streamer = this.activeStreamer;
      if (!streamer) {
        if (!this.pauseController.manualScreen) return this.buildStatus();
        this.deps.logger.info({ screen: this.pauseController.manualScreen }, 'Manueller Screen beendet');
        return this.stopInternalLocked();
      }
      if (this.state !== 'paused') return this.buildStatus();
      this.pauseController.manualScreen = null;
      this.pauseController.pauseReason = null;
      this.pauseController.clearPauseLimit();
      this.pauseController.clearStartupTimer();
      return this.startStreamerLocked(streamer, {
        key: this.sinkController.key,
        playlist: this.playlistController.current ?? undefined,
        allowOfflineWait: true,
        intro: false,
        preservePreferredReturn: Boolean(this.autoSwitch.returnTarget),
      });
    });
  }

  async playPlaylist(id: string): Promise<StatusSnapshot> {
    return this.playlistController.play(id);
  }

  async playlistNext(): Promise<StatusSnapshot> {
    return this.playlistController.next();
  }

  async playlistPrevious(): Promise<StatusSnapshot> {
    return this.playlistController.previous();
  }

  async playlistTune(streamerId: string): Promise<StatusSnapshot> {
    return this.playlistController.tune(streamerId);
  }

  async stopPlaylist(): Promise<StatusSnapshot> {
    return this.stop();
  }

  // --- Regie-Queue -----------------------------------------------------------

  buildQueueSnapshot(): QueueSnapshot {
    return this.queueCoordinator.buildSnapshot();
  }

  /** Unified playback view for the cockpit transport (#94). */
  buildPlaybackState(): PlaybackState {
    return this.playbackService.build();
  }

  /** Last played queue entries, newest first (#94). */
  queueHistory() {
    return this.queue.history();
  }

  async queueAdd(channel: string): Promise<QueueSnapshot> {
    return this.queueCoordinator.add(channel);
  }

  async queueRemove(id: string): Promise<QueueSnapshot> {
    return this.queueCoordinator.remove(id);
  }

  async queueMove(id: string, to: number): Promise<QueueSnapshot> {
    return this.queueCoordinator.move(id, to);
  }

  async queueDuplicate(id: string): Promise<QueueSnapshot> {
    return this.queueCoordinator.duplicate(id);
  }

  async queueUpdateEntry(
    id: string,
    patch: { duration_seconds?: number | null },
  ): Promise<QueueSnapshot> {
    return this.queueCoordinator.updateEntry(id, patch);
  }

  async queueSetLoop(loop: boolean): Promise<QueueSnapshot> {
    return this.queueCoordinator.setLoop(loop);
  }

  async queueSetLoopMode(mode: 'off' | 'all' | 'one'): Promise<QueueSnapshot> {
    return this.queueCoordinator.setLoopMode(mode);
  }

  /** Unified enqueue for streamers, files and screens (#94). */
  async queueEnqueue(channel: string, mode: 'now' | 'next' | 'end'): Promise<QueueSnapshot> {
    return this.queueCoordinator.enqueue(channel, mode);
  }

  /** Copies a playlist into the regie queue (#94). */
  async queueFromPlaylist(
    playlistId: string,
    mode: 'replace' | 'append',
  ): Promise<QueueSnapshot> {
    const playlist = this.deps.store.playlists().find((entry) => entry.id === playlistId);
    if (!playlist) throw new NotFoundError(`Playlist "${playlistId}" wurde nicht gefunden`);
    if (playlistId === QUEUE_PLAYLIST_ID) {
      throw new ValidationError('Die Regie-Queue kann nicht in sich selbst geladen werden');
    }
    return this.queueCoordinator.loadFromPlaylist(playlist.channels, mode);
  }

  async queueClear(): Promise<QueueSnapshot> {
    return this.queueCoordinator.clear();
  }

  async queuePlay(index = 0): Promise<StatusSnapshot> {
    return this.queueCoordinator.play(index);
  }

  async queueNext(): Promise<StatusSnapshot> {
    return this.queueCoordinator.next();
  }

  async queuePrevious(): Promise<StatusSnapshot> {
    return this.queueCoordinator.previous();
  }

  async queueStop(): Promise<StatusSnapshot> {
    return this.queueCoordinator.stop();
  }

  async queuePlayNow(channel: string): Promise<StatusSnapshot> {
    return this.queueCoordinator.playNow(channel);
  }

  async seekActiveVideo(seconds: number): Promise<StatusSnapshot> {
    return this.queueCoordinator.seekActiveVideo(seconds);
  }

  private currentMediaPosition(): number {
    return this.media.currentPosition();
  }

  /** Persists the active queue video position (throttled by the status timer). */
  private persistMediaProgress(): void {
    this.media.persistProgress(this.queue, this.playlistController.current?.playlist.id);
  }

  private async resumeQueuePlayback(playback: QueuePlayback): Promise<void> {
    if (this.shuttingDown || this.state !== 'idle') return;
    const index = this.queue.get().findIndex((entry) => entry.channel === playback.channel);
    if (index < 0) return;
    try {
      this.deps.logger.info(
        { channel: playback.channel, position: playback.position_seconds },
        'Regie-Video wird nach Neustart fortgesetzt',
      );
      await this.playlistController.play(QUEUE_PLAYLIST_ID, index, playback.position_seconds);
    } catch (error) {
      this.deps.logger.warn(
        { err: toErrorMessage(error) },
        'Regie-Video konnte nach Neustart nicht fortgesetzt werden',
      );
    }
  }

  private clearAllTimers(): void {
    this.sourceSession.clearReconnectTimer();
    this.sinkController.clearTimers();
    this.playlistController.clearTimers();
    if (this.autoStartTimer) clearTimeout(this.autoStartTimer);
    this.autoStartTimer = undefined;
    this.media.clearResumeTimer();
    this.pauseController.clearTimers();
  }

  private handleSourceExit(
    code: number | null = null,
    signal: NodeJS.Signals | null = null,
  ): void {
    this.sourceRecovery.handleSourceExit(code, signal);
  }

  private scheduleReconnect(delayMs?: number): void {
    this.sourceRecovery.scheduleReconnect(delayMs);
  }

  private reencodeSource(reconnect: boolean): boolean {
    return this.sourceRecovery.reencodeSource(reconnect);
  }

  private async reconnect(): Promise<void> {
    return this.sourceRecovery.reconnect();
  }

  private async startPauseLocked(): Promise<void> {
    return this.sourceRecovery.startPauseLocked();
  }

  private canStartOfflinePauseLocked(): boolean {
    return this.sourceRecovery.canStartOfflinePauseLocked();
  }

  private async refreshSource(reason: string): Promise<void> {
    return this.sourceRecovery.refreshSource(reason);
  }

  private handleCodecProblem(line: string): void {
    this.sourceRecovery.handleCodecProblem(line);
  }

  private async restartSinkLocked(): Promise<void> {
    await this.sinkWatchdog.restartSinkLocked();
  }

  async applySettings(next: Settings, previous: Settings): Promise<StatusSnapshot> {
    return this.lock.run(async () => this.applySettingsLocked(next, previous));
  }

  async activateScene(id: string): Promise<{ scene: OverlayScene; status: StatusSnapshot }> {
    return this.lock.run(async () => {
      const scene = this.scenes.require(id);
      const current = this.deps.settingsService.get();
      const overlays = structuredClone(scene.overlays);
      // Preserve live chat API key so activating a sanitized scene never wipes it.
      overlays.chat.api_key = current.overlays.chat.api_key;
      const { previous, next } = this.deps.settingsService.update({
        overlays,
        video: { ...current.video, layout: structuredClone(scene.video_layout) },
      });
      this.applyingScene = true;
      let status: StatusSnapshot;
      try {
        this.scenes.setActiveId(scene.id);
        status = await this.applySettingsLocked(next, previous);
      } finally {
        this.applyingScene = false;
      }
      this.deps.bus.emit({
        type: 'scene',
        data: { active_scene_id: scene.id, active_scene_name: scene.name },
      });
      return { scene, status: this.buildStatus() ?? status };
    });
  }

  private async applySettingsLocked(next: Settings, previous: Settings): Promise<StatusSnapshot> {
    return applySupervisorSettings(this as unknown as SettingsApplyHost, next, previous);
  }

  async restartSink(): Promise<StatusSnapshot> {
    return this.lock.run(async () => {
      await this.restartSinkLocked();
      return this.buildStatus();
    });
  }

  async refreshNow(): Promise<StatusSnapshot> {
    await this.refreshSource('manual');
    return this.buildStatus();
  }

  async checkOnlineNow(): Promise<void> {
    await this.lock.run(async () => {
      await this.online.checkNow();
      this.emitStreamers();
    });
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.persistMediaProgress();
    this.online.stop();
    this.earnings?.stop();
    this.watchdog.stop();
    this.autoRefresh.stop();
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = undefined;
    this.clearAllTimers();
    await this.lock.run(async () => {
      await this.stopInternalLocked();
    });
    await this.buffer.stop();
    await this.relay.stop();
  }

  subscribePreview(listener: (chunk: Buffer) => void): () => void {
    return this.relay.subscribe(listener);
  }

  overlayPreviewPng(sample = false): Buffer {
    return this.overlayRuntime.previewPng(sample);
  }

  studioPreviewPng(
    overlays: Settings['overlays'],
    sample = true,
    maxDimension = 720,
    chatMessages?: ChatMessage[],
    earningsDraft?: Partial<Settings['earnings']>,
    videoLayoutDraft?: Partial<Settings['video']['layout']>,
    videoAspect?: PreviewAspect,
  ): Buffer {
    return this.overlayRuntime.studioPreviewPng(
      overlays,
      sample,
      maxDimension,
      chatMessages,
      earningsDraft,
      videoLayoutDraft,
      videoAspect,
    );
  }

  /** Latest real chat messages, used by the overlay studio when samples are off. */
  recentChatMessages(): ChatMessage[] {
    return this.overlayRuntime.recentMessages();
  }

  chatAnalytics() {
    return this.overlayRuntime.chatAnalytics();
  }

  earningsOverlayText(): string {
    return this.earnings ? this.overlayRuntime.earningsOverlayText() : '';
  }

  earningsStatus(): ReturnType<EarningsMonitor['get']> | null {
    return this.earnings?.get() ?? null;
  }

  earningsHistory(period?: EarningsPeriod, limit = 240) {
    return this.earnings?.history(period, limit) ?? [];
  }

  async refreshEarnings(): Promise<ReturnType<EarningsMonitor['get']> | null> {
    if (!this.earnings) return null;
    return this.earnings.refresh();
  }

  addTestChatMessage(username: string, text: string): ChatMessage[] {
    return this.overlayRuntime.addTestMessage(username, text);
  }

  chatStatus(): StatusSnapshot['chat'] {
    return this.overlayRuntime.chatStatus();
  }

  notifyStreamersChanged(): void {
    this.emitStreamers();
  }

  titleFor(id: string): { streamer_id: string; template: string; title: string } {
    const streamer = this.deps.store.get(id);
    if (!streamer) throw new NotFoundError(`Streamer "${id}" wurde nicht gefunden`);
    const template = this.settings.streaming.title_template;
    const resolved = this.activeStreamer?.id === id ? this.activeTitle : '';
    return {
      streamer_id: id,
      template,
      title: formatStreamTitle(template, streamer, resolved),
    };
  }

  streamersView(): StreamerView[] {
    return buildStreamersView(
      this.deps.store.list(),
      this.activeStreamer?.id ?? null,
      this.state === 'live' || this.state === 'starting' || this.state === 'reconnecting',
      this.online,
      this.deps.store,
      this.startingStreamerId,
      this.deps.tiktokAccounts,
    );
  }

  playlistsView(): PlaylistView[] {
    return buildPlaylistsView(
      this.deps.store.playlists(),
      this.playlistController.current,
      (channel) => this.playlistController.resolveChannel(channel),
    );
  }

  emitAll(force = false): void {
    this.emitStatus(force);
    this.emitStreamers(force);
    this.emitQueue(force);
  }

  emitStatus(force = false): void {
    if (!force && !this.deps.bus.hasObservers()) return;
    const status = this.buildStatus();
    this.deps.bus.emit({ type: 'status', data: status });
    this.emitPlayback(force, status);
  }

  /** Emits the playback view only when it actually changed. */
  emitPlayback(force = false, status?: StatusSnapshot): void {
    if (!force && !this.deps.bus.hasObservers()) return;
    try {
      const state = this.playbackService.build(status);
      const signature = JSON.stringify({ ...state, updated_at: '' });
      if (signature === this.lastPlaybackSignature) return;
      this.lastPlaybackSignature = signature;
      this.deps.bus.emit({ type: 'playback', data: state });
    } catch (error) {
      this.deps.logger.warn(
        { err: toErrorMessage(error) },
        'Playback-Ansicht konnte nicht erzeugt werden',
      );
    }
  }

  emitQueue(force = false): void {
    // `{queue}` in the earnings overlay follows queue edits immediately (#95).
    this.earnings?.refreshQueueOverlay?.();
    if (!force && !this.deps.bus.hasObservers()) return;
    try {
      this.deps.bus.emit({ type: 'queue', data: this.buildQueueSnapshot() });
      this.emitPlayback(force);
    } catch (error) {
      this.deps.logger.warn(
        { err: toErrorMessage(error) },
        'Queue-Ansicht konnte nicht erzeugt werden',
      );
    }
  }

  emitStreamers(force = false): void {
    if (!force && !this.deps.bus.hasObservers()) return;
    try {
      this.deps.bus.emit({ type: 'streamers', data: this.streamersView() });
    } catch (error) {
      this.deps.logger.warn(
        { err: toErrorMessage(error) },
        'Streamer-Ansicht konnte nicht erzeugt werden',
      );
    }
  }

  recordingFilename(): string | null {
    return this.outputFanout?.recordingFilename() ?? null;
  }

  addRecordingMarker(input: { label?: string; source?: MarkerSource }): RecordingMarker | null {
    return this.outputFanout?.addRecordingMarker(input) ?? null;
  }

  async createRecordingClip(options: ClipOptions): Promise<ClipResult> {
    return this.outputFanout.createRecordingClip(options);
  }

  buildStatus(): StatusSnapshot {
    const activeSceneId = this.scenes?.activeId() ?? null;
    const activeScene = activeSceneId ? (this.scenes.get(activeSceneId) ?? null) : null;
    const fanout = this.outputFanout?.status() ?? {};
    return buildStatusSnapshot({
      state: this.state,
      settings: this.settings,
      activeStreamer: this.activeStreamer,
      activePlaylist: this.playlistController.current,
      activeScene: activeScene ? { id: activeScene.id, name: activeScene.name } : null,
      manualScreen: this.pauseController.manualScreen,
      startedAt: this.startedAt,
      resolving: this.sourceSession.resolving,
      reconnects: this.sourceSession.reconnects,
      lastError: this.lastError,
      reconnecting: this.state === 'reconnecting' || this.sourceSession.reconnecting,
      monitorOnline: this.activeStreamer
        ? (this.online?.isOnline(this.activeStreamer) ?? null)
        : null,
      source: this.sourceSession?.stats(),
      relay: this.relay?.stats(),
      delay: this.buffer?.stats(),
      sink: this.sinkController?.stats(),
      watchdog: this.watchdog?.stats(),
      autoRefresh: this.autoRefresh?.stats(),
      chat: this.chatStatus(),
      media: this.media.status(),
      secondarySink: fanout.secondarySink,
      recording: fanout.recording,
      disconnectProtection: this.pauseController.disconnectProtection,
      rtmpIngest: this.rtmpIngest?.stats()
        ? {
            enabled: this.settings.rtmp_ingest.enabled,
            running: this.rtmpIngest.isRunning,
            port: this.settings.rtmp_ingest.port,
            active_client: this.rtmpIngest.hasActiveStream,
            client_ip: null,
            connected_at: null,
            ingest_url: `rtmp://<host>:${this.settings.rtmp_ingest.port}/live`,
            stream_key_set: Boolean(this.settings.rtmp_ingest.stream_key.trim()),
          }
        : undefined,
    });
  }
}
