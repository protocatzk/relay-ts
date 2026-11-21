import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  createBackupArchive,
  inspectBackupArchive,
  restoreBackupArchive,
} from '../src/core/system/backup-service.js';

describe('System Backup & Restore Service', () => {
  let tempDir: string;
  let dataDir: string;
  let configDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'relay-backup-test-'));
    dataDir = join(tempDir, 'data');
    configDir = join(tempDir, 'config');
    mkdirSync(configDir, { recursive: true });
    mkdirSync(join(dataDir, 'media'), { recursive: true });
    mkdirSync(join(dataDir, 'recordings'), { recursive: true });

    writeFileSync(join(configDir, 'settings.yml'), 'server:\n  port: 3000\n');
    writeFileSync(join(configDir, 'streamers.yml'), 'streamers: []\n');
    writeFileSync(join(dataDir, 'scenes.json'), '{"scenes":[]}\n');
    // Files that MUST be excluded from backups
    writeFileSync(join(dataDir, 'sessions.json'), '{"sessions":[]}\n');
    writeFileSync(join(dataDir, 'media', 'song.mp4'), Buffer.from('large media'));
    writeFileSync(join(dataDir, 'recordings', 'rec.mkv'), Buffer.from('large rec'));
  });

  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('creates a backup archive and excludes sensitive/heavy folders', async () => {
    const backup = await createBackupArchive({
      rootDir: tempDir,
      dataDir,
      configDir,
    });
    expect(existsSync(backup.archivePath)).toBe(true);
    expect(backup.filename.startsWith('relay-backup-')).toBe(true);
    expect(backup.filename.endsWith('.tar.gz')).toBe(true);
    expect(backup.size).toBeGreaterThan(0);

    const inspection = await inspectBackupArchive(backup.archivePath);
    expect(inspection.ok).toBe(true);
    expect(inspection.entries.some((e: string) => e.startsWith('config/settings.yml'))).toBe(true);
    expect(inspection.entries.some((e: string) => e.startsWith('config/streamers.yml'))).toBe(true);
    expect(inspection.entries.some((e: string) => e.startsWith('data/scenes.json'))).toBe(true);
    // Excluded items:
    expect(inspection.entries.some((e: string) => e.includes('sessions.json'))).toBe(false);
    expect(inspection.entries.some((e: string) => e.includes('media/'))).toBe(false);
    expect(inspection.entries.some((e: string) => e.includes('recordings/'))).toBe(false);
  });

  it('inspects and rejects malicious or invalid archives', async () => {
    // 1. Non-existent or empty archive
    const emptyFile = join(tempDir, 'empty.tar.gz');
    writeFileSync(emptyFile, Buffer.alloc(0));
    const emptyInspect = await inspectBackupArchive(emptyFile);
    expect(emptyInspect.ok).toBe(false);

    // 2. Archive containing symlinks
    const symlinkDir = mkdtempSync(join(tmpdir(), 'relay-sym-tar-'));
    mkdirSync(join(symlinkDir, 'config'), { recursive: true });
    writeFileSync(join(symlinkDir, 'config', 'target.txt'), 'secret');
    try {
      execFileSync('ln', ['-s', '/etc/passwd', join(symlinkDir, 'config', 'link')]);
      const symTar = join(tempDir, 'symlink.tar.gz');
      execFileSync('tar', ['-czf', symTar, '-C', symlinkDir, 'config']);
      const symInspect = await inspectBackupArchive(symTar);
      expect(symInspect.ok).toBe(false);
      expect(symInspect.error).toContain('Symlink');
    } catch {
      /* ignore if ln not permitted */
    } finally {
      rmSync(symlinkDir, { recursive: true, force: true });
    }
  });

  it('restores backup archive, creates rollback archive, and ensures 0600 file modes', async () => {
    const backup = await createBackupArchive({
      rootDir: tempDir,
      dataDir,
      configDir,
    });

    // Modify a config file
    writeFileSync(join(configDir, 'settings.yml'), 'server:\n  port: 9999\n');

    const restoreResult = await restoreBackupArchive({
      archivePath: backup.archivePath,
      rootDir: tempDir,
      dataDir,
      configDir,
    });
    expect(restoreResult.entriesCount).toBeGreaterThan(0);
    expect(restoreResult.rollbackPath).toBeTruthy();

    // Verified rollback was created
    expect(existsSync(restoreResult.rollbackPath)).toBe(true);

    // Verified content restored
    const content = readFileSync(join(configDir, 'settings.yml'), 'utf-8');
    expect(content).toContain('port: 3000');
  });
});

describe('System Backup & Restore API', () => {
  let app: FastifyInstance;
  let tempDir: string;
  let dataDir: string;
  let configDir: string;
  let settingsService: SettingsService;
  let store: StreamerStore;
  let reloadedSettings = false;
  let reloadedStore = false;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'relay-backup-api-'));
    configDir = join(tempDir, 'config');
    dataDir = join(tempDir, 'data');
    mkdirSync(configDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });

    writeFileSync(join(configDir, 'settings.yml'), 'server:\n  port: 3000\n');
    writeFileSync(join(configDir, 'streamers.yml'), 'streamers: []\n');

    const logger = pino({ level: 'silent' });
    const config = loadConfig({
      cwd: tempDir,
      env: { API_TOKEN: 'backup-secret', LOG_LEVEL: 'silent' },
    });

    store = new StreamerStore(
      config.paths.streamersFile,
      { streamers: [], playlists: [] },
      logger,
    );
    const originalStoreReload = store.reload.bind(store);
    store.reload = () => {
      reloadedStore = true;
      return originalStoreReload();
    };

    settingsService = new SettingsService(config.paths.settingsFile, DEFAULT_SETTINGS, logger);
    const originalSettingsReload = settingsService.reload.bind(settingsService);
    settingsService.reload = () => {
      reloadedSettings = true;
      return originalSettingsReload();
    };

    const supervisor = {
      buildStatus: () => ({
        state: 'idle',
        source: { online: null, connected: false, reconnects: 0, last_data_at: null },
        relay: { ingest_clients: 0, output_connected: false, buffered_bytes: 0, buffer_seconds: 0 },
        sink: { running: false, bitrate_kbps: null, fps: null },
        secondary_sink: { enabled: false, provider: 'custom', mode: 'copy', running: false, pid: null, bitrate_kbps: null, fps: null, restarts: 0, last_error: null },
        recording: { enabled: false, active: false, filename: null, started_at: null, bytes: 0, disk_warning: null, last_error: null },
        manual_screen: null,
        version: VERSION,
      }),
      applySettings: async () => ({ state: 'idle', version: VERSION }),
      streamersView: () => [],
      playlistsView: () => [],
      notifyStreamersChanged: () => {},
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

  it('downloads backup archive via GET /api/system/backup', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/backup',
      headers: { authorization: 'Bearer backup-secret' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/gzip');
    expect(res.headers['content-disposition']).toContain('attachment; filename="relay-backup-');
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });

  it('restores backup archive via POST /api/system/restore multipart', async () => {
    // Create valid archive
    const backup = await createBackupArchive({
      rootDir: tempDir,
      dataDir,
      configDir,
    });
    const archiveBuffer = readFileSync(backup.archivePath);

    const boundary = '----relay-backup-boundary';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="file"; filename="${backup.filename}"\r\n`),
      Buffer.from('Content-Type: application/gzip\r\n\r\n'),
      archiveBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    reloadedSettings = false;
    reloadedStore = false;

    const res = await app.inject({
      method: 'POST',
      url: '/api/system/restore',
      headers: {
        authorization: 'Bearer backup-secret',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    const resBody = res.json();
    expect(resBody.ok).toBe(true);
    expect(resBody.entries_count).toBeGreaterThan(0);
    expect(resBody.rollback_file).toBeTruthy();
    expect(reloadedSettings).toBe(true);
    expect(reloadedStore).toBe(true);
  });

  it('rejects corrupt upload on restore', async () => {
    const boundary = '----relay-backup-boundary-bad';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from('Content-Disposition: form-data; name="file"; filename="corrupt.tar.gz"\r\n'),
      Buffer.from('Content-Type: application/gzip\r\n\r\n'),
      Buffer.from('corrupt non-tar content'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/system/restore',
      headers: {
        authorization: 'Bearer backup-secret',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('Archiv');
  });
});
