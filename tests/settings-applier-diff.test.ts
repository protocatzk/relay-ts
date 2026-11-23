import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/core/config/schema.js';
import { diffSettings } from '../src/core/supervisor/settings-applier.js';

describe('settings diff', () => {
  it('flags a changed YouTube RTMP endpoint as a sink restart', () => {
    const next = {
      ...DEFAULT_SETTINGS,
      youtube: { ...DEFAULT_SETTINGS.youtube, rtmp_url: 'rtmp://b.rtmp.youtube.com/live2' },
    };

    expect(diffSettings(DEFAULT_SETTINGS, next).youtubeRtmpChanged).toBe(true);
    expect(diffSettings(DEFAULT_SETTINGS, DEFAULT_SETTINGS).youtubeRtmpChanged).toBe(false);

    // Other sink restart triggers keep working independently.
    const diff = diffSettings(DEFAULT_SETTINGS, {
      ...DEFAULT_SETTINGS,
      sink: { ...DEFAULT_SETTINGS.sink, rw_timeout_seconds: 30 },
    });
    expect(diff.sinkTimeoutChanged).toBe(true);
    expect(diff.youtubeRtmpChanged).toBe(false);
  });
});
