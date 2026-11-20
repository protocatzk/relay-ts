import { createCanvas, type Image } from '@napi-rs/canvas';
import type { Logger } from 'pino';
import type { Settings } from '../config/schema.js';
import type { ChatPanelSpec } from './chat-engine.js';

export interface LogoOverlayEngineOptions {
  settings: Settings;
  image: Image;
  logger: Logger;
}

/**
 * Canvas-based logo overlay. Renders the RELAY logo once at its configured
 * size/opacity and streams it as RGBA frames over a dedicated pipe. Position,
 * size and opacity only change when the engine is rebuilt (settings save), so
 * the sink filter graph stays constant while the logo is live.
 */
export class LogoOverlayEngine {
  private readonly logger: Logger;
  private readonly spec: ChatPanelSpec;
  private readonly frame: Buffer;
  private stream?: NodeJS.WritableStream;
  private timer?: NodeJS.Timeout;
  private blocked = false;
  private stopped = false;

  constructor(options: LogoOverlayEngineOptions) {
    this.logger = options.logger;
    const cfg = options.settings.overlays.logo;
    const [outputWidth, outputHeight] = options.settings.video.resolution
      .split('x')
      .map(Number) as [number, number];
    const width = Math.max(32, Math.min(cfg.width, outputWidth));
    const ratio =
      options.image.width > 0 && options.image.height > 0
        ? options.image.height / options.image.width
        : 1;
    const height = Math.max(1, Math.round(width * ratio));
    const margin = Math.max(0, cfg.margin);
    const x = cfg.position.endsWith('right') ? outputWidth - width - margin : margin;
    const y = cfg.position.startsWith('top') ? margin : outputHeight - height - margin;
    this.spec = { width, height, x: x + cfg.offset_x, y: y + cfg.offset_y, fps: 10, fd: 4 };

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = Math.max(0, Math.min(1, cfg.opacity));
    ctx.drawImage(options.image, 0, 0, width, height);
    ctx.globalAlpha = 1;
    const data = ctx.getImageData(0, 0, width, height).data;
    this.frame = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }

  get panel(): ChatPanelSpec {
    return { ...this.spec };
  }

  attach(stream: NodeJS.WritableStream | null): void {
    if (!stream || this.stream === stream) return;
    this.detach();
    this.stopped = false;
    this.stream = stream;
    const guarded = stream as NodeJS.WritableStream & {
      destroyed?: boolean;
      on?: (event: string, listener: (error: Error) => void) => void;
      once?: (event: string, listener: () => void) => void;
    };
    if (guarded.on) {
      guarded.on('error', (error) => {
        if (this.stream !== stream) return;
        this.logger.warn(
          { err: error.message },
          'Logo-Pipe getrennt – Logo-Frame-Stream wird gestoppt',
        );
        this.stream = undefined;
        this.blocked = false;
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
      });
    }
    if (guarded.once) {
      guarded.once('close', () => {
        if (this.stream !== stream) return;
        this.stream = undefined;
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
      });
    }
    if (guarded.destroyed) return;
    this.timer = setInterval(() => this.tick(), Math.max(20, Math.round(1000 / this.spec.fps)));
    this.tick();
  }

  detach(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const stream = this.stream;
    this.stream = undefined;
    this.blocked = false;
    if (stream) {
      try {
        stream.end();
      } catch {
        // already closed
      }
    }
  }

  stop(): void {
    this.stopped = true;
    this.detach();
  }

  private tick(): void {
    if (this.stopped || !this.stream || this.blocked) return;
    try {
      const ok = this.stream.write(this.frame);
      if (!ok) {
        this.blocked = true;
        this.stream.once('drain', () => {
          this.blocked = false;
        });
      }
    } catch {
      this.detach();
    }
  }
}
