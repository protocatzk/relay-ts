import pino from 'pino';
import { describe, expect, it } from 'vitest';
import type { MediaConfig } from '../src/core/config/loader.js';
import { DEFAULT_SETTINGS } from '../src/core/config/schema.js';
import { YouTubeSink } from '../src/core/sink/youtube-sink.js';

const media: MediaConfig = {
  ffmpegBin: 'ffmpeg',
  ytdlpBin: 'yt-dlp',
  youtubeRtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
  youtubeBackup: false,
  tiktokSessionId: '',
  tiktokTargetIdc: '',
  ytdlpTimeoutSeconds: 45,
  relayHost: '127.0.0.1',
  relayPort: 12345,
  ffmpegLogLevel: 'warning',
  overlayFont: '',
  pauseOnOffline: true,
  sourceUserAgent: 'TestAgent',
};

describe('YouTubeSink settings', () => {
  it('uses updated settings for the next start', () => {
    const sink = new YouTubeSink({
      media,
      settings: DEFAULT_SETTINGS,
      relay: { host: '127.0.0.1', port: 12345 },
      logger: pino({ level: 'silent' }),
    });
    expect(sink.stats().targetBitrateKbps).toBe(DEFAULT_SETTINGS.video.video_bitrate);

    const next = {
      ...DEFAULT_SETTINGS,
      video: {
        ...DEFAULT_SETTINGS.video,
        video_bitrate: 5000,
        layout: { enabled: true, scale: 60, position_x: 10, position_y: 90 },
      },
    };
    sink.updateSettings(next);
    expect(sink.stats().targetBitrateKbps).toBe(5000);
  });
});
