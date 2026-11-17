import pino from 'pino';
import { describe, expect, it } from 'vitest';
import type { LoadedConfig } from '../src/core/config/loader.js';
import { DEFAULT_SETTINGS, StreamerSchema } from '../src/core/config/schema.js';
import {
  buildPauseCommand,
  buildSinkCommand,
  buildSourceCommand,
  youtubeUrls,
} from '../src/core/source/ffmpeg.js';
import {
  buildResolveArgs,
  parseApiLivePayload,
  TikTokResolver,
} from '../src/core/source/resolver.js';
import { StreamerOfflineError } from '../src/utils/errors.js';
import { selectFormat } from '../src/core/source/tiktok.js';
import { runCommand } from '../src/utils/process.js';

const media: LoadedConfig['media'] = {
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
const relay = { host: '127.0.0.1', port: 12345 };
const streamer = StreamerSchema.parse({
  id: 'alpha',
  name: 'Alpha',
  tiktok: '@alpha',
});
const stream = {
  url: 'https://cdn.example/stream.flv',
  vcodec: 'avc1.64001f',
  height: 720,
  formatId: 'h264',
  isH264: true,
  title: 'Live',
  resolvedAt: new Date(),
};

describe('ffmpeg command builders', () => {
  it('copies H.264 sources into MPEG-TS and writes to the ingest port', () => {
    const args = buildSourceCommand({
      media,
      settings: DEFAULT_SETTINGS,
      streamer,
      stream,
      relay,
    });
    expect(args[0]).toBe('-hide_banner');
    expect(args).not.toContain('ffmpeg');
    const line = args.join(' ');
    expect(line).toContain('-c:v copy');
    expect(line).toContain('tcp://127.0.0.1:12345?tcp_nodelay=1');
    expect(line).toContain('Referer: https://www.tiktok.com/');
  });

  it('re-encodes non-H.264 sources', () => {
    const args = buildSourceCommand({
      media,
      settings: DEFAULT_SETTINGS,
      streamer,
      stream: { ...stream, vcodec: 'vp9', isH264: false },
      relay,
    });
    const line = args.join(' ');
    expect(line).toContain('libx264');
    expect(line).toContain('-b:v 4000k');
  });

  it('adds a timestamp offset when a source is restarted', () => {
    const args = buildSourceCommand({
      media,
      settings: DEFAULT_SETTINGS,
      streamer,
      stream,
      relay,
      timestampOffset: 42.5,
    });
    const line = args.join(' ');
    expect(line).toContain('-output_ts_offset 42.500');
  });

  it('builds a CBR sink for YouTube with the configured canvas', () => {
    const args = buildSinkCommand({
      media,
      settings: {
        ...DEFAULT_SETTINGS,
        video: { ...DEFAULT_SETTINGS.video, resolution: '1280x720', fps: 30 },
      },
      key: 'abc-def',
      relay,
      overlayFilters: ['drawtext=text=Test'],
    });
    expect(args[0]).toBe('-hide_banner');
    expect(args).not.toContain('ffmpeg');
    const line = args.join(' ');
    expect(line).toContain('scale=1280:720:force_original_aspect_ratio=decrease');
    expect(line).toContain('fps=30');
    expect(line).toContain('drawtext=text=Test');
    expect(line).toContain('nal-hrd=cbr:filler=1');
    expect(line).toContain('tcp://127.0.0.1:12346?tcp_nodelay=1');
    expect(line).toContain('rtmp://a.rtmp.youtube.com/live2/abc-def');
  });

  it('supports full RTMP URLs and backup ingest', () => {
    expect(youtubeUrls({ ...media, youtubeBackup: false }, 'rtmp://custom/live/key')).toEqual([
      'rtmp://custom/live/key',
    ]);
    expect(youtubeUrls({ ...media, youtubeBackup: true }, 'key')).toEqual([
      'rtmp://a.rtmp.youtube.com/live2/key',
      'rtmp://b.rtmp.youtube.com/live2/key?backup=1',
    ]);

    const args = buildSinkCommand({
      media: { ...media, youtubeBackup: true },
      settings: DEFAULT_SETTINGS,
      key: 'key',
      relay,
    });
    expect(args.filter((value) => value === 'flv')).toHaveLength(2);
    expect(args).toContain('rtmp://b.rtmp.youtube.com/live2/key?backup=1');
  });

  it('builds a pause slate with text', () => {
    const args = buildPauseCommand({
      media,
      settings: DEFAULT_SETTINGS,
      relay,
      text: 'Pause: gleich weiter',
      subtext: 'Bitte warten',
      fontFile: '/usr/share/fonts/dejavu/DejaVuSans.ttf',
      timestampOffset: 12,
    });
    const line = args.join(' ');
    expect(args[0]).toBe('-hide_banner');
    expect(line).toContain('color=c=0x101820');
    expect(line).toContain('Pause\\: gleich weiter');
    expect(line).toContain('tcp://127.0.0.1:12345?tcp_nodelay=1');
    expect(line).toContain('-output_ts_offset 12.000');
  });
});

describe('resolver', () => {
  it('builds yt-dlp arguments', () => {
    const args = buildResolveArgs(streamer, { cookiesFile: '/nonexistent', media });
    expect(args[0]).toBe('--dump-single-json');
    expect(args).not.toContain('yt-dlp');
    expect(args).toContain('--dump-single-json');
    expect(args.at(-1)).toBe('https://www.tiktok.com/@alpha/live');
  });

  it('prefers H.264 and respects the quality ceiling', () => {
    const format = selectFormat(
      {
        formats: [
          { url: 'a', vcodec: 'hvc1', height: 1080, quality: 10 },
          { url: 'b', vcodec: 'avc1', height: 720, tbr: 2000 },
          { url: 'c', vcodec: 'avc1', height: 480, tbr: 1000 },
        ],
      },
      { quality: '720p' },
    );
    expect(format.url).toBe('b');
    expect(format.isH264).toBe(true);
  });

  it('falls back to the best available format when no H.264 exists', () => {
    const format = selectFormat({
      formats: [{ url: 'a', vcodec: 'hvc1', height: 1080 }],
    });
    expect(format.url).toBe('a');
    expect(format.isH264).toBe(false);
  });

  it('reports offline streams with a domain error', async () => {
    const resolver = new TikTokResolver({
      media,
      logger: pino({ level: 'silent' }),
      cookiesFile: '/nonexistent',
      runner: async () => ({
        code: 1,
        stdout: '',
        stderr: 'ERROR: [TikTokLive] user is not currently live',
      }),
      apiLive: async () => {
        throw new StreamerOfflineError('@alpha ist aktuell nicht live');
      },
    });
    await expect(resolver.resolve(streamer)).rejects.toThrow(/nicht live/);
  });

  it('falls back to the TikTok mobile API when yt-dlp reports offline', async () => {
    const resolver = new TikTokResolver({
      media,
      logger: pino({ level: 'silent' }),
      cookiesFile: '/nonexistent',
      runner: async () => ({
        code: 1,
        stdout: '',
        stderr: 'ERROR: [TikTokLive] user is not currently live',
      }),
      apiLive: async () => ({
        url: 'https://cdn/api-live.flv',
        vcodec: 'h264',
        height: 1440,
        formatId: 'api-live-hd',
        isH264: true,
        title: 'Fallback',
        resolvedAt: new Date(),
      }),
    });
    const resolved = await resolver.resolve(streamer);
    expect(resolved.url).toBe('https://cdn/api-live.flv');
    expect(resolved.height).toBe(1440);
  });

  it('parses the TikTok mobile live-room response', () => {
    const streamData = JSON.stringify({
      data: {
        hd: {
          main: {
            flv: 'https://cdn/live.flv',
            sdk_params: JSON.stringify({
              VCodec: 'h264',
              vbitrate: 1000000,
              resolution: '720x1440',
            }),
          },
        },
        ao: { main: { flv: 'https://cdn/audio.flv' } },
      },
    });
    const parsed = parseApiLivePayload(
      {
        data: {
          user: { status: 2, uniqueId: 'alpha' },
          liveRoom: {
            status: 2,
            title: 'Live',
            streamData: { pull_data: { stream_data: streamData } },
          },
        },
      },
      'best',
    );
    expect(parsed.url).toBe('https://cdn/live.flv');
    expect(parsed.height).toBe(1440);
    expect(parsed.isH264).toBe(true);
    expect(parsed.formatId).toBe('api-live-hd');
  });

  it('reports offline when the mobile API room is not live', () => {
    expect(() =>
      parseApiLivePayload({ data: { user: { status: 4 }, liveRoom: { status: 4 } } }, 'best'),
    ).toThrow(/keinen aktiven Live-Room/);
  });

  it('parses a dumped JSON document', async () => {
    const resolver = new TikTokResolver({
      media,
      logger: pino({ level: 'silent' }),
      cookiesFile: '/nonexistent',
      runner: async () => ({
        code: 0,
        stderr: '',
        stdout: JSON.stringify({
          is_live: true,
          title: 'Test',
          formats: [{ url: 'https://cdn/x.flv', vcodec: 'avc1', height: 720 }],
        }),
      }),
    });
    const resolved = await resolver.resolve(streamer);
    expect(resolved.url).toBe('https://cdn/x.flv');
    expect(resolved.height).toBe(720);
  });
});

describe('runCommand', () => {
  it('captures output and exit codes', async () => {
    const result = await runCommand(process.execPath, ['-e', 'console.log("ok")']);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('ok');
  });

  it('rejects a missing binary', async () => {
    await expect(runCommand('definitely-not-a-binary', [])).rejects.toThrow(/konnte nicht gestartet/);
  });
});
