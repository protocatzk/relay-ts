import { existsSync } from 'node:fs';
import type { Settings, StreamerConfig } from '../config/schema.js';
import { StreamerSchema } from '../config/schema.js';
import type { ResolvedStream } from '../source/tiktok.js';
import { QUEUE_PLAYLIST_ID, type QueueController, type QueuePlayback } from './queue-controller.js';
import { mediaFilePath } from '../media/media-files.js';
import { remainingTimeFilter } from '../overlays/drawtext.js';
import { ValidationError } from '../../utils/errors.js';

export class MediaPlaybackController {
  private activeMediaFile: string | null = null;
  private activeMediaOffset = 0;
  private activeMediaStartedAt: number | null = null;
  private activeMediaDuration: number | null = null;
  private resumeTimer?: NodeJS.Timeout;

  get file(): string | null {
    return this.activeMediaFile;
  }

  get duration(): number | null {
    return this.activeMediaDuration;
  }

  get offset(): number {
    return this.activeMediaOffset;
  }

  get isPlaying(): boolean {
    return this.activeMediaFile !== null;
  }

  start(file: string, offset: number, duration: number | null): void {
    this.activeMediaFile = file;
    this.activeMediaOffset = offset;
    this.activeMediaDuration = duration;
    this.activeMediaStartedAt = Date.now();
  }

  stop(): void {
    this.activeMediaFile = null;
    this.activeMediaOffset = 0;
    this.activeMediaStartedAt = null;
    this.activeMediaDuration = null;
  }

  currentPosition(): number {
    if (!this.activeMediaDuration) return 0;
    const elapsed =
      this.activeMediaStartedAt === null
        ? 0
        : Math.max(0, (Date.now() - this.activeMediaStartedAt) / 1000);
    return Math.min(this.activeMediaDuration, this.activeMediaOffset + elapsed);
  }

  status(): { file: string; duration_seconds: number; position_seconds: number } | null {
    if (!this.activeMediaFile || !this.activeMediaDuration) return null;
    return {
      file: this.activeMediaFile,
      duration_seconds: this.activeMediaDuration,
      position_seconds: this.currentPosition(),
    };
  }

  computeSeekTarget(seconds: number): number {
    const max = this.activeMediaDuration
      ? Math.max(0, this.activeMediaDuration - 0.5)
      : Math.max(0, seconds);
    return Math.max(0, Math.min(seconds, max));
  }

  persistProgress(queue: QueueController, currentPlaylistId?: string): void {
    if (!this.activeMediaFile || !this.activeMediaDuration) return;
    if (currentPlaylistId !== QUEUE_PLAYLIST_ID) return;
    queue.setPlayback({
      channel: `file:${this.activeMediaFile}`,
      position_seconds: this.currentPosition(),
      duration_seconds: this.activeMediaDuration,
      updated_at: new Date().toISOString(),
    });
  }

  scheduleResume(
    playback: QueuePlayback,
    onResume: (playback: QueuePlayback) => Promise<void>,
    delayMs = 2500,
  ): void {
    this.clearResumeTimer();
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = undefined;
      void onResume(playback);
    }, delayMs);
  }

  clearResumeTimer(): void {
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = undefined;
    }
  }

  validateMediaFile(dataDir: string, file: string): string {
    const path = mediaFilePath(dataDir, file);
    if (!path || !existsSync(path)) {
      throw new ValidationError(`Lokales Video "${file}" wurde nicht gefunden`);
    }
    return path;
  }

  prepareCountdownFilter(
    settings: Settings,
    fontFile: string | null,
    seekSeconds: number,
  ): string | null {
    if (!fontFile || !this.activeMediaDuration) return null;
    return remainingTimeFilter(settings, fontFile, this.activeMediaDuration, seekSeconds);
  }

  buildSyntheticStreamerAndResolved(
    file: string,
    path: string,
    isH264: boolean,
    height: number | null,
  ): { synthetic: StreamerConfig; resolved: ResolvedStream } {
    const synthetic = StreamerSchema.parse({
      id: 'media-file',
      name: file,
      tiktok: 'media-file',
      video_mode: 'copy',
    });
    const resolved: ResolvedStream = {
      url: path,
      vcodec: isH264 ? 'h264' : 'other',
      height,
      formatId: null,
      isH264,
      title: file,
      resolvedAt: new Date(),
    };
    return { synthetic, resolved };
  }
}
