import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { LoadedConfig } from '../config/loader.js';
import {
  StreamerSchema,
  resolveStreamKey,
  type PlaylistConfig,
  type Settings,
  type StreamerConfig,
} from '../config/schema.js';
import { AsyncLock, runCommand } from '../../utils/process.js';
import {
  AppError,
  MissingStreamKeyError,
  NotFoundError,
  StreamerOfflineError,
  ValidationError,
  toErrorMessage,
} from '../../utils/errors.js';
import { VERSION } from '../../version.js';
import type { EventBus, StatusSnapshot, StreamState } from '../events.js';
import type { SettingsService } from '../store/settings-service.js';
import type { StreamerStore, StreamerView } from '../store/streamer-store.js';
import { DelayBuffer } from '../relay/delay-buffer.js';
import { MpegTsRelay } from '../relay/relay-server.js';
import { TikTokResolver } from '../source/resolver.js';
import { TikTokSource } from '../source/tiktok-source.js';
import type { ResolvedStream } from '../source/tiktok.js';
import { YouTubeSink } from '../sink/youtube-sink.js';
import { SecondarySink } from '../sink/secondary-sink.js';
import { RecordingController } from '../recording/recording-controller.js';
import { OverlayManager } from '../overlays/overlay-manager.js';
import type { ChatMessage } from '../overlays/chat-service.js';
import { PauseScreen } from '../overlays/pause-screen.js';
import { remainingTimeFilter } from '../overlays/drawtext.js';
import { OnlineMonitor } from '../online/monitor.js';
import { EarningsMonitor } from '../earnings/monitor.js';
import { EarningsHistoryStore, type EarningsPeriod } from '../earnings/history.js';
import type { PreviewAspect } from '../overlays/studio-preview.js';
import { Watchdog } from './watchdog.js';
import { AutoRefresh } from './auto-refresh.js';
import { SupervisorStateMachine } from './state-machine.js';
import { buildStatusSnapshot } from './status-builder.js';
import { OverlayRuntime } from './overlay-runtime.js';
import { SinkController } from './sink-controller.js';
import { PauseController } from './pause-controller.js';
import { SourceSession } from './source-session.js';
import { incMetric } from '../metrics.js';
import {
  PlaylistController,
  type PlaylistRunState,
  type PlaylistStartOptions,
} from './playlist-controller.js';
import { mediaFilePath, probeMediaFile } from '../media/media-files.js';
import {
  configureVideoEncoder,
  probeVideoEncoders,
  setAvailableVideoEncoders,
} from '../media/encoders.js';
import type { SinkOverlayInput } from '../source/ffmpeg.js';
import { QueueController, QUEUE_PLAYLIST_ID, type QueuePlayback } from './queue-controller.js';
import type { QueueSnapshot } from '../events.js';
import { sortStreamersByPriority } from '../streamer-order.js';

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
}

export interface PlaylistView {
  id: string;
  name: string;
  channels: string[];
  auto_advance: boolean;
  wrap: boolean;
  advance_delay_seconds: number;
  end_after_minutes: number | null;
  end_time: string | null;
  youtube_key_set: boolean;
  active: boolean;
  index: number | null;
}


interface StartOptions {
  key?: string;
  playlist?: PlaylistRunState;
  forceReencode?: boolean;
  allowOfflineWait?: boolean;
  intro?: boolean;
  /** Internal: keep the return target when taking over for a preferred streamer. */
  preservePreferredReturn?: boolean;
}

interface PreferredReturnTarget {
  kind: 'streamer' | 'file';
  streamer?: StreamerConfig;
  file?: string;
  key: string;
  playlist: PlaylistRunState | null;
  seekSeconds?: number;
}

/**
 * Owns the stream lifecycle: source, delay line, sink, overlays and recovery.
 * All mutating operations are serialized through a single async lock so a
 * watchdog restart can never race a user-initiated switch.
 */
export class Supervisor {
  private readonly deps: SupervisorDeps;
  private readonly lock = new AsyncLock();
  private settings: Settings;

  private buffer!: DelayBuffer;
  private relay!: MpegTsRelay;
  private sourceSession!: SourceSession;
  private sinkController!: SinkController;
  private secondarySink!: SecondarySink;
  private recording!: RecordingController;
  private overlays!: OverlayManager;
  private pauseController!: PauseController;
  private watchdog!: Watchdog;
  private autoRefresh!: AutoRefresh;
  private online!: OnlineMonitor;
  private earnings!: EarningsMonitor;
  private overlayRuntime!: OverlayRuntime;

  private readonly stateMachine: SupervisorStateMachine;
  private activeStreamer: StreamerConfig | null = null;
  private activeMediaFile: string | null = null;
  private activeMediaOffset = 0;
  private activeMediaStartedAt: number | null = null;
  private activeMediaDuration: number | null = null;
  /** Where to return when an automatically preferred streamer ends. */
  private preferredReturn: PreferredReturnTarget | null = null;
  /** Preferred streamers that ended and must go offline before a new takeover. */
  private readonly endedPreferred = new Map<string, number>();
  private statusTicks = 0;
  private resumeTimer?: NodeJS.Timeout;
  private readonly playlistController: PlaylistController;
  private readonly queue: QueueController;
  private startedAt: Date | null = null;
  private lastError: string | null = null;
  private activeTitle = '';
  private statusTimer?: NodeJS.Timeout;
  private autoStartTimer?: NodeJS.Timeout;
  private shuttingDown = false;
  private forceReencodeNext = false;

  constructor(deps: SupervisorDeps) {
    this.deps = deps;
    this.settings = deps.settingsService.get();
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
      stopAll: () => this.stopInternalLocked(),
      transition: (state, reason) => this.transitionTo(state, reason),
      emitStatus: () => this.emitStatus(),
      emitAll: () => this.emitAll(),
      setLastError: (message) => {
        this.lastError = message;
      },
    });
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
    const relayEndpoint = { host: config.media.relayHost, port: config.media.relayPort };

    this.buffer = new DelayBuffer({
      host: relayEndpoint.host,
      port: relayEndpoint.port + 1,
      delaySeconds: this.settings.delay_buffer.size,
      enabled: this.settings.delay_buffer.enabled,
      maxBytes: this.bufferMaxBytes(this.settings),
      fallbackBitrateKbps: Math.round(this.settings.video.video_bitrate * 1.25),
      logger,
    });
    try {
      await this.buffer.start();
    } catch (error) {
      throw new AppError(
        'relay_bind_failed',
        `Delay-Puffer konnte nicht auf Port ${relayEndpoint.port + 1} starten: ${toErrorMessage(error)}`,
        500,
      );
    }

    this.relay = new MpegTsRelay({
      host: relayEndpoint.host,
      port: relayEndpoint.port,
      logger,
      buffer: this.buffer,
    });
    try {
      await this.relay.start();
    } catch (error) {
      await this.buffer.stop();
      throw new AppError(
        'relay_bind_failed',
        `MPEG-TS-Relay konnte nicht auf Port ${relayEndpoint.port} starten: ${toErrorMessage(error)}`,
        500,
      );
    }

    const resolver =
      this.deps.resolver ??
      new TikTokResolver({
        media: config.media,
        logger,
        cookiesFile: config.paths.cookiesFile,
        redact: this.deps.redact,
      });
    const source = new TikTokSource({
      media: config.media,
      settings: this.settings,
      relay: relayEndpoint,
      logger,
      redact: this.deps.redact,
      onExit: (code, signal) => this.handleSourceExit(code, signal),
      onCodecProblem: (line) => this.handleCodecProblem(line),
    });
    this.sourceSession = new SourceSession({
      source,
      resolver,
      settings: this.settings,
    });
    const sink = new YouTubeSink({
      media: config.media,
      settings: this.settings,
      relay: relayEndpoint,
      logger,
      redact: this.deps.redact,
      onExit: () => this.handleSinkExit(),
    });
    this.sinkController = new SinkController({
      sink,
      settings: this.settings,
      logger,
      lock: this.lock,
      isShuttingDown: () => this.shuttingDown,
      canStartDelayed: () =>
        this.sourceSession.running ||
        this.pauseController.pauseRunning ||
        this.pauseController.startupRunning,
      onStarted: () =>
        this.overlayRuntime.attachToSink(
          this.sinkController.overlayStream(),
          this.sinkController.logoStream(),
        ),
      onStopping: () => this.overlayRuntime.detachEngine(),
      onPrefillDone: () => this.emitAll(),
      youtube: () => this.deps.youtube,
    });
    this.secondarySink = new SecondarySink({
      media: config.media,
      settings: this.settings,
      relay: this.relay,
      logger,
      redact: this.deps.redact,
    });
    this.recording = new RecordingController({
      dataDir: config.paths.dataDir,
      media: config.media,
      settings: this.settings,
      relay: this.relay,
      logger,
    });
    if (this.settings.secondary_sink.stream_key) {
      this.deps.registerSecret?.(this.settings.secondary_sink.stream_key);
    }
    this.overlays = new OverlayManager(
      { media: config.media, overlaysDir: config.paths.overlaysDir, logger },
      this.settings,
    );
    const pauseScreen = new PauseScreen({
      media: config.media,
      settings: this.settings,
      relay: relayEndpoint,
      logger,
      overlaysDir: config.paths.overlaysDir,
      fontFile: this.overlays.font,
      redact: this.deps.redact,
      onExit: () => {
        if (!this.shuttingDown && this.state === 'paused') {
          this.deps.logger.warn('Pausenscreen unerwartet beendet – Neustart wird geplant');
          this.pauseController.handlePauseScreenExit();
        }
      },
    });
    const startupScreen = new PauseScreen({
      media: config.media,
      settings: this.settings,
      relay: relayEndpoint,
      logger,
      overlaysDir: config.paths.overlaysDir,
      fontFile: this.overlays.font,
      screen: 'startup',
      redact: this.deps.redact,
    });
    this.pauseController = new PauseController({
      pauseScreen,
      startupScreen,
      settings: this.settings,
      logger,
      lock: this.lock,
      hooks: {
        isShuttingDown: () => this.shuttingDown,
        isPaused: () => this.state === 'paused',
        nextOffset: () => this.sourceSession.nextOffset(),
        markProducerStarted: (offset) => this.sourceSession.markProducerStarted(offset),
        emitStatus: () => this.emitStatus(),
        emitAll: () => this.emitAll(),
        canScheduleOfflinePause: () => this.sinkController.running,
        canStartOfflinePause: () => this.canStartOfflinePauseLocked(),
        startOfflinePause: () => this.startPauseLocked(),
        onPauseLimit: async () => {
          incMetric('pause_limit_hits_total');
          await this.stopInternalLocked();
        },
      },
    });
    this.watchdog = new Watchdog({
      settings: this.settings,
      logger,
      snapshot: () => ({
        state: this.state,
        relayLastDataAt: this.relay.lastData,
        sinkRunning: this.sinkController.running,
        sinkStarting: this.sinkController.starting,
        sinkLastProgressAt: this.sinkController.lastProgressAt,
        sourceRunning: this.sourceSession.running,
        sourceStartedAt: this.sourceSession.startedAt,
        sinkStartedAt: this.sinkController.startedAt,
        sourceBitrateKbps: this.sourceSession.bitrateKbps ?? this.buffer?.stats().pacingKbps ?? null,
        sourceOutputSeconds: this.sourceSession.outputTimeSeconds,
        suppressStall: this.playlistController.isAdvancePending,
        sinkGraceUntil: this.sinkController.graceUntil,
      }),
      onRelayStall: (age) => void this.handleRelayStall(age),
      onSinkDown: () => this.scheduleSinkRestart(1000),
      onSinkStall: (age) => void this.handleSinkStall(age),
      onLowBitrate: (kbps) => void this.handleLowBitrate(kbps),
      onLowSourceRate: (percent) => void this.handleLowSourceRate(percent),
    });
    this.autoRefresh = new AutoRefresh({
      settings: this.settings,
      logger,
      onRefresh: () => this.refreshSource('auto_refresh'),
    });
    this.online = new OnlineMonitor({
      settings: this.settings,
      logger,
      onStatuses: () => {
        this.handleOnlineStatuses();
      },
    });
    this.online.start();
    const earningsHistory = new EarningsHistoryStore(
      join(config.paths.dataDir, 'earnings-history.json'),
      logger,
    );
    this.earnings = new EarningsMonitor({
      settings: this.settings,
      logger,
      getActive: () => this.activeStreamer,
      onUpdate: (snapshot, overlayText) => {
        this.overlays.updateEarnings(overlayText);
        this.deps.bus.emit({ type: 'earnings', data: snapshot });
      },
      history: earningsHistory,
    });
    this.overlayRuntime = new OverlayRuntime({
      settings: this.settings,
      overlays: this.overlays,
      earnings: this.earnings,
      logger,
      logoPath: join(config.paths.webDir, 'logo.png'),
    });
    await this.overlayRuntime.loadLogo();
    this.earnings.start();
    this.watchdog.start();
    this.statusTimer = setInterval(() => {
      this.emitStatus();
      this.statusTicks += 1;
      if (this.statusTicks % 5 === 0) this.persistMediaProgress();
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
      this.resumeTimer = setTimeout(() => void this.resumeQueuePlayback(resume), 2500);
      this.resumeTimer.unref?.();
    }
    logger.info({ version: VERSION, relayPort: relayEndpoint.port }, 'Supervisor bereit');
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

    const active = this.activeStreamer;
    const candidates = sortStreamersByPriority(
      this.deps.store.list().filter(
        (streamer) =>
          streamer.enabled &&
          streamer.preferred &&
          streamer.id !== active?.id &&
          this.online.isOnline(streamer) === true &&
          Boolean(resolveStreamKey(streamer).key) &&
          !this.isPreferredSuppressed(streamer.id),
      ),
    );
    if (candidates.length === 0) return;

    const candidate = candidates[0]!;
    if (active?.preferred) {
      // A manually selected preferred streamer is never replaced. After an
      // automatic takeover only a strictly better priority may take over.
      if (!this.preferredReturn) return;
      if (candidate.priority >= active.priority) return;
    }

    await this.lock.run(async () => {
      if (
        this.shuttingDown ||
        this.playlistController.isAdvancePending ||
        this.activeStreamer?.id === candidate.id ||
        this.isPreferredSuppressed(candidate.id)
      ) {
        return;
      }
      const key = resolveStreamKey(candidate).key;
      if (!key) return;

      const previousTarget = this.preferredReturn;
      if (!this.preferredReturn) {
        this.preferredReturn = this.capturePreferredReturnTarget();
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
          this.preferredReturn = null;
        }
        this.deps.logger.warn(
          { streamer: candidate.id, err: toErrorMessage(error) },
          'Automatischer Wechsel zum bevorzugten Streamer fehlgeschlagen',
        );
      }
    });
  }

  private handleOnlineStatuses(): void {
    const now = Date.now();
    for (const [id, endedAt] of this.endedPreferred) {
      const streamer = this.deps.store.get(id);
      if (!streamer || this.online.isOnline(streamer) === false || now - endedAt > 300_000) {
        this.endedPreferred.delete(id);
      }
    }
    this.emitStreamers();
    void this.maybeAutoSwitchPreferred();
  }

  private isPreferredSuppressed(id: string): boolean {
    const endedAt = this.endedPreferred.get(id);
    if (!endedAt) return false;
    if (Date.now() - endedAt > 300_000) {
      this.endedPreferred.delete(id);
      return false;
    }
    return true;
  }

  /** Snapshot of what was playing before a preferred takeover. */
  private capturePreferredReturnTarget(): PreferredReturnTarget | null {
    if (!this.sinkController.key) return null;
    if (this.activeMediaFile) {
      const playlist = this.playlistController.current;
      if (!playlist) return null;
      return {
        kind: 'file',
        file: this.activeMediaFile,
        key: this.sinkController.key,
        playlist,
        seekSeconds: this.currentMediaPosition(),
      };
    }
    if (this.activeStreamer) {
      return {
        kind: 'streamer',
        streamer: this.activeStreamer,
        key: this.sinkController.key,
        playlist: this.playlistController.current,
      };
    }
    return null;
  }

  /**
   * Restore the streamer/playlist that was active before the automatic
   * takeover. Returns false when there is nothing to restore.
   */
  private async returnToPreferredOriginLocked(reason: string): Promise<boolean> {
    const target = this.preferredReturn;
    if (!target) return false;
    this.preferredReturn = null;
    this.pauseController.clearOfflinePauseTimer();
    const ended = this.activeStreamer;
    const endedId = ended?.preferred ? ended.id : undefined;
    if (endedId) this.endedPreferred.set(endedId, Date.now());

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
            ? this.refreshReturnPlaylist(target.playlist)
            : undefined,
          allowOfflineWait: true,
          intro: false,
          preservePreferredReturn: true,
        });
      } else if (target.kind === 'file' && target.file && target.playlist) {
        await this.startFileLocked(target.file, {
          key: target.key,
          playlist: this.refreshReturnPlaylist(target.playlist),
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

  private refreshReturnPlaylist(state: PlaylistRunState): PlaylistRunState {
    const playlist = this.resolvePlaylist(state.playlist.id) ?? state.playlist;
    const maxIndex = Math.max(0, playlist.channels.length - 1);
    return { playlist, index: Math.min(Math.max(0, state.index), maxIndex) };
  }

  private async autoStart(): Promise<void> {
    const candidates = sortStreamersByPriority(
      this.deps.store.list().filter((streamer) => streamer.enabled && streamer.auto_start),
    );
    if (candidates.length === 0) return;
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
    if (!rebuilt) return;
    this.sinkController.overlayInput = rebuilt.panel;
    this.sinkController.logoInput = rebuilt.logoPanel;
    this.sinkController.signature = rebuilt.signature;
  }

  private async startFileLocked(
    file: string,
    options: PlaylistStartOptions,
  ): Promise<StatusSnapshot> {
    if (this.shuttingDown) throw new AppError('shutting_down', 'Der Dienst wird beendet', 503);
    this.preferredReturn = null;
    const path = mediaFilePath(this.deps.config.paths.dataDir, file);
    if (!path || !existsSync(path)) {
      throw new ValidationError(`Lokales Video "${file}" wurde nicht gefunden`);
    }
    const seekSeconds = Math.max(0, options.seekSeconds ?? 0);
    this.sinkController.clearStartTimer();
    const probe = await probeMediaFile(this.deps.config.media.ffmpegBin, path);
    const prepared = this.overlays.prepare();
    const filters = [...prepared.filters];
    if (prepared.fontFile && probe.duration) {
      const countdown = remainingTimeFilter(
        this.settings,
        prepared.fontFile,
        probe.duration,
        seekSeconds,
      );
      if (countdown) filters.push(countdown);
    }
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
    this.activeMediaFile = file;
    this.activeMediaOffset = seekSeconds;
    this.activeMediaDuration = probe.duration;
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

    const synthetic = StreamerSchema.parse({
      id: 'media-file',
      name: file,
      tiktok: 'media-file',
      video_mode: 'copy',
    });
    const resolved: ResolvedStream = {
      url: path,
      vcodec: probe.isH264 ? 'h264' : 'other',
      height: probe.height,
      formatId: null,
      isH264: probe.isH264,
      title: file,
      resolvedAt: new Date(),
    };
    const offset = 0;
    this.sourceSession.start(synthetic, resolved, false, offset, seekSeconds);
    this.activeMediaStartedAt = Date.now();
    this.startSinkOrPrefillLocked(options.key, filters, signature, undefined, logoEngine?.panel);
    this.sourceSession.markProducerStarted(offset);
    this.markSinkGrace();
    this.earnings.setActive();
    this.autoRefresh.stop();
    this.watchdog.reset();
    this.watchdog.clearError();
    this.playlistController.activate(options.playlist);
    this.transitionTo('live');
    if (options.playlist.playlist.id === QUEUE_PLAYLIST_ID && probe.duration) {
      this.queue.setPlayback({
        channel: `file:${file}`,
        position_seconds: seekSeconds,
        duration_seconds: probe.duration,
        updated_at: new Date().toISOString(),
      });
    }
    this.emitAll();
    this.deps.logger.info({ file, playlist: options.playlist.playlist.id }, 'Lokales Video gestartet');
    return this.buildStatus();
  }

  private async startStreamerLocked(
    streamer: StreamerConfig,
    options: StartOptions,
  ): Promise<StatusSnapshot> {
    if (this.shuttingDown) throw new AppError('shutting_down', 'Der Dienst wird beendet', 503);
    if (!options.preservePreferredReturn) this.preferredReturn = null;
    this.sinkController.clearStartTimer();
    const key = options.key ?? resolveStreamKey(streamer).key;
    if (!key) throw new MissingStreamKeyError();
    this.deps.registerSecret(key);

    if (
      this.activeStreamer?.id === streamer.id &&
      this.state === 'live' &&
      this.sinkController.key === key &&
      !options.forceReencode
    ) {
      return this.buildStatus();
    }

    this.sourceSession.clearReconnectTimer();
    const previousState = this.state;
    this.transitionTo('starting');
    this.lastError = null;
    this.sourceSession.beginResolve();
    this.emitStatus();

    let stream: ResolvedStream;
    try {
      stream = await this.sourceSession.resolve(streamer);
    } catch (error) {
      this.sourceSession.endResolve();
      const message = toErrorMessage(error);
      this.lastError = message;
      if (
        error instanceof StreamerOfflineError &&
        options.allowOfflineWait &&
        this.settings.pause.enabled
      ) {
        await this.beginWaitingSessionLocked(streamer, key, options, message);
        return this.buildStatus();
      }
      this.transitionTo(
        previousState === 'live' || previousState === 'paused' ? previousState : 'error',
        'start failed',
      );
      this.emitAll();
      throw error;
    }
    this.sourceSession.endResolve();

    const previousKey = this.sinkController.key;
    const prepared = this.overlays.prepare();
    const candidateEngine = this.overlayRuntime.createEngine();
    const candidateLogo = this.overlayRuntime.createLogoEngine();
    const overlayInput = candidateEngine?.panel;
    const logoInput = candidateLogo?.panel;
    const signature = this.overlayRuntime.signature(
      prepared.filters,
      candidateEngine,
      candidateLogo,
    );
    const reusable =
      this.sinkController.running && previousKey === key && this.sinkController.signature === signature;
    const timestampOffset = reusable ? this.sourceSession.nextOffset() : 0;

    await this.stopSourceAndChatLocked();

    if (!reusable) {
      this.buffer.reset();
      this.sourceSession.resetTimeline();
      if (previousKey && previousKey !== key) this.sinkController.notifyStopped(previousKey);
      if (this.sinkController.running) await this.stopSinkLocked();
      this.overlayRuntime.replaceEngine(candidateEngine, candidateLogo);
    } else if (!this.overlayRuntime.engine || !this.overlayRuntime.logo) {
      this.overlayRuntime.adoptEngine(
        candidateEngine,
        candidateLogo,
        this.sinkController.overlayStream(),
        this.sinkController.logoStream(),
      );
    }
    this.applyConfiguredDelay();

    this.activeStreamer = streamer;
    this.activeMediaFile = null;
    this.activeMediaOffset = 0;
    this.activeMediaStartedAt = null;
    this.activeMediaDuration = null;
    this.queue.clearPlayback();
    this.sinkController.key = key;
    this.sinkController.filters = prepared.filters;
    this.sinkController.overlayInput = overlayInput;
    this.sinkController.logoInput = logoInput;
    this.sinkController.signature = signature;
    this.startedAt = new Date();
    this.activeTitle = stream.title;
    this.pauseController.pauseReason = null;
    this.pauseController.manualScreen = null;
    this.pauseController.clearPauseLimit();
    this.sourceSession.resetReconnectAttempts();
    this.forceReencodeNext = options.forceReencode ?? false;

    const introSeconds =
      options.intro !== false &&
      !options.playlist &&
      previousState === 'idle' &&
      this.settings.startup.enabled
        ? Math.max(0, this.settings.startup.duration_seconds)
        : 0;

    if (introSeconds > 0) {
      incMetric('startup_screens_total');
      await this.pauseController.startStartup(timestampOffset);
      this.sourceSession.markProducerStarted(timestampOffset);
      this.markSinkGrace();
      this.pauseController.clearOfflinePauseTimer();
      this.earnings.setActive();
      this.watchdog.reset();
      this.watchdog.clearError();
      this.transitionTo('starting', 'startup screen');
      this.scheduleStartupFinishLocked(streamer, stream, introSeconds);
    } else {
      this.sourceSession.start(streamer, stream, this.reencodeSource(false), timestampOffset);
      this.sourceSession.markProducerStarted(timestampOffset);
      this.markSinkGrace();
      this.pauseController.clearOfflinePauseTimer();
      this.overlayRuntime.startChat(streamer);
      this.earnings.setActive();
      this.autoRefresh.start();
      this.watchdog.reset();
      this.watchdog.clearError();
      this.transitionTo('live');
    }
    if (!reusable) {
      this.startSinkOrPrefillLocked(key, prepared.filters, signature, overlayInput, logoInput);
    }
    this.playlistController.activate(options.playlist ?? null);
    this.emitAll();
    this.deps.logger.info(
      { streamer: streamer.id, key: '***', reusedSink: reusable, introSeconds },
      introSeconds > 0 ? 'Startbildschirm aktiv' : 'Stream gestartet',
    );
    return this.buildStatus();
  }

  private scheduleStartupFinishLocked(
    streamer: StreamerConfig,
    stream: ResolvedStream,
    introSeconds: number,
  ): void {
    this.pauseController.scheduleStartupFinish(introSeconds, () => {
      void this.lock.run(async () => {
        if (
          this.shuttingDown ||
          this.state !== 'starting' ||
          this.activeStreamer?.id !== streamer.id
        ) {
          return;
        }
        await this.pauseController.stopStartup();
        if (this.sourceSession.running) return;
        const offset = this.sourceSession.nextOffset();
        this.sourceSession.start(streamer, stream, this.reencodeSource(false), offset);
        this.sourceSession.markProducerStarted(offset);
        this.markSinkGrace();
        this.pauseController.clearOfflinePauseTimer();
        this.overlayRuntime.startChat(streamer);
        this.autoRefresh.start();
        this.transitionTo('live', 'startup finished');
        this.emitAll();
      });
    });
  }

  /**
   * Manual start of an offline streamer: keep YouTube alive with the pause
   * screen and retry until the streamer goes live (matches the old
   * Python restreamer behaviour instead of returning an error immediately).
   */
  private async beginWaitingSessionLocked(
    streamer: StreamerConfig,
    key: string,
    options: StartOptions,
    message: string,
  ): Promise<void> {
    this.sourceSession.clearReconnectTimer();
    this.pauseController.clearOfflinePauseTimer();
    const prepared = this.overlays.prepare();
    const candidateEngine = this.overlayRuntime.createEngine();
    const candidateLogo = this.overlayRuntime.createLogoEngine();
    const overlayInput = candidateEngine?.panel;
    const logoInput = candidateLogo?.panel;
    const signature = this.overlayRuntime.signature(
      prepared.filters,
      candidateEngine,
      candidateLogo,
    );
    const reusable =
      this.sinkController.running && this.sinkController.key === key && this.sinkController.signature === signature;

    await this.stopSourceAndChatLocked();
    if (!reusable) {
      this.buffer.reset();
      this.sourceSession.resetTimeline();
      if (this.sinkController.running) await this.stopSinkLocked();
      this.overlayRuntime.replaceEngine(candidateEngine, candidateLogo);
    } else if (!this.overlayRuntime.engine || !this.overlayRuntime.logo) {
      this.overlayRuntime.adoptEngine(
        candidateEngine,
        candidateLogo,
        this.sinkController.overlayStream(),
        this.sinkController.logoStream(),
      );
    }

    this.activeStreamer = streamer;
    this.sinkController.key = key;
    this.sinkController.filters = prepared.filters;
    this.sinkController.overlayInput = overlayInput;
    this.sinkController.logoInput = logoInput;
    this.sinkController.signature = signature;
    this.startedAt = new Date();
    this.activeTitle = streamer.name;
    this.sourceSession.resetReconnectAttempts();
    this.forceReencodeNext = false;
    this.applyConfiguredDelay();
    this.autoRefresh.stop();
    this.watchdog.reset();
    this.watchdog.clearError();

    this.playlistController.activate(options.playlist ?? null);

    await this.startPauseLocked();
    this.earnings.setActive();
    this.lastError = message;
    this.emitAll();
    this.scheduleReconnect(30_000);
    this.deps.logger.info(
      { streamer: streamer.id, err: message },
      'Streamer offline – Wartemodus mit Pausenscreen',
    );
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
    this.secondarySink.start();
    this.recording.start(this.activeStreamer?.id ?? this.activeMediaFile ?? 'stream');
  }

  private async stopSinkLocked(): Promise<void> {
    await this.sinkController.stop();
  }

  private async stopSourceAndChatLocked(): Promise<void> {
    this.activeMediaFile = null;
    this.activeMediaOffset = 0;
    this.activeMediaStartedAt = null;
    this.activeMediaDuration = null;
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
    await Promise.allSettled([this.secondarySink.stop(), this.recording.stop()]);
    await this.stopSinkLocked();
    // A container restart is not a user stop. Keep the broadcast for the next
    // start instead of completing it on every deploy.
    if (!this.shuttingDown) this.sinkController.notifyStopped(stoppingKey);
    this.overlayRuntime.stopEngine();
    this.buffer.reset();
    this.overlays.clear();
    this.overlayRuntime.resetMessages();
    this.activeStreamer = null;
    this.activeMediaFile = null;
    this.activeMediaOffset = 0;
    this.activeMediaStartedAt = null;
    this.activeMediaDuration = null;
    this.playlistController.detach();
    this.preferredReturn = null;
    this.endedPreferred.clear();
    this.sinkController.key = '';
    this.sinkController.filters = [];
    this.sinkController.overlayInput = undefined;
    this.sinkController.logoInput = undefined;
    this.sinkController.signature = '';
    this.startedAt = null;
    this.activeTitle = '';
    this.lastError = null;
    this.forceReencodeNext = false;
    this.sourceSession.resetReconnectAttempts();
    this.sourceSession.resetTimeline();
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
    return (
      this.activeStreamer ??
      this.deps.store.list()[0] ??
      StreamerSchema.parse({ id: 'screen', name: 'Screen', tiktok: 'screen' })
    );
  }

  /**
   * RTMP target for a manual screen. An active stream keeps its running key;
   * otherwise the preferred/enabled streamer key is used and the global
   * YOUTUBE_STREAM_KEY acts as the last fallback.
   */
  private resolveScreenTarget(): { streamer: StreamerConfig | null; key: string } {
    if (this.activeStreamer && this.sinkController.key) {
      return { streamer: this.activeStreamer, key: this.sinkController.key };
    }
    const streamers = this.deps.store.list();
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
      if (this.shuttingDown) {
        throw new AppError('shutting_down', 'Der Dienst wird beendet', 503);
      }
      if (type === 'startup' && !this.settings.startup.enabled) {
        throw new ValidationError('Der Startbildschirm ist in den Einstellungen deaktiviert');
      }
      if (type === 'pause' && !this.settings.pause.enabled) {
        throw new ValidationError('Der Pausenscreen ist in den Einstellungen deaktiviert');
      }
      this.pauseController.clearStartupTimer();
      this.pauseController.clearOfflinePauseTimer();
      this.pauseController.clearPauseLimit();
      this.sourceSession.clearReconnectTimer();
      this.sinkController.clearStartTimer();
      await this.stopSourceAndChatLocked();
      this.queue.clearPlayback();

      let pendingSink: {
        key: string;
        filters: string[];
        signature: string;
        input?: SinkOverlayInput;
      } | null = null;

      if (this.activeStreamer && this.sinkController.key) {
        // Keep the existing sink so the RTMP connection survives the swap.
        if (!this.sinkController.running) {
          this.buffer.reset();
          this.sourceSession.resetTimeline();
          pendingSink = {
            key: this.sinkController.key,
            filters: this.sinkController.filters,
            signature: this.sinkController.signature,
            input: this.sinkController.overlayInput,
          };
        }
      } else {
        const target = this.resolveScreenTarget();
        if (!target.key) {
          throw new ValidationError(
            'Kein YouTube-Stream-Key gefunden – der Screen kann nicht gesendet werden',
          );
        }
        this.deps.registerSecret(target.key);
        if (!this.sinkController.running || this.sinkController.key !== target.key) {
          if (this.sinkController.running) await this.stopSinkLocked();
          this.overlayRuntime.stopEngine();
          this.sinkController.logoInput = undefined;
          this.overlayRuntime.resetMessages(false, false);
          this.buffer.reset();
          this.sourceSession.resetTimeline();
          const prepared = this.overlays.prepare();
          pendingSink = {
            key: target.key,
            filters: prepared.filters,
            signature: this.overlayRuntime.signature(prepared.filters, undefined),
          };
        }
      }
      this.applyConfiguredDelay();
      const offset = this.sourceSession.nextOffset();
      const screen = this.pauseController.screen(type);
      if (screen === this.pauseController.screen('startup')) {
        await this.pauseController.startStartup(offset);
      } else {
        await this.pauseController.startPause(offset);
      }
      if (pendingSink) {
        this.startSinkOrPrefillLocked(
          pendingSink.key,
          pendingSink.filters,
          pendingSink.signature,
          pendingSink.input,
          this.sinkController.logoInput,
        );
      }
      this.sourceSession.markProducerStarted(offset);
      this.markSinkGrace();
      this.pauseController.manualScreen = type;
      this.pauseController.pauseReason = 'user';
      incMetric('manual_screens_total');
      this.transitionTo('paused', `manual ${type} screen`);
      this.autoRefresh.stop();
      this.emitAll();
      this.deps.logger.info(
        { screen: type, streamer: this.activeStreamer?.id ?? null },
        'Manueller Screen aktiviert',
      );
      return this.buildStatus();
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
        preservePreferredReturn: Boolean(this.preferredReturn),
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
    const active = this.playlistController.current;
    const isQueue = active?.playlist.id === QUEUE_PLAYLIST_ID;
    return this.queue.snapshot(Boolean(isQueue), isQueue ? (active?.index ?? null) : null);
  }

  async queueAdd(channel: string): Promise<QueueSnapshot> {
    return this.lock.run(async () => {
      const { isQueue, currentId } = this.queueEditState();
      this.queue.add(channel);
      await this.reindexQueueLocked(currentId, isQueue);
      this.emitQueue();
      return this.buildQueueSnapshot();
    });
  }

  async queueRemove(id: string): Promise<QueueSnapshot> {
    return this.lock.run(async () => {
      const { isQueue, currentId } = this.queueEditState();
      if (!this.queue.remove(id)) throw new NotFoundError('Queue-Eintrag nicht gefunden');
      await this.reindexQueueLocked(currentId, isQueue);
      this.emitQueue();
      return this.buildQueueSnapshot();
    });
  }

  async queueMove(id: string, to: number): Promise<QueueSnapshot> {
    return this.lock.run(async () => {
      const { isQueue, currentId } = this.queueEditState();
      if (!this.queue.move(id, to)) throw new NotFoundError('Queue-Eintrag nicht gefunden');
      await this.reindexQueueLocked(currentId, isQueue);
      this.emitQueue();
      return this.buildQueueSnapshot();
    });
  }

  async queueDuplicate(id: string): Promise<QueueSnapshot> {
    return this.lock.run(async () => {
      const { isQueue, currentId } = this.queueEditState();
      if (!this.queue.duplicate(id)) throw new NotFoundError('Queue-Eintrag nicht gefunden');
      await this.reindexQueueLocked(currentId, isQueue);
      this.emitQueue();
      return this.buildQueueSnapshot();
    });
  }

  async queueUpdateEntry(
    id: string,
    patch: { duration_seconds?: number | null },
  ): Promise<QueueSnapshot> {
    return this.lock.run(async () => {
      if (!this.queue.updateEntry(id, patch)) {
        throw new NotFoundError('Queue-Eintrag nicht gefunden');
      }
      this.emitQueue();
      return this.buildQueueSnapshot();
    });
  }

  async queueSetLoop(loop: boolean): Promise<QueueSnapshot> {
    return this.lock.run(async () => {
      this.queue.setLoop(loop);
      this.emitQueue();
      return this.buildQueueSnapshot();
    });
  }

  async queueClear(): Promise<QueueSnapshot> {
    return this.lock.run(async () => {
      const { isQueue } = this.queueEditState();
      this.queue.clear();
      if (isQueue) await this.stopInternalLocked();
      this.emitQueue();
      return this.buildQueueSnapshot();
    });
  }

  async queuePlay(index = 0): Promise<StatusSnapshot> {
    if (this.queue.get().length === 0) {
      throw new ValidationError('Die Regie-Queue ist leer');
    }
    return this.playlistController.play(QUEUE_PLAYLIST_ID, index);
  }

  async queueNext(): Promise<StatusSnapshot> {
    if (this.playlistController.current?.playlist.id !== QUEUE_PLAYLIST_ID) {
      throw new ValidationError('Die Regie-Queue ist nicht aktiv');
    }
    return this.playlistController.next();
  }

  async queueStop(): Promise<StatusSnapshot> {
    return this.stop();
  }

  /** "Sofort abspielen": queued after the current entry and skipped to. */
  async queuePlayNow(channel: string): Promise<StatusSnapshot> {
    const active = this.playlistController.current;
    const isQueue = active?.playlist.id === QUEUE_PLAYLIST_ID;
    if (isQueue && active) {
      this.queue.insertAt(channel, active.index + 1);
      this.emitQueue();
      return this.playlistController.next();
    }
    this.queue.insertAt(channel, 0);
    this.emitQueue();
    return this.playlistController.play(QUEUE_PLAYLIST_ID, 0);
  }

  /** Jumps within the currently playing local video. */
  async seekActiveVideo(seconds: number): Promise<StatusSnapshot> {
    return this.lock.run(async () => {
      const file = this.activeMediaFile;
      if (!file) throw new ValidationError('Es läuft kein lokales Video');
      const key = this.sinkController.key;
      if (!key) throw new ValidationError('Kein aktiver YouTube-Stream-Key');
      const current = this.playlistController.current;
      if (!current) throw new ValidationError('Keine aktive Playlist');
      const max = this.activeMediaDuration
        ? Math.max(0, this.activeMediaDuration - 0.5)
        : Math.max(0, seconds);
      const target = Math.max(0, Math.min(seconds, max));
      this.deps.logger.info({ file, seconds: target }, 'Lokales Video wird gesucht');
      return this.startFileLocked(file, {
        key,
        playlist: current,
        seekSeconds: target,
      });
    });
  }

  private queueEditState(): { isQueue: boolean; currentId: string | null } {
    const active = this.playlistController.current;
    const isQueue = active?.playlist.id === QUEUE_PLAYLIST_ID;
    return {
      isQueue: Boolean(isQueue),
      currentId: isQueue && active ? this.queue.entryIdAt(active.index) : null,
    };
  }

  /** Keeps playback on the same entry after a live queue edit; stops if it was removed. */
  private async reindexQueueLocked(currentId: string | null, wasActive: boolean): Promise<void> {
    if (!wasActive || !currentId) return;
    const nextIndex = this.queue.indexOfId(currentId);
    if (nextIndex >= 0) {
      this.playlistController.setIndex(nextIndex);
      return;
    }
    this.queue.clearPlayback();
    await this.stopInternalLocked();
  }

  private currentMediaPosition(): number {
    if (!this.activeMediaDuration) return 0;
    const elapsed =
      this.activeMediaStartedAt === null
        ? 0
        : Math.max(0, (Date.now() - this.activeMediaStartedAt) / 1000);
    return Math.min(this.activeMediaDuration, this.activeMediaOffset + elapsed);
  }

  /** Persists the active queue video position (throttled by the status timer). */
  private persistMediaProgress(): void {
    if (!this.activeMediaFile || !this.activeMediaDuration) return;
    if (this.playlistController.current?.playlist.id !== QUEUE_PLAYLIST_ID) return;
    this.queue.setPlayback({
      channel: `file:${this.activeMediaFile}`,
      position_seconds: this.currentMediaPosition(),
      duration_seconds: this.activeMediaDuration,
      updated_at: new Date().toISOString(),
    });
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
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = undefined;
    this.pauseController.clearTimers();
  }

  private handleSourceExit(
    code: number | null = null,
    signal: NodeJS.Signals | null = null,
  ): void {
    if (this.shuttingDown || this.sourceSession.stopping > 0) return;
    if (this.activeMediaFile) {
      const file = this.activeMediaFile;
      this.activeMediaFile = null;
      this.activeMediaOffset = 0;
      this.activeMediaStartedAt = null;
      this.activeMediaDuration = null;
      this.deps.logger.info({ file, code, signal }, 'Lokales Playlist-Video beendet');
      void this.playlistController.advanceAfterFile().catch((error) => {
        this.lastError = toErrorMessage(error);
        this.deps.logger.warn({ err: this.lastError }, 'Playlist konnte nach Video nicht fortsetzen');
        this.emitAll();
      });
      return;
    }
    if (!this.activeStreamer) return;
    if (!['live', 'starting'].includes(this.state)) return;
    incMetric('source_exits_total');
    this.sourceSession.incrementReconnects();
    this.lastError = 'Stream-Quelle beendet';
    this.pauseController.scheduleOfflinePause();
    if (!this.settings.watchdog.auto_reconnect) {
      if (this.preferredReturn) {
        void this.lock.run(async () => {
          await this.returnToPreferredOriginLocked('preferred source ended without reconnect');
          this.emitAll();
        });
        return;
      }
      this.transitionTo('error');
      this.emitAll();
      return;
    }
    this.transitionTo('reconnecting');
    this.emitStatus();
    this.deps.logger.warn(
      { streamer: this.activeStreamer.id },
      'Quelle unerwartet beendet – Neuverbindung',
    );
    this.scheduleReconnect();
  }

  private scheduleReconnect(delayMs?: number): void {
    if (this.shuttingDown || !this.activeStreamer || this.sourceSession.reconnecting) return;
    incMetric('source_reconnects_total');
    const scheduled = this.sourceSession.scheduleReconnect(delayMs, () => void this.reconnect());
    if (!scheduled) return;
    if (this.state !== 'paused') this.transitionTo('reconnecting', 'reconnect scheduled');
    this.emitStatus();
    this.deps.logger.info(
      { attempt: scheduled.attempt, delaySeconds: Math.round(scheduled.delayMs / 100) / 10 },
      'Neuverbindung geplant',
    );
  }

  private reencodeSource(reconnect: boolean): boolean {
    if (this.forceReencodeNext) return true;
    const mode = this.settings.source.reencode;
    if (mode === 'always') return true;
    if (mode === 'on_reconnect' && reconnect) return true;
    return false;
  }

  private async reconnect(): Promise<void> {
    await this.lock.run(async () => {
      if (this.shuttingDown || !this.activeStreamer) return;
      if (this.state === 'paused' && this.pauseController.pauseReason === 'user') return;
      if (this.sourceSession.running) return;
      this.transitionTo('reconnecting');
      this.emitStatus();
      try {
        const stream = await this.sourceSession.resolve(this.activeStreamer);
        await this.pauseController.stopPause();
        this.applyConfiguredDelay();
        const timestampOffset = this.sourceSession.nextOffset();
        this.sourceSession.start(this.activeStreamer, stream, this.reencodeSource(true), timestampOffset);
        if (!this.sinkController.running && this.sinkController.key) {
          this.startSinkOrPrefillLocked(
            this.sinkController.key,
            this.sinkController.filters,
            this.sinkController.signature,
            this.sinkController.overlayInput,
            this.sinkController.logoInput,
          );
        }
        this.sourceSession.markProducerStarted(timestampOffset);
        this.markSinkGrace();
        this.applyConfiguredDelay();
        this.pauseController.clearOfflinePauseTimer();
        this.activeTitle = stream.title;
        this.pauseController.clearPauseLimit();
        this.pauseController.pauseReason = null;
        this.pauseController.manualScreen = null;
        this.lastError = null;
        this.sourceSession.resetReconnectAttempts();
        this.watchdog.clearError();
        this.overlayRuntime.ensureChat(this.activeStreamer);
        this.transitionTo('live');
        incMetric('reconnect_success_total');
        this.emitAll();
        this.deps.logger.info({ streamer: this.activeStreamer.id }, 'Stream wieder verbunden');
      } catch (error) {
        const message = toErrorMessage(error);
        this.lastError = message;
        incMetric('reconnect_failures_total');
        this.deps.logger.warn(
          { streamer: this.activeStreamer.id, err: message },
          'Neuverbindung fehlgeschlagen',
        );
        if (error instanceof StreamerOfflineError && this.preferredReturn) {
          await this.returnToPreferredOriginLocked('preferred streamer offline');
          this.emitAll();
          return;
        }
        const playlist = this.playlistController.current;
        if (error instanceof StreamerOfflineError && playlist) {
          if (playlist.playlist.auto_advance) {
            this.playlistController.scheduleAdvance();
            this.emitStatus();
            return;
          }
          if (this.settings.pause.enabled && this.sinkController.running && !this.pauseController.pauseRunning) {
            await this.startPauseLocked();
          }
          this.emitStatus();
          this.scheduleReconnect(Math.max(30, this.settings.watchdog.max_reconnect_delay) * 1000);
          return;
        }
        if (
          error instanceof StreamerOfflineError &&
          this.settings.pause.enabled &&
          this.sinkController.running &&
          !this.pauseController.pauseRunning &&
          this.sourceSession.reconnectAttempts >= 2
        ) {
          await this.startPauseLocked();
        }
        this.emitStatus();
        this.scheduleReconnect(error instanceof StreamerOfflineError ? 30_000 : undefined);
      }
    });
  }

  private async startPauseLocked(): Promise<void> {
    this.pauseController.clearStartupTimer();
    await this.pauseController.stopStartup();
    this.overlayRuntime.stopChat();
    this.applyConfiguredDelay();
    const timestampOffset = this.sourceSession.nextOffset();
    await this.pauseController.startPause(timestampOffset);
    if (!this.sinkController.running && this.sinkController.key) {
      this.startSinkOrPrefillLocked(
        this.sinkController.key,
        this.sinkController.filters,
        this.sinkController.signature,
        this.sinkController.overlayInput,
        this.sinkController.logoInput,
      );
    }
    this.sourceSession.markProducerStarted(timestampOffset);
    this.markSinkGrace();
    this.pauseController.pauseReason = 'offline';
    this.pauseController.manualScreen = null;
    this.transitionTo('paused');
    incMetric('pause_starts_total');
    this.pauseController.schedulePauseLimit();
    this.deps.logger.info('Quelle offline – Pausenscreen aktiv');
  }

  private canStartOfflinePauseLocked(): boolean {
    if (this.sourceSession.running || this.pauseController.pauseRunning || !this.sinkController.running) {
      return false;
    }
    if (this.playlistController.isAdvancePending) return false;
    if (!['live', 'starting', 'reconnecting', 'paused', 'error'].includes(this.state)) return false;
    if (this.state === 'paused' && this.pauseController.pauseReason === 'user') return false;
    return true;
  }

  private async refreshSource(reason: string): Promise<void> {
    await this.lock.run(async () => {
      const streamer = this.activeStreamer;
      if (!streamer || this.shuttingDown) return;
      if (!['live', 'paused'].includes(this.state)) return;
      this.deps.logger.info({ reason }, 'Quell-URL wird aktualisiert');
      try {
        const stream = await this.sourceSession.resolve(streamer);
        await this.pauseController.stopPause();
        await this.sourceSession.stop();
        const timestampOffset = this.sourceSession.nextOffset();
        this.sourceSession.start(streamer, stream, this.reencodeSource(true), timestampOffset);
        this.sourceSession.markProducerStarted(timestampOffset);
        this.markSinkGrace();
        this.applyConfiguredDelay();
        this.pauseController.clearOfflinePauseTimer();
        this.activeTitle = stream.title;
        this.pauseController.clearPauseLimit();
        this.pauseController.pauseReason = null;
        this.pauseController.manualScreen = null;
        this.transitionTo('live');
        this.lastError = null;
        this.autoRefresh.markRefreshed();
        // Keep the running chat service alive: restarting it would clear the
        // overlay until the next poll and cause visible flicker.
        this.overlayRuntime.ensureChat(streamer);
        this.emitAll();
      } catch (error) {
        this.lastError = toErrorMessage(error);
        this.emitStatus();
        if (error instanceof StreamerOfflineError && this.preferredReturn) {
          await this.returnToPreferredOriginLocked('preferred streamer offline');
          return;
        }
        if (!this.sourceSession.running && this.state === 'live') {
          this.scheduleReconnect(3000);
        }
        if (error instanceof StreamerOfflineError) {
          this.deps.logger.warn('Auto-Refresh: Streamer ist offline');
          if (this.playlistController.current?.playlist.auto_advance) {
            this.playlistController.scheduleAdvance();
          }
        } else {
          this.deps.logger.warn({ err: this.lastError }, 'Auto-Refresh fehlgeschlagen');
        }
        throw error;
      }
    });
  }

  private handleCodecProblem(line: string): void {
    if (this.shuttingDown || this.sourceSession.stopping > 0 || !this.activeStreamer) return;
    this.deps.logger.warn({ line }, 'Quell-Codec wird nicht unterstützt – Re-Encoding-Fallback');
    this.forceReencodeNext = true;
    void (async () => {
      await this.sourceSession.stop();
      this.pauseController.scheduleOfflinePause();
      this.scheduleReconnect(1000);
    })();
  }

  private handleSinkExit(): void {
    if (this.sinkController.stopping || this.shuttingDown) return;
    if (!this.activeStreamer || !this.sinkController.key) return;
    if (['idle', 'stopping'].includes(this.state)) return;
    this.overlayRuntime.detachEngine();
    this.deps.logger.warn('YouTube-Sink beendet – Neustart geplant');
    this.scheduleSinkRestart(3000);
  }

  private scheduleSinkRestart(delayMs: number): void {
    this.sinkController.scheduleRestart(
      delayMs,
      () => this.restartSinkLocked(),
      () => !this.shuttingDown && Boolean(this.sinkController.key) && !['idle', 'stopping'].includes(this.state),
    );
  }

  private async restartSinkLocked(): Promise<void> {
    if (!this.sinkController.key) return;
    incMetric('sink_restarts_total');
    await this.sinkController.restart();
    this.emitAll();
  }

  private async handleRelayStall(ageSeconds: number): Promise<void> {
    await this.lock.run(async () => {
      if (!this.activeStreamer || this.shuttingDown) return;
      if (!['live', 'reconnecting'].includes(this.state)) return;
      if (this.playlistController.isAdvancePending) return;
      const last = this.relay.lastData;
      if (last && Date.now() - last.getTime() < this.settings.watchdog.stall_timeout * 1000) {
        return;
      }
      this.lastError = `Quelle liefert seit ${ageSeconds}s keine Daten`;
      incMetric('watchdog_triggers_total');
      this.deps.logger.warn({ ageSeconds }, 'Quelle wird wegen Stall neu gestartet');
      await this.sourceSession.stop();
      this.pauseController.scheduleOfflinePause();
      this.scheduleReconnect(1000);
    });
  }

  private async handleLowBitrate(kbps: number): Promise<void> {
    await this.lock.run(async () => {
      if (!this.activeStreamer || this.shuttingDown) return;
      if (this.state !== 'live') return;
      incMetric('watchdog_triggers_total');
      // A low source bitrate is a quality warning, not an outage. Restarting
      // the source here would cause the output to stall repeatedly.
      this.deps.logger.warn(
        { kbps: Math.round(kbps), minimum: this.settings.watchdog.min_bitrate },
        'Quell-Bitrate niedrig – Stream bleibt aktiv',
      );
    });
  }

  private async handleLowSourceRate(percent: number): Promise<void> {
    await this.handleSourceProblem(`Quellrate zu niedrig (${percent} %)`, { percent });
  }

  private async handleSourceProblem(
    reason: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    await this.lock.run(async () => {
      if (!this.activeStreamer || this.shuttingDown) return;
      if (this.state !== 'live' || this.playlistController.isAdvancePending) return;
      this.lastError = reason;
      incMetric('watchdog_triggers_total');
      this.deps.logger.warn({ ...context, reason }, 'Quelle wird neu gestartet');
      await this.sourceSession.stop();
      this.pauseController.scheduleOfflinePause();
      this.scheduleReconnect(2000);
    });
  }

  private async handleSinkStall(ageSeconds: number): Promise<void> {
    await this.lock.run(async () => {
      if (this.shuttingDown || !this.sinkController.key) return;
      if (this.playlistController.isAdvancePending) return;
      const last = this.sinkController.lastProgressAt;
      if (last && Date.now() - last.getTime() < this.settings.watchdog.stall_timeout * 1000) {
        return;
      }
      this.lastError = `Encoder liefert seit ${ageSeconds}s keinen Fortschritt`;
      incMetric('watchdog_triggers_total');
      this.deps.logger.warn({ ageSeconds }, 'Sink wird neu gestartet');
      await this.restartSinkLocked();
    });
  }

  async applySettings(next: Settings, previous: Settings): Promise<StatusSnapshot> {
    return this.lock.run(async () => {
      this.settings = next;
      if (previous.video.encoder !== next.video.encoder) {
        // Probe lazily so switching to a hardware encoder in the dashboard
        // works without a restart; failed probes fall back to libx264.
        setAvailableVideoEncoders(
          await probeVideoEncoders({
            ffmpegBin: this.deps.config.media.ffmpegBin,
            preferred: next.video.encoder,
            logger: this.deps.logger,
          }),
        );
      }
      configureVideoEncoder(next.video.encoder, this.deps.logger);
      this.sinkController.updateSettings(next);
      this.applyConfiguredDelay();
      this.buffer.setMaxBytes(this.bufferMaxBytes(next));
      this.watchdog.updateSettings(next);
      this.autoRefresh.updateSettings(next);
      this.online.updateSettings(next);
      this.overlays.updateSettings(next);
      this.overlayRuntime.updateSettings(next);
      this.sourceSession.updateSettings(next);
      this.pauseController.updateSettings(next);
      this.earnings.updateSettings(next);
      this.secondarySink.updateSettings(next);
      this.recording.updateSettings(next);
      if (next.secondary_sink.stream_key) {
        this.deps.registerSecret?.(next.secondary_sink.stream_key);
      }
      const sessionActive = this.sinkController.running || this.sinkController.starting;
      if (JSON.stringify(previous.secondary_sink) !== JSON.stringify(next.secondary_sink)) {
        await this.secondarySink.syncWithSettings(sessionActive);
      }
      if (JSON.stringify(previous.recording) !== JSON.stringify(next.recording)) {
        await this.recording.syncWithSettings(
          sessionActive,
          this.activeStreamer?.id ?? this.activeMediaFile ?? 'stream',
        );
      }

      const overlaysChanged = JSON.stringify(previous.overlays) !== JSON.stringify(next.overlays);
      const earningsOverlayChanged =
        previous.earnings.overlay_enabled !== next.earnings.overlay_enabled ||
        previous.earnings.overlay_position !== next.earnings.overlay_position ||
        previous.earnings.overlay_template !== next.earnings.overlay_template ||
        previous.earnings.overlay_font_size !== next.earnings.overlay_font_size ||
        previous.earnings.overlay_margin !== next.earnings.overlay_margin ||
        previous.earnings.overlay_offset_x !== next.earnings.overlay_offset_x ||
        previous.earnings.overlay_offset_y !== next.earnings.overlay_offset_y ||
        previous.earnings.overlay_font_color !== next.earnings.overlay_font_color ||
        previous.earnings.overlay_box_color !== next.earnings.overlay_box_color ||
        previous.earnings.overlay_show_box !== next.earnings.overlay_show_box;
      const overlayCarrier =
        this.activeStreamer ??
        (this.pauseController.manualScreen || this.activeMediaFile ? this.screenFallbackStreamer() : null);
      let needsSinkRestart = false;
      if (earningsOverlayChanged && overlayCarrier && !overlaysChanged) {
        const prepared = this.overlays.prepare();
        this.sinkController.filters = prepared.filters;
        this.sinkController.signature = this.overlayRuntime.signature(
          prepared.filters,
          this.activeStreamer ? this.overlayRuntime.engine : undefined,
          this.overlayRuntime.logo,
        );
        needsSinkRestart = true;
      }

      if (overlaysChanged && overlayCarrier) {
        const prepared = this.overlays.prepare();
        this.sinkController.filters = prepared.filters;
        this.rebuildChatEngineLocked();
        if (this.state === 'live' && this.activeStreamer) {
          this.overlayRuntime.startChat(this.activeStreamer, { preserveMessages: true });
        }
        needsSinkRestart = true;
      }

      const videoLayoutChanged =
        JSON.stringify(previous.video.layout) !== JSON.stringify(next.video.layout);
      if (videoLayoutChanged) needsSinkRestart = true;

      const chatChanged = JSON.stringify(previous.chat) !== JSON.stringify(next.chat);
      if (chatChanged && this.activeStreamer) {
        if (this.state === 'live') {
          this.overlayRuntime.startChat(this.activeStreamer, { preserveMessages: true });
        } else if (this.state === 'paused') {
          this.overlayRuntime.stopChat();
          this.overlayRuntime.resetMessages(false);
        }
      }

      const videoEncodeChanged =
        previous.video.resolution !== next.video.resolution ||
        previous.video.fps !== next.video.fps ||
        previous.video.video_bitrate !== next.video.video_bitrate ||
        previous.video.audio_bitrate !== next.video.audio_bitrate ||
        previous.video.preset !== next.video.preset ||
        previous.video.encoder !== next.video.encoder;
      if (videoEncodeChanged) {
        this.rebuildChatEngineLocked();
        needsSinkRestart = true;
      }
      if (needsSinkRestart && this.sinkController.running) await this.restartSinkLocked();
      if (videoEncodeChanged && this.sourceSession.running && this.sourceSession.resolved) {
        const reencoding =
          this.activeStreamer?.video_mode === 'reencode' || !this.sourceSession.resolved.isH264;
        const resolved = this.sourceSession.resolved;
        if (reencoding && this.activeStreamer && resolved) {
          await this.sourceSession.stop();
          const timestampOffset = this.sourceSession.nextOffset();
          this.sourceSession.start(this.activeStreamer, resolved, true, timestampOffset);
          this.sourceSession.markProducerStarted(timestampOffset);
          this.markSinkGrace();
          this.applyConfiguredDelay();
        }
      }
      if (this.state === 'paused') {
        const screen = this.pauseController.startupRunning
          ? this.pauseController.screen('startup')
          : this.pauseController.pauseRunning
            ? this.pauseController.screen('pause')
            : null;
        if (screen) {
          await screen.stop();
          const timestampOffset = this.sourceSession.nextOffset();
          await screen.start(undefined, undefined, timestampOffset);
          this.sourceSession.markProducerStarted(timestampOffset);
        }
      }
      if (!next.auto_refresh.enabled) {
        this.autoRefresh.stop();
      } else if (this.activeStreamer && this.state === 'live') {
        this.autoRefresh.start();
      } else if (!this.activeStreamer) {
        this.autoRefresh.stop();
      }
      this.emitAll();
      return this.buildStatus();
    });
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
    const now = new Date();
    const title = template
      .replaceAll('{name}', streamer.name)
      .replaceAll('{tiktok}', streamer.tiktok.replace(/^@+/, ''))
      .replaceAll('{title}', resolved || streamer.name)
      .replaceAll('{date}', now.toLocaleDateString('de-DE'))
      .replaceAll('{time}', now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }))
      .slice(0, 200);
    return { streamer_id: id, template, title };
  }

  streamersView(): StreamerView[] {
    const activeId = this.activeStreamer?.id ?? null;
    return this.deps.store.list().map((streamer) => {
      const monitor = this.online.isOnline(streamer);
      const online = streamer.id === activeId && this.state === 'live' ? true : monitor;
      return this.deps.store.view(streamer, activeId, online);
    });
  }

  playlistsView(): PlaylistView[] {
    const active = this.playlistController.current;
    return this.deps.store.playlists().map((playlist) => {
      const playlistKey = resolveStreamKey(playlist).key;
      const channelsHaveKey =
        Boolean(playlistKey) ||
        playlist.channels.some((channel) =>
          Boolean(resolveStreamKey(this.playlistController.resolveChannel(channel)).key),
        );
      return {
        id: playlist.id,
        name: playlist.name,
        channels: playlist.channels,
        auto_advance: playlist.auto_advance,
        wrap: playlist.wrap,
        advance_delay_seconds: playlist.advance_delay_seconds,
        end_after_minutes: playlist.end_after_minutes ?? null,
        end_time: playlist.end_time ?? null,
        youtube_key_set: channelsHaveKey,
        active: active?.playlist.id === playlist.id,
        index: active?.playlist.id === playlist.id ? active.index : null,
      };
    });
  }

  emitAll(): void {
    this.emitStatus();
    this.emitStreamers();
    this.emitQueue();
  }

  emitStatus(): void {
    this.deps.bus.emit({ type: 'status', data: this.buildStatus() });
  }

  emitQueue(): void {
    try {
      this.deps.bus.emit({ type: 'queue', data: this.buildQueueSnapshot() });
    } catch (error) {
      this.deps.logger.warn(
        { err: toErrorMessage(error) },
        'Queue-Ansicht konnte nicht erzeugt werden',
      );
    }
  }

  emitStreamers(): void {
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
    return this.recording?.filename ?? null;
  }

  buildStatus(): StatusSnapshot {
    return buildStatusSnapshot({
      state: this.state,
      settings: this.settings,
      activeStreamer: this.activeStreamer,
      activePlaylist: this.playlistController.current,
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
      media:
        this.activeMediaFile && this.activeMediaDuration
          ? {
              file: this.activeMediaFile,
              duration_seconds: this.activeMediaDuration,
              position_seconds: this.currentMediaPosition(),
            }
          : null,
      secondarySink: this.secondarySink?.status(),
      recording: this.recording?.status(),
    });
  }
}
