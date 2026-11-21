import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/core/config/loader.js';
import { DEFAULT_SETTINGS } from '../src/core/config/schema.js';
import { EventBus } from '../src/core/events.js';
import { SceneStore } from '../src/core/overlays/scene-store.js';
import { SettingsService } from '../src/core/store/settings-service.js';
import { StreamerStore } from '../src/core/store/streamer-store.js';
import type { Supervisor } from '../src/core/supervisor/supervisor.js';
import { buildServer } from '../src/api/server.js';
import { AuthSessionStore } from '../src/api/session-store.js';
import { LogRing } from '../src/utils/logger.js';
import { VERSION } from '../src/version.js';

const logger = pino({ level: 'silent' });
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('SceneStore', () => {
  it('creates, updates, persists with 0600 permissions, and strips chat.api_key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-scenes-'));
    tempDirs.push(dir);
    const file = join(dir, 'scenes.json');
    const store = new SceneStore(file);

    const overlaysWithSecret = {
      ...structuredClone(DEFAULT_SETTINGS.overlays),
      chat: { ...structuredClone(DEFAULT_SETTINGS.overlays.chat), api_key: 'super-secret-chat-key', enabled: true },
    };
    const scene = store.create(
      { name: 'Gaming 16:9' },
      { overlays: overlaysWithSecret, video_layout: { enabled: true, scale: 80, position_x: 50, position_y: 50 } },
    );

    expect(scene.id).toBe('gaming-16-9');
    expect(scene.overlays.chat.api_key).toBe('');
    expect(scene.overlays.chat.enabled).toBe(true);
    expect(scene.video_layout.scale).toBe(80);
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain('super-secret-chat-key');

    store.setActiveId(scene.id);
    expect(store.activeId()).toBe(scene.id);

    const reloaded = new SceneStore(file);
    expect(reloaded.activeId()).toBe(scene.id);
    expect(reloaded.list()).toHaveLength(1);

    const updated = reloaded.update(
      scene.id,
      { name: 'IRL Hochkant', capture_current: true },
      {
        overlays: structuredClone(DEFAULT_SETTINGS.overlays),
        video_layout: { enabled: false, scale: 100, position_x: 50, position_y: 50 },
      },
    );
    expect(updated.name).toBe('IRL Hochkant');
    expect(updated.overlays.chat.enabled).toBe(false);
    expect(updated.video_layout.scale).toBe(100);

    reloaded.remove(scene.id);
    expect(reloaded.list()).toEqual([]);
    expect(reloaded.activeId()).toBeNull();
  });

  it('rejects duplicate ids and missing scenes cleanly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-scenes-dup-'));
    tempDirs.push(dir);
    const store = new SceneStore(join(dir, 'scenes.json'));

    const fallback = {
      overlays: structuredClone(DEFAULT_SETTINGS.overlays),
      video_layout: structuredClone(DEFAULT_SETTINGS.video.layout),
    };
    store.create({ id: 'talk', name: 'Talk' }, fallback);
    expect(() => store.create({ id: 'talk', name: 'Talk 2' }, fallback)).toThrow(/existiert bereits/);
    expect(() => store.require('unknown')).toThrow(/nicht gefunden/);
  });
});

describe('Scenes API', () => {
  it('supports CRUD and scene activation via HTTP API', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-scenes-api-'));
    tempDirs.push(dir);
    const config = loadConfig({
      cwd: dir,
      env: { API_TOKEN: 'api-secret', LOG_LEVEL: 'silent' },
    });
    const store = new StreamerStore(config.paths.streamersFile, { streamers: [], playlists: [] }, logger);
    const settingsService = new SettingsService(config.paths.settingsFile, DEFAULT_SETTINGS, logger);
    const scenes = new SceneStore(join(dir, 'scenes.json'));

    const fakeStatus = {
      state: 'idle',
      active_streamer_id: null,
      active_streamer_name: null,
      active_playlist: null,
      active_scene_id: scenes.activeId(),
      active_scene_name: null,
      manual_screen: null,
      started_at: null,
      uptime_seconds: 0,
      source: { online: null, resolving: false, connected: false, pid: null, last_data_at: null, bitrate_kbps: null, reconnects: 0 },
      relay: { ingest_clients: 0, output_connected: false, buffer_seconds: 0, excess_seconds: 0, catching_up: false, pacing_multiplier: 1, buffered_bytes: 0, dropped_bytes: 0, delay_seconds: 30, pacing_kbps: null, total_bytes: 0 },
      sink: { running: false, pid: null, bitrate_kbps: null, target_bitrate_kbps: 4000, fps: null, dropped_frames: 0, speed: null, last_progress_at: null, restarts: 0, dts_errors: 0, silence_active: false, silence_since: null, last_error: null },
      watchdog: { stall_timeout: 30, stall_count: 0, last_stall_at: null, last_error: null, reconnecting: false },
      auto_refresh: { enabled: true, interval_minutes: 20, next_refresh_in_seconds: null, last_refresh_at: null, count: 0 },
      chat: { enabled: false, engine: null, messages: 0, last_message_at: null, api_configured: false, canvas_active: false },
      media: null,
      version: VERSION,
    };

    const supervisor = {
      buildStatus: () => ({
        ...fakeStatus,
        active_scene_id: scenes.activeId(),
        active_scene_name: scenes.activeId() ? (scenes.get(scenes.activeId()!)?.name ?? null) : null,
      }),
      activateScene: async (id: string) => {
        const scene = scenes.require(id);
        scenes.setActiveId(scene.id);
        return {
          scene,
          status: { ...fakeStatus, active_scene_id: scene.id, active_scene_name: scene.name },
        };
      },
    } as unknown as Supervisor;

    const app = await buildServer({
      config,
      logger,
      store,
      settingsService,
      supervisor,
      bus: new EventBus(),
      ring: new LogRing(),
      version: VERSION,
      authSessions: new AuthSessionStore(),
      scenes,
    });
    await app.ready();

    try {
      const headers = { authorization: 'Bearer api-secret' };

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/scenes',
        headers,
        payload: { name: 'Studio Talk' },
      });
      expect(createRes.statusCode).toBe(201);
      const created = (createRes.json() as { scene: { id: string } }).scene;

      const listRes = await app.inject({ method: 'GET', url: '/api/scenes', headers });
      expect(listRes.statusCode).toBe(200);
      expect((listRes.json() as { scenes: unknown[] }).scenes).toHaveLength(1);

      const actRes = await app.inject({
        method: 'POST',
        url: `/api/scenes/${created.id}/activate`,
        headers,
      });
      expect(actRes.statusCode).toBe(200);
      expect((actRes.json() as { status: { active_scene_id: string } }).status.active_scene_id).toBe(
        created.id,
      );

      const updRes = await app.inject({
        method: 'PUT',
        url: `/api/scenes/${created.id}`,
        headers,
        payload: { name: 'Talk Updated' },
      });
      expect(updRes.statusCode).toBe(200);
      expect((updRes.json() as { scene: { name: string } }).scene.name).toBe('Talk Updated');

      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/scenes/${created.id}`,
        headers,
      });
      expect(delRes.statusCode).toBe(200);
      expect(scenes.activeId()).toBeNull();
    } finally {
      await app.close();
    }
  });
});
