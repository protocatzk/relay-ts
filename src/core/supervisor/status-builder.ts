import type { Settings, StreamerConfig } from '../config/schema.js';
import type { StatusSnapshot, StreamState } from '../events.js';
import type { TikTokSource } from '../source/tiktok-source.js';
import type { MpegTsRelay } from '../relay/relay-server.js';
import type { DelayBuffer } from '../relay/delay-buffer.js';
import type { YouTubeSink } from '../sink/youtube-sink.js';
import type { Watchdog } from './watchdog.js';
import type { AutoRefresh } from './auto-refresh.js';
import type { PlaylistRunState } from './playlist-controller.js';
import { isoOrNull } from '../../utils/format.js';
import { VERSION } from '../../version.js';

export interface StatusBuilderContext {
  state: StreamState;
  settings: Settings;
  activeStreamer: StreamerConfig | null;
  activePlaylist: PlaylistRunState | null;
  manualScreen: 'startup' | 'pause' | null;
  startedAt: Date | null;
  resolving: boolean;
  reconnects: number;
  lastError: string | null;
  reconnecting: boolean;
  monitorOnline: boolean | null;
  source?: ReturnType<TikTokSource['stats']>;
  relay?: ReturnType<MpegTsRelay['stats']>;
  delay?: ReturnType<DelayBuffer['stats']>;
  sink?: ReturnType<YouTubeSink['stats']>;
  watchdog?: ReturnType<Watchdog['stats']>;
  autoRefresh?: ReturnType<AutoRefresh['stats']>;
  chat: StatusSnapshot['chat'];
  media: StatusSnapshot['media'];
}

/** Builds the API/SSE status snapshot from the current supervisor state. */
export function buildStatusSnapshot(context: StatusBuilderContext): StatusSnapshot {
  const {
    state,
    settings,
    activeStreamer,
    activePlaylist,
    manualScreen,
    startedAt,
    resolving,
    reconnects,
    lastError,
    reconnecting,
    monitorOnline,
    source,
    relay,
    delay,
    sink,
    watchdog,
    autoRefresh,
    chat,
    media,
  } = context;
  const now = Date.now();
  return {
    state,
    active_streamer_id: activeStreamer?.id ?? null,
    active_streamer_name: activeStreamer?.name ?? null,
    active_playlist: activePlaylist
      ? {
          id: activePlaylist.playlist.id,
          name: activePlaylist.playlist.name,
          index: activePlaylist.index,
          total: activePlaylist.playlist.channels.length,
        }
      : null,
    manual_screen: manualScreen,
    started_at: isoOrNull(startedAt),
    uptime_seconds: startedAt ? Math.round((now - startedAt.getTime()) / 1000) : 0,
    source: {
      online: activeStreamer ? (state === 'live' ? true : monitorOnline) : null,
      resolving,
      connected: relay?.connected ?? false,
      pid: source?.pid ?? null,
      last_data_at: isoOrNull(relay?.lastDataAt ?? null),
      bitrate_kbps: source?.bitrateKbps ?? delay?.pacingKbps ?? null,
      reconnects,
    },
    relay: {
      ingest_clients: relay?.ingestClients ?? 0,
      output_connected: delay?.outputConnected ?? false,
      buffer_seconds: delay?.bufferSeconds ?? 0,
      buffered_bytes: delay?.bufferedBytes ?? 0,
      dropped_bytes: delay?.droppedBytes ?? 0,
      delay_seconds: delay?.delaySeconds ?? settings.delay_buffer.size,
      pacing_kbps: delay?.pacingKbps ?? null,
      total_bytes: relay?.totalBytes ?? 0,
    },
    sink: {
      running: sink?.running ?? false,
      pid: sink?.pid ?? null,
      bitrate_kbps: sink?.bitrateKbps ?? null,
      target_bitrate_kbps: sink?.targetBitrateKbps ?? settings.video.video_bitrate,
      fps: sink?.fps ?? null,
      dropped_frames: sink?.droppedFrames ?? 0,
      speed: sink?.speed ?? null,
      last_progress_at: isoOrNull(sink?.lastProgressAt ?? null),
      restarts: sink?.restarts ?? 0,
    },
    watchdog: {
      stall_timeout: settings.watchdog.stall_timeout,
      stall_count: watchdog?.stallCount ?? 0,
      last_stall_at: isoOrNull(watchdog?.lastStallAt ?? null),
      last_error: watchdog?.lastError ?? lastError,
      reconnecting,
    },
    auto_refresh: {
      enabled: autoRefresh?.enabled ?? settings.auto_refresh.enabled,
      interval_minutes: autoRefresh?.intervalMinutes ?? settings.auto_refresh.interval,
      next_refresh_in_seconds: autoRefresh?.nextRefreshInSeconds ?? null,
      last_refresh_at: isoOrNull(autoRefresh?.lastRefreshAt ?? null),
      count: autoRefresh?.count ?? 0,
    },
    chat,
    media,
    version: VERSION,
  };
}
