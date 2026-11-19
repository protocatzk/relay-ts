import { expectTypeOf, test } from 'vitest';
import type { PlaylistView } from '../src/core/supervisor/supervisor.js';
import type { StreamerView } from '../src/core/store/streamer-store.js';
import type { Playlist, Streamer } from '../src/web/src/api/types.js';

test('frontend resource types cover backend payloads', () => {
  expectTypeOf<StreamerView>().toMatchTypeOf<Streamer>();
  expectTypeOf<PlaylistView>().toMatchTypeOf<Playlist>();
});
