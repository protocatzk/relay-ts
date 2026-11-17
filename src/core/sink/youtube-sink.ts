import type { Logger } from 'pino';
import type { MediaConfig } from '../config/loader.js';
import type { Settings } from '../config/schema.js';
import { buildSinkCommand, youtubeUrls, type RelayEndpoint, type SinkOverlayInput } from '../source/ffmpeg.js';
import { ManagedProcess } from '../../utils/process.js';
import { FfmpegProgress } from '../../utils/ffmpeg-progress.js';

export interface YouTubeSinkOptions {
  media: MediaConfig;
  settings: Settings;
  relay: RelayEndpoint;
  logger: Logger;
  redact?: (text: string) => string;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

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
];

export class YouTubeSink {
  private readonly options: YouTubeSinkOptions;
  private process?: ManagedProcess;
  private readonly progress = new FfmpegProgress();
  private startCount = 0;
  private lastError: string | null = null;
  private targetKey = '';

  constructor(options: YouTubeSinkOptions) {
    this.options = options;
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

  start(key: string, overlayFilters: string[] = [], overlayInput?: SinkOverlayInput): void {
    if (!key.trim()) throw new Error('YouTube-Stream-Key ist leer');
    if (this.process?.running) {
      if (this.targetKey === key) return;
      throw new Error('Sink läuft bereits mit einem anderen Key');
    }
    this.targetKey = key;
    this.progress.reset();
    this.lastError = null;
    const args = buildSinkCommand({
      media: this.options.media,
      settings: this.options.settings,
      key,
      relay: this.options.relay,
      overlayFilters,
      overlayInput,
    });
    // Validate URLs early (before spawning) and keep keys out of logs.
    youtubeUrls(this.options.media, key);
    const process = new ManagedProcess({
      name: 'youtube-sink',
      command: this.options.media.ffmpegBin,
      args,
      logger: this.options.logger,
      redact: this.options.redact,
      extraPipes: overlayInput ? 1 : 0,
      onLine: (line, stream) => {
        if (stream === 'stdout') {
          this.progress.push(line);
          return;
        }
        const lower = line.toLowerCase();
        if (IMPORTANT_STDERR.some((needle) => lower.includes(needle))) {
          this.lastError = line;
          this.options.logger.warn({ sink: true, line }, 'YouTube-Sink meldet ein Problem');
        } else {
          this.options.logger.debug({ sink: true, line }, 'ffmpeg sink');
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
    lastError: string | null;
  } {
    return {
      running: this.running,
      pid: this.pid,
      bitrateKbps: this.progress.bitrateKbps,
      targetBitrateKbps: this.options.settings.video.video_bitrate,
      fps: this.progress.fps,
      droppedFrames: this.progress.droppedFrames,
      speed: this.progress.speed,
      lastProgressAt: this.progress.lastUpdate,
      restarts: Math.max(0, this.startCount - 1),
      lastError: this.lastError,
    };
  }
}
