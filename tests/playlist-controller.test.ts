import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { PlaylistSchema, StreamerSchema } from '../src/core/config/schema.js';
import type { StatusSnapshot } from '../src/core/events.js';
import { StreamerStore } from '../src/core/store/streamer-store.js';
import { PlaylistController } from '../src/core/supervisor/playlist-controller.js';
import { AsyncLock } from '../src/utils/process.js';
import { StreamerOfflineError } from '../src/utils/errors.js';

const logger = pino({ level: 'silent' });
const status = { state: 'live' } as unknown as StatusSnapshot;

let temp: string | null = null;

afterEach(() => {
  if (temp) {
    rmSync(temp, { recursive: true, force: true });
    temp = null;
  }
});

function setup(options: {
  channels?: string[];
  wrap?: boolean;
  autoAdvance?: boolean;
  streamers?: Array<{ id: string; enabled?: boolean; own?: boolean }>;
  failOffline?: string[];
}) {
  temp = mkdtempSync(join(tmpdir(), 'relay-playlist-'));
  const streamers = (options.streamers ?? [{ id: 'alpha' }, { id: 'beta' }]).map((item) =>
    StreamerSchema.parse({
      id: item.id,
      name: item.id,
      tiktok: item.id,
      enabled: item.enabled ?? true,
      own_stream: item.own ?? false,
    }),
  );
  const store = new StreamerStore(
    join(temp, 'streamers.yml'),
    {
      streamers,
      playlists: [
        PlaylistSchema.parse({
          id: 'mix',
          name: 'Mix',
          channels: options.channels ?? ['alpha', 'beta'],
          wrap: options.wrap ?? false,
          auto_advance: options.autoAdvance ?? true,
          advance_delay_seconds: 0,
          youtube_key: 'playlist-key',
        }),
      ],
    },
    logger,
  );

  const started: Array<{ id: string; index: number }> = [];
  const stops: number[] = [];
  const transitions: string[] = [];
  const controller = new PlaylistController({
    store,
    logger,
    lock: new AsyncLock(),
    isShuttingDown: () => false,
    startStreamer: async (streamer, startOptions) => {
      if (options.failOffline?.includes(streamer.id)) {
        throw new StreamerOfflineError(`@${streamer.id} ist offline`);
      }
      started.push({ id: streamer.id, index: startOptions.playlist.index });
      controller.activate(startOptions.playlist);
      return status;
    },
    startFile: async (file, startOptions) => {
      started.push({ id: `file:${file}`, index: startOptions.playlist.index });
      controller.activate(startOptions.playlist);
      return status;
    },
    stopAll: async () => {
      stops.push(1);
      controller.detach();
      return status;
    },
    transition: (state) => transitions.push(state),
    emitStatus: () => undefined,
    emitAll: () => undefined,
    setLastError: () => undefined,
  });
  return { controller, started, stops, transitions, store };
}

describe('PlaylistController', () => {
  it('starts the first playable channel and exposes the active state', async () => {
    const { controller, started } = setup({ channels: ['alpha'] });
    await controller.play('mix');
    expect(started).toEqual([{ id: 'alpha', index: 0 }]);
    expect(controller.current?.index).toBe(0);
    expect(controller.current?.playlist.id).toBe('mix');
  });

  it('skips disabled channels and advances with wrap', async () => {
    const { controller, started } = setup({
      channels: ['alpha', 'beta'],
      wrap: true,
      streamers: [
        { id: 'alpha', enabled: false },
        { id: 'beta' },
      ],
    });
    await controller.play('mix');
    expect(started).toEqual([{ id: 'beta', index: 1 }]);
  });

  it('starts local file entries and advances after they end', async () => {
    const { controller, started } = setup({ channels: ['file:intro.mp4', 'alpha'] });
    await controller.play('mix');
    expect(started[0]).toEqual({ id: 'file:intro.mp4', index: 0 });
    await controller.advanceAfterFile();
    expect(started[1]).toEqual({ id: 'alpha', index: 1 });
  });

  it('wraps to the first channel after the last one', async () => {
    const { controller, started } = setup({ channels: ['alpha', 'beta'], wrap: true });
    await controller.play('mix');
    await controller.next();
    await controller.next();
    expect(started.map((item) => item.id)).toEqual(['alpha', 'beta', 'alpha']);
  });

  it('stops the playlist after the last channel without wrap', async () => {
    const { controller, started, stops } = setup({ channels: ['alpha'] });
    await controller.play('mix');
    await controller.next();
    expect(started).toHaveLength(1);
    expect(stops).toHaveLength(1);
    expect(controller.current).toBeNull();
  });

  it('goes back with wrap and stays at the start otherwise', async () => {
    const { controller, started } = setup({ channels: ['alpha', 'beta'], wrap: true });
    await controller.play('mix');
    await controller.previous();
    expect(started.at(-1)).toEqual({ id: 'beta', index: 1 });
  });

  it('tunes to a channel by handle', async () => {
    const { controller, started } = setup({ channels: ['alpha', 'beta'] });
    await controller.play('mix');
    await controller.tune('beta');
    expect(started.at(-1)).toEqual({ id: 'beta', index: 1 });
  });

  it('skips offline entries and starts the next channel', async () => {
    const { controller, started } = setup({
      channels: ['alpha', 'beta'],
      failOffline: ['alpha'],
    });
    await controller.play('mix');
    expect(started).toEqual([{ id: 'beta', index: 1 }]);
  });

  it('rethrows errors that are not offline errors', async () => {
    const { controller, started } = setup({ channels: ['alpha'] });
    const original = controller['deps'].startStreamer;
    controller['deps'].startStreamer = async () => {
      throw new Error('boom');
    };
    await expect(controller.play('mix')).rejects.toThrow('boom');
    expect(started).toHaveLength(0);
    controller['deps'].startStreamer = original;
  });
});
