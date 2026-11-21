import { describe, expect, it } from 'vitest';
import { StreamerSchema } from '../src/core/config/schema.js';
import { resolveScreenTarget, screenFallbackStreamer } from '../src/core/supervisor/screen-controller.js';

describe('screen-controller', () => {
  it('resolves active streamer key when streaming', () => {
    const streamer = StreamerSchema.parse({
      id: 'active',
      name: 'Active',
      tiktok: 'active',
    });
    const target = resolveScreenTarget([streamer], streamer, 'active-sink-key');
    expect(target.key).toBe('active-sink-key');
    expect(target.streamer?.id).toBe('active');
  });

  it('selects preferred streamer key as fallback when idle', () => {
    const normal = StreamerSchema.parse({
      id: 'normal',
      name: 'Normal',
      tiktok: 'normal',
      enabled: true,
      preferred: false,
      youtube_key: 'normal-key',
    });
    const preferred = StreamerSchema.parse({
      id: 'pref',
      name: 'Preferred',
      tiktok: 'pref',
      enabled: true,
      preferred: true,
      youtube_key: 'pref-key',
    });

    const target = resolveScreenTarget([normal, preferred], null, null);
    expect(target.key).toBe('pref-key');
    expect(target.streamer?.id).toBe('pref');
  });

  it('provides fallback streamer config when no streamers exist', () => {
    const fallback = screenFallbackStreamer([], null);
    expect(fallback.id).toBe('screen');
  });
});
