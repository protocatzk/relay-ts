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
  /** Start offset for local videos (seconds). */
  seekSeconds?: number;
}

export function buildSourceCommand(options: SourceCommandOptions): string[] {
  const { media, settings, stream, relay, forceReencode } = options;
  const localFile = stream.url.startsWith('/') || /^file:/i.test(stream.url);
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
  ];
  if (localFile) {
    // Local playlist videos must be read at real time, not as fast as the disk.
    if (options.seekSeconds && options.seekSeconds > 0) {
      args.push('-ss', options.seekSeconds.toFixed(3));
    }
    args.push('-re', '-i', stream.url);
  } else {
    args.push(
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
    );
  }
  args.push('-map', '0:v:0?', '-map', '0:a:0?');

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

export interface SinkOverlayInput {
  width: number;
  height: number;
  x: number;
  y: number;
  fps: number;
  /** File descriptor number; 3 by default. */
  fd?: number;
}

export interface SinkCommandOptions {
  media: MediaConfig;
  settings: Settings;
  key: string;
  relay: RelayEndpoint;
  overlayFilters?: string[];
  overlayInput?: SinkOverlayInput;
  logoInput?: SinkOverlayInput;
}

function evenDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

/** Builds the video filter chain; a disabled layout keeps the legacy framing. */
export function buildVideoFilters(
  settings: Settings,
  width: number,
  height: number,
  overlayFilters: string[] = [],
): string[] {
  const layout = settings.video.layout;
  const enabled = layout.enabled;
  const scalePercent = enabled ? layout.scale : 100;
  const positionX = enabled ? layout.position_x : 50;
  const positionY = enabled ? layout.position_y : 50;
  const targetWidth = evenDimension((width * scalePercent) / 100);
  const targetHeight = evenDimension((height * scalePercent) / 100);

  const filters = [
    `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
  ];

  // Zoom above 100%: crop the scaled image to the output size, then pad the
  // remaining dimension if the source aspect does not fill the canvas.
  if (scalePercent > 100) {
    const cropX =
      positionX === 50 ? `(iw-${width})/2` : `(iw-${width})*${positionX}/100`;
    const cropY =
      positionY === 50 ? `(ih-${height})/2` : `(ih-${height})*${positionY}/100`;
    filters.push(
      `crop=w='min(iw\\,${width})':h='min(ih\\,${height})':` +
        `x='max(0\\,min(iw-${width}\\,${cropX}))':` +
        `y='max(0\\,min(ih-${height}\\,${cropY}))'`,
    );
  }

  const padX = positionX === 50 ? '(ow-iw)/2' : `(ow-iw)*${positionX}/100`;
  const padY = positionY === 50 ? '(oh-ih)/2' : `(oh-ih)*${positionY}/100`;
  filters.push(
    `pad=${width}:${height}:${padX}:${padY}:color=black`,
    'setsar=1',
    `fps=${settings.video.fps}`,
    'format=yuv420p',
    ...overlayFilters,
  );
  return filters;
}

export function buildSinkCommand(options: SinkCommandOptions): string[] {
  const { media, settings, relay } = options;
  const [width, height] = settings.video.resolution.split('x').map(Number) as [number, number];
  const fps = settings.video.fps;
  const bitrate = settings.video.video_bitrate;
  const gop = Math.max(1, fps * 2);
  const filters = buildVideoFilters(settings, width, height, options.overlayFilters);

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
  const overlayInputs: SinkOverlayInput[] = [];
  if (options.overlayInput) overlayInputs.push(options.overlayInput);
  if (options.logoInput) overlayInputs.push(options.logoInput);
  for (const overlay of overlayInputs) {
    inputArgs.push(
      '-thread_queue_size',
      '512',
      '-f',
      'rawvideo',
      '-pixel_format',
      'rgba',
      '-video_size',
      `${overlay.width}x${overlay.height}`,
      '-framerate',
      String(overlay.fps),
      '-i',
      `pipe:${overlay.fd ?? 3}`,
    );
  }

  // Overlay inputs are blended in order (chat first, logo second) so the logo
  // stays on top. Each input is a rawvideo RGBA pipe.
  const graphParts: string[] = [];
  if (overlayInputs.length > 0) {
    graphParts.push(`[0:v]${filters.join(',')}[base]`);
    overlayInputs.forEach((overlay, index) => {
      const input = index + 1;
      const isLast = index === overlayInputs.length - 1;
      const source = index === 0 ? 'base' : `stage${index - 1}`;
      const target = isLast ? 'vout' : `stage${index}`;
      const tail = isLast ? ',format=yuv420p[vout]' : `[${target}]`;
      graphParts.push(
        `[${source}][${input}:v]overlay=${overlay.x}:${overlay.y}:` +
          `format=auto:eof_action=repeat:repeatlast=1${tail}`,
      );
    });
  }

  const videoArgs =
    overlayInputs.length > 0
      ? ['-map', '[vout]', '-map', '0:a:0?', '-filter_complex', graphParts.join(';')]
      : ['-map', '0:v:0?', '-map', '0:a:0?', '-vf', filters.join(',')];

  // Output options must be repeated for every output URL (primary + backup),
  // otherwise ffmpeg cannot infer the FLV muxer for the second output.
  const outputArgs = [
    ...videoArgs,
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
  background?: string;
  textColor?: string;
  color?: string;
  fit?: 'cover' | 'contain' | 'stretch';
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

function pauseBackgroundKind(background: string): 'video' | 'animated' | 'image' | 'other' {
  const path = background.split('?')[0]!.toLowerCase();
  if (/\.(mp4|webm|mov|mkv|m4v)$/.test(path)) return 'video';
  if (/\.(gif|webp)$/.test(path)) return 'animated';
  if (/\.(png|jpe?g|bmp|avif)$/.test(path)) return 'image';
  return 'other';
}

export interface SlateFilterOptions {
  settings: Settings;
  background?: string;
  text: string;
  subtext: string;
  fontFile?: string | null;
  textColor?: string;
  color?: string;
  fit?: 'cover' | 'contain' | 'stretch';
}

/** Scale/fit filters plus the centered pause/startup drawtext block. */
export function buildSlateFilters(options: SlateFilterOptions): string[] {
  const [width, height] = options.settings.video.resolution
    .split('x')
    .map(Number) as [number, number];
  const fps = options.settings.video.fps;
  const background = options.background?.trim() ?? '';
  const textColor = options.textColor?.trim() || 'white';
  const slateColor = options.color?.trim() || options.settings.pause.color;
  const filters: string[] = [];

  if (background) {
    const fit = options.fit === 'contain' || options.fit === 'stretch' ? options.fit : 'cover';
    if (fit === 'cover') {
      filters.push(
        `scale=${width}:${height}:force_original_aspect_ratio=increase`,
        `crop=${width}:${height}`,
      );
    } else if (fit === 'stretch') {
      filters.push(`scale=${width}:${height}`);
    } else {
      filters.push(
        `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${slateColor}`,
      );
    }
    filters.push('setsar=1', `fps=${fps}`);
  }

  if (options.fontFile && options.text.trim()) {
    filters.push(
      `drawtext=fontfile='${options.fontFile}':text='${escapeDrawtext(options.text)}':` +
        `fontsize=${Math.round(width / 14)}:fontcolor=${escapeDrawtext(textColor)}:x=(w-tw)/2:y=(h-th)/2-40`,
    );
  }
  if (options.fontFile && options.subtext.trim()) {
    filters.push(
      `drawtext=fontfile='${options.fontFile}':text='${escapeDrawtext(options.subtext)}':` +
        `fontsize=${Math.round(width / 30)}:fontcolor=${escapeDrawtext(textColor)}:alpha=0.7:x=(w-tw)/2:y=(h-th)/2+60`,
    );
  }

  return filters;
}

export function buildPausePreviewArgs(
  options: SlateFilterOptions & { media: MediaConfig; output: string },
): string[] {
  const [width, height] = options.settings.video.resolution
    .split('x')
    .map(Number) as [number, number];
  const background = options.background?.trim() ?? '';
  const slateColor = options.color?.trim() || options.settings.pause.color;
  const filters = buildSlateFilters(options);
  const args = [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    options.media.ffmpegLogLevel,
    '-y',
  ];
  if (background) {
    const kind = pauseBackgroundKind(background);
    if (kind === 'video' || kind === 'animated') {
      args.push('-ss', '0', '-i', background);
    } else {
      args.push('-i', background);
    }
  } else {
    args.push('-f', 'lavfi', '-i', `color=c=${slateColor}:s=${width}x${height}:d=1`);
  }
  args.push('-frames:v', '1', '-an');
  if (filters.length > 0) args.push('-vf', filters.join(','));
  args.push('-f', 'image2', options.output);
  return args;
}

export function buildPauseCommand(options: PauseCommandOptions): string[] {
  const { media, settings, relay } = options;
  const [width, height] = settings.video.resolution.split('x').map(Number) as [number, number];
  const fps = settings.video.fps;
  const bitrate = settings.video.video_bitrate;
  const background = options.background?.trim() ?? '';
  const kind = background ? pauseBackgroundKind(background) : 'none';
  const slateColor = options.color?.trim() || settings.pause.color;
  const filters = buildSlateFilters(options);

  const args = [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    media.ffmpegLogLevel,
  ];

  if (background) {
    if (kind === 'video') {
      args.push('-stream_loop', '-1', '-re', '-i', background);
    } else if (kind === 'animated') {
      args.push('-stream_loop', '-1', '-re', '-i', background);
    } else {
      args.push('-loop', '1', '-re', '-i', background);
    }
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
  } else {
    args.push(
      '-re',
      '-f',
      'lavfi',
      '-i',
      `color=c=${slateColor}:s=${width}x${height}:r=${fps}`,
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
    );
  }

  args.push('-map', '0:v:0', '-map', '1:a:0');

  if (filters.length > 0) args.push('-vf', filters.join(','));
  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
  );
  if (!background || kind === 'image') args.push('-tune', 'stillimage');
  args.push(
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
