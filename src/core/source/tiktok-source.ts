import type { Logger } from 'pino';
import type { MediaConfig } from '../config/loader.js';
import type { Settings, StreamerConfig } from '../config/schema.js';
import { ManagedProcess } from '../../utils/process.js';
import { FfmpegProgress } from '../../utils/ffmpeg-progress.js';
import { buildSourceCommand, type RelayEndpoint } from './ffmpeg.js';
import type { ResolvedStream } from './tiktok.js';

export interface TikTokSourceOptions {
  media: MediaConfig;
  settings: Settings;
  relay: RelayEndpoint;
  logger: Logger;
  redact?: (text: string) => string;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  onCodecProblem?: (line: string) => void;
}

const CODEC_PROBLEMS = [
  'could not find codec parameters',
  'unknown decoder',
  'non-existing pps',
  'invalid data found',
  'unsupported codec',
  'decoder not found',
  'error while decoding',
];

const IMPORTANT_STDERR = [
  'error',
  'failed',
  'forbidden',
  'unauthorized',
  'timed out',
  'connection reset',
  'connection refused',
  'server returned 4',
  'server returned 5',
  'no route',
];

export class TikTokSource {
  private readonly options: TikTokSourceOptions;
  private process?: ManagedProcess;
  private readonly progress = new FfmpegProgress();
  private streamer?: StreamerConfig;
  private stream?: ResolvedStream;
  private forceReencode = false;
  private lastError: string | null = null;

  constructor(options: TikTokSourceOptions) {
    this.options = options;
  }

  get running(): boolean {
    return this.process?.running ?? false;
  }

  get pid(): number | null {
    return this.process?.pid ?? null;
  }

  get resolved(): ResolvedStream | null {
    return this.stream ?? null;
  }

  get currentStreamer(): StreamerConfig | null {
    return this.streamer ?? null;
  }

  get bitrateKbps(): number | null {
    return this.progress.bitrateKbps;
  }

  get outputTimeSeconds(): number | null {
    return this.progress.outTimeUs === null ? null : this.progress.outTimeUs / 1_000_000;
  }

  get startedAt(): Date | null {
    return this.process?.startedAt ?? null;
  }

  get error(): string | null {
    return this.lastError;
  }

  updateSettings(settings: Settings): void {
    this.options.settings = settings;
  }

  start(streamer: StreamerConfig, stream: ResolvedStream, forceReencode = false, timestampOffset = 0): void {
    if (this.process?.running) throw new Error('Quelle läuft bereits');
    this.streamer = streamer;
    this.stream = stream;
    this.forceReencode = forceReencode;
    this.progress.reset();
    this.lastError = null;
    const args = buildSourceCommand({
      media: this.options.media,
      settings: this.options.settings,
      streamer,
      stream,
      relay: this.options.relay,
      forceReencode,
      timestampOffset,
    });
    const process = new ManagedProcess({
      name: `source-${streamer.id}`,
      command: this.options.media.ffmpegBin,
      args,
      logger: this.options.logger,
      redact: this.options.redact,
      onLine: (line, streamType) => {
        if (streamType === 'stdout') {
          this.progress.push(line);
          return;
        }
        const lower = line.toLowerCase();
        if (CODEC_PROBLEMS.some((needle) => lower.includes(needle))) {
          this.lastError = line;
          this.options.onCodecProblem?.(line);
          return;
        }
        if (IMPORTANT_STDERR.some((needle) => lower.includes(needle))) {
          this.lastError = line;
          this.options.logger.warn({ source: streamer.id, line }, 'Quelle meldet ein Problem');
        } else {
          this.options.logger.debug({ source: streamer.id, line }, 'ffmpeg Quelle');
        }
      },
      onExit: (code, signal) => {
        this.options.logger.warn({ code, signal, streamer: streamer.id }, 'Stream-Quelle beendet');
        this.options.onExit?.(code, signal);
      },
    });
    this.process = process;
    process.start();
    this.options.logger.info(
      {
        streamer: streamer.id,
        vcodec: stream.vcodec,
        height: stream.height,
        reencode: forceReencode || streamer.video_mode === 'reencode' || !stream.isH264,
      },
      'Stream-Quelle gestartet',
    );
  }

  async stop(): Promise<void> {
    const process = this.process;
    this.process = undefined;
    if (process) await process.stop();
    this.streamer = undefined;
    this.stream = undefined;
  }

  stats(): {
    pid: number | null;
    running: boolean;
    bitrateKbps: number | null;
    lastError: string | null;
    forceReencode: boolean;
    fps: number | null;
    lastProgressAt: Date | null;
  } {
    return {
      pid: this.pid,
      running: this.running,
      bitrateKbps: this.progress.bitrateKbps,
      lastError: this.lastError,
      forceReencode: this.forceReencode,
      fps: this.progress.fps,
      lastProgressAt: this.progress.lastUpdate,
    };
  }
}
