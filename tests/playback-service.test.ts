import { describe, expect, it } from 'vitest';
import { PlaybackService } from '../src/core/supervisor/playback-service.js';
import type { PlaylistRunState } from '../src/core/supervisor/playlist-controller.js';
import { QUEUE_PLAYLIST_ID } from '../src/core/supervisor/queue-controller.js';
import type { QueueSnapshot, StatusSnapshot } from '../src/core/events.js';

function status(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    state: 'live',
    active_streamer_id: 'alpha',
    active_streamer_name: 'Alpha',
    active_playlist: null,
    manual_screen: null,
    media: null,
    sink: { running: true },
    ...overrides,
  } as StatusSnapshot;
}

const queueSnapshot: QueueSnapshot = {
  entries: [
    { id: 'e1', channel: 'file:intro.mp4', kind: 'file', label: 'intro.mp4', duration_seconds: 252 },
    { id: 'e2', channel: 'bravo', kind: 'streamer', label: 'Bravo', duration_seconds: null },
  ],
  playing: true,
  index: 0,
  loop: false,
};

function service(options: {
  status?: Partial<StatusSnapshot>;
  active?: PlaylistRunState | null;
  loop?: boolean;
  playlistChannels?: string[];
}) {
  return new PlaybackService({
    queue: {
      isLoop: () => Boolean(options.loop),
      loopModeValue: () => (options.loop ? 'all' : 'off'),
      snapshot: () => ({ ...queueSnapshot, loop: Boolean(options.loop) }),
    } as never,
    status: () => status(options.status),
    activePlaylist: () => options.active ?? null,
    resolveChannelLabel: (channel) => ({
      label: channel.replace(/^file:/, ''),
      kind: channel.startsWith('file:') ? 'file' : 'streamer',
      channel,
    }),
    resolvePlaylistChannel: (playlistId, index) => {
      const channel = options.playlistChannels?.[index];
      if (!channel) return null;
      return {
        label: channel.replace(/^file:/, ''),
        kind: channel.startsWith('file:') ? 'file' : 'streamer',
        channel,
      };
    },
    ...({} as Record<string, never>),
  });
}

describe('playback state', () => {
  it('reports a running queue with current and next entry', () => {
    const state = service({
      active: {
        playlist: { id: QUEUE_PLAYLIST_ID, name: 'Regie', channels: ['file:intro.mp4', 'bravo'], wrap: false } as never,
        index: 0,
      },
    }).build();

    expect(state.source).toBe('queue');
    expect(state.playing).toBe(true);
    expect(state.paused).toBe(false);
    expect(state.current?.label).toBe('intro.mp4');
    expect(state.next?.label).toBe('Bravo');
    expect(state.queue_index).toBe(0);
    expect(state.loop).toBe('off');
  });

  it('wraps to the first queue entry when loop is on', () => {
    const state = service({
      loop: true,
      active: {
        playlist: { id: QUEUE_PLAYLIST_ID, name: 'Regie', channels: ['file:intro.mp4', 'bravo'], wrap: false } as never,
        index: 1,
      },
    }).build();

    expect(state.loop).toBe('all');
    expect(state.current?.label).toBe('Bravo');
    expect(state.next?.label).toBe('intro.mp4');
  });

  it('keeps the paused entry visible while the pause screen is on air', () => {
    const state = service({
      status: { state: 'paused', manual_screen: 'pause' },
      active: {
        playlist: { id: QUEUE_PLAYLIST_ID, name: 'Regie', channels: ['file:intro.mp4'], wrap: false } as never,
        index: 0,
      },
    }).build();

    expect(state.source).toBe('queue');
    expect(state.paused).toBe(true);
    expect(state.playing).toBe(false);
    expect(state.current?.label).toBe('intro.mp4');
  });

  it('reports a manual screen when nothing else is active', () => {
    const state = service({
      status: { state: 'paused', manual_screen: 'startup', active_streamer_id: null, active_streamer_name: null },
    }).build();

    expect(state.source).toBe('screen');
    expect(state.current?.label).toBe('Startbildschirm');
    expect(state.next).toBeNull();
  });

  it('falls back to a single streamer', () => {
    const state = service({ status: { active_streamer_id: 'alpha', active_streamer_name: 'Alpha' } }).build();
    expect(state.source).toBe('streamer');
    expect(state.current?.label).toBe('Alpha');
    expect(state.next).toBeNull();
  });

  it('reports idle without a source', () => {
    const state = service({
      status: { state: 'idle', active_streamer_id: null, active_streamer_name: null },
    }).build();
    expect(state.source).toBe('idle');
    expect(state.current).toBeNull();
    expect(state.playing).toBe(false);
  });

  it('describes a playlist with its next channel', () => {
    const state = service({
      playlistChannels: ['file:one.mp4', 'bravo', 'charlie'],
      active: {
        playlist: { id: 'pl-1', name: 'Abend', channels: ['file:one.mp4', 'bravo', 'charlie'], wrap: true } as never,
        index: 1,
      },
    }).build();

    expect(state.source).toBe('playlist');
    expect(state.current?.label).toBe('bravo');
    expect(state.next?.label).toBe('charlie');
    expect(state.loop).toBe('off');
  });

  it('exposes media position and duration for local videos', () => {
    const state = service({
      status: { media: { file: 'intro.mp4', position_seconds: 42, duration_seconds: 252 } },
      active: {
        playlist: { id: QUEUE_PLAYLIST_ID, name: 'Regie', channels: ['file:intro.mp4'], wrap: false } as never,
        index: 0,
      },
    }).build();

    expect(state.position_seconds).toBe(42);
    expect(state.duration_seconds).toBe(252);
  });
});
