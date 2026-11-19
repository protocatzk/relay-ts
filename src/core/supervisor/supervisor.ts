import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { LoadedConfig } from '../config/loader.js';
import {
  StreamerSchema,
  resolveStreamKey,
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
import { OverlayManager } from '../overlays/overlay-manager.js';
import type { ChatMessage } from '../overlays/chat-service.js';
import { PauseScreen } from '../overlays/pause-screen.js';
import { OnlineMonitor } from '../online/monitor.js';
import { EarningsMonitor } from '../earnings/monitor.js';
import { EarningsHistoryStore, type EarningsPeriod } from '../earnings/history.js';
import type { PreviewAspect } from '../overlays/studio-preview.js';
import { Watchdog } from './watchdog.js';
import { AutoRefresh } from './auto-refresh.js';
import { SupervisorStateMachine } from './state-machine.js';
import { buildStatusSnapshot } from './status-builder.js';
import { OverlayRuntime } from './overlay-runtime.js';
import { incMetric } from '../metrics.js';
import { pauseLimitDelayMs } from './pause-limit.js';
import {
  PlaylistController,
  type PlaylistRunState,
  type PlaylistStartOptions,
} from './playlist-controller.js';
import { mediaFilePath, probeMediaFile } from '../media/media-files.js';
import { reconnectDelay } from './reconnect-policy.js';
import type { SinkOverlayInput } from '../source/ffmpeg.js';

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
  private resolver!: { resolve(streamer: StreamerConfig): Promise<ResolvedStream> };
  private source!: TikTokSource;
  private sink!: YouTubeSink;
  private overlays!: OverlayManager;
  private pauseScreen!: PauseScreen;
  private startupScreen!: PauseScreen;
  private watchdog!: Watchdog;
  private autoRefresh!: AutoRefresh;
  private online!: OnlineMonitor;
  private earnings!: EarningsMonitor;
  private overlayRuntime!: OverlayRuntime;

  private readonly stateMachine: SupervisorStateMachine;
  private activeStreamer: StreamerConfig | null = null;
  private activeMediaFile: string | null = null;
  private readonly playlistController: PlaylistController;
  private activeKey = '';
  private activeOverlayFilters: string[] = [];
  private activeOverlayInput?: SinkOverlayInput;
  private activeOverlaySignature = '';
  private startedAt: Date | null = null;
  private lastError: string | null = null;
  private activeTitle = '';
  private reconnects = 0;
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private sinkRestartTimer?: NodeJS.Timeout;
  private sinkStartTimer?: NodeJS.Timeout;
  private youtubeStartTimer?: NodeJS.Timeout;
  private sinkStarting = false;
  private pauseRestartTimer?: NodeJS.Timeout;
  private pauseLimitTimer?: NodeJS.Timeout;
  private startupTimer?: NodeJS.Timeout;
  private offlinePauseTimer?: NodeJS.Timeout;
  private statusTimer?: NodeJS.Timeout;
  private autoStartTimer?: NodeJS.Timeout;
  private stoppingSource = 0;
  private stoppingSink = false;
  private shuttingDown = false;
  private pauseReason: 'user' | 'offline' | null = null;
  private manualScreen: 'startup' | 'pause' | null = null;
  private forceReencodeNext = false;
  private resolving = false;
  private producerStartedAt: number | null = null;
  private producerOffset = 0;
  private sinkGraceUntil = 0;

  constructor(deps: SupervisorDeps) {
    this.deps = deps;
    this.settings = deps.settingsService.get();
    this.stateMachine = new SupervisorStateMachine('idle', deps.logger);
    this.playlistController = new PlaylistController({
      store: deps.store,
      logger: deps.logger,
      lock: this.lock,
      isShuttingDown: () => this.shuttingDown,
      startStreamer: (streamer, options) => this.startStreamerLocked(streamer, options),
      startFile: (file, options) => this.startFileLocked(file, options),
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

    this.resolver =
      this.deps.resolver ??
      new TikTokResolver({
        media: config.media,
        logger,
        cookiesFile: config.paths.cookiesFile,
        redact: this.deps.redact,
      });
    this.source = new TikTokSource({
      media: config.media,
      settings: this.settings,
      relay: relayEndpoint,
      logger,
      redact: this.deps.redact,
      onExit: (code, signal) => this.handleSourceExit(code, signal),
      onCodecProblem: (line) => this.handleCodecProblem(line),
    });
    this.sink = new YouTubeSink({
      media: config.media,
      settings: this.settings,
      relay: relayEndpoint,
      logger,
      redact: this.deps.redact,
      onExit: () => this.handleSinkExit(),
    });
    this.overlays = new OverlayManager(
      { media: config.media, overlaysDir: config.paths.overlaysDir, logger },
      this.settings,
    );
    this.pauseScreen = new PauseScreen({
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
          this.schedulePauseRestart();
        }
      },
    });
    this.startupScreen = new PauseScreen({
      media: config.media,
      settings: this.settings,
      relay: relayEndpoint,
      logger,
      overlaysDir: config.paths.overlaysDir,
      fontFile: this.overlays.font,
      screen: 'startup',
      redact: this.deps.redact,
    });
    this.watchdog = new Watchdog({
      settings: this.settings,
      logger,
      snapshot: () => ({
        state: this.state,
        relayLastDataAt: this.relay.lastData,
        sinkRunning: this.sink.running,
        sinkStarting: this.sinkStarting,
        sinkLastProgressAt: this.sink.lastProgressAt,
        sourceRunning: this.source.running,
        sourceStartedAt: this.source.startedAt,
        sinkStartedAt: this.sink.startedAt,
        sourceBitrateKbps: this.source.bitrateKbps ?? this.buffer?.stats().pacingKbps ?? null,
        sourceOutputSeconds: this.source.outputTimeSeconds,
        suppressStall: this.playlistController.isAdvancePending,
        sinkGraceUntil: this.sinkGraceUntil,
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
        this.emitStreamers();
        void this.maybeAutoSwitchPreferred();
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
      onUpdate: (_snapshot, overlayText) => {
        this.overlays.updateEarnings(overlayText);
      },
      history: earningsHistory,
    });
    this.overlayRuntime = new OverlayRuntime({
      settings: this.settings,
      overlays: this.overlays,
      earnings: this.earnings,
      logger,
    });
    this.earnings.start();
    this.watchdog.start();
    this.statusTimer = setInterval(() => this.emitStatus(), 2000);
    this.emitAll();
    void this.checkBinaries();
    if (config.autoStart) {
      this.autoStartTimer = setTimeout(() => void this.autoStart(), 1500);
    }
    logger.info({ version: VERSION, relayPort: relayEndpoint.port }, 'Supervisor bereit');
  }

  /**
   * Keep MPEG-TS timestamps monotonic across source/pause switches. The new
   * producer gets the offset used by the previous one plus the wall-clock time
   * it was running (and a safety margin). This avoids backward DTS jumps in the
   * long-lived encoder when TikTok restarts its timeline at zero.
   */
  private nextProducerOffset(): number {
    if (this.producerStartedAt === null) return this.producerOffset;
    const elapsed = Math.max(0, (Date.now() - this.producerStartedAt) / 1000);
    return Math.round((this.producerOffset + Math.max(2, elapsed + 1)) * 1000) / 1000;
  }

  private markProducerStarted(offset: number): void {
    this.producerOffset = offset;
    this.producerStartedAt = Date.now();
  }

  private markSinkGrace(): void {
    const delay = this.settings.delay_buffer.enabled ? this.settings.delay_buffer.size : 0;
    this.sinkGraceUntil = Date.now() + (delay + 5) * 1000;
  }

  private resetTimeline(): void {
    this.producerOffset = 0;
    this.producerStartedAt = null;
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
   * Optional parity feature: when a preferred streamer goes live, take it over
   * automatically (e.g. the main channel returns).
   */
  private async maybeAutoSwitchPreferred(): Promise<void> {
    if (
      this.shuttingDown ||
      !this.settings.online.enabled ||
      !this.settings.online.auto_switch_preferred ||
      this.playlistController.current ||
      this.state === 'stopping'
    ) {
      return;
    }
    if (this.state === 'paused' && this.pauseReason === 'user') return;
    if (this.activeStreamer?.preferred && this.state === 'live') return;

    const candidate = this.deps.store
      .list()
      .find(
        (streamer) =>
          streamer.enabled &&
          streamer.preferred &&
          streamer.id !== this.activeStreamer?.id &&
          this.online.isOnline(streamer) === true &&
          Boolean(resolveStreamKey(streamer).key),
      );
    if (!candidate) return;

    await this.lock.run(async () => {
      if (
        this.shuttingDown ||
        this.playlistController.current ||
        this.activeStreamer?.id === candidate.id
      )
        return;
      const key = resolveStreamKey(candidate).key;
      if (!key) return;
      this.deps.logger.info(
        { streamer: candidate.id },
        'Bevorzugter Streamer ist online – automatischer Wechsel',
      );
      try {
        await this.startStreamerLocked(candidate, { key, allowOfflineWait: true });
      } catch (error) {
        this.deps.logger.warn(
          { streamer: candidate.id, err: toErrorMessage(error) },
          'Automatischer Wechsel zum bevorzugten Streamer fehlgeschlagen',
        );
      }
    });
  }

  private async autoStart(): Promise<void> {
    const candidates = this.deps.store
      .list()
      .filter((streamer) => streamer.enabled && streamer.auto_start)
      .sort((left, right) => Number(right.preferred) - Number(left.preferred));
    if (candidates.length === 0) return;
    for (const candidate of candidates) {
      try {
        this.deps.logger.info({ streamer: candidate.id }, 'Auto-Start');
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
      this.activeOverlayFilters,
      Boolean(this.activeStreamer),
    );
    if (!rebuilt) return;
    this.activeOverlayInput = rebuilt.panel;
    this.activeOverlaySignature = rebuilt.signature;
  }

  private async startFileLocked(
    file: string,
    options: PlaylistStartOptions,
  ): Promise<StatusSnapshot> {
    if (this.shuttingDown) throw new AppError('shutting_down', 'Der Dienst wird beendet', 503);
    const path = mediaFilePath(this.deps.config.paths.dataDir, file);
    if (!path || !existsSync(path)) {
      throw new ValidationError(`Lokales Video "${file}" wurde nicht gefunden`);
    }
    this.clearSinkStartTimer();
    const probe = await probeMediaFile(this.deps.config.media.ffmpegBin, path);
    const prepared = this.overlays.prepare();
    const signature = this.overlayRuntime.signature(prepared.filters, undefined);
    await this.stopSourceAndChatLocked();
    if (this.sink.running) await this.stopSinkLocked();
    this.buffer.reset();
    this.resetTimeline();
    this.overlayRuntime.stopEngine();
    this.overlayRuntime.resetMessages();
    this.applyConfiguredDelay();

    this.activeStreamer = null;
    this.activeMediaFile = file;
    this.activeKey = options.key;
    this.activeOverlayFilters = prepared.filters;
    this.activeOverlayInput = undefined;
    this.activeOverlaySignature = signature;
    this.startedAt = new Date();
    this.activeTitle = file;
    this.pauseReason = null;
    this.manualScreen = null;
    this.clearPauseLimit();
    this.reconnectAttempts = 0;
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
    this.source.start(synthetic, resolved, false, offset);
    this.startSinkOrPrefillLocked(options.key, prepared.filters, signature);
    this.markProducerStarted(offset);
    this.markSinkGrace();
    this.earnings.setActive();
    this.autoRefresh.stop();
    this.watchdog.reset();
    this.watchdog.clearError();
    this.playlistController.activate(options.playlist);
    this.transitionTo('live');
    this.emitAll();
    this.deps.logger.info({ file, playlist: options.playlist.playlist.id }, 'Lokales Video gestartet');
    return this.buildStatus();
  }

  private async startStreamerLocked(
    streamer: StreamerConfig,
    options: StartOptions,
  ): Promise<StatusSnapshot> {
    if (this.shuttingDown) throw new AppError('shutting_down', 'Der Dienst wird beendet', 503);
    this.clearSinkStartTimer();
    const key = options.key ?? resolveStreamKey(streamer).key;
    if (!key) throw new MissingStreamKeyError();
    this.deps.registerSecret(key);

    if (
      this.activeStreamer?.id === streamer.id &&
      this.state === 'live' &&
      this.activeKey === key &&
      !options.forceReencode
    ) {
      return this.buildStatus();
    }

    this.clearReconnectTimer();
    const previousState = this.state;
    this.transitionTo('starting');
    this.lastError = null;
    this.resolving = true;
    this.emitStatus();

    let stream: ResolvedStream;
    try {
      stream = await this.resolver.resolve(streamer);
    } catch (error) {
      this.resolving = false;
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
    this.resolving = false;

    const previousKey = this.activeKey;
    const prepared = this.overlays.prepare();
    const candidateEngine = this.overlayRuntime.createEngine();
    const overlayInput = candidateEngine?.panel;
    const signature = this.overlayRuntime.signature(prepared.filters, candidateEngine);
    const reusable =
      this.sink.running && previousKey === key && this.activeOverlaySignature === signature;
    const timestampOffset = reusable ? this.nextProducerOffset() : 0;

    await this.stopSourceAndChatLocked();

    if (!reusable) {
      this.buffer.reset();
      this.resetTimeline();
      if (previousKey && previousKey !== key) this.notifyYouTubeStopped(previousKey);
      if (this.sink.running) await this.stopSinkLocked();
      this.overlayRuntime.replaceEngine(candidateEngine);
    } else if (!this.overlayRuntime.engine && candidateEngine) {
      this.overlayRuntime.adoptEngine(candidateEngine, this.sink.overlayStream());
    }
    this.applyConfiguredDelay();

    this.activeStreamer = streamer;
    this.activeKey = key;
    this.activeOverlayFilters = prepared.filters;
    this.activeOverlayInput = overlayInput;
    this.activeOverlaySignature = signature;
    this.startedAt = new Date();
    this.activeTitle = stream.title;
    this.pauseReason = null;
    this.manualScreen = null;
    this.clearPauseLimit();
    this.reconnectAttempts = 0;
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
      await this.startupScreen.start(undefined, undefined, timestampOffset);
      this.markProducerStarted(timestampOffset);
      this.markSinkGrace();
      this.clearOfflinePauseTimer();
      this.earnings.setActive();
      this.watchdog.reset();
      this.watchdog.clearError();
      this.transitionTo('starting', 'startup screen');
      this.scheduleStartupFinishLocked(streamer, stream, introSeconds);
    } else {
      this.source.start(streamer, stream, this.forceReencodeNext, timestampOffset);
      this.markProducerStarted(timestampOffset);
      this.markSinkGrace();
      this.clearOfflinePauseTimer();
      this.overlayRuntime.startChat(streamer);
      this.earnings.setActive();
      this.autoRefresh.start();
      this.watchdog.reset();
      this.watchdog.clearError();
      this.transitionTo('live');
    }
    if (!reusable) {
      this.startSinkOrPrefillLocked(key, prepared.filters, signature, overlayInput);
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
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = setTimeout(() => {
      this.startupTimer = undefined;
      void this.lock.run(async () => {
        if (
          this.shuttingDown ||
          this.state !== 'starting' ||
          this.activeStreamer?.id !== streamer.id
        ) {
          return;
        }
        await this.startupScreen.stop();
        if (this.source.running) return;
        const offset = this.nextProducerOffset();
        this.source.start(streamer, stream, this.forceReencodeNext, offset);
        this.markProducerStarted(offset);
        this.markSinkGrace();
        this.clearOfflinePauseTimer();
        this.overlayRuntime.startChat(streamer);
        this.autoRefresh.start();
        this.transitionTo('live', 'startup finished');
        this.emitAll();
      });
    }, introSeconds * 1000);
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
    this.clearReconnectTimer();
    this.clearOfflinePauseTimer();
    const prepared = this.overlays.prepare();
    const candidateEngine = this.overlayRuntime.createEngine();
    const overlayInput = candidateEngine?.panel;
    const signature = this.overlayRuntime.signature(prepared.filters, candidateEngine);
    const reusable =
      this.sink.running && this.activeKey === key && this.activeOverlaySignature === signature;

    await this.stopSourceAndChatLocked();
    if (!reusable) {
      this.buffer.reset();
      this.resetTimeline();
      if (this.sink.running) await this.stopSinkLocked();
      this.overlayRuntime.replaceEngine(candidateEngine);
    } else if (!this.overlayRuntime.engine && candidateEngine) {
      this.overlayRuntime.adoptEngine(candidateEngine, this.sink.overlayStream());
    }

    this.activeStreamer = streamer;
    this.activeKey = key;
    this.activeOverlayFilters = prepared.filters;
    this.activeOverlayInput = overlayInput;
    this.activeOverlaySignature = signature;
    this.startedAt = new Date();
    this.activeTitle = streamer.name;
    this.reconnectAttempts = 0;
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

  private clearSinkStartTimer(): void {
    if (this.sinkStartTimer) clearTimeout(this.sinkStartTimer);
    this.sinkStartTimer = undefined;
    this.sinkStarting = false;
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
  ): void {
    this.clearSinkStartTimer();
    this.clearYouTubeStartTimer();
    this.activeKey = key;
    this.activeOverlayFilters = filters;
    this.activeOverlaySignature = signature;
    this.activeOverlayInput = overlayInput;
    const delaySeconds = this.settings.delay_buffer.enabled
      ? Math.max(0, this.settings.delay_buffer.size)
      : 0;
    const buffered = this.buffer?.stats().bufferSeconds ?? 0;
    const remaining = Math.max(0, delaySeconds - buffered);
    if (remaining <= 0) {
      this.startSinkLocked(key, filters, signature, overlayInput);
      return;
    }
    this.sinkStarting = true;
    this.deps.logger.info(
      { delaySeconds, bufferedSeconds: buffered, waitSeconds: remaining },
      'Sink startet nach Delay-Prefill',
    );
    this.sinkStartTimer = setTimeout(() => {
      this.sinkStartTimer = undefined;
      this.sinkStarting = false;
      void this.lock.run(async () => {
        if (this.shuttingDown || this.sink.running || this.activeKey !== key) return;
        if (!this.source.running && !this.pauseScreen.running && !this.startupScreen.running) {
          this.deps.logger.warn('Delay-Prefill beendet, aber keine Quelle aktiv');
          return;
        }
        this.startSinkLocked(key, filters, signature, overlayInput);
        this.emitAll();
      });
    }, remaining * 1000 + 250);
  }

  private startSinkLocked(
    key: string,
    filters: string[],
    signature: string,
    overlayInput?: SinkOverlayInput,
  ): void {
    this.clearSinkStartTimer();
    this.stoppingSink = false;
    this.activeKey = key;
    this.activeOverlayFilters = filters;
    this.activeOverlayInput = overlayInput;
    this.activeOverlaySignature = signature;
    const delay = this.settings.delay_buffer.enabled ? this.settings.delay_buffer.size : 0;
    this.sinkGraceUntil = Date.now() + (delay + 5) * 1000;
    this.sink.start(key, filters, overlayInput);
    this.scheduleYouTubeStarted(key);
    if (overlayInput) this.overlayRuntime.attachToSink(this.sink.overlayStream());
  }

  private async stopSinkLocked(): Promise<void> {
    this.clearSinkStartTimer();
    this.clearYouTubeStartTimer();
    this.stoppingSink = true;
    this.overlayRuntime.detachEngine();
    try {
      await this.sink.stop();
    } finally {
      this.stoppingSink = false;
    }
  }

  private async stopSourceAndChatLocked(): Promise<void> {
    this.activeMediaFile = null;
    this.overlayRuntime.stopChat();
    if (this.source.running || this.source.currentStreamer) {
      this.stoppingSource += 1;
      try {
        await this.source.stop();
      } finally {
        this.stoppingSource -= 1;
      }
    }
    if (this.pauseScreen.running) await this.pauseScreen.stop();
    if (this.startupScreen?.running) await this.startupScreen.stop();
  }

  private clearYouTubeStartTimer(): void {
    if (this.youtubeStartTimer) clearTimeout(this.youtubeStartTimer);
    this.youtubeStartTimer = undefined;
  }

  /**
   * The hook must run after the sink actually publishes, not when the source
   * starts. Otherwise YouTube sees an idle ingest and rejects the transition.
   */
  private scheduleYouTubeStarted(key: string): void {
    this.clearYouTubeStartTimer();
    if (!key) return;
    this.youtubeStartTimer = setTimeout(() => {
      this.youtubeStartTimer = undefined;
      if (this.shuttingDown || !this.sink.running || this.activeKey !== key) return;
      this.notifyYouTubeStarted(key);
    }, 5000);
    this.youtubeStartTimer.unref?.();
  }

  private notifyYouTubeStarted(key: string): void {
    const hook = this.deps.youtube?.streamStarted;
    if (!hook || !key) return;
    void Promise.resolve()
      .then(() => hook(key))
      .catch((error: unknown) => {
        this.deps.logger.warn({ err: toErrorMessage(error) }, 'YouTube-Autostart fehlgeschlagen');
      });
  }

  private notifyYouTubeStopped(key: string): void {
    const hook = this.deps.youtube?.streamStopped;
    if (!hook || !key) return;
    void Promise.resolve()
      .then(() => hook(key))
      .catch((error: unknown) => {
        this.deps.logger.warn({ err: toErrorMessage(error) }, 'YouTube-Autostop fehlgeschlagen');
      });
  }

  async stop(): Promise<StatusSnapshot> {
    return this.lock.run(() => this.stopInternalLocked());
  }

  private async stopInternalLocked(): Promise<StatusSnapshot> {
    this.clearYouTubeStartTimer();
    const stoppingKey = this.activeKey;
    this.transitionTo('stopping');
    this.pauseReason = null;
    this.manualScreen = null;
    this.clearAllTimers();
    this.autoRefresh.stop();
    this.watchdog.reset();
    await this.stopSourceAndChatLocked();
    await this.stopSinkLocked();
    // A container restart is not a user stop. Keep the broadcast for the next
    // start instead of completing it on every deploy.
    if (!this.shuttingDown) this.notifyYouTubeStopped(stoppingKey);
    this.overlayRuntime.stopEngine();
    this.buffer.reset();
    this.overlays.clear();
    this.overlayRuntime.resetMessages();
    this.activeStreamer = null;
    this.activeMediaFile = null;
    this.playlistController.detach();
    this.activeKey = '';
    this.activeOverlayFilters = [];
    this.activeOverlayInput = undefined;
    this.activeOverlaySignature = '';
    this.startedAt = null;
    this.activeTitle = '';
    this.lastError = null;
    this.forceReencodeNext = false;
    this.reconnectAttempts = 0;
    this.resetTimeline();
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
    if (this.activeStreamer && this.activeKey) {
      return { streamer: this.activeStreamer, key: this.activeKey };
    }
    const streamers = this.deps.store.list();
    const ordered = [
      ...streamers.filter((item) => item.enabled && item.preferred),
      ...streamers.filter((item) => item.enabled && !item.preferred),
      ...streamers.filter((item) => !item.enabled),
    ];
    for (const streamer of ordered) {
      const { key } = resolveStreamKey(streamer);
      if (key) return { streamer, key };
    }
    return { streamer: null, key: resolveStreamKey({}).key };
  }

  async showScreen(type: 'startup' | 'pause'): Promise<StatusSnapshot> {
    return this.lock.run(async () => {
      if (this.shuttingDown) {
        throw new AppError('shutting_down', 'Der Dienst wird beendet', 503);
      }
      if (type === 'startup' && !this.settings.startup.enabled) {
        throw new ValidationError('Der Startbildschirm ist in den Einstellungen deaktiviert');
      }
      if (type === 'pause' && !this.settings.pause.enabled) {
        throw new ValidationError('Der Pausenscreen ist in den Einstellungen deaktiviert');
      }
      this.clearStartupTimer();
      this.clearOfflinePauseTimer();
      this.clearPauseLimit();
      this.clearReconnectTimer();
      this.clearSinkStartTimer();
      await this.stopSourceAndChatLocked();

      let pendingSink: {
        key: string;
        filters: string[];
        signature: string;
        input?: SinkOverlayInput;
      } | null = null;

      if (this.activeStreamer && this.activeKey) {
        // Keep the existing sink so the RTMP connection survives the swap.
        if (!this.sink.running) {
          this.buffer.reset();
          this.resetTimeline();
          pendingSink = {
            key: this.activeKey,
            filters: this.activeOverlayFilters,
            signature: this.activeOverlaySignature,
            input: this.activeOverlayInput,
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
        if (!this.sink.running || this.activeKey !== target.key) {
          if (this.sink.running) await this.stopSinkLocked();
          this.overlayRuntime.stopEngine();
          this.overlayRuntime.resetMessages(false, false);
          this.buffer.reset();
          this.resetTimeline();
          const prepared = this.overlays.prepare();
          pendingSink = {
            key: target.key,
            filters: prepared.filters,
            signature: this.overlayRuntime.signature(prepared.filters, undefined),
          };
        }
      }
      this.applyConfiguredDelay();
      const offset = this.nextProducerOffset();
      const screen = type === 'startup' ? this.startupScreen : this.pauseScreen;
      await screen.start(undefined, undefined, offset);
      if (pendingSink) {
        this.startSinkOrPrefillLocked(
          pendingSink.key,
          pendingSink.filters,
          pendingSink.signature,
          pendingSink.input,
        );
      }
      this.markProducerStarted(offset);
      this.markSinkGrace();
      this.manualScreen = type;
      this.pauseReason = 'user';
      incMetric('manual_screens_total');
      this.transitionTo('paused', `manual ${type} screen`);
      this.autoRefresh.stop();
      this.emitAll();
      this.deps.logger.info(
        { screen: type, streamer: this.activeStreamer?.id ?? null },
        'Manueller Screen aktiviert',
      );
      return this.buildStatus();
    });
  }

  async hideScreen(): Promise<StatusSnapshot> {
    return this.lock.run(async () => {
      const streamer = this.activeStreamer;
      if (!streamer) {
        if (!this.manualScreen) return this.buildStatus();
        this.deps.logger.info({ screen: this.manualScreen }, 'Manueller Screen beendet');
        return this.stopInternalLocked();
      }
      if (this.state !== 'paused') return this.buildStatus();
      this.manualScreen = null;
      this.pauseReason = null;
      this.clearPauseLimit();
      this.clearStartupTimer();
      return this.startStreamerLocked(streamer, {
        key: this.activeKey,
        playlist: this.playlistController.current ?? undefined,
        allowOfflineWait: true,
        intro: false,
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

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private clearAllTimers(): void {
    this.clearReconnectTimer();
    this.clearSinkStartTimer();
    this.playlistController.clearTimers();
    if (this.sinkRestartTimer) clearTimeout(this.sinkRestartTimer);
    this.sinkRestartTimer = undefined;
    if (this.autoStartTimer) clearTimeout(this.autoStartTimer);
    this.autoStartTimer = undefined;
    if (this.pauseRestartTimer) clearTimeout(this.pauseRestartTimer);
    this.pauseRestartTimer = undefined;
    if (this.pauseLimitTimer) clearTimeout(this.pauseLimitTimer);
    this.pauseLimitTimer = undefined;
    this.clearStartupTimer();
    if (this.offlinePauseTimer) clearTimeout(this.offlinePauseTimer);
    this.offlinePauseTimer = undefined;
  }

  private handleSourceExit(
    code: number | null = null,
    signal: NodeJS.Signals | null = null,
  ): void {
    if (this.shuttingDown || this.stoppingSource > 0) return;
    if (this.activeMediaFile) {
      const file = this.activeMediaFile;
      this.activeMediaFile = null;
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
    this.reconnects += 1;
    this.lastError = 'Stream-Quelle beendet';
    this.scheduleOfflinePauseLocked();
    if (!this.settings.watchdog.auto_reconnect) {
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
    if (this.shuttingDown || !this.activeStreamer || this.reconnectTimer) return;
    incMetric('source_reconnects_total');
    this.reconnectAttempts += 1;
    const delay = reconnectDelay(this.reconnectAttempts, this.settings, delayMs);
    if (this.state !== 'paused') this.transitionTo('reconnecting', 'reconnect scheduled');
    this.emitStatus();
    this.deps.logger.info(
      { attempt: this.reconnectAttempts, delaySeconds: Math.round(delay / 100) / 10 },
      'Neuverbindung geplant',
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.reconnect();
    }, delay);
  }

  private async reconnect(): Promise<void> {
    await this.lock.run(async () => {
      if (this.shuttingDown || !this.activeStreamer) return;
      if (this.state === 'paused' && this.pauseReason === 'user') return;
      if (this.source.running) return;
      this.transitionTo('reconnecting');
      this.emitStatus();
      try {
        const stream = await this.resolver.resolve(this.activeStreamer);
        if (this.pauseScreen.running) await this.pauseScreen.stop();
        this.applyConfiguredDelay();
        const timestampOffset = this.nextProducerOffset();
        this.source.start(this.activeStreamer, stream, this.forceReencodeNext, timestampOffset);
        if (!this.sink.running && this.activeKey) {
          this.startSinkOrPrefillLocked(
            this.activeKey,
            this.activeOverlayFilters,
            this.activeOverlaySignature,
            this.activeOverlayInput,
          );
        }
        this.markProducerStarted(timestampOffset);
        this.markSinkGrace();
        this.applyConfiguredDelay();
        this.clearOfflinePauseTimer();
        this.activeTitle = stream.title;
        this.clearPauseLimit();
        this.pauseReason = null;
        this.manualScreen = null;
        this.lastError = null;
        this.reconnectAttempts = 0;
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
        const playlist = this.playlistController.current;
        if (error instanceof StreamerOfflineError && playlist) {
          if (playlist.playlist.auto_advance) {
            this.playlistController.scheduleAdvance();
            this.emitStatus();
            return;
          }
          if (this.settings.pause.enabled && this.sink.running && !this.pauseScreen.running) {
            await this.startPauseLocked();
          }
          this.emitStatus();
          this.scheduleReconnect(Math.max(30, this.settings.watchdog.max_reconnect_delay) * 1000);
          return;
        }
        if (
          error instanceof StreamerOfflineError &&
          this.settings.pause.enabled &&
          this.sink.running &&
          !this.pauseScreen.running &&
          this.reconnectAttempts >= 2
        ) {
          await this.startPauseLocked();
        }
        this.emitStatus();
        this.scheduleReconnect(error instanceof StreamerOfflineError ? 30_000 : undefined);
      }
    });
  }

  private async startPauseLocked(): Promise<void> {
    this.clearStartupTimer();
    if (this.startupScreen?.running) await this.startupScreen.stop();
    this.overlayRuntime.stopChat();
    this.applyConfiguredDelay();
    const timestampOffset = this.nextProducerOffset();
    await this.pauseScreen.start(undefined, undefined, timestampOffset);
    if (!this.sink.running && this.activeKey) {
      this.startSinkOrPrefillLocked(
        this.activeKey,
        this.activeOverlayFilters,
        this.activeOverlaySignature,
        this.activeOverlayInput,
      );
    }
    this.markProducerStarted(timestampOffset);
    this.markSinkGrace();
    this.pauseReason = 'offline';
    this.manualScreen = null;
    this.transitionTo('paused');
    incMetric('pause_starts_total');
    this.schedulePauseLimitLocked();
    this.deps.logger.info('Quelle offline – Pausenscreen aktiv');
  }

  private schedulePauseLimitLocked(): void {
    if (this.pauseLimitTimer) clearTimeout(this.pauseLimitTimer);
    this.pauseLimitTimer = undefined;
    const minutes = this.settings.pause.max_minutes;
    const delayMs = pauseLimitDelayMs(minutes);
    if (delayMs === null) return;
    this.pauseLimitTimer = setTimeout(() => {
      this.pauseLimitTimer = undefined;
      void this.lock.run(async () => {
        if (this.shuttingDown || this.state !== 'paused') return;
        incMetric('pause_limit_hits_total');
        this.deps.logger.warn({ minutes }, 'Maximale Pausendauer erreicht – Stream wird gestoppt');
        await this.stopInternalLocked();
      });
    }, delayMs);
  }

  private clearPauseLimit(): void {
    if (this.pauseLimitTimer) clearTimeout(this.pauseLimitTimer);
    this.pauseLimitTimer = undefined;
  }

  private clearOfflinePauseTimer(): void {
    if (this.offlinePauseTimer) clearTimeout(this.offlinePauseTimer);
    this.offlinePauseTimer = undefined;
  }

  private clearStartupTimer(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = undefined;
  }

  /**
   * If a reconnection takes longer than a few seconds, keep YouTube alive with
   * the pause screen instead of letting the encoder starve.
   */
  private scheduleOfflinePauseLocked(): void {
    if (this.offlinePauseTimer || !this.settings.pause.enabled || !this.sink.running) return;
    const delayMs = Math.max(0, this.settings.pause.grace_seconds) * 1000;
    this.offlinePauseTimer = setTimeout(() => {
      this.offlinePauseTimer = undefined;
      void this.lock.run(async () => {
        if (this.shuttingDown) return;
        if (this.source.running || this.pauseScreen.running || !this.sink.running) return;
        if (this.playlistController.isAdvancePending) return;
        if (!['live', 'starting', 'reconnecting', 'paused', 'error'].includes(this.state)) return;
        if (this.state === 'paused' && this.pauseReason === 'user') return;
        await this.startPauseLocked();
        this.emitAll();
      });
    }, delayMs);
  }

  private schedulePauseRestart(): void {
    if (this.pauseRestartTimer || this.shuttingDown) return;
    this.pauseRestartTimer = setTimeout(() => {
      this.pauseRestartTimer = undefined;
      void this.lock.run(async () => {
        if (this.shuttingDown || this.state !== 'paused' || this.pauseScreen.running) return;
        const timestampOffset = this.nextProducerOffset();
        await this.pauseScreen.start(undefined, undefined, timestampOffset);
        this.markProducerStarted(timestampOffset);
        this.emitStatus();
      });
    }, 2000);
  }

  private async refreshSource(reason: string): Promise<void> {
    await this.lock.run(async () => {
      const streamer = this.activeStreamer;
      if (!streamer || this.shuttingDown) return;
      if (!['live', 'paused'].includes(this.state)) return;
      this.deps.logger.info({ reason }, 'Quell-URL wird aktualisiert');
      try {
        const stream = await this.resolver.resolve(streamer);
        if (this.pauseScreen.running) await this.pauseScreen.stop();
        this.stoppingSource += 1;
        try {
          await this.source.stop();
        } finally {
          this.stoppingSource -= 1;
        }
        const timestampOffset = this.nextProducerOffset();
        this.source.start(streamer, stream, this.forceReencodeNext, timestampOffset);
        this.markProducerStarted(timestampOffset);
        this.markSinkGrace();
        this.applyConfiguredDelay();
        this.clearOfflinePauseTimer();
        this.activeTitle = stream.title;
        this.clearPauseLimit();
        this.pauseReason = null;
        this.manualScreen = null;
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
        if (!this.source.running && this.state === 'live') {
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
    if (this.shuttingDown || this.stoppingSource > 0 || !this.activeStreamer) return;
    this.deps.logger.warn({ line }, 'Quell-Codec wird nicht unterstützt – Re-Encoding-Fallback');
    this.forceReencodeNext = true;
    void (async () => {
      this.stoppingSource += 1;
      try {
        await this.source.stop();
      } finally {
        this.stoppingSource -= 1;
      }
      this.scheduleOfflinePauseLocked();
      this.scheduleReconnect(1000);
    })();
  }

  private handleSinkExit(): void {
    if (this.stoppingSink || this.shuttingDown) return;
    if (!this.activeStreamer || !this.activeKey) return;
    if (['idle', 'stopping'].includes(this.state)) return;
    this.overlayRuntime.detachEngine();
    this.deps.logger.warn('YouTube-Sink beendet – Neustart geplant');
    this.scheduleSinkRestart(3000);
  }

  private scheduleSinkRestart(delayMs: number): void {
    if (this.sinkRestartTimer || this.shuttingDown) return;
    this.sinkRestartTimer = setTimeout(() => {
      this.sinkRestartTimer = undefined;
      void this.lock.run(async () => {
        if (this.shuttingDown || !this.activeKey || ['idle', 'stopping'].includes(this.state))
          return;
        await this.restartSinkLocked();
      });
    }, delayMs);
  }

  private async restartSinkLocked(): Promise<void> {
    if (!this.activeKey) return;
    this.clearSinkStartTimer();
    incMetric('sink_restarts_total');
    if (this.sinkRestartTimer) {
      clearTimeout(this.sinkRestartTimer);
      this.sinkRestartTimer = undefined;
    }
    await this.stopSinkLocked();
    this.startSinkLocked(
      this.activeKey,
      this.activeOverlayFilters,
      this.activeOverlaySignature,
      this.activeOverlayInput,
    );
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
      this.stoppingSource += 1;
      try {
        await this.source.stop();
      } finally {
        this.stoppingSource -= 1;
      }
      this.scheduleOfflinePauseLocked();
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
      this.stoppingSource += 1;
      try {
        await this.source.stop();
      } finally {
        this.stoppingSource -= 1;
      }
      this.scheduleOfflinePauseLocked();
      this.scheduleReconnect(2000);
    });
  }

  private async handleSinkStall(ageSeconds: number): Promise<void> {
    await this.lock.run(async () => {
      if (this.shuttingDown || !this.activeKey) return;
      if (this.playlistController.isAdvancePending) return;
      const last = this.sink.lastProgressAt;
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
      this.sink.updateSettings(next);
      this.applyConfiguredDelay();
      this.buffer.setMaxBytes(this.bufferMaxBytes(next));
      this.watchdog.updateSettings(next);
      this.autoRefresh.updateSettings(next);
      this.online.updateSettings(next);
      this.overlays.updateSettings(next);
      this.overlayRuntime.updateSettings(next);
      this.pauseScreen.updateSettings(next);
      this.startupScreen.updateSettings(next);
      this.earnings.updateSettings(next);

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
        (this.manualScreen || this.activeMediaFile ? this.screenFallbackStreamer() : null);
      let needsSinkRestart = false;
      if (earningsOverlayChanged && overlayCarrier && !overlaysChanged) {
        const prepared = this.overlays.prepare();
        this.activeOverlayFilters = prepared.filters;
        this.activeOverlaySignature = this.overlayRuntime.signature(
          prepared.filters,
          this.activeStreamer ? this.overlayRuntime.engine : undefined,
        );
        needsSinkRestart = true;
      }

      if (overlaysChanged && overlayCarrier) {
        const prepared = this.overlays.prepare();
        this.activeOverlayFilters = prepared.filters;
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
        previous.video.preset !== next.video.preset;
      if (videoEncodeChanged) {
        this.rebuildChatEngineLocked();
        needsSinkRestart = true;
      }
      if (needsSinkRestart && this.sink.running) await this.restartSinkLocked();
      if (videoEncodeChanged && this.source.running && this.source.resolved) {
        const reencoding =
          this.activeStreamer?.video_mode === 'reencode' || !this.source.resolved.isH264;
        const resolved = this.source.resolved;
        if (reencoding && this.activeStreamer && resolved) {
          this.stoppingSource += 1;
          try {
            await this.source.stop();
          } finally {
            this.stoppingSource -= 1;
          }
          const timestampOffset = this.nextProducerOffset();
          this.source.start(this.activeStreamer, resolved, true, timestampOffset);
          this.markProducerStarted(timestampOffset);
          this.markSinkGrace();
          this.applyConfiguredDelay();
        }
      }
      if (this.state === 'paused') {
        const screen = this.startupScreen.running
          ? this.startupScreen
          : this.pauseScreen.running
            ? this.pauseScreen
            : null;
        if (screen) {
          await screen.stop();
          const timestampOffset = this.nextProducerOffset();
          await screen.start(undefined, undefined, timestampOffset);
          this.markProducerStarted(timestampOffset);
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
  }

  emitStatus(): void {
    this.deps.bus.emit({ type: 'status', data: this.buildStatus() });
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

  buildStatus(): StatusSnapshot {
    return buildStatusSnapshot({
      state: this.state,
      settings: this.settings,
      activeStreamer: this.activeStreamer,
      activePlaylist: this.playlistController.current,
      manualScreen: this.manualScreen,
      startedAt: this.startedAt,
      resolving: this.resolving,
      reconnects: this.reconnects,
      lastError: this.lastError,
      reconnecting: this.state === 'reconnecting' || Boolean(this.reconnectTimer),
      monitorOnline: this.activeStreamer
        ? (this.online?.isOnline(this.activeStreamer) ?? null)
        : null,
      source: this.source?.stats(),
      relay: this.relay?.stats(),
      delay: this.buffer?.stats(),
      sink: this.sink?.stats(),
      watchdog: this.watchdog?.stats(),
      autoRefresh: this.autoRefresh?.stats(),
      chat: this.chatStatus(),
      earnings: this.earnings?.get() ?? null,
    });
  }
}
