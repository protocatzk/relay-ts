import { describe, expect, it } from 'vitest';
import { sortStreamersByLive } from '../src/web/src/utils/sort-streamers.js';

function streamer(
  name: string,
  online: boolean | null,
  active = false,
  preferred = false,
  enabled = true,
) {
  return {
    name,
    enabled,
    preferred,
    status: { online, active },
  };
}

describe('sortStreamersByLive', () => {
  it('puts active and online streamers first, offline last', () => {
    const sorted = sortStreamersByLive([
      streamer('Offline', false),
      streamer('Unknown', null),
      streamer('Online', true),
      streamer('Active', true, true),
    ]);
    expect(sorted.map((item) => item.name)).toEqual(['Active', 'Online', 'Unknown', 'Offline']);
  });

  it('prefers preferred and enabled streamers inside the same group', () => {
    const sorted = sortStreamersByLive([
      streamer('Zulu', false),
      streamer('Alpha', false, false, true),
      streamer('Disabled', false, false, true, false),
    ]);
    expect(sorted.map((item) => item.name)).toEqual(['Alpha', 'Disabled', 'Zulu']);
  });
});
