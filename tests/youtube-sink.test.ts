import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import type { MediaConfig } from '../src/core/config/loader.js';
import { DEFAULT_SETTINGS } from '../src/core/config/schema.js';
import { metricsSnapshot, resetMetrics } from '../src/core/metrics.js';
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

const tempDirs: string[] = [];

afterEach(() => {
  resetMetrics();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

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

  it('tracks repeated DTS errors and triggers onUnhealthy once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-sink-'));
    tempDirs.push(dir);
    const script = join(dir, 'fake-sink.mjs');
    writeFileSync(
      script,
      `#!/usr/bin/env node
console.log('bitrate=4200.0kbits/s');
console.log('fps=25.0');
console.log('progress=continue');
for (let i = 0; i < 12; i++) {
  console.error('Non-monotonous DTS in output stream 0:0; previous: 100, current: 90');
}
setTimeout(() => process.exit(0), 250);
`,
    );
    chmodSync(script, 0o755);

    const reasons: string[] = [];
    const exited = new Promise<void>((resolve) => {
      const sink = new YouTubeSink({
        media: { ...media, ffmpegBin: script },
        settings: DEFAULT_SETTINGS,
        relay: { host: '127.0.0.1', port: 12345 },
        logger: pino({ level: 'silent' }),
        onUnhealthy: (reason) => reasons.push(reason),
        onExit: () => {
          const stats = sink.stats();
          expect(stats.dtsErrors).toBe(12);
          expect(stats.lastError).toContain('Non-monotonous DTS');
          expect(stats.bitrateDriftPercent).toBe(5);
          expect(metricsSnapshot().counters.sink_dts_errors_total).toBe(12);
          expect(reasons).toEqual(['Wiederholte DTS-Sprünge am YouTube-Sink']);
          resolve();
        },
      });
      sink.start('stream-key');
    });
    await exited;
  });
});
