import { describe, expect, it } from 'vitest';
import { StreamerSchema } from '../src/core/config/schema.js';
import { compareStreamerPriority, sortStreamersByPriority } from '../src/core/streamer-order.js';

function streamer(id: string, patch: { priority?: number; preferred?: boolean } = {}) {
  return StreamerSchema.parse({ id, name: id, tiktok: id, ...patch });
}

describe('streamer priority order', () => {
  it('puts lower priority values first', () => {
    const sorted = sortStreamersByPriority([
      streamer('low', { priority: 50 }),
      streamer('high', { priority: 1 }),
      streamer('zero', { priority: 0 }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(['zero', 'high', 'low']);
  });

  it('uses preferred and name as legacy tie-breakers', () => {
    const sorted = sortStreamersByPriority([
      streamer('zulu'),
      streamer('alpha', { preferred: true }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(['alpha', 'zulu']);
    expect(compareStreamerPriority(streamer('a'), streamer('b'))).toBeLessThan(0);
  });
});
