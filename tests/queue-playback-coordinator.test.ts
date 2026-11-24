import { describe, expect, it, vi } from 'vitest';
import { QueuePlaybackCoordinator } from '../src/core/supervisor/queue-playback-coordinator.js';
import type { QueueController } from '../src/core/supervisor/queue-controller.js';
import type { PlaylistController } from '../src/core/supervisor/playlist-controller.js';
import type { MediaPlaybackController } from '../src/core/supervisor/media-playback-controller.js';
import { AsyncLock } from '../src/utils/process.js';
import pino from 'pino';

describe('QueuePlaybackCoordinator', () => {
  it('manages queue operations and snapshots', async () => {
    const queueEntries: Array<{ id: string; channel: string }> = [];
    const queueMock = {
      snapshot: vi.fn().mockReturnValue({ entries: queueEntries, loop: false, active_index: null }),
      add: vi.fn((ch: string) => {
        const entry = { id: `id-${queueEntries.length}`, channel: ch };
        queueEntries.push(entry);
        return entry;
      }),
      remove: vi.fn((id: string) => {
        const idx = queueEntries.findIndex((e) => e.id === id);
        if (idx >= 0) {
          queueEntries.splice(idx, 1);
          return true;
        }
        return false;
      }),
      indexOfId: vi.fn((id: string) => queueEntries.findIndex((e) => e.id === id)),
      entryIdAt: vi.fn((idx: number) => queueEntries[idx]?.id ?? null),
      setLoop: vi.fn(),
      setLoopMode: vi.fn(),
      clear: vi.fn(() => queueEntries.splice(0, queueEntries.length)),
      clearPlayback: vi.fn(),
      get: vi.fn().mockReturnValue(queueEntries),
    } as unknown as QueueController;

    const playlistMock = {
      current: null,
      play: vi.fn().mockResolvedValue({ state: 'playing' }),
      next: vi.fn().mockResolvedValue({ state: 'playing' }),
      setIndex: vi.fn(),
    } as unknown as PlaylistController;

    const mediaMock = {} as unknown as MediaPlaybackController;

    const coordinator = new QueuePlaybackCoordinator({
      queue: queueMock,
      playlistController: playlistMock,
      media: mediaMock,
      getSinkKey: () => 'test-key',
      lock: new AsyncLock(),
      logger: pino({ level: 'silent' }),
      emitQueue: vi.fn(),
      stopInternalLocked: vi.fn().mockResolvedValue({}),
      stop: vi.fn().mockResolvedValue({}),
      startFileLocked: vi.fn().mockResolvedValue({}),
    });

    const snap1 = await coordinator.add('test-channel');
    expect(snap1).toBeDefined();
    expect(queueMock.add).toHaveBeenCalledWith('test-channel');

    await coordinator.setLoop(true);
    // The boolean API now maps onto the loop mode (#94).
    expect(queueMock.setLoopMode).toHaveBeenCalledWith('all');

    await coordinator.clear();
    expect(queueMock.clear).toHaveBeenCalled();
  });
});
