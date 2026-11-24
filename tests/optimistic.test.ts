import { describe, expect, it } from 'vitest';
import {
  canStart,
  canStop,
  canToggleScreens,
  nextSwitchCandidate,
} from '../src/web/src/actions/guards.js';
import {
  OPTIMISTIC_TTL_MS,
  StatusPatchStore,
  type StatusHolder,
} from '../src/web/src/composables/status-patch.js';
import type { StatusPayload, Streamer } from '../src/web/src/api/types.js';

function status(overrides: Partial<StatusPayload> = {}): StatusPayload {
  return {
    state: 'live',
    active_streamer_id: 'alpha',
    active_streamer_name: 'Alpha',
    active_playlist: null,
    manual_screen: null,
    started_at: null,
    uptime_seconds: 10,
    source: {
      online: true,
      resolving: false,
      connected: true,
      pid: 1,
      last_data_at: null,
      bitrate_kbps: 4000,
      reconnects: 0,
    },
    relay: {
      buffer_seconds: 0,
      delay_seconds: 0,
      ingest_clients: 1,
      catching_up: false,
      pacing_multiplier: 1.01,
    },
    sink: {
      running: true,
      bitrate_kbps: 6000,
      target_bitrate_kbps: 6000,
      fps: 20,
      dropped_frames: 0,
    },
    watchdog: {
      stall_timeout: 10,
      stall_count: 0,
      last_stall_at: null,
      last_error: null,
      reconnecting: false,
    },
    auto_refresh: {
      enabled: false,
      interval_minutes: 30,
      next_refresh_in_seconds: null,
      last_refresh_at: null,
      count: 0,
    },
    chat: {
      enabled: true,
      engine: 'canvas',
      messages: 0,
      last_message_at: null,
      api_configured: true,
      canvas_active: true,
      viewers: 100,
    },
    media: null,
    ...overrides,
  } as StatusPayload;
}

function streamer(id: string, online: boolean | null, active = false): Streamer {
  return {
    id,
    name: id,
    tiktok: id,
    youtube_key_set: true,
    youtube_key_source: 'streamer',
    quality: 'best',
    auto_start: false,
    preferred: false,
    priority: 0,
    enabled: true,
    own_stream: false,
    tiktok_account: '',
    tiktok_account_label: '',
    tiktok_account_missing: false,
    video_mode: 'copy',
    status: { online, active },
  };
}

describe('action guards', () => {
  it('blocks start while the stream is already live', () => {
    expect(canStart(status({ state: 'live' }))).toBe(false);
    expect(canStart(status({ state: 'idle' }))).toBe(true);
    expect(canStart(status({ state: 'reconnecting' }))).toBe(false);
  });

  it('requires an active target before stop is offered', () => {
    expect(canStop(status({ active_streamer_id: null }))).toBe(false);
    expect(canStop(status({ active_streamer_id: 'alpha' }))).toBe(true);
    expect(canStop(status({ state: 'stopping' }))).toBe(false);
    expect(canStop(null)).toBe(false);
  });

  it('allows screen toggles from idle and error states', () => {
    expect(canToggleScreens(status({ state: 'idle' }))).toBe(true);
    expect(canToggleScreens(status({ state: 'error' }))).toBe(true);
    expect(canToggleScreens(status({ state: 'stopping' }))).toBe(false);
  });

  it('picks the next live streamer that is not on air', () => {
    const current = status({ active_streamer_id: 'alpha' });
    const candidate = nextSwitchCandidate(current, [
      streamer('alpha', true, true),
      streamer('bravo', true),
      streamer('charlie', false),
    ]);
    expect(candidate?.id).toBe('bravo');
  });

  it('returns null when no other streamer is live', () => {
    const current = status({ active_streamer_id: 'alpha' });
    expect(
      nextSwitchCandidate(current, [streamer('alpha', true, true), streamer('bravo', false)]),
    ).toBeNull();
  });

  it('ignores disabled streamers when switching', () => {
    const current = status({ active_streamer_id: 'alpha' });
    const disabled = { ...streamer('bravo', true), enabled: false };
    expect(nextSwitchCandidate(current, [streamer('alpha', true, true), disabled])).toBeNull();
  });
});

describe('optimistic status patches', () => {
  function holder(): StatusHolder & { patcher: StatusPatchStore } {
    const state: StatusHolder = { status: status() };
    return Object.assign(state, { patcher: new StatusPatchStore(state) });
  }

  it('applies a guess immediately', () => {
    const store = holder();
    store.patcher.patch({ state: 'paused', manual_screen: 'pause' });
    expect(store.status?.state).toBe('paused');
    expect(store.status?.manual_screen).toBe('pause');
    expect(store.patcher.hasPending).toBe(true);
  });

  it('rolls back to the exact snapshot from before the click', () => {
    const store = holder();
    const before = JSON.parse(JSON.stringify(store.status));
    store.patcher.patch({ state: 'paused', manual_screen: 'pause' });
    store.patcher.rollback();
    expect(store.status).toEqual(before);
    expect(store.patcher.hasPending).toBe(false);
  });

  it('keeps merging several patches applied in sequence', () => {
    const store = holder();
    store.patcher.patch({ state: 'paused' });
    store.patcher.patch({ manual_screen: 'pause' });
    expect(store.status?.state).toBe('paused');
    expect(store.status?.manual_screen).toBe('pause');
  });

  it('re-applies the guess over a server snapshot inside the ttl', () => {
    const store = holder();
    store.patcher.patch({ state: 'paused' });
    const merged = store.patcher.merge(status({ state: 'live', uptime_seconds: 99 }));
    expect(merged.state).toBe('paused');
    expect(merged.uptime_seconds).toBe(99);
  });

  it('lets the server win once the guess is older than the ttl', () => {
    const store = holder();
    store.patcher.patch({ state: 'paused' });
    const merged = store.patcher.merge(
      status({ state: 'live' }),
      Date.now() + OPTIMISTIC_TTL_MS + 1,
    );
    expect(merged.state).toBe('live');
    expect(store.patcher.hasPending).toBe(false);
  });

  it('does nothing without a status snapshot', () => {
    const state: StatusHolder = { status: null };
    const patcher = new StatusPatchStore(state);
    patcher.patch({ state: 'paused' });
    expect(state.status).toBeNull();
    expect(patcher.hasPending).toBe(false);
  });
});
