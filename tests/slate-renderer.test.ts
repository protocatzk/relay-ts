import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { SettingsSchema } from '../src/core/config/schema.js';
import { renderSlatePng } from '../src/core/overlays/slate-renderer.js';
import { renderPausePreview } from '../src/core/overlays/pause-preview.js';

describe('SlateRenderer (modern pause & startup screens)', () => {
  it('renders glass_minimal and ultra_clean pause & startup PNGs in 16:9 and 9:16', () => {
    const pausePng = renderSlatePng({
      screen: 'pause',
      width: 1280,
      height: 720,
      text: 'Kurze Pause',
      subtext: 'Gleich geht es weiter.',
      layoutMode: 'glass_minimal',
    });
    expect(pausePng.length).toBeGreaterThan(2000);
    expect(pausePng.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

    const startupPng = renderSlatePng({
      screen: 'startup',
      width: 720,
      height: 1280,
      text: 'Stream startet gleich',
      subtext: 'Bitte kurz warten…',
      layoutMode: 'ultra_clean',
    });
    expect(startupPng.length).toBeGreaterThan(2000);
    expect(startupPng.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('uses Canvas slate in renderPausePreview when no custom background is set', async () => {
    const settings = SettingsSchema.parse({});
    const buf = await renderPausePreview({
      media: {
        ffmpegBin: 'nonexistent-ffmpeg',
        ytdlpBin: 'yt-dlp',
        youtubeRtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
        youtubeBackup: false,
        tiktokSessionId: '',
        tiktokTargetIdc: '',
        ytdlpTimeoutSeconds: 20,
        relayHost: '127.0.0.1',
        relayPort: 9000,
        ffmpegLogLevel: 'warning',
        overlayFont: '',
        pauseOnOffline: true,
        sourceUserAgent: '',
      },
      settings,
      overlaysDir: '/tmp/relay-slate-test',
      logger: pino({ level: 'silent' }),
      screen: 'startup',
      draft: { text: 'Gleich live!', subtext: 'Willkommen' },
    });
    expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });
});
