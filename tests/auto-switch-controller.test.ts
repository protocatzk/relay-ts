import { describe, expect, it } from 'vitest';
import { StreamerSchema, PlaylistSchema } from '../src/core/config/schema.js';
import { AutoSwitchController } from '../src/core/supervisor/auto-switch-controller.js';

describe('AutoSwitchController', () => {
  it('identifies preferred candidates sorted by priority', () => {
    const controller = new AutoSwitchController();
    const alpha = StreamerSchema.parse({
      id: 'alpha',
      name: 'Alpha',
      tiktok: 'alpha',
      preferred: true,
      priority: 2,
    });
    const beta = StreamerSchema.parse({
      id: 'beta',
      name: 'Beta',
      tiktok: 'beta',
      preferred: true,
      priority: 1,
    });
    const gamma = StreamerSchema.parse({
      id: 'gamma',
      name: 'Gamma',
      tiktok: 'gamma',
      preferred: false,
      priority: 0,
    });

    const candidate = controller.findPreferredCandidate(
      null,
      [alpha, beta, gamma],
      () => true,
      () => 'test-key',
    );
    expect(candidate?.id).toBe('beta');
  });

  it('does not replace a manually selected preferred streamer unless priority is strictly better', () => {
    const controller = new AutoSwitchController();
    const active = StreamerSchema.parse({
      id: 'active',
      name: 'Active',
      tiktok: 'active',
      preferred: true,
      priority: 1,
    });
    const challenger = StreamerSchema.parse({
      id: 'challenger',
      name: 'Challenger',
      tiktok: 'challenger',
      preferred: true,
      priority: 2,
    });

    // Manually selected (no returnTarget) -> never replaced
    expect(
      controller.findPreferredCandidate(active, [challenger], () => true, () => 'key'),
    ).toBeNull();

    // After automatic takeover (returnTarget set) -> strictly better priority can take over
    controller.setReturnTarget({ kind: 'streamer', key: 'key' });
    const better = StreamerSchema.parse({
      id: 'better',
      name: 'Better',
      tiktok: 'better',
      preferred: true,
      priority: 0,
    });
    expect(
      controller.findPreferredCandidate(active, [better], () => true, () => 'key')?.id,
    ).toBe('better');
  });

  it('tracks ended preferred streamers with suppression cooldown', () => {
    const controller = new AutoSwitchController();
    expect(controller.isSuppressed('streamer-1')).toBe(false);

    controller.markEnded('streamer-1');
    expect(controller.isSuppressed('streamer-1')).toBe(true);

    // After 300 seconds it un-suppresses
    expect(controller.isSuppressed('streamer-1', Date.now() + 301_000)).toBe(false);
  });

  it('captures return target accurately for streamers and media files', () => {
    const controller = new AutoSwitchController();
    const streamer = StreamerSchema.parse({
      id: 'streamer',
      name: 'Streamer',
      tiktok: 'streamer',
    });
    const playlist = {
      playlist: PlaylistSchema.parse({ id: 'pl-1', name: 'PL1', channels: ['streamer'] }),
      index: 0,
    };

    const streamerTarget = controller.captureReturnTarget('key-123', streamer, null, 0, playlist);
    expect(streamerTarget).toEqual({
      kind: 'streamer',
      streamer,
      key: 'key-123',
      playlist,
    });

    const fileTarget = controller.captureReturnTarget('key-123', null, 'intro.mp4', 42, playlist);
    expect(fileTarget).toEqual({
      kind: 'file',
      file: 'intro.mp4',
      key: 'key-123',
      playlist,
      seekSeconds: 42,
    });
  });

  it('filters and sorts auto-start candidates', () => {
    const controller = new AutoSwitchController();
    const s1 = StreamerSchema.parse({
      id: 's1',
      name: 'S1',
      tiktok: 's1',
      auto_start: true,
      priority: 5,
    });
    const s2 = StreamerSchema.parse({
      id: 's2',
      name: 'S2',
      tiktok: 's2',
      auto_start: true,
      priority: 2,
    });
    const s3 = StreamerSchema.parse({
      id: 's3',
      name: 'S3',
      tiktok: 's3',
      auto_start: false,
      priority: 1,
    });

    const candidates = controller.autoStartCandidates([s1, s2, s3]);
    expect(candidates.map((c) => c.id)).toEqual(['s2', 's1']);
  });
});
