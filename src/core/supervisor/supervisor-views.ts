import type { PlaylistConfig, StreamerConfig } from '../config/schema.js';
import { resolveStreamKey } from '../config/schema.js';
import type { StreamerStore, StreamerView } from '../store/streamer-store.js';
import type { OnlineMonitor } from '../online/monitor.js';
import type { PlaylistRunState } from './playlist-controller.js';

export interface PlaylistView {
  id: string;
  name: string;
  channels: string[];
  auto_advance: boolean;
  wrap: boolean;
  advance_delay_seconds: number;
  end_after_minutes: number | null;
  end_time: string | null;
  youtube_key_set: boolean;
  active: boolean;
  index: number | null;
}

export function formatStreamTitle(
  template: string,
  streamer: StreamerConfig,
  resolvedTitle: string,
): string {
  const now = new Date();
  return template
    .replaceAll('{name}', streamer.name)
    .replaceAll('{tiktok}', streamer.tiktok.replace(/^@+/, ''))
    .replaceAll('{title}', resolvedTitle || streamer.name)
    .replaceAll('{date}', now.toLocaleDateString('de-DE'))
    .replaceAll('{time}', now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }))
    .slice(0, 200);
}

export function buildStreamersView(
  streamers: StreamerConfig[],
  activeStreamerId: string | null,
  isLive: boolean,
  online: OnlineMonitor,
  store: StreamerStore,
  startingStreamerId: string | null = null,
  accounts?: { getById(id: string): { label: string } | null },
): StreamerView[] {
  return streamers.map((streamer) => {
    const monitor = online.isOnline(streamer);
    const isStarting = streamer.id === startingStreamerId;
    const isStreamOnline = (streamer.id === activeStreamerId && isLive) || isStarting ? true : monitor;
    const view = store.view(streamer, activeStreamerId, isStreamOnline, accounts);
    if (isStarting) {
      view.status.active = true;
    }
    return view;
  });
}

export function buildPlaylistsView(
  playlists: PlaylistConfig[],
  active: PlaylistRunState | null,
  resolveChannel: (channel: string) => StreamerConfig | null,
): PlaylistView[] {
  return playlists.map((playlist) => {
    const playlistKey = resolveStreamKey(playlist).key;
    const channelsHaveKey =
      Boolean(playlistKey) ||
      playlist.channels.some((channel) => {
        const streamer = resolveChannel(channel);
        return streamer ? Boolean(resolveStreamKey(streamer).key) : false;
      });
    return {
      id: playlist.id,
      name: playlist.name,
      channels: playlist.channels,
      auto_advance: playlist.auto_advance,
      wrap: playlist.wrap,
      advance_delay_seconds: playlist.advance_delay_seconds,
      end_after_minutes: playlist.end_after_minutes ?? null,
      end_time: playlist.end_time ?? null,
      youtube_key_set: channelsHaveKey,
      active: active?.playlist.id === playlist.id,
      index: active?.playlist.id === playlist.id ? active.index : null,
    };
  });
}
