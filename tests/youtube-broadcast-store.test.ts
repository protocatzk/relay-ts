import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { YouTubeBroadcastStore } from '../src/core/youtube/broadcast-store.js';

const logger = pino({ level: 'silent' });

function record(id: string) {
  return {
    id,
    stream_id: 'stream-1',
    title: `Broadcast ${id}`,
    scheduled_start: '2026-01-02T10:00:00.000Z',
    created_at: '2026-01-01T12:00:00.000Z',
    status: 'created',
  };
}

describe('YouTubeBroadcastStore', () => {
  it('persists records with mode 0600 and reloads them', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'relay-youtube-store-')), 'broadcasts.json');
    const store = new YouTubeBroadcastStore(path, logger);
    store.upsert(record('bc-1'));
    await store.flush();

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, 'utf8')).broadcasts).toHaveLength(1);

    const reloaded = new YouTubeBroadcastStore(path, logger);
    expect(reloaded.ids().has('bc-1')).toBe(true);
    expect(reloaded.get('bc-1')).toMatchObject({ stream_id: 'stream-1', status: 'created' });

    reloaded.updateStatus('bc-1', 'live');
    reloaded.updateStream('bc-1', 'stream-2');
    await reloaded.flush();
    expect(new YouTubeBroadcastStore(path, logger).get('bc-1')).toMatchObject({
      status: 'live',
      stream_id: 'stream-2',
    });

    reloaded.remove('bc-1');
    await reloaded.flush();
    expect(new YouTubeBroadcastStore(path, logger).list()).toEqual([]);
  });

  it('ignores a corrupt file instead of breaking startup', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'relay-youtube-store-')), 'broadcasts.json');
    writeFileSync(path, '{not json');
    const store = new YouTubeBroadcastStore(path, logger);
    expect(store.list()).toEqual([]);
  });
});
