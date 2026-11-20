import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { StreamerStore } from '../src/core/store/streamer-store.js';
import { QueueController } from '../src/core/supervisor/queue-controller.js';
import {
  cleanupMediaThumbnails,
  clearMediaProbeCache,
  listMediaFilesWithMeta,
  mediaDirectory,
  mediaThumbnailPath,
  mediaThumbsDirectory,
} from '../src/core/media/media-files.js';

const logger = pino({ level: 'silent' });

describe('Phase 3: Media metadata & thumbnails + Regie-Queue loop/duplicate/duration', () => {
  it('returns media metadata with graceful null fallbacks and cleans up cached thumbnails', async () => {
    clearMediaProbeCache();
    const dir = mkdtempSync(join(tmpdir(), 'relay-media-meta-'));
    const mediaDir = mediaDirectory(dir);
    mkdirSync(mediaDir, { recursive: true });
    const filePath = join(mediaDir, 'clip.mp4');
    writeFileSync(filePath, Buffer.from('not-a-real-mp4'));

    const files = await listMediaFilesWithMeta(dir, '/bin/false');
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      filename: 'clip.mp4',
      duration: null,
      width: null,
      height: null,
      is_h264: null,
      codec: null,
      thumbnail_url: '/api/media/clip.mp4/thumbnail',
    });

    // Cached thumbnails live in .thumbs and are ignored by listMediaFilesWithMeta.
    mkdirSync(mediaThumbsDirectory(dir), { recursive: true });
    const thumbPath = mediaThumbnailPath(dir, 'clip.mp4', 14, 123456);
    writeFileSync(thumbPath, Buffer.from('jpg'));
    expect(existsSync(thumbPath)).toBe(true);
    expect((await listMediaFilesWithMeta(dir, '/bin/false')).map((f) => f.filename)).toEqual([
      'clip.mp4',
    ]);

    cleanupMediaThumbnails(dir, 'clip.mp4');
    expect(existsSync(thumbPath)).toBe(false);
  });

  it('persists Regie-Queue loop mode, entry move, duplicate and per-entry duration across reloads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-queue-phase3-'));
    const mediaDir = mediaDirectory(dir);
    mkdirSync(mediaDir, { recursive: true });
    writeFileSync(join(mediaDir, 'intro.mp4'), Buffer.from('vid'));

    const store = new StreamerStore(
      join(dir, 'streamers.yml'),
      { streamers: [], playlists: [] },
      logger,
    );
    store.create({ id: 'alpha', name: 'Alpha', tiktok: 'alpha', youtube_key: 'k' });

    const queuePath = join(dir, 'queue.json');
    const queue = new QueueController({ path: queuePath, dataDir: dir, store, logger });

    const first = queue.add('file:intro.mp4');
    const second = queue.add('alpha');
    expect(queue.isLoop()).toBe(false);
    expect(queue.playlist().wrap).toBe(false);

    // Loop mode updates playlist wrap and persists.
    queue.setLoop(true);
    expect(queue.isLoop()).toBe(true);
    expect(queue.playlist().wrap).toBe(true);

    // Update per-entry duration override.
    expect(queue.updateEntry(first.id, { duration_seconds: 120 })).toBe(true);

    // Duplicate inserts right after source preserving duration.
    const dup = queue.duplicate(first.id);
    expect(dup).not.toBeNull();
    expect(queue.get().map((e) => e.channel)).toEqual(['file:intro.mp4', 'file:intro.mp4', 'alpha']);

    // Move alpha to index 0.
    expect(queue.move(second.id, 0)).toBe(true);
    expect(queue.get().map((e) => e.channel)).toEqual(['alpha', 'file:intro.mp4', 'file:intro.mp4']);

    // Reload from disk: loop, order, and duration override survive.
    const reloaded = new QueueController({ path: queuePath, dataDir: dir, store, logger });
    const snap = reloaded.snapshot(false, null);
    expect(snap.loop).toBe(true);
    expect(snap.entries.map((e) => e.channel)).toEqual([
      'alpha',
      'file:intro.mp4',
      'file:intro.mp4',
    ]);
    expect(snap.entries[1]?.duration_seconds).toBe(120);
    expect(snap.entries[2]?.duration_seconds).toBe(120);
  });
});
