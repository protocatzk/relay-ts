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
import { isoOrNull } from '../../utils/format.js';
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
import { ChatService } from '../overlays/chat-service.js';
import { PauseScreen } from '../overlays/pause-screen.js';
import { OnlineMonitor } from '../online/monitor.js';
import { Watchdog } from './watchdog.js';
import { AutoRefresh } from './auto-refresh.js';

export interface SupervisorDeps {
  config: LoadedConfig;
  settingsService: SettingsService;
  store: StreamerStore;
  logger: Logger;
  bus: EventBus;
  redact: (text: string) => string;
  registerSecret: (secret: string | undefined) => void;
}

export interface PlaylistView {
  id: string;
  name: string;
  channels: string[];
  auto_advance: boolean;
  wrap: boolean;
  advance_delay_seconds: number;
  end_after_minutes: number | null;
  youtube_key_set: boolean;
  active: boolean;
  index: number | null;
}

interface PlaylistState {
  playlist: PlaylistConfig;
  index: number;
}

interface StartOptions {
  key?: string;
  playlist?: PlaylistState;
  forceReencode?: boolean;
  allowOfflineWait?: boolean;
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
  private resolver!: TikTokResolver;
  private source!: TikTokSource;
  private sink!: YouTubeSink;
  private overlays!: OverlayManager;
  private pauseScreen!: PauseScreen;
  private watchdog!: Watchdog;
  private autoRefresh!: AutoRefresh;
  private online!: OnlineMonitor;
  private chat?: ChatService;

  private state: StreamState = 'idle';
  private activeStreamer: StreamerConfig | null = null;
  private activePlaylist: PlaylistState | null = null;
  private activeKey = '';
  private activeOverlayFilters: string[] = [];
  private activeOverlaySignature = '';
  private startedAt: Date | null = null;
  private lastError: string | null = null;
  private reconnects = 0;
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private sinkRestartTimer?: NodeJS.Timeout;
  private playlistAdvanceTimer?: NodeJS.Timeout;
  private playlistEndTimer?: NodeJS.Timeout;
  private playlistEndAt: number | null = null;
  private playlistAdvancePending = false;
  private pauseRestartTimer?: NodeJS.Timeout;
  private offlinePauseTimer?: NodeJS.Timeout;
  private statusTimer?: NodeJS.Timeout;
  private autoStartTimer?: NodeJS.Timeout;
  private stoppingSource = 0;
  private stoppingSink = false;
  private shuttingDown = false;
  private pauseReason: 'user' | 'offline' | null = null;
  private forceReencodeNext = false;
  private resolving = false;
  private producerStartedAt: number | null = null;
  private producerOffset = 0;
  private sinkGraceUntil = 0;

  constructor(deps: SupervisorDeps) {
    this.deps = deps;
    this.settings = deps.settingsService.get();
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

    this.resolver = new TikTokResolver({
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
      onExit: () => this.handleSourceExit(),
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
      fontFile: this.overlays.font,
      redact: this.deps.redact,
      onExit: () => {
        if (!this.shuttingDown && this.state === 'paused') {
          this.deps.logger.warn('Pausenscreen unerwartet beendet – Neustart wird geplant');
          this.schedulePauseRestart();
        }
      },
    });
    this.watchdog = new Watchdog({
      settings: this.settings,
      logger,
      snapshot: () => ({
        state: this.state,
        relayLastDataAt: this.relay.lastData,
        sinkRunning: this.sink.running,
        sinkLastProgressAt: this.sink.lastProgressAt,
        sourceRunning: this.source.running,
        sourceStartedAt: this.source.startedAt,
        sinkStartedAt: this.sink.startedAt,
        sourceBitrateKbps: this.source.bitrateKbps ?? this.buffer?.stats().pacingKbps ?? null,
        suppressStall: this.playlistAdvancePending,
        sinkGraceUntil: this.sinkGraceUntil,
      }),
      onRelayStall: (age) => void this.handleRelayStall(age),
      onSinkDown: () => this.scheduleSinkRestart(1000),
      onSinkStall: (age) => void this.handleSinkStall(age),
      onLowBitrate: (kbps) => void this.handleLowBitrate(kbps),
    });
    this.autoRefresh = new AutoRefresh({
      settings: this.settings,
      logger,
      onRefresh: () => this.refreshSource('auto_refresh'),
    });
    this.online = new OnlineMonitor({
      settings: this.settings,
      logger,
      onStatuses: () => this.emitStreamers(),
    });
    this.online.start();
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
          this.deps.logger.warn({ binary: name, code: result.code }, 'Externe Abhängigkeit antwortet unerwartet');
        }
      } catch (error) {
        this.deps.logger.warn(
          { binary: name, err: toErrorMessage(error) },
          `${name} ist nicht verfügbar – Streaming wird fehlschlagen (Docker-Image verwenden oder Binary installieren)`,
        );
      }
    }
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

  private async startStreamerLocked(streamer: StreamerConfig, options: StartOptions): Promise<StatusSnapshot> {
    if (this.shuttingDown) throw new AppError('shutting_down', 'Der Dienst wird beendet', 503);
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
    this.state = 'starting';
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
      this.state =
        previousState === 'live' || previousState === 'paused' ? previousState : 'error';
      this.emitAll();
      throw error;
    }
    this.resolving = false;

    const previousKey = this.activeKey;
    const prepared = this.overlays.prepare(streamer);
    const signature = prepared.filters.join('|');
    const reusable =
      this.sink.running && previousKey === key && this.activeOverlaySignature === signature;
    const timestampOffset = reusable ? this.nextProducerOffset() : 0;

    await this.stopSourceAndChatLocked();

    if (!reusable) {
      this.buffer.reset();
      this.resetTimeline();
      if (this.sink.running) await this.stopSinkLocked();
      this.startSinkLocked(key, prepared.filters, signature);
    }
    this.applyConfiguredDelay();

    this.activeStreamer = streamer;
    this.activeKey = key;
    this.activeOverlayFilters = prepared.filters;
    this.activeOverlaySignature = signature;
    this.activePlaylist = options.playlist ?? null;
    this.startedAt = new Date();
    this.pauseReason = null;
    this.reconnectAttempts = 0;
    this.forceReencodeNext = options.forceReencode ?? false;

    this.source.start(streamer, stream, this.forceReencodeNext, timestampOffset);
    this.markProducerStarted(timestampOffset);
    this.markSinkGrace();
    this.clearOfflinePauseTimer();
    this.startChatLocked(streamer);
    this.autoRefresh.start();
    this.watchdog.reset();
    this.watchdog.clearError();
    if (options.playlist) {
      if (this.playlistAdvanceTimer) clearTimeout(this.playlistAdvanceTimer);
      this.playlistAdvanceTimer = undefined;
      this.playlistAdvancePending = false;
      if (this.playlistEndAt === null && options.playlist.playlist.end_after_minutes) {
        this.playlistEndAt =
          Date.now() + options.playlist.playlist.end_after_minutes * 60_000;
      }
      this.schedulePlaylistEndLocked();
    } else {
      this.clearPlaylistTimers();
    }
    this.state = 'live';
    this.emitAll();
    this.deps.logger.info(
      { streamer: streamer.id, key: '***', reusedSink: reusable },
      'Stream gestartet',
    );
    return this.buildStatus();
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
    const prepared = this.overlays.prepare(streamer);
    const signature = prepared.filters.join('|');
    const reusable =
      this.sink.running && this.activeKey === key && this.activeOverlaySignature === signature;

    await this.stopSourceAndChatLocked();
    if (!reusable) {
      this.buffer.reset();
      this.resetTimeline();
      if (this.sink.running) await this.stopSinkLocked();
      this.startSinkLocked(key, prepared.filters, signature);
    }

    this.activeStreamer = streamer;
    this.activeKey = key;
    this.activeOverlayFilters = prepared.filters;
    this.activeOverlaySignature = signature;
    this.activePlaylist = options.playlist ?? null;
    this.startedAt = new Date();
    this.reconnectAttempts = 0;
    this.forceReencodeNext = false;
    this.applyConfiguredDelay();
    this.autoRefresh.stop();
    this.watchdog.reset();
    this.watchdog.clearError();

    if (options.playlist) {
      if (this.playlistEndAt === null && options.playlist.playlist.end_after_minutes) {
        this.playlistEndAt =
          Date.now() + options.playlist.playlist.end_after_minutes * 60_000;
      }
      this.schedulePlaylistEndLocked();
    } else {
      this.clearPlaylistTimers();
    }

    this.startPauseLocked();
    this.lastError = message;
    this.emitAll();
    this.scheduleReconnect(30_000);
    this.deps.logger.info(
      { streamer: streamer.id, err: message },
      'Streamer offline – Wartemodus mit Pausenscreen',
    );
  }

  private startSinkLocked(key: string, filters: string[], signature: string): void {    this.stoppingSink = false;
    this.activeKey = key;
    this.activeOverlayFilters = filters;
    this.activeOverlaySignature = signature;
    const delay = this.settings.delay_buffer.enabled ? this.settings.delay_buffer.size : 0;
    this.sinkGraceUntil = Date.now() + (delay + 5) * 1000;
    this.sink.start(key, filters);
  }

  private async stopSinkLocked(): Promise<void> {
    this.stoppingSink = true;
    try {
      await this.sink.stop();
    } finally {
      this.stoppingSink = false;
    }
  }

  private async stopSourceAndChatLocked(): Promise<void> {
    if (this.chat) {
      this.chat.stop();
      this.chat = undefined;
    }
    if (this.source.running || this.source.currentStreamer) {
      this.stoppingSource += 1;
      try {
        await this.source.stop();
      } finally {
        this.stoppingSource -= 1;
      }
    }
    if (this.pauseScreen.running) await this.pauseScreen.stop();
  }

  private startChatLocked(streamer: StreamerConfig): void {
    this.chat?.stop();
    this.chat = new ChatService({
      streamer,
      settings: this.settings,
      logger: this.deps.logger,
      onMessages: (messages) => this.overlays.updateChat(messages),
    });
    this.chat.start();
  }

  async stop(): Promise<StatusSnapshot> {
    return this.lock.run(() => this.stopInternalLocked());
  }

  private async stopInternalLocked(): Promise<StatusSnapshot> {
    this.state = 'stopping';
    this.pauseReason = null;
    this.clearAllTimers();
    this.autoRefresh.stop();
    this.watchdog.reset();
    await this.stopSourceAndChatLocked();
    await this.stopSinkLocked();
    this.buffer.reset();
    this.overlays.clear();
    this.activeStreamer = null;
    this.activePlaylist = null;
    this.activeKey = '';
    this.activeOverlayFilters = [];
    this.activeOverlaySignature = '';
    this.startedAt = null;
    this.lastError = null;
    this.forceReencodeNext = false;
    this.reconnectAttempts = 0;
    this.resetTimeline();
    this.state = 'idle';
    this.emitAll();
    this.deps.logger.info('Stream gestoppt');
    return this.buildStatus();
  }

  async pause(): Promise<StatusSnapshot> {
    return this.lock.run(async () => {
      if (!this.activeStreamer || !this.activeKey) {
        throw new ValidationError('Es läuft kein Stream, der pausiert werden kann');
      }
      if (!this.settings.pause.enabled) {
        throw new ValidationError('Der Pausenscreen ist in den Einstellungen deaktiviert');
      }
      if (this.state === 'paused' && this.pauseScreen.running) {
        return this.buildStatus();
      }
      this.clearReconnectTimer();
      this.pauseReason = 'user';
      this.clearOfflinePauseTimer();
      await this.stopSourceAndChatLocked();
      if (!this.sink.running) {
        this.buffer.reset();
        this.resetTimeline();
        this.startSinkLocked(this.activeKey, this.activeOverlayFilters, this.activeOverlaySignature);
      }
      this.applyConfiguredDelay();
      const timestampOffset = this.nextProducerOffset();
      this.pauseScreen.start(undefined, undefined, timestampOffset);
      this.markProducerStarted(timestampOffset);
      this.markSinkGrace();
      this.state = 'paused';
      this.autoRefresh.stop();
      this.emitAll();
      this.deps.logger.info('Stream pausiert');
      return this.buildStatus();
    });
  }

  async resume(): Promise<StatusSnapshot> {
    return this.lock.run(async () => {
      const streamer = this.activeStreamer;
      if (!streamer) throw new ValidationError('Es ist kein Streamer aktiv');
      if (this.state !== 'paused') return this.buildStatus();
      this.pauseReason = null;
      return this.startStreamerLocked(streamer, {
        key: this.activeKey,
        playlist: this.activePlaylist ?? undefined,
        allowOfflineWait: true,
      });
    });
  }

  async playPlaylist(id: string): Promise<StatusSnapshot> {
    return this.lock.run(async () => {
      const playlist = this.deps.store.playlist(id);
      if (!playlist) throw new NotFoundError(`Playlist "${id}" wurde nicht gefunden`);
      this.clearPlaylistTimers();
      this.playlistEndAt = playlist.end_after_minutes
        ? Date.now() + playlist.end_after_minutes * 60_000
        : null;
      return this.startPlaylistEntryLocked(playlist, 0);
    });
  }

  async playlistNext(): Promise<StatusSnapshot> {
    return this.lock.run(async () => {
      if (!this.activePlaylist) throw new ValidationError('Es ist keine Playlist aktiv');
      return this.advancePlaylistLocked('manual');
    });
  }

  async stopPlaylist(): Promise<StatusSnapshot> {
    return this.stop();
  }

  private async startPlaylistEntryLocked(
    playlist: PlaylistConfig,
    startIndex: number,
  ): Promise<StatusSnapshot> {
    const { channels } = playlist;
    if (channels.length === 0) throw new ValidationError('Die Playlist enthält keine Kanäle');
    let index = startIndex;
    let tried = 0;
    let lastError: string | null = null;
    while (tried < channels.length) {
      if (index >= channels.length) {
        if (playlist.wrap && tried > 0) {
          index = 0;
        } else {
          break;
        }
      }
      const channel = channels[index]!;
      const streamer = this.resolvePlaylistChannel(channel);
      const key = resolveStreamKey(playlist).key || resolveStreamKey(streamer).key;
      tried += 1;
      if (!streamer.enabled || !key) {
        index += 1;
        continue;
      }
      try {
        return await this.startStreamerLocked(streamer, {
          key,
          playlist: { playlist, index },
        });
      } catch (error) {
        lastError = toErrorMessage(error);
        this.deps.logger.warn(
          { playlist: playlist.id, channel: streamer.id, err: lastError },
          'Playlist-Eintrag konnte nicht gestartet werden',
        );
        if (!(error instanceof StreamerOfflineError)) throw error;
        index += 1;
      }
    }
    await this.stopInternalLocked();
    this.lastError = lastError ?? 'Kein Streamer der Playlist ist verfügbar';
    this.state = 'error';
    this.emitAll();
    throw new StreamerOfflineError(this.lastError);
  }

  private resolvePlaylistChannel(channel: string): StreamerConfig {
    const existing = this.deps.store.findForChannel(channel);
    if (existing) return existing;
    const handle = channel.replace(/^@+/, '');
    const id = handle
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
    return StreamerSchema.parse({
      id: id || `channel-${Date.now()}`,
      name: handle,
      tiktok: handle,
      quality: 'best',
      enabled: true,
    });
  }

  private async advancePlaylistLocked(reason: 'manual' | 'offline' | 'end_after'): Promise<StatusSnapshot> {
    const state = this.activePlaylist;
    if (!state) throw new ValidationError('Es ist keine Playlist aktiv');
    const playlist = this.deps.store.playlist(state.playlist.id) ?? state.playlist;
    if (reason === 'end_after') {
      return this.stopInternalLocked();
    }
    if (this.playlistAdvanceTimer) clearTimeout(this.playlistAdvanceTimer);
    this.playlistAdvanceTimer = undefined;
    this.playlistAdvancePending = false;
    const nextIndex = state.index + 1;
    if (nextIndex >= playlist.channels.length && !playlist.wrap) {
      this.deps.logger.info({ playlist: playlist.id }, 'Playlist beendet');
      return this.stopInternalLocked();
    }
    return this.startPlaylistEntryLocked(playlist, nextIndex >= playlist.channels.length ? 0 : nextIndex);
  }

  private schedulePlaylistAdvanceLocked(): void {
    if (!this.activePlaylist || !this.activePlaylist.playlist.auto_advance) return;
    if (this.playlistAdvanceTimer) return;
    const delay = Math.max(0, this.activePlaylist.playlist.advance_delay_seconds) * 1000;
    this.playlistAdvancePending = true;
    this.state = 'reconnecting';
    this.emitStatus();
    this.deps.logger.info(
      { playlist: this.activePlaylist.playlist.id, delaySeconds: delay / 1000 },
      'Playlist wechselt zum nächsten Kanal',
    );
    this.playlistAdvanceTimer = setTimeout(() => {
      this.playlistAdvanceTimer = undefined;
      this.playlistAdvancePending = false;
      this.state = 'starting';
      this.emitStatus();
      void this.lock.run(async () => {
        if (!this.activePlaylist || this.shuttingDown) return;
        try {
          await this.advancePlaylistLocked('offline');
        } catch (error) {
          this.lastError = toErrorMessage(error);
          this.state = 'error';
          this.emitAll();
        }
      });
    }, delay);
  }

  private schedulePlaylistEndLocked(): void {
    if (this.playlistEndTimer) clearTimeout(this.playlistEndTimer);
    this.playlistEndTimer = undefined;
    if (!this.playlistEndAt) return;
    const delay = Math.max(0, this.playlistEndAt - Date.now());
    this.playlistEndTimer = setTimeout(() => {
      this.playlistEndTimer = undefined;
      void this.lock.run(async () => {
        if (!this.activePlaylist || this.shuttingDown) return;
        this.deps.logger.info(
          { playlist: this.activePlaylist.playlist.id },
          'Playlist-Endzeit erreicht',
        );
        await this.stopInternalLocked();
      });
    }, delay);
  }

  private clearPlaylistTimers(): void {
    if (this.playlistAdvanceTimer) clearTimeout(this.playlistAdvanceTimer);
    if (this.playlistEndTimer) clearTimeout(this.playlistEndTimer);
    this.playlistAdvanceTimer = undefined;
    this.playlistEndTimer = undefined;
    this.playlistAdvancePending = false;
    this.playlistEndAt = null;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private clearAllTimers(): void {
    this.clearReconnectTimer();
    this.clearPlaylistTimers();
    if (this.sinkRestartTimer) clearTimeout(this.sinkRestartTimer);
    this.sinkRestartTimer = undefined;
    if (this.autoStartTimer) clearTimeout(this.autoStartTimer);
    this.autoStartTimer = undefined;
    if (this.pauseRestartTimer) clearTimeout(this.pauseRestartTimer);
    this.pauseRestartTimer = undefined;
    if (this.offlinePauseTimer) clearTimeout(this.offlinePauseTimer);
    this.offlinePauseTimer = undefined;
  }

  private handleSourceExit(): void {
    if (this.shuttingDown || this.stoppingSource > 0) return;
    if (!this.activeStreamer) return;
    if (!['live', 'starting'].includes(this.state)) return;
    this.reconnects += 1;
    this.lastError = 'Stream-Quelle beendet';
    if (!this.settings.watchdog.auto_reconnect) {
      this.state = 'error';
      this.emitAll();
      return;
    }
    this.state = 'reconnecting';
    this.emitStatus();
    this.deps.logger.warn({ streamer: this.activeStreamer.id }, 'Quelle unerwartet beendet – Neuverbindung');
    this.scheduleOfflinePauseLocked();
    this.scheduleReconnect();
  }

  private scheduleReconnect(delayMs?: number): void {
    if (this.shuttingDown || !this.activeStreamer || this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    const maxDelay = Math.max(2, this.settings.watchdog.max_reconnect_delay) * 1000;
    const delay = delayMs ?? Math.min(maxDelay, 2000 * 2 ** Math.min(6, this.reconnectAttempts - 1));
    if (this.state !== 'paused') this.state = 'reconnecting';
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
      this.state = 'reconnecting';
      this.emitStatus();
      try {
        const stream = await this.resolver.resolve(this.activeStreamer);
        if (this.pauseScreen.running) await this.pauseScreen.stop();
        this.applyConfiguredDelay();
        const timestampOffset = this.nextProducerOffset();
        this.source.start(this.activeStreamer, stream, this.forceReencodeNext, timestampOffset);
        this.markProducerStarted(timestampOffset);
        this.markSinkGrace();
        this.applyConfiguredDelay();
        this.clearOfflinePauseTimer();
        this.pauseReason = null;
        this.lastError = null;
        this.reconnectAttempts = 0;
        this.watchdog.clearError();
        if (!this.chat) this.startChatLocked(this.activeStreamer);
        this.state = 'live';
        this.emitAll();
        this.deps.logger.info({ streamer: this.activeStreamer.id }, 'Stream wieder verbunden');
      } catch (error) {
        const message = toErrorMessage(error);
        this.lastError = message;
        this.deps.logger.warn(
          { streamer: this.activeStreamer.id, err: message },
          'Neuverbindung fehlgeschlagen',
        );
        if (error instanceof StreamerOfflineError && this.activePlaylist) {
          if (this.activePlaylist.playlist.auto_advance) {
            this.schedulePlaylistAdvanceLocked();
            this.emitStatus();
            return;
          }
          if (this.settings.pause.enabled && this.sink.running && !this.pauseScreen.running) {
            this.startPauseLocked();
          }
          this.emitStatus();
          this.scheduleReconnect(
            Math.max(30, this.settings.watchdog.max_reconnect_delay) * 1000,
          );
          return;
        }
        if (
          error instanceof StreamerOfflineError &&
          this.settings.pause.enabled &&
          this.sink.running &&
          !this.pauseScreen.running &&
          this.reconnectAttempts >= 2
        ) {
          this.startPauseLocked();
        }
        this.emitStatus();
        this.scheduleReconnect(
          error instanceof StreamerOfflineError ? 30_000 : undefined,
        );
      }
    });
  }

  private startPauseLocked(): void {
    if (this.chat) {
      this.chat.stop();
      this.chat = undefined;
    }
    this.applyConfiguredDelay();
    const timestampOffset = this.nextProducerOffset();
    this.pauseScreen.start(undefined, undefined, timestampOffset);
    this.markProducerStarted(timestampOffset);
    this.markSinkGrace();
    this.pauseReason = 'offline';
    this.state = 'paused';
    this.deps.logger.info('Quelle offline – Pausenscreen aktiv');
  }

  private clearOfflinePauseTimer(): void {
    if (this.offlinePauseTimer) clearTimeout(this.offlinePauseTimer);
    this.offlinePauseTimer = undefined;
  }

  /**
   * If a reconnection takes longer than a few seconds, keep YouTube alive with
   * the pause screen instead of letting the encoder starve.
   */
  private scheduleOfflinePauseLocked(): void {
    if (this.offlinePauseTimer || !this.settings.pause.enabled || !this.sink.running) return;
    const delayMs = Math.min(15, this.settings.watchdog.stall_timeout) * 1000;
    this.offlinePauseTimer = setTimeout(() => {
      this.offlinePauseTimer = undefined;
      void this.lock.run(async () => {
        if (this.shuttingDown || this.state !== 'reconnecting') return;
        if (this.source.running || this.pauseScreen.running || !this.sink.running) return;
        if (this.playlistAdvancePending) return;
        this.startPauseLocked();
        this.emitAll();
      });
    }, delayMs);
  }

  private schedulePauseRestart(): void {    if (this.pauseRestartTimer || this.shuttingDown) return;
    this.pauseRestartTimer = setTimeout(() => {
      this.pauseRestartTimer = undefined;
      void this.lock.run(async () => {
        if (this.shuttingDown || this.state !== 'paused' || this.pauseScreen.running) return;
        const timestampOffset = this.nextProducerOffset();
        this.pauseScreen.start(undefined, undefined, timestampOffset);
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
        this.pauseReason = null;
        this.state = 'live';
        this.lastError = null;
        this.autoRefresh.markRefreshed();
        if (this.chat) {
          this.chat.stop();
          this.startChatLocked(streamer);
        }
        this.emitAll();
      } catch (error) {
        this.lastError = toErrorMessage(error);
        this.emitStatus();
        if (!this.source.running && this.state === 'live') {
          this.scheduleReconnect(3000);
        }
        if (error instanceof StreamerOfflineError) {
          this.deps.logger.warn('Auto-Refresh: Streamer ist offline');
          if (this.activePlaylist?.playlist.auto_advance) this.schedulePlaylistAdvanceLocked();
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
    this.deps.logger.warn('YouTube-Sink beendet – Neustart geplant');
    this.scheduleSinkRestart(3000);
  }

  private scheduleSinkRestart(delayMs: number): void {
    if (this.sinkRestartTimer || this.shuttingDown) return;
    this.sinkRestartTimer = setTimeout(() => {
      this.sinkRestartTimer = undefined;
      void this.lock.run(async () => {
        if (this.shuttingDown || !this.activeKey || ['idle', 'stopping'].includes(this.state)) return;
        await this.restartSinkLocked();
      });
    }, delayMs);
  }

  private async restartSinkLocked(): Promise<void> {
    if (!this.activeKey) return;
    await this.stopSinkLocked();
    this.startSinkLocked(this.activeKey, this.activeOverlayFilters, this.activeOverlaySignature);
    this.emitAll();
  }

  private async handleRelayStall(ageSeconds: number): Promise<void> {
    await this.lock.run(async () => {
      if (!this.activeStreamer || this.shuttingDown) return;
      if (!['live', 'reconnecting'].includes(this.state)) return;
      if (this.playlistAdvancePending) return;
      const last = this.relay.lastData;
      if (last && Date.now() - last.getTime() < this.settings.watchdog.stall_timeout * 1000) {
        return;
      }
      this.lastError = `Quelle liefert seit ${ageSeconds}s keine Daten`;
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
      if (this.state !== 'live' || this.playlistAdvancePending) return;
      const current = this.source.bitrateKbps ?? this.buffer.stats().pacingKbps;
      if (current !== null && current >= this.settings.watchdog.min_bitrate) return;
      this.lastError = `Quell-Bitrate zu niedrig (${Math.round(kbps)} kbit/s)`;
      this.deps.logger.warn({ kbps, current }, 'Quelle wird wegen niedriger Bitrate neu gestartet');
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
      if (this.playlistAdvancePending) return;
      const last = this.sink.lastProgressAt;
      if (last && Date.now() - last.getTime() < this.settings.watchdog.stall_timeout * 1000) {
        return;
      }
      this.lastError = `Encoder liefert seit ${ageSeconds}s keinen Fortschritt`;
      this.deps.logger.warn({ ageSeconds }, 'Sink wird neu gestartet');
      await this.restartSinkLocked();
    });
  }

  async applySettings(next: Settings, previous: Settings): Promise<StatusSnapshot> {
    return this.lock.run(async () => {
      this.settings = next;
      this.applyConfiguredDelay();
      this.buffer.setMaxBytes(this.bufferMaxBytes(next));
      this.watchdog.updateSettings(next);
      this.autoRefresh.updateSettings(next);
      this.online.updateSettings(next);
      this.overlays.updateSettings(next);
      this.pauseScreen.updateSettings(next);

      const videoChanged =
        JSON.stringify(previous.video) !== JSON.stringify(next.video);
      if (videoChanged && this.sink.running) {
        await this.restartSinkLocked();
      }
      if (videoChanged && this.source.running && this.source.resolved) {
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
      if (this.state === 'paused' && this.pauseScreen.running) {
        await this.pauseScreen.stop();
        const timestampOffset = this.nextProducerOffset();
        this.pauseScreen.start(undefined, undefined, timestampOffset);
        this.markProducerStarted(timestampOffset);
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

  async shutdown(): Promise<void> {    this.shuttingDown = true;
    this.online.stop();
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

  notifyStreamersChanged(): void {
    this.emitStreamers();
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
    const active = this.activePlaylist;
    return this.deps.store.playlists().map((playlist) => {
      const playlistKey = resolveStreamKey(playlist).key;
      const channelsHaveKey =
        Boolean(playlistKey) ||
        playlist.channels.some((channel) => Boolean(resolveStreamKey(this.resolvePlaylistChannel(channel)).key));
      return {
        id: playlist.id,
        name: playlist.name,
        channels: playlist.channels,
        auto_advance: playlist.auto_advance,
        wrap: playlist.wrap,
        advance_delay_seconds: playlist.advance_delay_seconds,
        end_after_minutes: playlist.end_after_minutes ?? null,
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
      this.deps.logger.warn({ err: toErrorMessage(error) }, 'Streamer-Ansicht konnte nicht erzeugt werden');
    }
  }

  buildStatus(): StatusSnapshot {
    const source = this.source?.stats();
    const relay = this.relay?.stats();
    const delay = this.buffer?.stats();
    const sink = this.sink?.stats();
    const watchdog = this.watchdog?.stats();
    const refresh = this.autoRefresh?.stats();
    const now = Date.now();
    const activeId = this.activeStreamer?.id ?? null;
    const monitorOnline = this.activeStreamer ? this.online?.isOnline(this.activeStreamer) ?? null : null;
    return {
      state: this.state,
      active_streamer_id: activeId,
      active_streamer_name: this.activeStreamer?.name ?? null,
      active_playlist: this.activePlaylist
        ? {
            id: this.activePlaylist.playlist.id,
            name: this.activePlaylist.playlist.name,
            index: this.activePlaylist.index,
            total: this.activePlaylist.playlist.channels.length,
          }
        : null,
      started_at: isoOrNull(this.startedAt),
      uptime_seconds: this.startedAt ? Math.round((now - this.startedAt.getTime()) / 1000) : 0,
      source: {
        online: this.activeStreamer ? (this.state === 'live' ? true : monitorOnline) : null,
        resolving: this.resolving,
        connected: relay?.connected ?? false,
        pid: source?.pid ?? null,
        last_data_at: isoOrNull(relay?.lastDataAt ?? null),
        bitrate_kbps: source?.bitrateKbps ?? delay?.pacingKbps ?? null,
        reconnects: this.reconnects,
      },
      relay: {
        ingest_clients: relay?.ingestClients ?? 0,
        output_connected: delay?.outputConnected ?? false,
        buffer_seconds: delay?.bufferSeconds ?? 0,
        buffered_bytes: delay?.bufferedBytes ?? 0,
        dropped_bytes: delay?.droppedBytes ?? 0,
        delay_seconds: delay?.delaySeconds ?? this.settings.delay_buffer.size,
        pacing_kbps: delay?.pacingKbps ?? null,
        total_bytes: relay?.totalBytes ?? 0,
      },
      sink: {
        running: sink?.running ?? false,
        pid: sink?.pid ?? null,
        bitrate_kbps: sink?.bitrateKbps ?? null,
        target_bitrate_kbps: sink?.targetBitrateKbps ?? this.settings.video.video_bitrate,
        fps: sink?.fps ?? null,
        dropped_frames: sink?.droppedFrames ?? 0,
        speed: sink?.speed ?? null,
        last_progress_at: isoOrNull(sink?.lastProgressAt ?? null),
        restarts: sink?.restarts ?? 0,
      },
      watchdog: {
        stall_timeout: this.settings.watchdog.stall_timeout,
        stall_count: watchdog?.stallCount ?? 0,
        last_stall_at: isoOrNull(watchdog?.lastStallAt ?? null),
        last_error: watchdog?.lastError ?? this.lastError,
        reconnecting: this.state === 'reconnecting' || Boolean(this.reconnectTimer),
      },
      auto_refresh: {
        enabled: refresh?.enabled ?? this.settings.auto_refresh.enabled,
        interval_minutes: refresh?.intervalMinutes ?? this.settings.auto_refresh.interval,
        next_refresh_in_seconds: refresh?.nextRefreshInSeconds ?? null,
        last_refresh_at: isoOrNull(refresh?.lastRefreshAt ?? null),
        count: refresh?.count ?? 0,
      },
      version: VERSION,
    };
  }
}
