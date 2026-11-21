import { describe, expect, it } from 'vitest';
import { MediaPlaybackController } from '../src/core/supervisor/media-playback-controller.js';

describe('MediaPlaybackController', () => {
  it('tracks active media playback lifecycle and position', () => {
    const controller = new MediaPlaybackController();
    expect(controller.isPlaying).toBe(false);
    expect(controller.status()).toBeNull();

    controller.start('test.mp4', 10, 100);
    expect(controller.isPlaying).toBe(true);
    expect(controller.file).toBe('test.mp4');
    expect(controller.duration).toBe(100);
    expect(controller.offset).toBe(10);

    const pos = controller.currentPosition();
    expect(pos).toBeGreaterThanOrEqual(10);
    expect(pos).toBeLessThanOrEqual(100);

    const status = controller.status();
    expect(status?.file).toBe('test.mp4');
    expect(status?.duration_seconds).toBe(100);
    expect(status?.position_seconds).toBe(pos);

    controller.stop();
    expect(controller.isPlaying).toBe(false);
    expect(controller.file).toBeNull();
    expect(controller.status()).toBeNull();
  });

  it('clamps seek targets within 0 and duration - 0.5', () => {
    const controller = new MediaPlaybackController();
    controller.start('clip.mp4', 0, 60);

    expect(controller.computeSeekTarget(-10)).toBe(0);
    expect(controller.computeSeekTarget(30)).toBe(30);
    expect(controller.computeSeekTarget(65)).toBe(59.5);
  });

  it('builds synthetic streamer and resolved stream', () => {
    const controller = new MediaPlaybackController();
    const result = controller.buildSyntheticStreamerAndResolved(
      'sample.mp4',
      '/data/media/sample.mp4',
      true,
      1080,
    );

    expect(result.synthetic.id).toBe('media-file');
    expect(result.synthetic.name).toBe('sample.mp4');
    expect(result.synthetic.video_mode).toBe('copy');
    expect(result.resolved.url).toBe('/data/media/sample.mp4');
    expect(result.resolved.isH264).toBe(true);
    expect(result.resolved.vcodec).toBe('h264');
    expect(result.resolved.height).toBe(1080);
  });

  it('schedules and cancels resume timers safely', async () => {
    const controller = new MediaPlaybackController();
    let resumed = false;

    controller.scheduleResume(
      {
        channel: 'file:test.mp4',
        position_seconds: 5,
        duration_seconds: 20,
        updated_at: new Date().toISOString(),
      },
      async () => {
        resumed = true;
      },
      50,
    );

    controller.clearResumeTimer();
    await new Promise((r) => setTimeout(r, 70));
    expect(resumed).toBe(false);
  });
});
