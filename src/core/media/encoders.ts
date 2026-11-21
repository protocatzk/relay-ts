import type { Logger } from 'pino';
import type { VideoEncoderSetting, VideoPreset } from '../config/schema.js';
import { runCommand } from '../../utils/process.js';

export type HardwareVideoEncoder = 'h264_qsv' | 'h264_nvenc' | 'h264_amf';
export type VideoEncoder = 'libx264' | HardwareVideoEncoder;

const SOFTWARE_ENCODER = 'libx264' as const;
/** `auto` prefers a discrete GPU encoder, then Intel Quick Sync, then AMD AMF. */
const AUTO_ORDER: HardwareVideoEncoder[] = ['h264_nvenc', 'h264_qsv', 'h264_amf'];
const HARDWARE_ENCODERS = new Set<string>(AUTO_ORDER);
const KNOWN_ENCODERS = new Set<VideoEncoder>([SOFTWARE_ENCODER, ...AUTO_ORDER]);

/**
 * Encoders whose driver/device initialization was verified at startup. The
 * software encoder is always considered available so command builders never
 * depend on the probe having run (tests, tooling).
 */
let availableEncoders: ReadonlySet<VideoEncoder> = new Set<VideoEncoder>([SOFTWARE_ENCODER]);
let activeEncoder: VideoEncoder = SOFTWARE_ENCODER;

export function setAvailableVideoEncoders(encoders: Iterable<VideoEncoder>): void {
  const next = new Set<VideoEncoder>([SOFTWARE_ENCODER]);
  for (const encoder of encoders) {
    if (KNOWN_ENCODERS.has(encoder)) next.add(encoder);
  }
  availableEncoders = next;
}

export function availableVideoEncoders(): VideoEncoder[] {
  return [...availableEncoders];
}

export function isHardwareVideoEncoder(
  encoder: VideoEncoderSetting,
): encoder is HardwareVideoEncoder {
  return HARDWARE_ENCODERS.has(encoder);
}

export function resolveVideoEncoder(preferred: VideoEncoderSetting): {
  encoder: VideoEncoder;
  fallback: boolean;
} {
  if (preferred === 'auto') {
    return {
      encoder: AUTO_ORDER.find((encoder) => availableEncoders.has(encoder)) ?? SOFTWARE_ENCODER,
      fallback: false,
    };
  }
  if (availableEncoders.has(preferred)) return { encoder: preferred, fallback: false };
  return { encoder: SOFTWARE_ENCODER, fallback: true };
}

/**
 * Resolves the configured encoder, remembers it for the ffmpeg command
 * builders and logs whether a hardware fallback happened.
 */
export function configureVideoEncoder(
  preferred: VideoEncoderSetting,
  logger?: Pick<Logger, 'info' | 'warn'>,
): VideoEncoder {
  const { encoder, fallback } = resolveVideoEncoder(preferred);
  activeEncoder = encoder;
  if (fallback) {
    logger?.warn(
      { requested: preferred, encoder, available: availableVideoEncoders() },
      'Video-Encoder nicht verfügbar – libx264 wird verwendet',
    );
  } else {
    logger?.info(
      { requested: preferred, encoder, available: availableVideoEncoders() },
      'Video-Encoder ausgewählt',
    );
  }
  return encoder;
}

/** Encoder currently used for source re-encodes, the sink and slates. */
export function currentVideoEncoder(): VideoEncoder {
  return activeEncoder;
}

/** Parses `ffmpeg -encoders` into the encoders RELAY knows how to drive. */
export function parseEncoderList(output: string): VideoEncoder[] {
  const found = new Set<VideoEncoder>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*V[A-Z.]{5}\s+(\S+)/.exec(line);
    if (!match) continue;
    const name = match[1] as VideoEncoder;
    if (KNOWN_ENCODERS.has(name)) found.add(name);
  }
  return [...found];
}

export interface EncoderProbeOptions {
  ffmpegBin: string;
  /** Only the encoder needed for this setting is test-encoded. */
  preferred?: VideoEncoderSetting;
  logger?: Pick<Logger, 'debug' | 'warn' | 'info'>;
  /** Per-encoder test encode timeout. */
  timeoutMs?: number;
  /** Injectable for tests. */
  runner?: typeof runCommand;
}

/**
 * Detects usable encoders by listing the build and then encoding three frames
 * with the exact argument set used at runtime. The test encode matters: a
 * build can advertise h264_qsv/h264_nvenc while the driver, device or an
 * option such as `-tune ll` is unavailable. Only the encoder selected by the
 * setting is tested, so a libx264 setup does not pay for driver probes.
 */
export async function probeVideoEncoders(options: EncoderProbeOptions): Promise<VideoEncoder[]> {
  const { ffmpegBin, logger } = options;
  const preferred = options.preferred ?? 'auto';
  const runner = options.runner ?? runCommand;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (preferred === 'libx264') {
    logger?.info({ available: [SOFTWARE_ENCODER] }, 'Video-Encoder: libx264');
    return [SOFTWARE_ENCODER];
  }

  const listed = await runner(ffmpegBin, ['-hide_banner', '-encoders'], {
    timeoutMs,
  }).catch((error: unknown) => {
    logger?.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'ffmpeg-Encoder konnten nicht gelesen werden',
    );
    return null;
  });
  if (!listed || listed.code !== 0) {
    logger?.warn('ffmpeg-Encoder-Liste nicht verfügbar – libx264 wird verwendet');
    return [SOFTWARE_ENCODER];
  }
  const candidates = parseEncoderList(listed.stdout);
  if (!candidates.includes(SOFTWARE_ENCODER)) {
    logger?.warn('ffmpeg meldet keinen libx264-Encoder');
  }

  const testOrder: HardwareVideoEncoder[] =
    preferred === 'auto'
      ? AUTO_ORDER
      : isHardwareVideoEncoder(preferred)
        ? [preferred]
        : [];
  const usable: VideoEncoder[] = [SOFTWARE_ENCODER];
  for (const encoder of testOrder) {
    if (!candidates.includes(encoder)) {
      logger?.debug({ encoder }, 'Encoder ist im ffmpeg-Build nicht enthalten');
      continue;
    }
    const ok = await testEncoder(ffmpegBin, encoder, timeoutMs, logger, runner);
    if (!ok) continue;
    usable.push(encoder);
    // `auto` takes the first working encoder; explicit settings test exactly
    // the requested one.
    if (preferred === 'auto') break;
  }
  logger?.info({ available: usable }, 'Verfügbare Video-Encoder');
  return usable;
}

async function testEncoder(
  ffmpegBin: string,
  encoder: HardwareVideoEncoder,
  timeoutMs: number,
  logger?: Pick<Logger, 'debug' | 'warn'>,
  runner: typeof runCommand = runCommand,
): Promise<boolean> {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=black:s=256x144:r=25',
    '-frames:v',
    '3',
    '-an',
    ...buildVideoEncoderArgs(encoder, {
      bitrateKbps: 1_000,
      fps: 25,
      preset: 'veryfast',
      tune: 'zerolatency',
      filler: false,
      profile: 'high',
      level: '4.0',
      keyframeLimits: true,
    }),
    '-f',
    'null',
    '-',
  ];
  try {
    const result = await runner(ffmpegBin, args, { timeoutMs });
    if (result.code === 0) {
      logger?.debug({ encoder }, 'Hardware-Encoder nutzbar');
      return true;
    }
    logger?.warn(
      { encoder, stderr: result.stderr.trim().slice(-400) },
      'Hardware-Encoder nicht nutzbar – Fallback auf libx264',
    );
    return false;
  } catch (error) {
    logger?.warn(
      { encoder, err: error instanceof Error ? error.message : String(error) },
      'Hardware-Encoder-Test fehlgeschlagen – Fallback auf libx264',
    );
    return false;
  }
}

function qsvPreset(preset: VideoPreset): string {
  switch (preset) {
    case 'ultrafast':
    case 'veryfast':
      return 'veryfast';
    case 'faster':
      return 'faster';
    case 'fast':
      return 'fast';
    default:
      return 'medium';
  }
}

function nvencPreset(preset: VideoPreset): string {
  switch (preset) {
    case 'ultrafast':
      return 'p1';
    case 'veryfast':
      return 'p2';
    case 'faster':
      return 'p3';
    case 'fast':
      return 'p4';
    default:
      return 'p5';
  }
}

function amfQuality(preset: VideoPreset): string {
  return preset === 'ultrafast' || preset === 'veryfast' ? 'speed' : 'balanced';
}

export interface VideoEncoderArgsOptions {
  bitrateKbps: number;
  fps: number;
  preset: VideoPreset;
  /** libx264 latency/still-image tuning; hardware encoders use their own flags. */
  tune?: 'zerolatency' | 'stillimage';
  /** libx264 HRD filler keeps YouTube's CBR stream from running dry. */
  filler?: boolean;
  profile?: 'high';
  level?: string;
  /** Adds -keyint_min/-sc_threshold next to -g (closed GOP). */
  keyframeLimits?: boolean;
}

/**
 * Output arguments shared by every encode site. Hardware encoders map the
 * dashboard preset to their own quality scale; the bitrate ceiling and GOP
 * length stay identical so YouTube sees the same stream shape.
 */
export function buildVideoEncoderArgs(
  encoder: VideoEncoder,
  options: VideoEncoderArgsOptions,
): string[] {
  const bitrate = Math.max(1, Math.round(options.bitrateKbps));
  const fps = Math.max(1, Math.round(options.fps));
  const gop = Math.max(1, fps * 2);
  const common = [
    ...(options.profile ? ['-profile:v', options.profile] : []),
    // Hardware encoders pick a level that fits resolution/FPS themselves; the
    // hardcoded YouTube level is an x264-only constraint here.
    ...(options.profile && options.level && encoder === 'libx264'
      ? ['-level', options.level]
      : []),
    '-pix_fmt',
    encoder === 'h264_qsv' ? 'nv12' : 'yuv420p',
    '-b:v',
    `${bitrate}k`,
    '-maxrate',
    `${bitrate}k`,
    '-bufsize',
    `${bitrate * 2}k`,
    '-g',
    String(gop),
  ];
  if (options.keyframeLimits) {
    common.push('-keyint_min', String(gop), '-sc_threshold', '0');
  }

  switch (encoder) {
    case 'h264_qsv':
      return [
        '-c:v',
        encoder,
        '-preset',
        qsvPreset(options.preset),
        '-look_ahead',
        '0',
        '-async_depth',
        '1',
        '-forced_idr',
        '1',
        ...common,
      ];
    case 'h264_nvenc':
      return [
        '-c:v',
        encoder,
        '-preset',
        nvencPreset(options.preset),
        '-tune',
        'll',
        '-rc',
        'cbr',
        '-bf',
        '0',
        '-forced-idr',
        '1',
        '-strict_gop',
        '1',
        '-zerolatency',
        '1',
        ...common,
      ];
    case 'h264_amf':
      return [
        '-c:v',
        encoder,
        '-usage',
        'lowlatency',
        '-quality',
        amfQuality(options.preset),
        '-rc',
        'cbr',
        ...common,
      ];
    case 'libx264':
    default:
      return [
        '-c:v',
        'libx264',
        '-preset',
        options.preset,
        ...(options.tune ? ['-tune', options.tune] : []),
        ...common,
        ...(options.filler ? ['-x264-params', 'nal-hrd=cbr:filler=1:force-cfr=1:aud=1'] : []),
      ];
  }
}
