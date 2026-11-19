import type { Settings, StreamerConfig } from '../config/schema.js';
import type { ResolvedStream } from '../source/tiktok.js';
import type { TikTokSource } from '../source/tiktok-source.js';
import { reconnectDelay } from './reconnect-policy.js';

export interface SourceResolver {
  resolve(streamer: StreamerConfig): Promise<ResolvedStream>;
}

export interface SourceSessionDeps {
  source: TikTokSource;
  resolver: SourceResolver;
  settings: Settings;
}

export interface ReconnectSchedule {
  attempt: number;
  delayMs: number;
}

/** Owns the TikTok source process, producer timeline and reconnect timing. */
export class SourceSession {
  private readonly source: TikTokSource;
  private readonly resolver: SourceResolver;
  private settings: Settings;
  private reconnectsValue = 0;
  private reconnectAttemptsValue = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private stoppingValue = 0;
  private resolvingValue = false;
  private producerOffset = 0;
  private producerStartedAt: number | null = null;

  constructor(deps: SourceSessionDeps) {
    this.source = deps.source;
    this.resolver = deps.resolver;
    this.settings = deps.settings;
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
  }

  get running(): boolean {
    return this.source.running;
  }

  get startedAt(): Date | null {
    return this.source.startedAt;
  }

  get outputTimeSeconds(): number | null {
    return this.source.outputTimeSeconds;
  }

  get bitrateKbps(): number | null {
    return this.source.bitrateKbps;
  }

  get resolved(): ResolvedStream | null {
    return this.source.resolved;
  }

  get currentStreamer(): StreamerConfig | null {
    return this.source.currentStreamer;
  }

  stats(): ReturnType<TikTokSource['stats']> {
    return this.source.stats();
  }

  get reconnects(): number {
    return this.reconnectsValue;
  }

  get reconnectAttempts(): number {
    return this.reconnectAttemptsValue;
  }

  get reconnecting(): boolean {
    return Boolean(this.reconnectTimer);
  }

  get resolving(): boolean {
    return this.resolvingValue;
  }

  get stopping(): number {
    return this.stoppingValue;
  }

  resolve(streamer: StreamerConfig): Promise<ResolvedStream> {
    return this.resolver.resolve(streamer);
  }

  start(
    streamer: StreamerConfig,
    stream: ResolvedStream,
    forceReencode: boolean,
    offset: number,
  ): void {
    this.source.start(streamer, stream, forceReencode, offset);
  }

  async stop(): Promise<void> {
    if (!this.source.running && !this.source.currentStreamer) return;
    this.stoppingValue += 1;
    try {
      await this.source.stop();
    } finally {
      this.stoppingValue -= 1;
    }
  }

  beginResolve(): void {
    this.resolvingValue = true;
  }

  endResolve(): void {
    this.resolvingValue = false;
  }

  incrementReconnects(): void {
    this.reconnectsValue += 1;
  }

  resetReconnectAttempts(): void {
    this.reconnectAttemptsValue = 0;
  }

  scheduleReconnect(delayMs: number | undefined, onReconnect: () => void): ReconnectSchedule | null {
    if (this.reconnectTimer) return null;
    this.reconnectAttemptsValue += 1;
    const delay = reconnectDelay(this.reconnectAttemptsValue, this.settings, delayMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      onReconnect();
    }, delay);
    this.reconnectTimer.unref?.();
    return { attempt: this.reconnectAttemptsValue, delayMs: delay };
  }

  clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  nextOffset(): number {
    if (this.producerStartedAt === null) return this.producerOffset;
    const elapsed = Math.max(0, (Date.now() - this.producerStartedAt) / 1000);
    return Math.round((this.producerOffset + Math.max(2, elapsed + 1)) * 1000) / 1000;
  }

  markProducerStarted(offset: number): void {
    this.producerOffset = offset;
    this.producerStartedAt = Date.now();
  }

  resetTimeline(): void {
    this.producerOffset = 0;
    this.producerStartedAt = null;
  }
}
