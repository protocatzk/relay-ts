import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { Logger } from 'pino';
import type { MediaConfig } from '../config/loader.js';
import type { Settings } from '../config/schema.js';
import { buildPauseCommand, type RelayEndpoint } from '../source/ffmpeg.js';
import { ensureDir } from '../../utils/fs.js';
import { resolveFont } from './drawtext.js';
import { ManagedProcess } from '../../utils/process.js';

export interface PauseScreenOptions {
  media: MediaConfig;
  settings: Settings;
  relay: RelayEndpoint;
  logger: Logger;
  overlaysDir: string;
  fontFile?: string | null;
  screen?: 'pause' | 'startup';
  redact?: (text: string) => string;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

type SlateConfig = Pick<
  Settings['pause'],
  'text' | 'subtext' | 'color' | 'background' | 'font' | 'text_color' | 'fit'
>;

const ANIMATED_SVG = /<(animate|animateTransform|animateMotion|set)\b|@keyframes|animation\s*:/i;

/** Replaces the TikTok source with a static slate while the sink keeps running. */
export class PauseScreen {
  private options: PauseScreenOptions;
  private process?: ManagedProcess;
  private stopping = false;

  constructor(options: PauseScreenOptions) {
    this.options = options;
  }

  get running(): boolean {
    return this.process?.running ?? false;
  }

  get pid(): number | null {
    return this.process?.pid ?? null;
  }

  updateSettings(settings: Settings): void {
    this.options.settings = settings;
  }

  private get config(): SlateConfig {
    return this.options.screen === 'startup'
      ? this.options.settings.startup
      : this.options.settings.pause;
  }

  async start(
    text?: string,
    subtext?: string,
    timestampOffset = 0,
    backgroundOverride?: string,
  ): Promise<void> {
    if (this.process?.running) return;
    this.stopping = false;
    const config = this.config;
    const background = await this.resolveBackground(backgroundOverride || config.background);
    const fontFile = resolveFont(config.font) ?? this.options.fontFile;
    const args = buildPauseCommand({
      media: this.options.media,
      settings: this.options.settings,
      relay: this.options.relay,
      text: text ?? config.text,
      subtext: subtext ?? config.subtext,
      fontFile,
      timestampOffset,
      background,
      textColor: config.text_color,
      color: config.color,
      fit: config.fit,
    });
    const process = new ManagedProcess({
      name: 'pause-screen',
      command: this.options.media.ffmpegBin,
      args,
      logger: this.options.logger,
      redact: this.options.redact,
      onExit: (code, signal) => {
        if (this.stopping) {
          this.options.logger.debug({ code, signal }, 'Pausenscreen gestoppt');
          return;
        }
        this.options.logger.warn({ code, signal }, 'Pausenscreen beendet');
        this.options.onExit?.(code, signal);
      },
    });
    this.process = process;
    process.start();
    this.options.logger.info({ background: Boolean(background) }, 'Pausenscreen gestartet');
  }

  async stop(): Promise<void> {
    const process = this.process;
    this.process = undefined;
    if (process) {
      this.stopping = true;
      try {
        await process.stop();
      } finally {
        this.stopping = false;
      }
    }
  }

  private async resolveBackground(raw: string): Promise<string | undefined> {
    return resolveSlateBackground(raw, this.options);
  }
}

export interface SlateBackgroundOptions {
  overlaysDir: string;
  logger: Logger;
}

/**
 * ffmpeg in this image has no SVG decoder. Static SVGs are rasterized once
 * with Skia; animated SVGs fall back to their first frame (use WebM/GIF for
 * actual animation).
 */
export async function resolveSlateBackground(
  raw: string,
  options: SlateBackgroundOptions,
): Promise<string | undefined> {
  const value = raw?.trim();
  if (!value) return undefined;
  const clean = value.split('?')[0]!.toLowerCase();
  if (!clean.endsWith('.svg')) return value;

  try {
    let data: Buffer;
    if (/^https?:\/\//i.test(value)) {
      const response = await fetch(value, {
        signal: AbortSignal.timeout(15_000),
        headers: { accept: 'image/svg+xml,image/*' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = Buffer.from(await response.arrayBuffer());
    } else {
      data = readFileSync(value);
    }
    const svg = data.toString('utf8');
    if (ANIMATED_SVG.test(svg)) {
      options.logger.warn(
        { background: value },
        'Animiertes SVG wird als statisches Bild verwendet – für Animation WebM/GIF nutzen',
      );
    }
    ensureDir(options.overlaysDir);
    const source = join(options.overlaysDir, 'pause-source.svg');
    writeFileSync(source, data, { mode: 0o600 });
    const image = await loadImage(source);
    const width = Math.max(1, image.width || 1920);
    const height = Math.max(1, image.height || 1080);
    const canvas = createCanvas(width, height);
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    const target = join(options.overlaysDir, 'pause-background.png');
    ensureDir(options.overlaysDir);
    writeFileSync(target, canvas.toBuffer('image/png'), { mode: 0o600 });
    return target;
  } catch (error) {
    options.logger.warn(
      { background: value, err: error instanceof Error ? error.message : String(error) },
      'Pausenscreen-Hintergrund konnte nicht geladen werden – nutze Hintergrundfarbe',
    );
    return undefined;
  }
}
