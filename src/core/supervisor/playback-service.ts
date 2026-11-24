import type {
  PlaybackEntry,
  PlaybackLoop,
  PlaybackSource,
  PlaybackState,
  QueueEntryKind,
  StatusSnapshot,
} from '../events.js';
import type { PlaylistRunState } from './playlist-controller.js';
import { QUEUE_PLAYLIST_ID, type QueueController } from './queue-controller.js';

export interface PlaybackServiceDeps {
  queue: QueueController;
  status: () => StatusSnapshot;
  activePlaylist: () => PlaylistRunState | null;
  held?: () => boolean;
  resolveChannelLabel: (channel: string) => { label: string; kind: QueueEntryKind };
  resolvePlaylistChannel: (
    playlistId: string,
    index: number,
  ) => { label: string; kind: QueueEntryKind; channel: string } | null;
}

/**
 * Read-only view over everything the app can put on air (#94).
 *
 * The service owns no state: it derives a single `PlaybackState` from the
 * playlist controller, the regie queue and the status snapshot, so the cockpit
 * has one transport instead of one per subsystem.
 */
export class PlaybackService {
  constructor(private readonly deps: PlaybackServiceDeps) {}

  build(statusSnapshot?: StatusSnapshot): PlaybackState {
    const status = statusSnapshot ?? this.deps.status();
    const active = this.deps.activePlaylist();
    const isQueue = active?.playlist.id === QUEUE_PLAYLIST_ID;
    const paused = status.state === 'paused';
    const source = this.resolveSource(status, active);
    const queueEntries = isQueue ? this.deps.queue.snapshot(true, active?.index ?? 0).entries : [];

    return {
      source,
      playing: this.isPlaying(status),
      paused,
      position_seconds: status.media?.position_seconds ?? null,
      duration_seconds: status.media?.duration_seconds ?? null,
      current: this.resolveCurrent(status, active, isQueue, queueEntries),
      next: this.resolveNext(status, active, isQueue, queueEntries),
      loop: this.resolveLoop(isQueue),
      queue_index: isQueue ? (active?.index ?? null) : null,
      held: this.deps.held?.() ?? false,
      updated_at: new Date().toISOString(),
    };
  }

  private resolveSource(
    status: StatusSnapshot,
    active: PlaylistRunState | null,
  ): PlaybackSource {
    // While paused the paused entry stays the logical source: the transport
    // resumes it, so the operator sees what comes back (#94).
    if (!active) {
      if (status.active_streamer_id) return 'streamer';
      return status.manual_screen ? 'screen' : 'idle';
    }
    return active.playlist.id === QUEUE_PLAYLIST_ID ? 'queue' : 'playlist';
  }

  private isPlaying(status: StatusSnapshot): boolean {
    if (status.state === 'paused') return false;
    return (
      status.state === 'live' || status.state === 'starting' || status.state === 'reconnecting'
    );
  }

  private resolveLoop(isQueue: boolean): PlaybackLoop {
    if (!isQueue) return 'off';
    return this.deps.queue.loopModeValue();
  }

  private resolveCurrent(
    status: StatusSnapshot,
    active: PlaylistRunState | null,
    isQueue: boolean,
    queueEntries: ReturnType<QueueController['snapshot']>['entries'],
  ): PlaybackEntry | null {
    if (isQueue && active) {
      const entry = queueEntries[active.index];
      if (entry) return { kind: entry.kind, id: entry.id, label: entry.label, channel: entry.channel };
      return null;
    }
    if (status.manual_screen) {
      return {
        kind: 'screen',
        id: `screen:${status.manual_screen}`,
        label: status.manual_screen === 'startup' ? 'Startbildschirm' : 'Pausenscreen',
        channel: `screen:${status.manual_screen}`,
      };
    }
    if (active) {
      const resolved = this.deps.resolvePlaylistChannel(active.playlist.id, active.index);
      if (resolved) {
        return {
          kind: resolved.kind,
          id: resolved.channel,
          label: resolved.label,
          channel: resolved.channel,
        };
      }
      return null;
    }
    if (status.active_streamer_id) {
      return {
        kind: 'streamer',
        id: status.active_streamer_id,
        label: status.active_streamer_name ?? status.active_streamer_id,
        channel: status.active_streamer_id,
      };
    }
    return null;
  }

  private resolveNext(
    status: StatusSnapshot,
    active: PlaylistRunState | null,
    isQueue: boolean,
    queueEntries: ReturnType<QueueController['snapshot']>['entries'],
  ): PlaybackEntry | null {
    if (isQueue && active) {
      const nextIndex = active.index + 1;
      const loopAll = this.deps.queue.loopModeValue() === 'all';
      const entry =
        queueEntries[nextIndex] ??
        (loopAll ? queueEntries[0] : undefined) ??
        // loop "one" repeats the current entry, so it is also "next".
        (this.deps.queue.loopModeValue() === 'one' ? queueEntries[active.index] : undefined);
      if (entry) return { kind: entry.kind, id: entry.id, label: entry.label, channel: entry.channel };
      return null;
    }
    if (active) {
      const nextIndex = active.index + 1;
      const wrapped = nextIndex < active.playlist.channels.length ? nextIndex : active.playlist.wrap ? 0 : -1;
      if (wrapped < 0) return null;
      const resolved = this.deps.resolvePlaylistChannel(active.playlist.id, wrapped);
      if (!resolved) return null;
      return { kind: resolved.kind, id: resolved.channel, label: resolved.label, channel: resolved.channel };
    }
    // A single streamer has no queue context; the cockpit offers "Weiter" only
    // when a queue or playlist is running.
    void status;
    return null;
  }
}
