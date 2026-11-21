import { afterEach, describe, expect, it } from 'vitest';
import {
  buildVideoEncoderArgs,
  configureVideoEncoder,
  currentVideoEncoder,
  parseEncoderList,
  probeVideoEncoders,
  resolveVideoEncoder,
  setAvailableVideoEncoders,
} from '../src/core/media/encoders.js';
import type { runCommand } from '../src/utils/process.js';

const ENCODER_LIST = `
 V..... = Video
 ------
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10
 V....D h264_qsv             H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (Intel Quick Sync Video acceleration)
 V....D h264_nvenc           NVIDIA NVENC H.264 encoder
 V....D h264_amf             AMD AMF H.264 Encoder
 V....D hevc_qsv             HEVC (Intel Quick Sync Video acceleration)
 A....D aac                  AAC (Advanced Audio Coding)
`;

afterEach(() => {
  setAvailableVideoEncoders(['libx264']);
  configureVideoEncoder('libx264');
});

describe('video encoder capabilities', () => {
  it('parses only the H.264 encoders RELAY drives', () => {
    expect(parseEncoderList(ENCODER_LIST).sort()).toEqual(
      ['h264_amf', 'h264_nvenc', 'h264_qsv', 'libx264'].sort(),
    );
  });

  it('keeps libx264 usable when no probe has run', () => {
    expect(resolveVideoEncoder('auto')).toEqual({ encoder: 'libx264', fallback: false });
    expect(resolveVideoEncoder('h264_qsv')).toEqual({ encoder: 'libx264', fallback: true });
  });

  it('prefers NVENC, then QSV, then AMF for auto', () => {
    setAvailableVideoEncoders(['libx264', 'h264_qsv', 'h264_amf']);
    expect(resolveVideoEncoder('auto').encoder).toBe('h264_qsv');
    setAvailableVideoEncoders(['libx264', 'h264_qsv', 'h264_amf', 'h264_nvenc']);
    expect(resolveVideoEncoder('auto').encoder).toBe('h264_nvenc');
  });

  it('remembers the configured encoder for command builders', () => {
    setAvailableVideoEncoders(['libx264', 'h264_amf']);
    expect(configureVideoEncoder('h264_amf')).toBe('h264_amf');
    expect(currentVideoEncoder()).toBe('h264_amf');
    expect(configureVideoEncoder('h264_qsv')).toBe('libx264');
    expect(currentVideoEncoder()).toBe('libx264');
  });

  it('probes listed encoders with the real runtime arguments', async () => {
    const calls: string[][] = [];
    const runner = (async (_cmd: string, args: string[]) => {
      calls.push(args);
      if (args.includes('-encoders')) return { code: 0, stdout: ENCODER_LIST, stderr: '' };
      const encoder = args[args.indexOf('-c:v') + 1];
      // Simulate a working NVIDIA driver and a broken QSV device.
      return encoder === 'h264_nvenc'
        ? { code: 0, stdout: '', stderr: '' }
        : { code: 1, stdout: '', stderr: 'device not found' };
    }) as typeof runCommand;

    const available = await probeVideoEncoders({ ffmpegBin: 'ffmpeg', runner, timeoutMs: 100 });
    expect(available).toEqual(['libx264', 'h264_nvenc']);
    const nvencTest = calls.find((args) => args.includes('h264_nvenc'));
    expect(nvencTest).toContain('-tune');
    expect(nvencTest).toContain('ll');
    expect(nvencTest).toContain('-rc');
  });

  it('tests only the explicitly selected hardware encoder', async () => {
    const tested: string[] = [];
    const runner = (async (_cmd: string, args: string[]) => {
      if (args.includes('-encoders')) return { code: 0, stdout: ENCODER_LIST, stderr: '' };
      tested.push(args[args.indexOf('-c:v') + 1]!);
      return { code: 0, stdout: '', stderr: '' };
    }) as typeof runCommand;

    await expect(
      probeVideoEncoders({ ffmpegBin: 'ffmpeg', runner, preferred: 'h264_qsv' }),
    ).resolves.toEqual(['libx264', 'h264_qsv']);
    expect(tested).toEqual(['h264_qsv']);
  });

  it('skips probe encodes entirely when libx264 is selected', async () => {
    let calls = 0;
    const runner = (async () => {
      calls += 1;
      return { code: 0, stdout: '', stderr: '' };
    }) as unknown as typeof runCommand;
    await expect(
      probeVideoEncoders({ ffmpegBin: 'ffmpeg', runner, preferred: 'libx264' }),
    ).resolves.toEqual(['libx264']);
    expect(calls).toBe(0);
  });

  it('falls back to libx264 when ffmpeg cannot list encoders', async () => {
    const runner = (async () => ({
      code: 1,
      stdout: '',
      stderr: 'ffmpeg not found',
    })) as unknown as typeof runCommand;
    await expect(probeVideoEncoders({ ffmpegBin: 'ffmpeg', runner })).resolves.toEqual([
      'libx264',
    ]);
  });
});

describe('video encoder arguments', () => {
  it('keeps the x264 CBR shape for YouTube', () => {
    const args = buildVideoEncoderArgs('libx264', {
      bitrateKbps: 4000,
      fps: 25,
      preset: 'veryfast',
      tune: 'zerolatency',
      filler: true,
      profile: 'high',
      level: '4.0',
      keyframeLimits: true,
    }).join(' ');
    expect(args).toContain('-c:v libx264');
    expect(args).toContain('-preset veryfast');
    expect(args).toContain('-tune zerolatency');
    expect(args).toContain('-profile:v high -level 4.0');
    expect(args).toContain('-pix_fmt yuv420p');
    expect(args).toContain('-b:v 4000k');
    expect(args).toContain('-g 50');
    expect(args).toContain('-keyint_min 50');
    expect(args).toContain('nal-hrd=cbr:filler=1:force-cfr=1:aud=1');
  });

  it('maps presets and pixel format for Intel QSV', () => {
    const args = buildVideoEncoderArgs('h264_qsv', {
      bitrateKbps: 3000,
      fps: 30,
      preset: 'ultrafast',
      tune: 'zerolatency',
      filler: true,
    }).join(' ');
    expect(args).toContain('-c:v h264_qsv');
    expect(args).toContain('-preset veryfast');
    expect(args).toContain('-look_ahead 0');
    expect(args).toContain('-forced_idr 1');
    expect(args).toContain('-pix_fmt nv12');
    expect(args).toContain('-g 60');
    expect(args).not.toContain('libx264');
    expect(args).not.toContain('nal-hrd');
    expect(args).not.toContain('zerolatency');
  });

  it('uses low-latency CBR for NVENC and AMF', () => {
    const nvenc = buildVideoEncoderArgs('h264_nvenc', {
      bitrateKbps: 6000,
      fps: 60,
      preset: 'fast',
    }).join(' ');
    expect(nvenc).toContain('-c:v h264_nvenc');
    expect(nvenc).toContain('-preset p4');
    expect(nvenc).toContain('-tune ll');
    expect(nvenc).toContain('-rc cbr');
    expect(nvenc).toContain('-forced-idr 1');
    expect(nvenc).toContain('-strict_gop 1');
    expect(nvenc).toContain('-zerolatency 1');
    expect(nvenc).toContain('-g 120');

    const amf = buildVideoEncoderArgs('h264_amf', {
      bitrateKbps: 2500,
      fps: 25,
      preset: 'veryfast',
    }).join(' ');
    expect(amf).toContain('-c:v h264_amf');
    expect(amf).toContain('-usage lowlatency');
    expect(amf).toContain('-quality speed');
    expect(amf).toContain('-rc cbr');
  });
});
