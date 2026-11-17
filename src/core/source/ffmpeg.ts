import type { MediaConfig } from '../config/loader.js';
import type { Settings, StreamerConfig } from '../config/schema.js';
import type { StreamState } from '../events.js';
import type { ResolvedStream } from './tiktok.js';

export interface RelayEndpoint {
  host: string;
  port: number;
}

export function ingestUrl(relay: RelayEndpoint): string {
  return `tcp://${relay.host}:${relay.port}?tcp_nodelay=1`;
}

export function playbackUrl(relay: RelayEndpoint): string {
  return `tcp://${relay.host}:${relay.port + 1}?tcp_nodelay=1`;
}

export function youtubeUrls(media: Pick<MediaConfig, 'youtubeRtmpUrl' | 'youtubeBackup'>, key: string): string[] {
  const value = key.trim();
  if (!value) throw new Error('YouTube-Stream-Key ist leer');
  if (/^rtmps?:\/\//i.test(value)) return [value];
  const base = media.youtubeRtmpUrl.replace(/\/+$/, '');
  const urls = [`${base}/${value}`];
  if (media.youtubeBackup) {
    urls.push(`rtmp://b.rtmp.youtube.com/live2/${value}?backup=1`);
  }
  return urls;
}

export interface SourceCommandOptions {
  media: MediaConfig;
  settings: Settings;
  streamer: StreamerConfig;
  stream: ResolvedStream;
  relay: RelayEndpoint;
  forceReencode?: boolean;
  timestampOffset?: number;
}

export function buildSourceCommand(options: SourceCommandOptions): string[] {
  const { media, settings, stream, relay, forceReencode } = options;
  const args = [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    media.ffmpegLogLevel,
    '-progress',
    'pipe:1',
    '-nostats',
    '-stats_period',
    '5',
    '-fflags',
    '+genpts',
    '-rw_timeout',
    '15000000',
    '-reconnect',
    '1',
    '-reconnect_streamed',
    '1',
    '-reconnect_delay_max',
    '5',
    '-user_agent',
    media.sourceUserAgent,
    '-headers',
    'Referer: https://www.tiktok.com/\r\nAccept: */*\r\n',
    '-i',
    stream.url,
    '-map',
    '0:v:0?',
    '-map',
    '0:a:0?',
  ];

  const reencode = forceReencode || !stream.isH264 || options.streamer.video_mode === 'reencode';
  if (reencode) {
    const bitrate = settings.video.video_bitrate;
    const gop = Math.max(1, settings.video.fps * 2);
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-tune',
      'zerolatency',
      '-pix_fmt',
      'yuv420p',
      '-b:v',
      `${bitrate}k`,
      '-maxrate',
      `${bitrate}k`,
      '-bufsize',
      `${bitrate * 2}k`,
      '-g',
      String(gop),
      '-keyint_min',
      String(gop),
      '-sc_threshold',
      '0',
      '-c:a',
      'aac',
      '-b:a',
      `${settings.video.audio_bitrate}k`,
      '-ar',
      '48000',
      '-ac',
      '2',
    );
  } else {
    args.push('-c:v', 'copy', '-c:a', 'copy');
  }

  args.push(
    '-f',
    'mpegts',
    '-mpegts_flags',
    '+resend_headers',
    '-flush_packets',
    '1',
    '-muxdelay',
    '0',
  );
  if (options.timestampOffset && options.timestampOffset > 0) {
    args.push('-output_ts_offset', options.timestampOffset.toFixed(3));
  }
  args.push(ingestUrl(relay));
  return args;
}

export interface SinkCommandOptions {
  media: MediaConfig;
  settings: Settings;
  key: string;
  relay: RelayEndpoint;
  overlayFilters?: string[];
}

export function buildSinkCommand(options: SinkCommandOptions): string[] {
  const { media, settings, relay } = options;
  const [width, height] = settings.video.resolution.split('x').map(Number) as [number, number];
  const fps = settings.video.fps;
  const bitrate = settings.video.video_bitrate;
  const gop = Math.max(1, fps * 2);
  const filters = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    `fps=${fps}`,
    'format=yuv420p',
    ...(options.overlayFilters ?? []),
  ];

  const inputArgs = [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    media.ffmpegLogLevel,
    '-progress',
    'pipe:1',
    '-nostats',
    '-stats_period',
    '5',
    '-fflags',
    '+genpts+discardcorrupt',
    '-thread_queue_size',
    '512',
    '-probesize',
    '1000000',
    '-analyzeduration',
    '1000000',
    '-f',
    'mpegts',
    '-i',
    playbackUrl(relay),
  ];

  // Output options must be repeated for every output URL (primary + backup),
  // otherwise ffmpeg cannot infer the FLV muxer for the second output.
  const outputArgs = [
    '-map',
    '0:v:0?',
    '-map',
    '0:a:0?',
    '-vf',
    filters.join(','),
    '-fps_mode',
    'cfr',
    '-c:v',
    'libx264',
    '-preset',
    settings.video.preset,
    '-tune',
    'zerolatency',
    '-profile:v',
    'high',
    '-level',
    '4.0',
    '-pix_fmt',
    'yuv420p',
    '-b:v',
    `${bitrate}k`,
    '-maxrate',
    `${bitrate}k`,
    '-bufsize',
    `${bitrate * 2}k`,
    '-x264-params',
    'nal-hrd=cbr:filler=1',
    '-g',
    String(gop),
    '-keyint_min',
    String(gop),
    '-sc_threshold',
    '0',
    '-af',
    'aresample=async=1:osr=48000:osf=fltp:ochl=stereo',
    '-c:a',
    'aac',
    '-b:a',
    `${settings.video.audio_bitrate}k`,
    '-ar',
    '48000',
    '-ac',
    '2',
    '-f',
    'flv',
    '-flvflags',
    'no_duration_filesize',
    '-max_muxing_queue_size',
    '1024',
  ];

  const args = [...inputArgs];
  for (const url of youtubeUrls(media, options.key)) {
    args.push(...outputArgs, url);
  }
  return args;
}

export interface PauseCommandOptions {
  media: MediaConfig;
  settings: Settings;
  relay: RelayEndpoint;
  text: string;
  subtext: string;
  fontFile?: string | null;
  timestampOffset?: number;
}

function escapeDrawtext(value: string): string {
  return value
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

export function buildPauseCommand(options: PauseCommandOptions): string[] {
  const { media, settings, relay } = options;
  const [width, height] = settings.video.resolution.split('x').map(Number) as [number, number];
  const fps = settings.video.fps;
  const bitrate = settings.video.video_bitrate;
  const filters: string[] = [];
  if (options.fontFile) {
    filters.push(
      `drawtext=fontfile='${options.fontFile}':text='${escapeDrawtext(options.text)}':` +
        `fontsize=${Math.round(width / 14)}:fontcolor=white:x=(w-tw)/2:y=(h-th)/2-40`,
    );
    filters.push(
      `drawtext=fontfile='${options.fontFile}':text='${escapeDrawtext(options.subtext)}':` +
        `fontsize=${Math.round(width / 30)}:fontcolor=white@0.7:x=(w-tw)/2:y=(h-th)/2+60`,
    );
  }
  const args = [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    media.ffmpegLogLevel,
    '-re',
    '-f',
    'lavfi',
    '-i',
    `color=c=${settings.pause.color}:s=${width}x${height}:r=${fps}`,
    '-f',
    'lavfi',
    '-i',
    'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
  ];
  if (filters.length > 0) args.push('-vf', filters.join(','));
  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-tune',
    'stillimage',
    '-pix_fmt',
    'yuv420p',
    '-b:v',
    `${bitrate}k`,
    '-maxrate',
    `${bitrate}k`,
    '-bufsize',
    `${bitrate * 2}k`,
    '-g',
    String(Math.max(1, fps * 2)),
    '-c:a',
    'aac',
    '-b:a',
    `${settings.video.audio_bitrate}k`,
    '-ar',
    '48000',
    '-ac',
    '2',
    '-f',
    'mpegts',
    '-mpegts_flags',
    '+resend_headers',
    '-flush_packets',
    '1',
    '-muxdelay',
    '0',
  );
  if (options.timestampOffset && options.timestampOffset > 0) {
    args.push('-output_ts_offset', options.timestampOffset.toFixed(3));
  }
  args.push(ingestUrl(relay));
  return args;
}

export function targetBitrateKbps(settings: Settings): number {
  return settings.video.video_bitrate;
}

export function stateLabel(state: StreamState): string {
  return {
    idle: 'Bereit',
    starting: 'Startet',
    live: 'Live',
    reconnecting: 'Neuverbindung',
    paused: 'Pause',
    stopping: 'Stoppt',
    error: 'Fehler',
  }[state];
}
