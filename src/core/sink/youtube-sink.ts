import type { Logger } from 'pino';
import type { MediaConfig } from '../config/loader.js';
import type { Settings } from '../config/schema.js';
import { buildSinkCommand, youtubeUrls, type RelayEndpoint, type SinkOverlayInput } from '../source/ffmpeg.js';
import { ManagedProcess } from '../../utils/process.js';
import { FfmpegProgress } from '../../utils/ffmpeg-progress.js';
import { incMetric } from '../metrics.js';

export interface YouTubeSinkOptions {
  media: MediaConfig;
  settings: Settings;
  relay: RelayEndpoint;
  logger: Logger;
  redact?: (text: string) => string;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  onUnhealthy?: (reason: string) => void;
}

const DTS_ERROR_WINDOW_MS = 15_000;
const DTS_ERROR_THRESHOLD = 10;
const MAX_BITRATE_SAMPLES = 12;

const IMPORTANT_STDERR = [
  'error',
  'failed',
  'refused',
  'unable',
  'broken pipe',
  'connection reset',
  'timed out',
  'no route',
  'invalid',
  'non-monotonous',
  'non monotonically',
  'rtmp_readpacket',
  'rtmp_write',
  'av_interleaved_write_frame',
  'write error',
];

export class YouTubeSink {
  private readonly options: YouTubeSinkOptions;
  private process?: ManagedProcess;
  private readonly progress = new FfmpegProgress();
  private startCount = 0;
  private lastError: string | null = null;
  private targetKey = '';
  private dtsErrors = 0;
  private recentDtsErrors: number[] = [];
  private unhealthyTriggered = false;
  private bitrateSamples: number[] = [];

  constructor(options: YouTubeSinkOptions) {
    this.options = options;
  }

  /** Keeps the next start on the current settings after a settings update. */
  updateSettings(settings: Settings): void {
    this.options.settings = settings;
  }

  get running(): boolean {
    return this.process?.running ?? false;
  }

  get pid(): number | null {
    return this.process?.pid ?? null;
  }

  get bitrateKbps(): number | null {
    return this.progress.bitrateKbps;
  }

  get lastProgressAt(): Date | null {
    return this.progress.lastUpdate;
  }

  get startedAt(): Date | null {
    return this.process?.startedAt ?? null;
  }

  get error(): string | null {
    return this.lastError;
  }

  start(
    key: string,
    overlayFilters: string[] = [],
    overlayInput?: SinkOverlayInput,
    logoInput?: SinkOverlayInput,
  ): void {
    if (!key.trim()) throw new Error('YouTube-Stream-Key ist leer');
    if (this.process?.running) {
      if (this.targetKey === key) return;
      throw new Error('Sink läuft bereits mit einem anderen Key');
    }
    this.targetKey = key;
    this.progress.reset();
    this.lastError = null;
    this.dtsErrors = 0;
    this.recentDtsErrors = [];
    this.unhealthyTriggered = false;
    this.bitrateSamples = [];
    const args = buildSinkCommand({
      media: this.options.media,
      settings: this.options.settings,
      key,
      relay: this.options.relay,
      overlayFilters,
      overlayInput,
      logoInput,
    });
    // Validate URLs early (before spawning) and keep keys out of logs.
    youtubeUrls(this.options.media, key);
    const process = new ManagedProcess({
      name: 'youtube-sink',
      command: this.options.media.ffmpegBin,
      args,
      logger: this.options.logger,
      redact: this.options.redact,
      // Always reserve fd 3 (chat) and fd 4 (logo) so the overlay engines keep
      // stable pipe descriptors even when only one overlay is active.
      extraPipes: overlayInput || logoInput ? 2 : 0,
      onLine: (line, stream) => {
        if (stream === 'stdout') {
          this.progress.push(line);
          const kbps = this.progress.bitrateKbps;
          if (line.startsWith('bitrate=') && kbps !== null && kbps > 0) {
            this.bitrateSamples.push(kbps);
            if (this.bitrateSamples.length > MAX_BITRATE_SAMPLES) {
              this.bitrateSamples.shift();
            }
          }
          return;
        }
        const lower = line.toLowerCase();
        if (IMPORTANT_STDERR.some((needle) => lower.includes(needle))) {
          this.lastError = line;
          this.options.logger.warn({ sink: true, line }, 'YouTube-Sink meldet ein Problem');
        } else {
          this.options.logger.debug({ sink: true, line }, 'ffmpeg sink');
        }
        if (lower.includes('non-monotonous') || lower.includes('non monotonically')) {
          const now = Date.now();
          this.dtsErrors += 1;
          incMetric('sink_dts_errors_total');
          this.recentDtsErrors.push(now);
          const cutoff = now - DTS_ERROR_WINDOW_MS;
          while (this.recentDtsErrors.length > 0 && this.recentDtsErrors[0]! < cutoff) {
            this.recentDtsErrors.shift();
          }
          if (this.recentDtsErrors.length >= DTS_ERROR_THRESHOLD && !this.unhealthyTriggered) {
            this.unhealthyTriggered = true;
            this.options.onUnhealthy?.('Wiederholte DTS-Sprünge am YouTube-Sink');
          }
        }
      },
      onExit: (code, signal) => {
        this.options.logger.warn({ code, signal }, 'YouTube-Sink beendet');
        this.options.onExit?.(code, signal);
      },
    });
    this.process = process;
    this.startCount += 1;
    process.start();
    this.options.logger.info({ key: '***', urls: youtubeUrls(this.options.media, key).length }, 'YouTube-Sink gestartet');
  }

  async stop(): Promise<void> {
    const process = this.process;
    this.process = undefined;
    this.targetKey = '';
    if (process) await process.stop();
  }

  overlayStream(): NodeJS.WritableStream | null {
    return this.process?.extraStream(3) ?? null;
  }

  logoStream(): NodeJS.WritableStream | null {
    return this.process?.extraStream(4) ?? null;
  }

  stats(): {
    running: boolean;
    pid: number | null;
    bitrateKbps: number | null;
    targetBitrateKbps: number;
    fps: number | null;
    droppedFrames: number;
    speed: string | null;
    lastProgressAt: Date | null;
    restarts: number;
    dtsErrors: number;
    bitrateDriftPercent: number | null;
    lastError: string | null;
  } {
    const targetBitrateKbps = this.options.settings.video.video_bitrate;
    let bitrateDriftPercent: number | null = null;
    if (this.bitrateSamples.length > 0 && targetBitrateKbps > 0) {
      const avg =
        this.bitrateSamples.reduce((sum, sample) => sum + sample, 0) / this.bitrateSamples.length;
      bitrateDriftPercent = Math.round(((avg - targetBitrateKbps) / targetBitrateKbps) * 100);
    }
    return {
      running: this.running,
      pid: this.pid,
      bitrateKbps: this.progress.bitrateKbps,
      targetBitrateKbps,
      fps: this.progress.fps,
      droppedFrames: this.progress.droppedFrames,
      speed: this.progress.speed,
      lastProgressAt: this.progress.lastUpdate,
      restarts: Math.max(0, this.startCount - 1),
      dtsErrors: this.dtsErrors,
      bitrateDriftPercent,
      lastError: this.lastError,
    };
  }
}
