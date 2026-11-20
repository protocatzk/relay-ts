import { Subject, type Observable } from 'rxjs';
import type { LogEntry } from '../utils/logger.js';
import type { StreamerView } from './store/streamer-store.js';
import type { EarningsSnapshot } from './earnings/monitor.js';

export type StreamState = 'idle' | 'starting' | 'live' | 'reconnecting' | 'paused' | 'stopping' | 'error';

export interface StatusSnapshot {
  state: StreamState;
  active_streamer_id: string | null;
  active_streamer_name: string | null;
  active_playlist: { id: string; name: string; index: number; total: number } | null;
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

/** Ephemeral-by-content, persisted "regie" queue of videos, streamers and screens. */
export interface QueueSnapshot {
  entries: QueueViewEntry[];
  playing: boolean;
  index: number | null;
  loop: boolean;
}

export type SystemEvent =
  | { type: 'status'; data: StatusSnapshot }
  | { type: 'streamers'; data: StreamerView[] }
  | { type: 'log'; data: LogEntry }
  | { type: 'earnings'; data: EarningsSnapshot }
  | { type: 'queue'; data: QueueSnapshot };

export class EventBus {
  private readonly subject = new Subject<SystemEvent>();

  emit(event: SystemEvent): void {
    this.subject.next(event);
  }

  observe(): Observable<SystemEvent> {
    return this.subject.asObservable();
  }
}
