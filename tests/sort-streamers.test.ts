import { describe, expect, it } from 'vitest';
import {
  sortStreamersByLive,
  sortStreamersByPriority,
} from '../src/web/src/utils/sort-streamers.js';

function streamer(
  name: string,
  online: boolean | null,
  active = false,
  preferred = false,
  enabled = true,
  priority = 0,
) {
  return {
    name,
    enabled,
    preferred,
    priority,
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

  it('orders by priority inside the same live group', () => {
    const sorted = sortStreamersByLive([
      streamer('Low', false, false, true, true, 50),
      streamer('High', false, false, false, true, 5),
      streamer('Default', false, false, true, true, 100),
    ]);
    expect(sorted.map((item) => item.name)).toEqual(['High', 'Low', 'Default']);
  });
});

describe('sortStreamersByPriority', () => {
  it('sorts by numeric priority, then preferred, then name', () => {
    const sorted = sortStreamersByPriority([
      streamer('Beta', false, false, false, true, 10),
      streamer('Alpha', false, false, true, true, 10),
      streamer('Gamma', false, false, false, true, 0),
    ]);
    expect(sorted.map((item) => item.name)).toEqual(['Gamma', 'Alpha', 'Beta']);
  });
});
