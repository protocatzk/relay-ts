import type { PlaylistConfig, StreamerConfig } from '../config/schema.js';
import { sortStreamersByPriority } from '../streamer-order.js';
import type { PlaylistRunState } from './playlist-controller.js';

export interface PreferredReturnTarget {
  kind: 'streamer' | 'file';
  streamer?: StreamerConfig;
  file?: string;
  key: string;
  playlist?: PlaylistRunState;
  seekSeconds?: number;
}

export class AutoSwitchController {
  private preferredReturn: PreferredReturnTarget | null = null;
  private readonly endedPreferred = new Map<string, number>();

  get returnTarget(): PreferredReturnTarget | null {
    return this.preferredReturn;
  }

  setReturnTarget(target: PreferredReturnTarget | null): void {
    this.preferredReturn = target;
  }

  clearReturnTarget(): void {
    this.preferredReturn = null;
  }

  markEnded(streamerId: string): void {
    this.endedPreferred.set(streamerId, Date.now());
  }

  cleanEnded(
    now: number,
    isStreamerOnline: (id: string) => boolean | null,
    hasStreamer: (id: string) => boolean,
  ): void {
    for (const [id, endedAt] of this.endedPreferred) {
      if (!hasStreamer(id) || isStreamerOnline(id) === false || now - endedAt > 300_000) {
        this.endedPreferred.delete(id);
      }
    }
  }

  isSuppressed(id: string, now = Date.now()): boolean {
    const endedAt = this.endedPreferred.get(id);
    if (!endedAt) return false;
    if (now - endedAt > 300_000) {
      this.endedPreferred.delete(id);
      return false;
    }
    return true;
  }

  findPreferredCandidate(
    active: StreamerConfig | null,
    streamers: StreamerConfig[],
    isOnline: (s: StreamerConfig) => boolean | null,
    resolveKey: (s: StreamerConfig) => string | null,
  ): StreamerConfig | null {
    const candidates = sortStreamersByPriority(
      streamers.filter(
        (streamer) =>
          streamer.enabled &&
          streamer.preferred &&
          streamer.id !== active?.id &&
          isOnline(streamer) === true &&
          Boolean(resolveKey(streamer)) &&
          !this.isSuppressed(streamer.id),
      ),
    );
    if (candidates.length === 0) return null;

    const candidate = candidates[0]!;
    if (active?.preferred) {
      // A manually selected preferred streamer is never replaced.
      // After an automatic takeover only a strictly better priority may take over.
      if (!this.preferredReturn) return null;
      if (candidate.priority >= active.priority) return null;
    }
    return candidate;
  }

  captureReturnTarget(
    sinkKey: string | null,
    activeStreamer: StreamerConfig | null,
    activeMediaFile: string | null,
    mediaPosition: number,
    currentPlaylist: PlaylistRunState | null,
  ): PreferredReturnTarget | null {
    if (!sinkKey) return null;
    if (activeMediaFile) {
      if (!currentPlaylist) return null;
      return {
        kind: 'file',
        file: activeMediaFile,
        key: sinkKey,
        playlist: currentPlaylist,
        seekSeconds: mediaPosition,
      };
    }
    if (activeStreamer) {
      return {
        kind: 'streamer',
        streamer: activeStreamer,
        key: sinkKey,
        playlist: currentPlaylist ?? undefined,
      };
    }
    return null;
  }

  refreshReturnPlaylist(
    state: PlaylistRunState,
    resolvePlaylist: (id: string) => PlaylistConfig | null,
  ): PlaylistRunState {
    const playlist = resolvePlaylist(state.playlist.id) ?? state.playlist;
    const maxIndex = Math.max(0, playlist.channels.length - 1);
    return { playlist, index: Math.min(Math.max(0, state.index), maxIndex) };
  }

  autoStartCandidates(streamers: StreamerConfig[]): StreamerConfig[] {
    return sortStreamersByPriority(
      streamers.filter((streamer) => streamer.enabled && streamer.auto_start),
    );
  }
}
