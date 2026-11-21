import pino from 'pino';
import { describe, expect, it } from 'vitest';
import type { LoadedConfig } from '../src/core/config/loader.js';
import { DEFAULT_SETTINGS, StreamerSchema } from '../src/core/config/schema.js';
import {
  buildAudioFilter,
  buildPauseCommand,
  buildPausePreviewArgs,
  buildSlateFilters,
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

  it('reads local playlist videos in real time without HTTP reconnect flags', () => {
    const args = buildSourceCommand({
      media,
      settings: DEFAULT_SETTINGS,
      streamer,
      stream: { ...stream, url: '/app/data/media/intro.mp4' },
      relay,
    });
    const line = args.join(' ');
    expect(line).toContain('-re -i /app/data/media/intro.mp4');
    expect(line).not.toContain('-reconnect');
    expect(line).not.toContain('Referer:');
    expect(line).toContain('tcp://127.0.0.1:12345?tcp_nodelay=1');
  });

  it('seeks local videos with -ss before the input', () => {
    const args = buildSourceCommand({
      media,
      settings: DEFAULT_SETTINGS,
      streamer,
      stream: { ...stream, url: '/app/data/media/intro.mp4' },
      relay,
      seekSeconds: 61.5,
    });
    const line = args.join(' ');
    expect(line).toContain('-ss 61.500 -re -i /app/data/media/intro.mp4');
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
    expect(line).toContain('-r 25');
    expect(line).toContain('-g 50');
  });

  it('re-encodes on forceReencode with the configured fps', () => {
    const args = buildSourceCommand({
      media,
      settings: { ...DEFAULT_SETTINGS, video: { ...DEFAULT_SETTINGS.video, fps: 20 } },
      streamer,
      stream,
      relay,
      forceReencode: true,
    });
    const line = args.join(' ');
    expect(line).toContain('-r 20');
    expect(line).toContain('-g 40');
    expect(line).not.toContain('-c:v copy');
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

  it('blends chat and logo rawvideo overlays in order', () => {
    const args = buildSinkCommand({
      media,
      settings: DEFAULT_SETTINGS,
      key: 'stream-key',
      relay,
      overlayInput: { width: 320, height: 180, x: 10, y: 20, fps: 10, fd: 3 },
      logoInput: { width: 100, height: 50, x: 30, y: 40, fps: 10, fd: 4 },
    });
    const line = args.join(' ');
    expect(line).toContain('-i pipe:3');
    expect(line).toContain('-i pipe:4');
    expect(line).toContain('[base][1:v]overlay=10:20');
    expect(line).toContain('[stage0][2:v]overlay=30:40');
    expect(line).toContain('format=yuv420p[vout]');
  });

  it('overlays only the logo when the chat canvas is disabled', () => {
    const args = buildSinkCommand({
      media,
      settings: DEFAULT_SETTINGS,
      key: 'stream-key',
      relay,
      logoInput: { width: 100, height: 50, x: 30, y: 40, fps: 10, fd: 4 },
    });
    const line = args.join(' ');
    expect(line).toContain('-i pipe:4');
    expect(line).not.toContain('-i pipe:3');
    expect(line).toContain('[base][1:v]overlay=30:40');
  });

  it('defaults the logo to fd 4 when the chat canvas is disabled', () => {
    const args = buildSinkCommand({
      media,
      settings: DEFAULT_SETTINGS,
      key: 'stream-key',
      relay,
      // The real logo engine panel carries fd 4, but the sink must not depend
      // on the caller: a logo-only pipeline has to read pipe 4, not pipe 3.
      logoInput: { width: 100, height: 50, x: 30, y: 40, fps: 10 },
    });
    const line = args.join(' ');
    expect(line).toContain('-i pipe:4');
    expect(line).not.toContain('-i pipe:3');
    expect(line).toContain('[base][1:v]overlay=30:40');
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
    expect(line).toContain('-err_detect ignore_err');
    expect(line).toContain('nal-hrd=cbr:filler=1:force-cfr=1:aud=1');
    expect(line).toContain('-force_key_frames expr:gte(t,n_forced*2)');
    expect(line).toContain(
      'aresample=async=1000:min_comp=0.01:min_hard_comp=0.2:osr=48000:osf=fltp:ochl=stereo',
    );
    expect(line).toContain('-avoid_negative_ts make_zero');
    expect(line).toContain('-max_interleave_delta 500000');
    expect(line).toContain('-flush_packets 1');
    expect(line).toContain('-tcp_nodelay 1 -rw_timeout 15000000 rtmp://a.rtmp.youtube.com/live2/abc-def');
    expect(line).toContain('tcp://127.0.0.1:12346?tcp_nodelay=1');
    expect(line).not.toContain('-rw_timeout 15000000 -f mpegts');
  });

  it('uses a hardware encoder override for the sink instead of libx264', () => {
    const args = buildSinkCommand({
      media,
      settings: DEFAULT_SETTINGS,
      key: 'abc-def',
      relay,
      encoder: 'h264_qsv',
    });
    const line = args.join(' ');
    expect(line).toContain('-c:v h264_qsv');
    expect(line).toContain('-pix_fmt nv12');
    expect(line).toContain('-look_ahead 0');
    expect(line).not.toContain('libx264');
    expect(line).not.toContain('nal-hrd=cbr:filler=1');
  });

  it('uses the encoder override for source re-encodes', () => {
    const args = buildSourceCommand({
      media,
      settings: DEFAULT_SETTINGS,
      streamer,
      stream: { ...stream, vcodec: 'vp9', isH264: false },
      relay,
      encoder: 'h264_nvenc',
    });
    const line = args.join(' ');
    expect(line).toContain('-c:v h264_nvenc');
    expect(line).toContain('-preset p2');
    expect(line).not.toContain('libx264');
  });

  it('skips x264-only stillimage tuning when a slate uses hardware encoding', () => {
    const args = buildPauseCommand({
      media,
      settings: DEFAULT_SETTINGS,
      relay,
      text: 'Pause',
      subtext: 'Gleich weiter',
      background: '/app/data/pause/background.png',
      encoder: 'h264_amf',
    });
    const line = args.join(' ');
    expect(line).toContain('-c:v h264_amf');
    expect(line).not.toContain('stillimage');
    expect(line).not.toContain('libx264');
  });

  it('applies the video layout scale and position to the sink', () => {
    const base = {
      media,
      key: 'abc-def',
      relay,
    };
    const legacy = buildSinkCommand({
      ...base,
      settings: { ...DEFAULT_SETTINGS, video: { ...DEFAULT_SETTINGS.video, resolution: '1280x720' } },
    }).join(' ');
    expect(legacy).toContain('scale=1280:720:force_original_aspect_ratio=decrease');
    expect(legacy).toContain('pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black');
    expect(legacy).not.toContain('crop=');

    const shrink = buildSinkCommand({
      ...base,
      settings: {
        ...DEFAULT_SETTINGS,
        video: {
          ...DEFAULT_SETTINGS.video,
          resolution: '1280x720',
          layout: { enabled: true, scale: 60, position_x: 25, position_y: 75 },
        },
      },
    }).join(' ');
    expect(shrink).toContain('scale=768:432:force_original_aspect_ratio=decrease');
    expect(shrink).toContain('pad=1280:720:(ow-iw)*25/100:(oh-ih)*75/100:color=black');
    expect(shrink).not.toContain('crop=');

    const zoom = buildSinkCommand({
      ...base,
      settings: {
        ...DEFAULT_SETTINGS,
        video: {
          ...DEFAULT_SETTINGS.video,
          resolution: '1280x720',
          layout: { enabled: true, scale: 200, position_x: 50, position_y: 50 },
        },
      },
    }).join(' ');
    expect(zoom).toContain('scale=2560:1440:force_original_aspect_ratio=decrease');
    expect(zoom).toContain("crop=w='min(iw\\,1280)':h='min(ih\\,720)'");
    expect(zoom).toContain("x='max(0\\,min(iw-1280\\,(iw-1280)/2))'");
    expect(zoom).toContain('pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black');
  });

  it('adds a canvas overlay input without using -vf', () => {
    const args = buildSinkCommand({
      media,
      settings: DEFAULT_SETTINGS,
      key: 'abc-def',
      relay,
      overlayFilters: ['drawtext=text=Clock'],
      overlayInput: { width: 640, height: 400, x: 32, y: 800, fps: 10 },
    });
    const line = args.join(' ');
    expect(line).toContain('-f rawvideo');
    expect(line).toContain('-pixel_format rgba');
    expect(line).toContain('-video_size 640x400');
    expect(line).toContain('-i pipe:3');
    expect(line).toContain('-filter_complex');
    expect(line).toContain('overlay=32:800');
    expect(line).toContain('drawtext=text=Clock');
    expect(line).not.toContain('-vf ');
  });

  it('supports full RTMP URLs and backup ingest', () => {    expect(youtubeUrls({ ...media, youtubeBackup: false }, 'rtmp://custom/live/key')).toEqual([
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
    expect(args.filter((value) => value === '-rw_timeout')).toHaveLength(2);
    expect(args).toContain('rtmp://b.rtmp.youtube.com/live2/key?backup=1');
  });

  it('builds a one-frame preview with the slate drawtext layers', () => {
    const args = buildPausePreviewArgs({
      media,
      settings: DEFAULT_SETTINGS,
      text: 'Pause: gleich weiter',
      subtext: 'Bitte warten',
      fontFile: '/usr/share/fonts/dejavu/DejaVuSans.ttf',
      output: '/tmp/preview.png',
    });
    const line = args.join(' ');
    expect(args).toContain('-frames:v');
    expect(line).toContain('color=c=0x101820');
    expect(line).toContain('drawtext=');
    expect(line).toContain('Pause\\: gleich weiter');
    expect(line).toContain('-f image2');
    expect(args.at(-1)).toBe('/tmp/preview.png');
  });

  it('applies fit and text color to preview filters', () => {
    const filters = buildSlateFilters({
      settings: DEFAULT_SETTINGS,
      background: '/tmp/background.mp4',
      text: 'Pause',
      subtext: '',
      fontFile: '/font.ttf',
      textColor: '#ff0000',
      fit: 'contain',
    });
    const line = filters.join(',');
    expect(line).toContain('force_original_aspect_ratio=decrease');
    expect(line).toContain('pad=');
    expect(line).toContain('fontcolor=#ff0000');
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
    expect(line).toContain('-keyint_min 50 -sc_threshold 0');
  });

  it('uses a looping video background with cover fit', () => {
    const args = buildPauseCommand({
      media,
      settings: DEFAULT_SETTINGS,
      relay,
      text: 'Pause',
      subtext: 'Gleich weiter',
      fontFile: '/usr/share/fonts/dejavu/DejaVuSans.ttf',
      background: '/app/data/pause/loop.webm',
      textColor: '#ffcc00',
      fit: 'cover',
    });
    const line = args.join(' ');
    expect(line).toContain('-stream_loop -1 -re -i /app/data/pause/loop.webm');
    expect(line).toContain('scale=720:1280:force_original_aspect_ratio=increase');
    expect(line).toContain('crop=720:1280');
    expect(line).toContain('fontcolor=#ffcc00');
    expect(line).not.toContain('-tune stillimage');
  });

  it('loops static images and keeps stillimage tuning', () => {
    const args = buildPauseCommand({
      media,
      settings: DEFAULT_SETTINGS,
      relay,
      text: 'Pause',
      subtext: 'Gleich weiter',
      background: '/app/data/pause/background.png',
      fit: 'contain',
    });
    const line = args.join(' ');
    expect(line).toContain('-loop 1 -re -i /app/data/pause/background.png');
    expect(line).toContain('force_original_aspect_ratio=decrease');
    expect(line).toContain('pad=720:1280');
    expect(line).toContain('-tune stillimage');
  });

  it('stretches backgrounds to the exact output resolution', () => {
    const args = buildPauseCommand({
      media,
      settings: DEFAULT_SETTINGS,
      relay,
      text: 'Pause',
      subtext: 'Gleich weiter',
      background: '/app/data/pause/portrait.mp4',
      fit: 'stretch',
    });
    const line = args.join(' ');
    expect(line).toContain('scale=720:1280');
    expect(line).not.toContain('force_original_aspect_ratio');
    expect(line).not.toContain('crop=720:1280');
    expect(line).not.toContain('pad=720:1280');
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

describe('buildAudioFilter', () => {
  it('uses async resampling only when normalization, gain, and silence detection are off', () => {
    expect(buildAudioFilter(DEFAULT_SETTINGS)).toBe(
      'aresample=async=1000:min_comp=0.01:min_hard_comp=0.2:osr=48000:osf=fltp:ochl=stereo',
    );
  });

  it('adds gain, loudnorm with dcshift + trailing aresample, dynaudnorm, and silencedetect', () => {
    const loud = buildAudioFilter({
      ...DEFAULT_SETTINGS,
      audio: {
        ...DEFAULT_SETTINGS.audio,
        normalize: 'loudnorm',
        target_lufs: -16,
        gain_db: 2.5,
        silence_detect: true,
        silence_threshold_db: -45,
        silence_seconds: 12,
      },
    });
    expect(loud).toContain('volume=2.5dB');
    expect(loud).toContain('dcshift=0.00001');
    expect(loud).toContain('loudnorm=I=-16:TP=-1.5:LRA=11');
    expect(loud.indexOf('dcshift=0.00001')).toBeLessThan(loud.indexOf('loudnorm='));
    expect(loud.indexOf('loudnorm=')).toBeLessThan(
      loud.lastIndexOf('aresample=osr=48000:osf=fltp:ochl=stereo'),
    );
    expect(loud).toContain('silencedetect=noise=-45dB:d=12');

    const dyn = buildAudioFilter({
      ...DEFAULT_SETTINGS,
      audio: { ...DEFAULT_SETTINGS.audio, normalize: 'dynaudnorm' },
    });
    expect(dyn).toContain('dynaudnorm=f=150:g=15');
    expect(dyn).not.toContain('dcshift');
  });

  it('promotes sink loglevel to info when silence detection is enabled', () => {
    const args = buildSinkCommand({
      media,
      settings: {
        ...DEFAULT_SETTINGS,
        audio: { ...DEFAULT_SETTINGS.audio, silence_detect: true },
      },
      key: 'abc-def',
      relay,
    });
    const loglevelIndex = args.indexOf('-loglevel');
    expect(loglevelIndex).toBeGreaterThan(-1);
    expect(args[loglevelIndex + 1]).toBe('info');
  });
});
