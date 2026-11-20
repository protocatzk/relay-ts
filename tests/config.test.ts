import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, readStreamersFile, applyEnvSettings } from '../src/core/config/loader.js';
import { DEFAULT_SETTINGS } from '../src/core/config/schema.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'relay-config-'));
}

describe('config loader', () => {
  it('creates a default configuration and applies defaults', () => {
    const dir = tempDir();
    const config = loadConfig({
      cwd: dir,
      env: { SERVER_PORT: '3300', LOG_LEVEL: 'debug' },
    });
    expect(config.server.port).toBe(3300);
    expect(config.server.logLevel).toBe('debug');
    expect(config.settings.delay_buffer.size).toBe(DEFAULT_SETTINGS.delay_buffer.size);
    expect(config.settings.source.reencode).toBe('on_reconnect');
    expect(config.settings.video.layout).toEqual({
      enabled: false,
      scale: 100,
      position_x: 50,
      position_y: 50,
    });
    expect(config.streamers).toEqual([]);
    expect(config.paths.streamersFile).toBe(join(dir, 'config/streamers.yml'));
  });

  it('applies environment overrides to settings', () => {
    const dir = tempDir();
    const config = loadConfig({
      cwd: dir,
      env: {
        RELAY_DELAY_SECONDS: '45',
        OUTPUT_FPS: '30',
        VIDEO_BITRATE: '5M',
        AUDIO_BITRATE: '160k',
        OUTPUT_RESOLUTION: '1280x720',
        SOURCE_REENCODE: 'always',
        STALL_TIMEOUT: '60',
        AUTO_REFRESH_MINUTES: '30',
        ONLINE_CHECK_ENABLED: 'true',
        PAUSE_GRACE_SECONDS: '3',
      },
    });
    expect(config.settings.delay_buffer.size).toBe(45);
    expect(config.settings.video.fps).toBe(30);
    expect(config.settings.video.video_bitrate).toBe(5000);
    expect(config.settings.video.audio_bitrate).toBe(160);
    expect(config.settings.video.resolution).toBe('1280x720');
    expect(config.settings.source.reencode).toBe('always');
    expect(config.settings.watchdog.stall_timeout).toBe(60);
    expect(config.settings.auto_refresh.interval).toBe(30);
    expect(config.settings.online.enabled).toBe(true);
    expect(config.settings.pause.grace_seconds).toBe(3);
  });

  it('keeps persisted settings unless env overrides are explicitly enabled', () => {
    const persisted = { video: { fps: 25 } };
    applyEnvSettings(persisted, { OUTPUT_FPS: '30' });
    expect(persisted.video.fps).toBe(25);

    const missing = { video: {} as Record<string, unknown> };
    applyEnvSettings(missing, { OUTPUT_FPS: '30' });
    expect(missing.video.fps).toBe(30);

    applyEnvSettings(persisted, { OUTPUT_FPS: '30' }, true);
    expect(persisted.video.fps).toBe(30);
  });

  it('reads streamers and rejects duplicate ids', () => {
    const dir = tempDir();
    const file = join(dir, 'streamers.yml');
    writeFileSync(
      file,
      [
        'streamers:',
        '  - id: alpha',
        '    name: Alpha',
        '    tiktok: alpha',
        '  - id: alpha',
        '    name: Alpha 2',
        '    tiktok: alpha2',
      ].join('\n'),
    );
    expect(() => readStreamersFile(file)).toThrow(/Doppelte Streamer-ID/);
  });

  it('writes a Netscape cookie file for the TikTok session', () => {
    const dir = tempDir();
    const config = loadConfig({
      cwd: dir,
      env: { TIKTOK_SESSION_ID: 'abc123', TIKTOK_TARGET_IDC: 'eu' },
    });
    const content = readFileSync(config.paths.cookiesFile, 'utf8');
    expect(content).toContain('sessionid\tabc123');
    expect(content).toContain('tt-target-idc\teu');
  });

  it('normalizes partial YAML settings over defaults', () => {
    const dir = tempDir();
    const file = join(dir, 'streamers.yml');
    writeFileSync(file, 'streamers: []\nsettings:\n  video:\n    fps: 20\n');
    const config = loadConfig({ cwd: dir, env: { STREAMERS_FILE: file } });
    expect(config.settings.video.fps).toBe(20);
    expect(config.settings.video.video_bitrate).toBe(DEFAULT_SETTINGS.video.video_bitrate);
  });

  it('migrates per-streamer overlays to global settings once', () => {
    const dir = tempDir();
    const file = join(dir, 'streamers.yml');
    const streamers = (fontSize: number) =>
      [
        'streamers:',
        '  - id: alpha',
        '    name: Alpha',
        '    tiktok: alpha',
        '    overlays:',
        '      chat:',
        '        enabled: true',
        `        font_size: ${fontSize}`,
        '      clock:',
        '        enabled: true',
        '        margin: 44',
      ].join('\n');
    writeFileSync(file, streamers(30));
    const first = loadConfig({ cwd: dir, env: { STREAMERS_FILE: file } });
    expect(first.settings.overlays.chat.enabled).toBe(true);
    expect(first.settings.overlays.chat.font_size).toBe(30);
    expect(first.settings.overlays.clock.margin).toBe(44);
    expect(readFileSync(first.paths.settingsFile, 'utf8')).toContain('overlays:');

    // Once persisted, later per-streamer changes must not overwrite the global config.
    writeFileSync(file, streamers(40));
    const second = loadConfig({ cwd: dir, env: { STREAMERS_FILE: file } });
    expect(second.settings.overlays.chat.font_size).toBe(30);
  });
});
