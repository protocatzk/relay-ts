import { Subject, type Observable } from 'rxjs';
import type { LogEntry } from '../utils/logger.js';
import type { DiscoveryResponse } from './source/discovery/types.js';
import type { StreamerView } from './store/streamer-store.js';
import type { EarningsSnapshot } from './earnings/monitor.js';

export type StreamState = 'idle' | 'starting' | 'live' | 'reconnecting' | 'paused' | 'stopping' | 'error';

export interface StatusSnapshot {
  state: StreamState;
  active_streamer_id: string | null;
  active_streamer_name: string | null;
  active_playlist: { id: string; name: string; index: number; total: number } | null;
  active_scene_id: string | null;
  active_scene_name: string | null;
  manual_screen: 'startup' | 'pause' | null;
  started_at: string | null;
  uptime_seconds: number;
  source: {
    online: boolean | null;
    resolving: boolean;
    connected: boolean;
    pid: number | null;
    last_data_at: string | null;
    bitrate_kbps: number | null;
    reconnects: number;
  };
  relay: {
    ingest_clients: number;
    output_connected: boolean;
    buffer_seconds: number;
    excess_seconds: number;
    catching_up: boolean;
    pacing_multiplier: number;
    buffered_bytes: number;
    dropped_bytes: number;
    delay_seconds: number;
    pacing_kbps: number | null;
    total_bytes: number;
  };
  sink: {
    running: boolean;
    pid: number | null;
    bitrate_kbps: number | null;
    target_bitrate_kbps: number | null;
    fps: number | null;
    dropped_frames: number;
    speed: string | null;
    last_progress_at: string | null;
    restarts: number;
    dts_errors: number;
    silence_active: boolean;
    silence_since: string | null;
    last_error: string | null;
  };
  watchdog: {
    stall_timeout: number;
    stall_count: number;
    last_stall_at: string | null;
    last_error: string | null;
    reconnecting: boolean;
  };
  auto_refresh: {
    enabled: boolean;
    interval_minutes: number;
    next_refresh_in_seconds: number | null;
    last_refresh_at: string | null;
    count: number;
  };
  chat: {
    enabled: boolean;
    engine: 'canvas' | 'drawtext' | null;
    messages: number;
    last_message_at: string | null;
    api_configured: boolean;
    canvas_active: boolean;
    /** Live viewer count from the webcast socket; null when unknown (#88). */
    viewers: number | null;
  };
  media: {
    file: string;
    duration_seconds: number;
    position_seconds: number;
  } | null;
  secondary_sink?: {
    enabled: boolean;
    provider: 'twitch' | 'kick' | 'custom';
    mode: 'copy' | 'reencode';
    running: boolean;
    pid: number | null;
    bitrate_kbps: number | null;
    fps: number | null;
    restarts: number;
    last_error: string | null;
  };
  recording?: {
    enabled: boolean;
    active: boolean;
    filename: string | null;
    started_at: string | null;
    bytes: number;
    disk_warning: string | null;
    last_error: string | null;
  };
  rtmp_ingest?: {
    enabled: boolean;
    running: boolean;
    port: number;
    active_client: boolean;
    client_ip: string | null;
    connected_at: string | null;
    ingest_url: string;
    stream_key_set: boolean;
  };
  disconnect_protection?: {
    active: boolean;
    events: number;
    started_at: string | null;
  };
  version: string;
}

export type QueueEntryKind = 'file' | 'streamer' | 'screen';

export interface QueueViewEntry {
  id: string;
  channel: string;
  kind: QueueEntryKind;
  label: string;
  duration_seconds: number | null;
}

/** One thing the app can put on air (#94). */
export interface PlaybackEntry {
  kind: QueueEntryKind;
  id: string;
  label: string;
  channel: string;
}

export type PlaybackSource = 'queue' | 'playlist' | 'streamer' | 'screen' | 'idle';
export type PlaybackLoop = 'off' | 'all' | 'one';

/**
 * Unified playback view (#94): one transport for queue, playlist, a single
 * streamer and screens.
 */
export interface PlaybackState {
  source: PlaybackSource;
  playing: boolean;
  paused: boolean;
  position_seconds: number | null;
  duration_seconds: number | null;
  current: PlaybackEntry | null;
  next: PlaybackEntry | null;
  loop: PlaybackLoop;
  queue_index: number | null;
  /** True while the operator holds automatic progression (#94). */
  held: boolean;
  updated_at: string;
}

/** Ephemeral-by-content, persisted "regie" queue of videos, streamers and screens. */
export interface QueueSnapshot {
  entries: QueueViewEntry[];
  playing: boolean;
  index: number | null;
  /** Legacy boolean alias for `loop_mode === 'all'`. */
  loop: boolean;
  /** `one` repeats the running entry (#94). */
  loop_mode?: PlaybackLoop;
}

export type SystemEvent =
  | { type: 'status'; data: StatusSnapshot }
  | { type: 'streamers'; data: StreamerView[] }
  | { type: 'log'; data: LogEntry }
  | { type: 'earnings'; data: EarningsSnapshot }
  | { type: 'queue'; data: QueueSnapshot }
  | { type: 'playback'; data: PlaybackState }
  | { type: 'scene'; data: { active_scene_id: string | null; active_scene_name: string | null } }
  | { type: 'discovery'; data: DiscoveryResponse };

export class EventBus {
  private readonly subject = new Subject<SystemEvent>();

  emit(event: SystemEvent): void {
    this.subject.next(event);
  }

  observe(): Observable<SystemEvent> {
    return this.subject.asObservable();
  }

  hasObservers(): boolean {
    return this.subject.observed;
  }

  get observerCount(): number {
    return this.subject.observers.length;
  }
}
