import { join } from 'node:path';
import { AppError, toErrorMessage } from '../../utils/errors.js';
import { incMetric } from '../metrics.js';
import type { Settings, StreamerConfig } from '../config/schema.js';
import type { StatusSnapshot, StreamState } from '../events.js';
import type { SinkOverlayInput } from '../source/ffmpeg.js';
import { DelayBuffer } from '../relay/delay-buffer.js';
import { MpegTsRelay } from '../relay/relay-server.js';
import { TikTokResolver } from '../source/resolver.js';
import { TikTokSource } from '../source/tiktok-source.js';
import { SourceSession } from './source-session.js';
import { YouTubeSink } from '../sink/youtube-sink.js';
import { SinkController } from './sink-controller.js';
import { OutputFanout } from './output-fanout.js';
import { OverlayManager } from '../overlays/overlay-manager.js';
import { PauseScreen } from '../overlays/pause-screen.js';
import { PauseController } from './pause-controller.js';
import { Watchdog } from './watchdog.js';
import { AutoRefresh } from './auto-refresh.js';
import { OnlineMonitor } from '../online/monitor.js';
import { EarningsHistoryStore } from '../earnings/history.js';
import { EarningsMonitor } from '../earnings/monitor.js';
import { OverlayRuntime } from './overlay-runtime.js';
import { ScreenPlaybackController } from './screen-controller.js';
import { SourceRecoveryController } from './source-recovery.js';
import { StreamerLauncher } from './streamer-launcher.js';
import { SinkWatchdogCoordinator } from './sink-watchdog-coordinator.js';
import { RtmpIngestServer } from '../ingest/rtmp-server.js';
import type { SupervisorDeps } from './supervisor.js';
import type { AsyncLock } from '../../utils/process.js';
import type { PlaylistController } from './playlist-controller.js';
import type { AutoSwitchController } from './auto-switch-controller.js';
import type { MediaPlaybackController } from './media-playback-controller.js';
import type { QueueController } from './queue-controller.js';

export interface SupervisorWiringHost {
  deps: SupervisorDeps;
  settings: Settings;
  lock: AsyncLock;
  state: StreamState;
  activeStreamer: StreamerConfig | null;
  startingStreamerId: string | null;
  activeTitle: string;
  startedAt: Date | null;
  lastError: string | null;
  forceReencodeNext: boolean;
  shuttingDown: boolean;
  playlistController: PlaylistController;
  autoSwitch: AutoSwitchController;
  media: MediaPlaybackController;
  queue: QueueController;

  bufferMaxBytes(settings: Settings): number;
  handleSourceExit(code: number | null, signal: NodeJS.Signals | null): void;
  handleCodecProblem(line: string): void;
  refreshSource(reason: string): Promise<void>;
  handleOnlineStatuses(): void;
  startPauseLocked(): Promise<void>;
  canStartOfflinePauseLocked(): boolean;
  stopInternalLocked(): Promise<void>;
  markSinkGrace(): void;
  applyConfiguredDelay(): void;
  startSinkOrPrefillLocked(
    key: string,
    filters: string[],
    signature: string,
    input?: SinkOverlayInput,
    logo?: SinkOverlayInput,
  ): void;
  stopSourceAndChatLocked(): Promise<void>;
  stopSinkLocked(): Promise<void>;
  returnToPreferredOriginLocked(reason: string): Promise<boolean>;
  scheduleReconnect(delayMs?: number): void;
  reencodeSource(reconnect: boolean): boolean;
  buildStatus(): StatusSnapshot;
  transitionTo(next: StreamState, reason?: string): void;
  emitStatus(): void;
  emitAll(): void;
}

export interface SupervisorSubsystems {
  buffer: DelayBuffer;
  relay: MpegTsRelay;
  sourceSession: SourceSession;
  sinkController: SinkController;
  outputFanout: OutputFanout;
  overlays: OverlayManager;
  pauseController: PauseController;
  watchdog: Watchdog;
  autoRefresh: AutoRefresh;
  online: OnlineMonitor;
  earnings: EarningsMonitor;
  overlayRuntime: OverlayRuntime;
  screenController: ScreenPlaybackController;
  sourceRecovery: SourceRecoveryController;
  streamerLauncher: StreamerLauncher;
  sinkWatchdog: SinkWatchdogCoordinator;
  rtmpIngest: RtmpIngestServer;
}

export async function createSupervisorSubsystems(
  host: SupervisorWiringHost,
): Promise<SupervisorSubsystems> {
  const { config, logger } = host.deps;
  const relayEndpoint = { host: config.media.relayHost, port: config.media.relayPort };

  const buffer = new DelayBuffer({
    host: relayEndpoint.host,
    port: relayEndpoint.port + 1,
    delaySeconds: host.settings.delay_buffer.size,
    enabled: host.settings.delay_buffer.enabled,
    maxBytes: host.bufferMaxBytes(host.settings),
    fallbackBitrateKbps: Math.round(host.settings.video.video_bitrate * 1.25),
    catchupRate: host.settings.delay_buffer.catchup_rate,
    logger,
  });
  try {
    await buffer.start();
  } catch (error) {
    throw new AppError(
      'relay_bind_failed',
      `Delay-Puffer konnte nicht auf Port ${relayEndpoint.port + 1} starten: ${toErrorMessage(error)}`,
      500,
    );
  }

  const relay = new MpegTsRelay({
    host: relayEndpoint.host,
    port: relayEndpoint.port,
    logger,
    buffer,
  });
  try {
    await relay.start();
  } catch (error) {
    await buffer.stop();
    throw new AppError(
      'relay_bind_failed',
      `MPEG-TS-Relay konnte nicht auf Port ${relayEndpoint.port} starten: ${toErrorMessage(error)}`,
      500,
    );
  }

  const resolver =
    host.deps.resolver ??
    new TikTokResolver({
      media: config.media,
      logger,
      cookiesFile: config.paths.cookiesFile,
      redact: host.deps.redact,
    });
  const source = new TikTokSource({
    media: config.media,
    settings: host.settings,
    relay: relayEndpoint,
    logger,
    redact: host.deps.redact,
    onExit: (code, signal) => host.handleSourceExit(code, signal),
    onCodecProblem: (line) => host.handleCodecProblem(line),
  });
  const sourceSession = new SourceSession({
    source,
    resolver,
    settings: host.settings,
  });

  let overlayRuntimeRef: OverlayRuntime | null = null;
  let sinkWatchdogRef: SinkWatchdogCoordinator | null = null;

  const sink = new YouTubeSink({
    media: config.media,
    settings: host.settings,
    relay: relayEndpoint,
    logger,
    redact: host.deps.redact,
    onExit: () => sinkWatchdogRef?.handleSinkExit(),
    onUnhealthy: (reason) => void sinkWatchdogRef?.handleSinkUnhealthy(reason),
    onSilenceChange: (active, since) => {
      host.emitAll();
      if (active) {
        host.deps.webhooks?.notify(
          'audio_silence',
          'Audio-Stille erkannt',
          'Am YouTube-Sink wurde anhaltende Audio-Stille erkannt.',
          { since: since?.toISOString() ?? null },
        );
      }
    },
  });

  let pauseControllerRef: PauseController | null = null;

  const sinkController = new SinkController({
    sink,
    settings: host.settings,
    logger,
    lock: host.lock,
    isShuttingDown: () => host.shuttingDown,
    canStartDelayed: () =>
      sourceSession.running ||
      (pauseControllerRef?.pauseRunning ?? false) ||
      (pauseControllerRef?.startupRunning ?? false),
    onStarted: () =>
      overlayRuntimeRef?.attachToSink(
        sinkController.overlayStream(),
        sinkController.logoStream(),
      ),
    onStopping: () => overlayRuntimeRef?.detachEngine(),
    onPrefillDone: () => host.emitAll(),
    youtube: () => host.deps.youtube,
  });

  const outputFanout = new OutputFanout({
    config,
    settings: host.settings,
    relay,
    logger,
    redact: host.deps.redact,
    registerSecret: host.deps.registerSecret,
  });
  if (host.settings.webhooks.url) {
    host.deps.registerSecret?.(host.settings.webhooks.url);
  }
  if (host.settings.webhooks.secret) {
    host.deps.registerSecret?.(host.settings.webhooks.secret);
  }

  const overlays = new OverlayManager(
    { media: config.media, overlaysDir: config.paths.overlaysDir, logger },
    host.settings,
  );

  const pauseScreen = new PauseScreen({
    media: config.media,
    settings: host.settings,
    relay: relayEndpoint,
    logger,
    overlaysDir: config.paths.overlaysDir,
    fontFile: overlays.font,
    redact: host.deps.redact,
    onExit: () => {
      if (!host.shuttingDown && host.state === 'paused') {
        host.deps.logger.warn('Pausenscreen unerwartet beendet – Neustart wird geplant');
        pauseControllerRef?.handlePauseScreenExit();
      }
    },
  });
  const startupScreen = new PauseScreen({
    media: config.media,
    settings: host.settings,
    relay: relayEndpoint,
    logger,
    overlaysDir: config.paths.overlaysDir,
    fontFile: overlays.font,
    screen: 'startup',
    redact: host.deps.redact,
  });

  const pauseController = new PauseController({
    pauseScreen,
    startupScreen,
    settings: host.settings,
    logger,
    lock: host.lock,
    hooks: {
      isShuttingDown: () => host.shuttingDown,
      isPaused: () => host.state === 'paused',
      nextOffset: () => sourceSession.nextOffset(),
      markProducerStarted: (offset) => sourceSession.markProducerStarted(offset),
      emitStatus: () => host.emitStatus(),
      emitAll: () => host.emitAll(),
      canScheduleOfflinePause: () => sinkController.running,
      canStartOfflinePause: () => host.canStartOfflinePauseLocked(),
      startOfflinePause: () => host.startPauseLocked(),
      onPauseLimit: async () => {
        incMetric('pause_limit_hits_total');
        host.deps.webhooks?.notify(
          'pause_limit',
          'Pausen-Limit erreicht',
          `Stream wurde nach ${host.settings.pause.max_minutes} Minuten Pause gestoppt.`,
          { streamer: host.activeStreamer?.id ?? null },
        );
        await host.stopInternalLocked();
      },
    },
  });
  pauseControllerRef = pauseController;

  const watchdog = new Watchdog({
    settings: host.settings,
    logger,
    snapshot: () => ({
      state: host.state,
      relayLastDataAt: relay.lastData,
      sinkRunning: sinkController.running,
      sinkStarting: sinkController.starting,
      sinkLastProgressAt: sinkController.lastProgressAt,
      sourceRunning: sourceSession.running,
      sourceStartedAt: sourceSession.startedAt,
      sinkStartedAt: sinkController.startedAt,
      sourceBitrateKbps: sourceSession.bitrateKbps ?? buffer?.stats().pacingKbps ?? null,
      sourceOutputSeconds: sourceSession.outputTimeSeconds,
      suppressStall: host.playlistController.isAdvancePending,
      sinkGraceUntil: sinkController.graceUntil,
    }),
    onRelayStall: (age) => void sinkWatchdogRef?.handleRelayStall(age),
    onSinkDown: () => sinkWatchdogRef?.scheduleSinkRestart(1000),
    onSinkStall: (age) => void sinkWatchdogRef?.handleSinkStall(age),
    onLowBitrate: (kbps) => void sinkWatchdogRef?.handleLowBitrate(kbps),
    onLowSourceRate: (percent) => void sinkWatchdogRef?.handleLowSourceRate(percent),
  });

  const autoRefresh = new AutoRefresh({
    settings: host.settings,
    logger,
    onRefresh: () => host.refreshSource('auto_refresh'),
  });

  const online = new OnlineMonitor({
    settings: host.settings,
    logger,
    onStatuses: () => {
      host.handleOnlineStatuses();
    },
    listStreamers: () => host.deps.store.list(),
    cookiesFile: config.paths.cookiesFile,
    userAgent: config.media.sourceUserAgent,
  });

  const earningsHistory = new EarningsHistoryStore(
    join(config.paths.dataDir, 'earnings-history.json'),
    logger,
  );
  const earnings = new EarningsMonitor({
    settings: host.settings,
    logger,
    history: earningsHistory,
    getActive: () => host.activeStreamer,
    onUpdate: (snapshot, overlayText) => {
      overlays.updateEarnings(overlayText);
      overlayRuntimeRef?.updateEarnings(snapshot);
      host.deps.bus.emit({ type: 'earnings', data: snapshot });
    },
  });

  const overlayRuntime = new OverlayRuntime({
    settings: host.settings,
    overlays,
    earnings,
    logger,
    logoPath: join(config.paths.webDir, 'logo.png'),
    cookiesFile: config.paths.cookiesFile,
  });
  overlayRuntimeRef = overlayRuntime;
  await overlayRuntime.loadLogo();

  const sinkWatchdog = new SinkWatchdogCoordinator({
    sinkController,
    sourceSession,
    pauseController,
    playlistController: host.playlistController,
    overlayRuntime,
    relay,
    lock: host.lock,
    logger,
    webhooks: host.deps.webhooks,
    getSettings: () => host.settings,
    getState: () => host.state,
    getActiveStreamer: () => host.activeStreamer,
    isShuttingDown: () => host.shuttingDown,
    setLastError: (err) => {
      host.lastError = err;
    },
    scheduleReconnect: (delayMs) => host.scheduleReconnect(delayMs),
    emitAll: () => host.emitAll(),
  });
  sinkWatchdogRef = sinkWatchdog;

  const screenController = new ScreenPlaybackController({
    pauseController,
    sinkController,
    sourceSession,
    buffer,
    overlays,
    overlayRuntime,
    queue: host.queue,
    store: host.deps.store,
    logger,
    registerSecret: (s) => host.deps.registerSecret(s),
    transitionTo: (state, reason) => host.transitionTo(state, reason),
    markSinkGrace: () => host.markSinkGrace(),
    applyConfiguredDelay: () => host.applyConfiguredDelay(),
    startSinkOrPrefill: (key, filters, sig, input, logo) =>
      host.startSinkOrPrefillLocked(key, filters, sig, input, logo),
    stopSourceAndChat: () => host.stopSourceAndChatLocked(),
    stopSink: () => host.stopSinkLocked(),
    autoRefresh,
    emitAll: () => host.emitAll(),
    isShuttingDown: () => host.shuttingDown,
    getSettings: () => host.settings,
  });

  const sourceRecovery = new SourceRecoveryController({
    sourceSession,
    pauseController,
    sinkController,
    overlayRuntime,
    autoRefresh,
    playlistController: host.playlistController,
    autoSwitch: host.autoSwitch,
    media: host.media,
    watchdog,
    lock: host.lock,
    logger,
    webhooks: host.deps.webhooks,
    getSettings: () => host.settings,
    getActiveStreamer: () => host.activeStreamer,
    getState: () => host.state,
    isShuttingDown: () => host.shuttingDown,
    transitionTo: (state, reason) => host.transitionTo(state, reason),
    emitStatus: () => host.emitStatus(),
    emitAll: () => host.emitAll(),
    applyConfiguredDelay: () => host.applyConfiguredDelay(),
    markSinkGrace: () => host.markSinkGrace(),
    startSinkOrPrefill: (key, filters, sig, input, logo) =>
      host.startSinkOrPrefillLocked(key, filters, sig, input, logo),
    returnToPreferredOrigin: (reason) => host.returnToPreferredOriginLocked(reason),
    setLastError: (err) => {
      host.lastError = err;
    },
    setActiveTitle: (title) => {
      host.activeTitle = title;
    },
    isForceReencodeNext: () => host.forceReencodeNext,
    setForceReencodeNext: (val) => {
      host.forceReencodeNext = val;
    },
  });

  const streamerLauncher = new StreamerLauncher({
    sourceSession,
    sinkController,
    overlayRuntime,
    overlays,
    pauseController,
    buffer,
    autoRefresh,
    watchdog,
    earnings,
    playlistController: host.playlistController,
    autoSwitch: host.autoSwitch,
    media: host.media,
    queue: host.queue,
    lock: host.lock,
    logger,
    registerSecret: (s) => host.deps.registerSecret(s),
    getSettings: () => host.settings,
    getState: () => host.state,
    isShuttingDown: () => host.shuttingDown,
    transitionTo: (state, reason) => host.transitionTo(state, reason),
    emitStatus: () => host.emitStatus(),
    emitAll: () => host.emitAll(),
    applyConfiguredDelay: () => host.applyConfiguredDelay(),
    markSinkGrace: () => host.markSinkGrace(),
    startSinkOrPrefill: (key, filters, sig, input, logo) =>
      host.startSinkOrPrefillLocked(key, filters, sig, input, logo),
    stopSourceAndChat: () => host.stopSourceAndChatLocked(),
    stopSink: () => host.stopSinkLocked(),
    startPauseLocked: () => host.startPauseLocked(),
    scheduleReconnect: (delayMs) => host.scheduleReconnect(delayMs),
    reencodeSource: (reconnect) => host.reencodeSource(reconnect),
    buildStatus: () => host.buildStatus(),
    getActiveStreamer: () => host.activeStreamer,
    setActiveStreamer: (streamer) => {
      host.activeStreamer = streamer;
    },
    setActiveTitle: (title) => {
      host.activeTitle = title;
    },
    setStartedAt: (date) => {
      host.startedAt = date;
    },
    setLastError: (err) => {
      host.lastError = err;
    },
    setForceReencodeNext: (val) => {
      host.forceReencodeNext = val;
    },
    setStartingStreamerId: (id) => {
      host.startingStreamerId = id;
    },
  });

  const rtmpIngest = new RtmpIngestServer({
    settings: host.settings.rtmp_ingest,
    relay: relayEndpoint,
    logger,
    ffmpegLogLevel: config.media.ffmpegLogLevel,
  });

  return {
    buffer,
    relay,
    sourceSession,
    sinkController,
    outputFanout,
    overlays,
    pauseController,
    watchdog,
    autoRefresh,
    online,
    earnings,
    overlayRuntime,
    screenController,
    sourceRecovery,
    streamerLauncher,
    sinkWatchdog,
    rtmpIngest,
  };
}
