import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Logger } from 'pino';
import type { RtmpIngestSettings } from '../config/schema.js';
import type { RelayEndpoint } from '../source/ffmpeg.js';
import { ingestUrl } from '../source/ffmpeg.js';

export interface RtmpIngestStats {
  running: boolean;
  port: number;
  activeClient: boolean;
  streamKey: string;
  bytesReceived: number;
  connectedAt: Date | null;
  ingestUrl: string;
}

export interface RtmpIngestServerOptions {
  settings: RtmpIngestSettings;
  relay: RelayEndpoint;
  logger: Logger;
  ffmpegLogLevel?: string;
}

/**
 * Native RTMP Ingest Server powered by FFmpeg RTMP listener.
 * Listens on rtmp://0.0.0.0:<port>/live/<stream_key>.
 * When an external streamer (OBS, Streamlabs, etc.) connects and publishes,
 * it bridges the stream directly to RELAY's internal MPEG-TS relay.
 */
export class RtmpIngestServer extends EventEmitter {
  private options: RtmpIngestServerOptions;
  private process: ChildProcess | null = null;
  private isPublishing = false;
  private connectedAt: Date | null = null;
  private stopping = false;
  private restartTimeout: NodeJS.Timeout | null = null;

  constructor(options: RtmpIngestServerOptions) {
    super();
    this.options = options;
  }

  get isRunning(): boolean {
    return this.process !== null && !this.stopping;
  }

  get hasActiveStream(): boolean {
    return this.isPublishing;
  }

  get listenUrl(): string {
    const key = this.options.settings.stream_key.trim() || 'live';
    return `rtmp://0.0.0.0:${this.options.settings.port}/live/${key}`;
  }

  stats(): RtmpIngestStats {
    return {
      running: this.isRunning,
      port: this.options.settings.port,
      activeClient: this.isPublishing,
      streamKey: this.options.settings.stream_key ? '***' : '',
      bytesReceived: 0,
      connectedAt: this.connectedAt,
      ingestUrl: `rtmp://<host>:${this.options.settings.port}/live/${this.options.settings.stream_key}`,
    };
  }

  updateSettings(settings: RtmpIngestSettings): void {
    const oldEnabled = this.options.settings.enabled;
    const oldPort = this.options.settings.port;
    const oldKey = this.options.settings.stream_key;
    this.options.settings = settings;

    if (!settings.enabled && oldEnabled) {
      this.stop();
    } else if (settings.enabled && (!oldEnabled || oldPort !== settings.port || oldKey !== settings.stream_key)) {
      this.stop();
      this.start();
    }
  }

  start(): void {
    if (this.process || !this.options.settings.enabled) return;
    this.stopping = false;

    const rtmpUrl = this.listenUrl;
    const relayIngest = ingestUrl(this.options.relay);

    // Command to listen for incoming RTMP publish and forward to MPEG-TS relay
    const args = [
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      this.options.ffmpegLogLevel ?? 'info',
      '-f',
      'flv',
      '-listen',
      '1',
      '-i',
      rtmpUrl,
      '-c:v',
      'copy',
      '-c:a',
      'copy',
      '-f',
      'mpegts',
      '-mpegts_flags',
      '+resend_headers',
      '-flush_packets',
      '1',
      '-muxdelay',
      '0',
      relayIngest,
    ];

    this.options.logger.info(
      { port: this.options.settings.port, path: `/live/${this.options.settings.stream_key ? '***' : ''}` },
      'RTMP-Ingest-Server wartet auf eingehende Verbindungen...',
    );

    const child = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.process = child;

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (!this.isPublishing && /Stream #0:0/i.test(text)) {
        this.isPublishing = true;
        this.connectedAt = new Date();
        this.options.logger.info('Gaming-Streamer via RTMP aktiv verbunden!');
        this.emit('publish_started');
      }
    });

    child.on('exit', (_code, _signal) => {
      this.process = null;
      const wasPublishing = this.isPublishing;
      this.isPublishing = false;
      this.connectedAt = null;

      if (wasPublishing) {
        this.options.logger.info('Gaming-Streamer via RTMP getrennt.');
        this.emit('publish_stopped');
      }

      if (!this.stopping && this.options.settings.enabled) {
        // Immediate restart of listener so OBS can reconnect anytime
        this.restartTimeout = setTimeout(() => {
          this.start();
        }, 1000);
      }
    });

    child.on('error', (err) => {
      this.options.logger.error({ err }, 'Fehler im RTMP-Ingest-Prozess');
    });
  }

  stop(): void {
    this.stopping = true;
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.isPublishing = false;
    this.connectedAt = null;
    this.options.logger.info('RTMP-Ingest-Server gestoppt.');
  }
}
