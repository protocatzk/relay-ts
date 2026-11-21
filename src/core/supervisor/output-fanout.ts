import type { Logger } from 'pino';
import type { LoadedConfig } from '../config/loader.js';
import type { Settings } from '../config/schema.js';
import type { MpegTsRelay } from '../relay/relay-server.js';
import { SecondarySink } from '../sink/secondary-sink.js';
import {
  RecordingController,
  type ClipOptions,
  type ClipResult,
} from '../recording/recording-controller.js';
import type { MarkerSource, RecordingMarker } from '../recording/recording-markers.js';

export interface OutputFanoutOptions {
  config: LoadedConfig;
  settings: Settings;
  relay: MpegTsRelay;
  logger: Logger;
  registerSecret?: (secret: string) => void;
  redact?: (text: string) => string;
}

/**
 * Manages secondary outputs that consume from the internal relay
 * alongside the primary YouTube sink (RTMP secondary sink & local MKV recording).
 */
export class OutputFanout {
  private readonly secondarySink: SecondarySink;
  private readonly recording: RecordingController;
  private readonly registerSecret?: (secret: string) => void;

  constructor(options: OutputFanoutOptions) {
    this.registerSecret = options.registerSecret;
    this.secondarySink = new SecondarySink({
      media: options.config.media,
      settings: options.settings,
      relay: options.relay,
      logger: options.logger,
      redact: options.redact,
    });
    this.recording = new RecordingController({
      dataDir: options.config.paths.dataDir,
      media: options.config.media,
      settings: options.settings,
      relay: options.relay,
      logger: options.logger,
    });
    this.registerConfiguredSecrets(options.settings);
  }

  private registerConfiguredSecrets(settings: Settings): void {
    if (settings.secondary_sink.stream_key) {
      this.registerSecret?.(settings.secondary_sink.stream_key);
    }
  }

  start(activeId: string): void {
    this.secondarySink.start();
    this.recording.start(activeId);
  }

  async stop(): Promise<void> {
    await Promise.allSettled([this.secondarySink.stop(), this.recording.stop()]);
  }

  updateSettings(next: Settings): void {
    this.secondarySink.updateSettings(next);
    this.recording.updateSettings(next);
    this.registerConfiguredSecrets(next);
  }

  async syncWithSettings(
    previous: Settings,
    next: Settings,
    sessionActive: boolean,
    activeId: string,
  ): Promise<void> {
    this.updateSettings(next);
    if (JSON.stringify(previous.secondary_sink) !== JSON.stringify(next.secondary_sink)) {
      await this.secondarySink.syncWithSettings(sessionActive);
    }
    if (JSON.stringify(previous.recording) !== JSON.stringify(next.recording)) {
      await this.recording.syncWithSettings(sessionActive, activeId);
    }
  }

  diskWarning(): string | null {
    return this.recording.status().disk_warning ?? null;
  }

  status(): {
    secondarySink?: ReturnType<SecondarySink['status']>;
    recording?: ReturnType<RecordingController['status']>;
  } {
    return {
      secondarySink: this.secondarySink.status(),
      recording: this.recording.status(),
    };
  }

  recordingFilename(): string | null {
    return this.recording.filename;
  }

  addRecordingMarker(input: { label?: string; source?: MarkerSource }): RecordingMarker | null {
    return this.recording.addMarker(input);
  }

  async createRecordingClip(options: ClipOptions): Promise<ClipResult> {
    return this.recording.createClip(options);
  }
}
