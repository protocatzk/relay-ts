import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { StreamerSchema } from '../src/core/config/schema.js';
import { QueueController, QUEUE_PLAYLIST_ID } from '../src/core/supervisor/queue-controller.js';
import { StreamerStore } from '../src/core/store/streamer-store.js';

const logger = pino({ level: 'silent' });
let temp: string | null = null;

afterEach(() => {
  if (temp) {
    rmSync(temp, { recursive: true, force: true });
    temp = null;
  }
});

function setup() {
  temp = mkdtempSync(join(tmpdir(), 'relay-queue-'));
  const dataDir = join(temp, 'data');
  mkdirSync(join(dataDir, 'media'), { recursive: true });
  writeFileSync(join(dataDir, 'media', 'clip.mp4'), 'x');
  const streamers = [
    StreamerSchema.parse({ id: 'alpha', name: 'Alpha', tiktok: 'alpha' }),
    StreamerSchema.parse({ id: 'beta', name: 'Beta', tiktok: 'beta' }),
  ];
  const store = new StreamerStore(
    join(temp, 'streamers.yml'),
    { streamers, playlists: [] },
    logger,
  );
  const path = join(dataDir, 'queue.json');
  const controller = new QueueController({ path, dataDir, store, logger });
  return { controller, path, dataDir, store };
}

describe('QueueController', () => {
  it('adds files, streamers and screens with labels and kinds', () => {
    const { controller } = setup();
    controller.add('file:clip.mp4');
    controller.add('alpha');
    controller.add('screen:pause');

    const snapshot = controller.snapshot(false, null);
    expect(snapshot.entries.map((entry) => entry.kind)).toEqual(['file', 'streamer', 'screen']);
    expect(snapshot.entries.map((entry) => entry.label)).toEqual([
      'clip.mp4',
      'Alpha',
      'Pausenscreen',
    ]);
    expect(snapshot.playing).toBe(false);
    expect(snapshot.index).toBeNull();
  });

  it('exposes a synthetic playlist matching the queue order', () => {
    const { controller } = setup();
    controller.add('file:clip.mp4');
    controller.add('beta');
    const playlist = controller.playlist();
    expect(playlist.id).toBe(QUEUE_PLAYLIST_ID);
    expect(playlist.channels).toEqual(['file:clip.mp4', 'beta']);
  });

  it('moves, removes and clears entries', () => {
    const { controller } = setup();
    const first = controller.add('alpha');
    controller.add('beta');
    const third = controller.add('screen:startup');

    expect(controller.move(third.id, 0)).toBe(true);
    expect(controller.channels()).toEqual(['screen:startup', 'alpha', 'beta']);
    expect(controller.remove(first.id)).toBe(true);
    expect(controller.channels()).toEqual(['screen:startup', 'beta']);
    controller.clear();
    expect(controller.channels()).toEqual([]);
  });

  it('inserts at a position for "play now"', () => {
    const { controller } = setup();
    controller.add('alpha');
    controller.add('beta');
    controller.insertAt('file:clip.mp4', 1);
    expect(controller.channels()).toEqual(['alpha', 'file:clip.mp4', 'beta']);
  });

  it('persists entries and reloads them in a new instance', () => {
    const { controller, path, dataDir, store } = setup();
    controller.add('alpha');
    const second = controller.add('screen:pause');

    const reloaded = new QueueController({ path, dataDir, store, logger });
    expect(reloaded.channels()).toEqual(['alpha', 'screen:pause']);
    expect(reloaded.snapshot(false, null).entries[1]?.id).toBe(second.id);
  });

  it('persists and clears the playback position for resume', () => {
    const { controller, path, dataDir, store } = setup();
    controller.add('file:clip.mp4');
    controller.setPlayback({
      channel: 'file:clip.mp4',
      position_seconds: 42,
      duration_seconds: 120,
      updated_at: '2026-11-20T00:00:00.000Z',
    });

    const reloaded = new QueueController({ path, dataDir, store, logger });
    expect(reloaded.getPlayback()).toEqual({
      channel: 'file:clip.mp4',
      position_seconds: 42,
      duration_seconds: 120,
      updated_at: '2026-11-20T00:00:00.000Z',
    });

    reloaded.clearPlayback();
    const again = new QueueController({ path, dataDir, store, logger });
    expect(again.getPlayback()).toBeNull();
  });

  it('rejects unknown streamers and missing media files', () => {
    const { controller } = setup();
    expect(() => controller.add('nobody')).toThrow(/Streamer "nobody"/);
    expect(() => controller.add('file:missing.mp4')).toThrow(/missing\.mp4/);
  });

  it('reports the active index when playing', () => {
    const { controller } = setup();
    controller.add('alpha');
    controller.add('beta');
    const snapshot = controller.snapshot(true, 1);
    expect(snapshot.playing).toBe(true);
    expect(snapshot.index).toBe(1);
  });
});

describe('queue loop modes and playlist import (#94)', () => {
  it('migrates the legacy boolean loop into loop_mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-queue-loop-'));
    const path = join(dir, 'queue.json');
    writeFileSync(
      path,
      JSON.stringify({
        version: 2,
        entries: [{ id: 'a', channel: 'file:a.mp4' }],
        playback: null,
        loop: true,
      }),
    );
    const controller = new QueueController({
      path,
      dataDir: dir,
      store: new StreamerStore(join(dir, 'streamers.yml'), { streamers: [], playlists: [] }, logger),
      logger,
    });
    expect(controller.loopModeValue()).toBe('all');
    expect(controller.isLoop()).toBe(true);
  });

  it('persists loop mode one and keeps the boolean alias off', () => {
    const { controller, path, dataDir, store } = setup();
    controller.setLoopMode('one');
    expect(controller.loopModeValue()).toBe('one');
    expect(controller.isLoop()).toBe(false);

    const reread = new QueueController({ path, dataDir, store, logger });
    expect(reread.loopModeValue()).toBe('one');
    expect(reread.snapshot(true, 0).loop_mode).toBe('one');
  });

  it('replaces and appends playlist channels as a copy', () => {
    const { controller } = setup();
    controller.replaceAll(['file:clip.mp4', 'beta']);
    expect(controller.get().map((entry) => entry.channel)).toEqual(['file:clip.mp4', 'beta']);

    controller.appendMany(['alpha']);
    expect(controller.get()).toHaveLength(3);
    expect(controller.get()[2]?.channel).toBe('alpha');
  });
});

describe('queue history (#94)', () => {
  it('records started entries, newest first, and collapses repeats', () => {
    const { controller } = setup();
    controller.recordHistory('alpha');
    controller.recordHistory('alpha');
    controller.recordHistory('beta');

    const history = controller.history();
    expect(history.map((entry) => entry.channel)).toEqual(['beta', 'alpha']);
    expect(history[0]?.label).toBe('Beta');
    expect(typeof history[0]?.played_at).toBe('string');
  });

  it('keeps only the last twenty entries across reloads', () => {
    const { controller, path, dataDir, store } = setup();
    for (let index = 0; index < 25; index += 1) {
      controller.recordHistory(index % 2 === 0 ? 'alpha' : 'beta');
    }
    expect(controller.history()).toHaveLength(20);

    const reread = new QueueController({ path, dataDir, store, logger });
    expect(reread.history()).toHaveLength(20);
  });
});
