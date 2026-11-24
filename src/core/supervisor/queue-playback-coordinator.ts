import type { Logger } from 'pino';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import type { AsyncLock } from '../../utils/process.js';
import type { QueueSnapshot, StatusSnapshot } from '../events.js';
import type { MediaPlaybackController } from './media-playback-controller.js';
import type { PlaylistController, PlaylistRunState } from './playlist-controller.js';
import { QUEUE_PLAYLIST_ID, type QueueController } from './queue-controller.js';

export interface QueuePlaybackDeps {
  queue: QueueController;
  playlistController: PlaylistController;
  media: MediaPlaybackController;
  getSinkKey: () => string | null;
  lock: AsyncLock;
  logger: Logger;
  emitQueue: () => void;
  stopInternalLocked: () => Promise<unknown>;
  stop: () => Promise<StatusSnapshot>;
  startFileLocked: (
    file: string,
    options: {
      key: string;
      playlist: PlaylistRunState;
      seekSeconds?: number;
    },
  ) => Promise<StatusSnapshot>;
}

export class QueuePlaybackCoordinator {
  constructor(private readonly deps: QueuePlaybackDeps) {}

  buildSnapshot(): QueueSnapshot {
    const active = this.deps.playlistController.current;
    const isQueue = active?.playlist.id === QUEUE_PLAYLIST_ID;
    return this.deps.queue.snapshot(Boolean(isQueue), isQueue ? (active?.index ?? null) : null);
  }

  private queueEditState(): { isQueue: boolean; currentId: string | null } {
    const active = this.deps.playlistController.current;
    const isQueue = active?.playlist.id === QUEUE_PLAYLIST_ID;
    return {
      isQueue: Boolean(isQueue),
      currentId: isQueue && active ? this.deps.queue.entryIdAt(active.index) : null,
    };
  }

  private async reindexQueueLocked(currentId: string | null, wasActive: boolean): Promise<void> {
    if (!wasActive || !currentId) return;
    const nextIndex = this.deps.queue.indexOfId(currentId);
    if (nextIndex >= 0) {
      this.deps.playlistController.setIndex(nextIndex);
      return;
    }
    this.deps.queue.clearPlayback();
    await this.deps.stopInternalLocked();
  }

  private async runQueueMutation(mutate: () => unknown): Promise<QueueSnapshot> {
    return this.deps.lock.run(async () => {
      const { isQueue, currentId } = this.queueEditState();
      const res = mutate();
      if (res === false) throw new NotFoundError('Queue-Eintrag nicht gefunden');
      await this.reindexQueueLocked(currentId, isQueue);
      this.deps.emitQueue();
      return this.buildSnapshot();
    });
  }

  async add(channel: string): Promise<QueueSnapshot> {
    return this.runQueueMutation(() => this.deps.queue.add(channel));
  }

  async remove(id: string): Promise<QueueSnapshot> {
    return this.runQueueMutation(() => this.deps.queue.remove(id));
  }

  async move(id: string, to: number): Promise<QueueSnapshot> {
    return this.runQueueMutation(() => this.deps.queue.move(id, to));
  }

  async duplicate(id: string): Promise<QueueSnapshot> {
    return this.runQueueMutation(() => this.deps.queue.duplicate(id));
  }

  async updateEntry(
    id: string,
    patch: { duration_seconds?: number | null },
  ): Promise<QueueSnapshot> {
    return this.runQueueMutation(() => this.deps.queue.updateEntry(id, patch));
  }

  async setLoop(loop: boolean): Promise<QueueSnapshot> {
    return this.deps.lock.run(async () => {
      this.deps.queue.setLoop(loop);
      this.deps.emitQueue();
      return this.buildSnapshot();
    });
  }

  async clear(): Promise<QueueSnapshot> {
    return this.deps.lock.run(async () => {
      const { isQueue } = this.queueEditState();
      this.deps.queue.clear();
      if (isQueue) await this.deps.stopInternalLocked();
      this.deps.emitQueue();
      return this.buildSnapshot();
    });
  }

  async play(index = 0): Promise<StatusSnapshot> {
    if (this.deps.queue.get().length === 0) {
      throw new ValidationError('Die Regie-Queue ist leer');
    }
    return this.deps.playlistController.play(QUEUE_PLAYLIST_ID, index);
  }

  async next(): Promise<StatusSnapshot> {
    if (this.deps.playlistController.current?.playlist.id !== QUEUE_PLAYLIST_ID) {
      throw new ValidationError('Die Regie-Queue ist nicht aktiv');
    }
    return this.deps.playlistController.next();
  }

  /** One entry back inside the running queue (#94). */
  async previous(): Promise<StatusSnapshot> {
    if (this.deps.playlistController.current?.playlist.id !== QUEUE_PLAYLIST_ID) {
      throw new ValidationError('Die Regie-Queue ist nicht aktiv');
    }
    const index = this.buildSnapshot().index ?? 0;
    if (index <= 0) {
      throw new ValidationError('Kein vorheriger Eintrag in der Regie-Queue');
    }
    return this.play(index - 1);
  }

  async stop(): Promise<StatusSnapshot> {
    return this.deps.stop();
  }

  async playNow(channel: string): Promise<StatusSnapshot> {
    const active = this.deps.playlistController.current;
    const isQueue = active?.playlist.id === QUEUE_PLAYLIST_ID;
    if (isQueue && active) {
      this.deps.queue.insertAt(channel, active.index + 1);
      this.deps.emitQueue();
      return this.deps.playlistController.next();
    }
    this.deps.queue.insertAt(channel, 0);
    this.deps.emitQueue();
    return this.deps.playlistController.play(QUEUE_PLAYLIST_ID, 0);
  }

  async seekActiveVideo(seconds: number): Promise<StatusSnapshot> {
    return this.deps.lock.run(async () => {
      const file = this.deps.media.file;
      if (!file) throw new ValidationError('Es läuft kein lokales Video');
      const key = this.deps.getSinkKey();
      if (!key) throw new ValidationError('Kein aktiver YouTube-Stream-Key');
      const current = this.deps.playlistController.current;
      if (!current) throw new ValidationError('Keine aktive Playlist');
      const target = this.deps.media.computeSeekTarget(seconds);
      this.deps.logger.info({ file, seconds: target }, 'Lokales Video wird gesucht');
      return this.deps.startFileLocked(file, {
        key,
        playlist: current,
        seekSeconds: target,
      });
    });
  }
}
