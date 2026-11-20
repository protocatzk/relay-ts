import type { Logger } from 'pino';
import type { MediaConfig } from '../config/loader.js';
import type { Settings } from '../config/schema.js';
import type { MpegTsRelay } from '../relay/relay-server.js';
import { buildVideoEncoderArgs, currentVideoEncoder, type VideoEncoder } from '../media/encoders.js';
import { buildVideoFilters } from '../source/ffmpeg.js';
import { ManagedProcess } from '../../utils/process.js';
import { FfmpegProgress } from '../../utils/ffmpeg-progress.js';

export interface SecondarySinkOptions {
  media: MediaConfig;
  settings: Settings;
  relay: MpegTsRelay;
  logger: Logger;
  redact?: (text: string) => string;
}

export interface SecondarySinkStatus {
  enabled: boolean;
  provider: 'twitch' | 'kick' | 'custom';
  mode: 'copy' | 'reencode';
  running: boolean;
  pid: number | null;
  bitrate_kbps: number | null;
  fps: number | null;
  restarts: number;
  last_error: string | null;
}

const MAX_STDIN_BACKLOG_BYTES = 4 * 1024 * 1024;
const RECONNECT_DELAY_MS = 8_000;

export function buildSecondaryRtmpUrl(rtmpUrl: string, streamKey: string): string {
  const base = rtmpUrl.trim().replace(/\/+$/, '');
  const key = streamKey.trim();
  if (!base || !key) return '';
  if (!/^rtmps?:\/\//i.test(base)) return '';
  return `${base}/${key}`;
}

export function buildSecondarySinkArgs(params: {
  media: MediaConfig;
  settings: Settings;
  url: string;
  encoder?: VideoEncoder;
}): string[] {
  const { media, settings, url } = params;
  const mode = settings.secondary_sink.mode;
  const inputArgs = [
    '-hide_banner',
    '-loglevel',
    media.ffmpegLogLevel,
    '-progress',
    'pipe:1',
    '-nostats',
    '-stats_period',
    '5',
    '-fflags',
    '+genpts+discardcorrupt',
    '-f',
    'mpegts',
    '-i',
    'pipe:0',
  ];

  if (mode === 'copy') {
    return [
      ...inputArgs,
      '-map',
      '0:v:0?',
      '-map',
      '0:a:0?',
      '-c',
      'copy',
      '-f',
      'flv',
      '-flvflags',
      'no_duration_filesize',
      url,
    ];
  }

  const [width, height] = settings.video.resolution.split('x').map(Number) as [number, number];
  const filters = buildVideoFilters(settings, width, height, []);
  return [
    ...inputArgs,
    '-map',
    '0:v:0?',
    '-map',
    '0:a:0?',
    '-vf',
    filters.join(','),
    '-fps_mode',
    'cfr',
    ...buildVideoEncoderArgs(params.encoder ?? currentVideoEncoder(), {
      bitrateKbps: settings.video.video_bitrate,
      fps: settings.video.fps,
      preset: settings.video.preset,
      tune: 'zerolatency',
      filler: true,
      profile: 'high',
      level: '4.0',
      keyframeLimits: true,
    }),
    '-af',
    'aresample=async=1:osr=48000:osf=fltp:ochl=stereo',
    '-c:a',
    'aac',
    '-b:a',
    `${settings.video.audio_bitrate}k`,
    '-ar',
    '48000',
    '-ac',
    '2',
    '-f',
    'flv',
    '-flvflags',
    'no_duration_filesize',
    '-max_muxing_queue_size',
    '1024',
    url,
  ];
}

/**
 * Fault-isolated secondary RTMP destination (Twitch, Kick or custom RTMP).
 * Reads from `MpegTsRelay.subscribe()` so stalls or disconnects on the second
 * destination can never backpressure or interrupt the primary YouTube sink.
 */
export class SecondarySink {
  private readonly options: SecondarySinkOptions;
  private process?: ManagedProcess;
  private unsubscribe?: () => void;
  private reconnectTimer?: NodeJS.Timeout;
  private readonly progress = new FfmpegProgress();
  private active = false;
  private startCount = 0;
  private lastError: string | null = null;

  constructor(options: SecondarySinkOptions) {
    this.options = options;
  }

  updateSettings(settings: Settings): void {
    this.options.settings = settings;
  }

  get running(): boolean {
    return this.process?.running ?? false;
  }

  start(): void {
    this.active = true;
    this.clearReconnect();
    const cfg = this.options.settings.secondary_sink;
    if (!cfg.enabled) return;
    const url = buildSecondaryRtmpUrl(cfg.rtmp_url, cfg.stream_key);
    if (!url) {
      this.lastError = 'RTMP-URL oder Stream-Key für Zweitziel fehlt';
      return;
    }
    if (this.process?.running) return;
    this.spawn(url);
  }

  async stop(): Promise<void> {
    this.active = false;
    this.clearReconnect();
    this.detachRelay();
    const proc = this.process;
    this.process = undefined;
    if (proc) await proc.stop();
  }

  async syncWithSettings(sessionActive: boolean): Promise<void> {
    await this.stop();
    if (sessionActive && this.options.settings.secondary_sink.enabled) {
      this.start();
    }
  }

  status(): SecondarySinkStatus {
    const cfg = this.options.settings.secondary_sink;
    return {
      enabled: cfg.enabled,
      provider: cfg.provider,
      mode: cfg.mode,
      running: this.running,
      pid: this.process?.pid ?? null,
      bitrate_kbps: this.progress.bitrateKbps,
      fps: this.progress.fps,
      restarts: Math.max(0, this.startCount - 1),
      last_error: this.lastError,
    };
  }

  private spawn(url: string): void {
    this.progress.reset();
    this.lastError = null;
    const args = buildSecondarySinkArgs({
      media: this.options.media,
      settings: this.options.settings,
      url,
    });
    const proc = new ManagedProcess({
      name: `secondary-sink-${this.options.settings.secondary_sink.provider}`,
      command: this.options.media.ffmpegBin,
      args,
      logger: this.options.logger,
      redact: this.options.redact,
      stdinMode: 'pipe',
      onLine: (line, stream) => {
        if (stream === 'stdout') {
          this.progress.push(line);
          return;
        }
        const lower = line.toLowerCase();
        if (lower.includes('error') || lower.includes('failed') || lower.includes('refused')) {
          this.lastError = line;
          this.options.logger.warn(
            { provider: this.options.settings.secondary_sink.provider, line },
            'Zweitziel-Sink meldet ein Problem',
          );
        }
      },
      onExit: (code, signal) => {
        this.detachRelay();
        if (this.process === proc) this.process = undefined;
        if (!this.active || !this.options.settings.secondary_sink.enabled) return;
        this.lastError = `Beendet (code=${code ?? 'null'}, signal=${signal ?? 'null'})`;
        this.options.logger.warn(
          { provider: this.options.settings.secondary_sink.provider, code, signal },
          'Zweitziel-Sink beendet – Neustart geplant (Haupt-Stream läuft weiter)',
        );
        this.scheduleReconnect();
      },
    });
    this.process = proc;
    this.startCount += 1;
    proc.start();

    const stdin = proc.stdin;
    if (stdin) {
      stdin.on('error', () => {
        /* ignore EPIPE on isolated secondary disconnect */
      });
      this.unsubscribe = this.options.relay.subscribe((chunk) => {
        if (!stdin.writable || stdin.destroyed) return;
        if (stdin.writableLength > MAX_STDIN_BACKLOG_BYTES) return;
        try {
          stdin.write(chunk);
        } catch {
          /* never affect relay */
        }
      });
    }
    this.options.logger.info(
      {
        provider: this.options.settings.secondary_sink.provider,
        mode: this.options.settings.secondary_sink.mode,
      },
      'Zweitziel-Sink gestartet',
    );
  }

  private scheduleReconnect(): void {
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.active || !this.options.settings.secondary_sink.enabled) return;
      const cfg = this.options.settings.secondary_sink;
      const url = buildSecondaryRtmpUrl(cfg.rtmp_url, cfg.stream_key);
      if (url) this.spawn(url);
    }, RECONNECT_DELAY_MS);
    this.reconnectTimer.unref?.();
  }

  private detachRelay(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }
}
