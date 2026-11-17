import type { Logger } from 'pino';
import type { MediaConfig } from '../config/loader.js';
import type { Settings } from '../config/schema.js';
import { buildPauseCommand, type RelayEndpoint } from '../source/ffmpeg.js';
import { ManagedProcess } from '../../utils/process.js';

export interface PauseScreenOptions {
  media: MediaConfig;
  settings: Settings;
  relay: RelayEndpoint;
  logger: Logger;
  fontFile?: string | null;
  redact?: (text: string) => string;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

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

  start(text?: string, subtext?: string, timestampOffset = 0): void {
    if (this.process?.running) return;
    this.stopping = false;
    const args = buildPauseCommand({
      media: this.options.media,
      settings: this.options.settings,
      relay: this.options.relay,
      text: text ?? this.options.settings.pause.text,
      subtext: subtext ?? this.options.settings.pause.subtext,
      fontFile: this.options.fontFile,
      timestampOffset,
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
    this.options.logger.info('Pausenscreen gestartet');
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
}
