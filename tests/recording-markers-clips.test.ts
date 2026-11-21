import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/core/config/loader.js';
import { DEFAULT_SETTINGS } from '../src/core/config/schema.js';
import { EventBus } from '../src/core/events.js';
import { StreamerStore } from '../src/core/store/streamer-store.js';
import { SettingsService } from '../src/core/store/settings-service.js';
import type { Supervisor } from '../src/core/supervisor/supervisor.js';
import { buildServer } from '../src/api/server.js';
import { AuthSessionStore } from '../src/api/session-store.js';
import { LogRing } from '../src/utils/logger.js';
import { VERSION } from '../src/version.js';
import {
  addRecordingMarker,
  readRecordingMarkers,
  removeRecordingMarker,
  removeMarkersFile,
} from '../src/core/recording/recording-markers.js';
import {
  recordingsDirectory,
  remuxRecordingClip,
} from '../src/core/recording/recording-controller.js';

describe('Recording Markers and Remux Clips', () => {
  let tempDir: string;
  let recDir: string;
  let mediaDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'relay-markers-test-'));
    recDir = recordingsDirectory(join(tempDir, 'data'));
    mediaDir = join(tempDir, 'data', 'media');
    mkdirSync(recDir, { recursive: true });
    mkdirSync(mediaDir, { recursive: true });
  });

  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup error */
    }
  });

  it('manages markers lifecycle and validates paths', () => {
    expect(readRecordingMarkers(join(tempDir, 'data'), '../traversal.mkv')).toEqual([]);
    expect(() => addRecordingMarker(join(tempDir, 'data'), '../traversal.mkv', { offset_seconds: 10 })).toThrow();
    expect(() => addRecordingMarker(join(tempDir, 'data'), 'sub/folder.mkv', { offset_seconds: 10 })).toThrow();

    const filename = '2026-11-21-sample.mkv';
    writeFileSync(join(recDir, filename), Buffer.from('dummy'));

    expect(readRecordingMarkers(join(tempDir, 'data'), filename)).toEqual([]);

    const m1 = addRecordingMarker(join(tempDir, 'data'), filename, {
      offset_seconds: 12.5,
      label: 'Kills',
      source: 'manual',
    });
    expect(m1.id).toBeTruthy();
    expect(m1.offset_seconds).toBe(12.5);
    expect(m1.label).toBe('Kills');
    expect(m1.source).toBe('manual');

    const m2 = addRecordingMarker(join(tempDir, 'data'), filename, {
      offset_seconds: 45,
      label: 'Winner',
      source: 'telegram',
    });

    const list = readRecordingMarkers(join(tempDir, 'data'), filename);
    expect(list).toHaveLength(2);
    expect(list[0]?.id).toBe(m1.id);
    expect(list[1]?.id).toBe(m2.id);

    const removed = removeRecordingMarker(join(tempDir, 'data'), filename, m1.id);
    expect(removed).toBe(true);
    expect(readRecordingMarkers(join(tempDir, 'data'), filename)).toHaveLength(1);

    removeMarkersFile(join(tempDir, 'data'), filename);
    expect(readRecordingMarkers(join(tempDir, 'data'), filename)).toEqual([]);
  });

  it('remuxes a clip to mp4 and imports into media', async () => {
    const filename = 'clip-source.mkv';
    const filePath = join(recDir, filename);

    // Generate a 4-second valid test MKV using ffmpeg
    try {
      execFileSync('ffmpeg', [
        '-y',
        '-f', 'lavfi', '-i', 'testsrc=duration=4:size=320x240:rate=15',
        '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=4:sample_rate=22050',
        '-c:v', 'libx264',
        '-c:a', 'aac',
        filePath,
      ], { stdio: 'ignore' });
    } catch {
      // If ffmpeg is not runnable in this env, skip the remux test
      return;
    }

    const clipResult = await remuxRecordingClip({
      ffmpegBin: 'ffmpeg',
      dataDir: join(tempDir, 'data'),
      sourceFilename: filename,
      startSeconds: 1,
      endSeconds: 3,
      targetFilename: 'my-highlight',
      toMedia: true,
    });

    expect(clipResult.filename).toBe('my-highlight.mp4');
    expect(clipResult.duration).toBeGreaterThan(0);
    expect(existsSync(join(mediaDir, 'my-highlight.mp4'))).toBe(true);
  });
});

describe('Recording Markers and Clip API', () => {
  let app: FastifyInstance;
  let tempDir: string;
  let recDir: string;
  const activeRecording = 'stream-active.mkv';
  const activeStartedAt = new Date(Date.now() - 30_000);

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'relay-markers-api-'));
    recDir = recordingsDirectory(join(tempDir, 'data'));
    mkdirSync(recDir, { recursive: true });
    mkdirSync(join(tempDir, 'data', 'media'), { recursive: true });

    const logger = pino({ level: 'silent' });
    const config = loadConfig({
      cwd: tempDir,
      env: { API_TOKEN: 'markers-secret', LOG_LEVEL: 'silent' },
    });

    const store = new StreamerStore(
      config.paths.streamersFile,
      { streamers: [], playlists: [] },
      logger,
    );
    const settingsService = new SettingsService(config.paths.settingsFile, DEFAULT_SETTINGS, logger);

    const supervisor = {
      buildStatus: () => ({
        state: 'live',
        source: { online: true, connected: true, reconnects: 0, last_data_at: null },
        relay: { ingest_clients: 1, output_connected: true, buffered_bytes: 0, buffer_seconds: 0 },
        sink: { running: true, bitrate_kbps: 2000, fps: 30 },
        recording: {
          enabled: true,
          active: Boolean(activeRecording),
          filename: activeRecording,
          started_at: activeStartedAt.toISOString(),
          bytes: 1024,
          disk_warning: null,
          last_error: null,
        },
        manual_screen: null,
        version: VERSION,
      }),
      recordingFilename: () => activeRecording,
      recordingStartedAt: () => (activeRecording ? activeStartedAt : null),
      addRecordingMarker: (input: { label?: string; source?: string }) => {
        if (!activeRecording) throw new Error('Keine Aufnahme aktiv');
        const offset = Math.max(0, (Date.now() - activeStartedAt.getTime()) / 1000);
        return addRecordingMarker(config.paths.dataDir, activeRecording, {
          offset_seconds: offset,
          label: input.label,
          source: (input.source as any) ?? 'manual',
        });
      },
      applySettings: async () => ({ state: 'live', version: VERSION }),
      streamersView: () => [],
      playlistsView: () => [],
    } as unknown as Supervisor;

    app = await buildServer({
      config,
      logger,
      store,
      settingsService,
      supervisor,
      bus: new EventBus(),
      ring: new LogRing(),
      version: VERSION,
      authSessions: new AuthSessionStore(),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('creates and lists markers for active recording using filename "current"', async () => {
    writeFileSync(join(recDir, 'stream-active.mkv'), Buffer.from('mock mkv'));

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/recordings/current/markers',
      headers: { authorization: 'Bearer markers-secret' },
      payload: { label: 'First Goal' },
    });
    expect(createRes.statusCode).toBe(201);
    const { marker } = createRes.json() as { marker: { label: string; offset_seconds: number; id: string } };
    expect(marker.label).toBe('First Goal');
    expect(marker.offset_seconds).toBeGreaterThanOrEqual(25);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/recordings/current/markers',
      headers: { authorization: 'Bearer markers-secret' },
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json() as { markers: any[] };
    expect(listBody.markers).toHaveLength(1);

    // Delete marker
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/recordings/stream-active.mkv/markers/${marker.id}`,
      headers: { authorization: 'Bearer markers-secret' },
    });
    expect(delRes.statusCode).toBe(200);

    const listResAfter = await app.inject({
      method: 'GET',
      url: '/api/recordings/stream-active.mkv/markers',
      headers: { authorization: 'Bearer markers-secret' },
    });
    expect(listResAfter.json().markers).toHaveLength(0);
  });

  it('validates clip creation input and enforces bounds', async () => {
    const invalidRes = await app.inject({
      method: 'POST',
      url: '/api/recordings/stream-active.mkv/clip',
      headers: { authorization: 'Bearer markers-secret' },
      payload: { start_seconds: 10, end_seconds: 5 },
    });
    expect(invalidRes.statusCode).toBe(400);

    const badNameRes = await app.inject({
      method: 'POST',
      url: '/api/recordings/stream-active.mkv/clip',
      headers: { authorization: 'Bearer markers-secret' },
      payload: { start_seconds: 1, end_seconds: 5, target_filename: '../malicious' },
    });
    expect(badNameRes.statusCode).toBe(400);
  });
});
