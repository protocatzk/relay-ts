import { describe, expect, it } from 'vitest';
import { pauseLimitDelayMs } from '../src/core/supervisor/pause-limit.js';

describe('pauseLimitDelayMs', () => {
  it('returns null for unlimited pauses', () => {
    expect(pauseLimitDelayMs(0)).toBeNull();
    expect(pauseLimitDelayMs(-5)).toBeNull();
    expect(pauseLimitDelayMs(Number.NaN)).toBeNull();
  });

  it('converts configured minutes to milliseconds', () => {
    expect(pauseLimitDelayMs(1)).toBe(60_000);
    expect(pauseLimitDelayMs(15)).toBe(900_000);
    expect(pauseLimitDelayMs(0.5)).toBe(30_000);
  });
});
