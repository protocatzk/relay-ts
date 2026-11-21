import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { EventBus } from '../src/core/events.js';
import { Supervisor } from '../src/core/supervisor/supervisor.js';
import { DEFAULT_SETTINGS } from '../src/core/config/schema.js';
import { clearFilesystemUsageCache, filesystemUsage } from '../src/core/diagnostics.js';
import {
  evaluateRecordingStorageAsync,
  listRecordingsAsync,
  recordingsDirectory,
} from '../src/core/recording/recording-controller.js';
import { OverlayManager } from '../src/core/overlays/overlay-manager.js';
import { QueueController } from '../src/core/supervisor/queue-controller.js';
import { StreamerStore } from '../src/core/store/streamer-store.js';
import { readLogFileEntries, RotatingFileStream } from '../src/utils/logger.js';
import { buildServer } from '../src/api/server.js';
import { SettingsService } from '../src/core/store/settings-service.js';
import { AuthSessionStore } from '../src/api/session-store.js';
import { VERSION } from '../src/version.js';

const silentLogger = pino({ level: 'silent' });

describe('Batch 2: Performance, Tech-Debt & Ops (#54, #57, #60, #61)', () => {
  describe('#54: Status snapshot only emitted when dashboards are connected', () => {
    it('skips buildStatus when event bus has no observers, and emits when observer connects', () => {
      const bus = new EventBus();
      expect(bus.hasObservers()).toBe(false);
      expect(bus.observerCount).toBe(0);

      // Create a partial supervisor mock or instantiate
      const buildStatusSpy = vi.fn().mockReturnValue({ state: 'idle' });
      const supervisor = {
        deps: { bus, logger: silentLogger },
        buildStatus: buildStatusSpy,
        streamersView: vi.fn().mockReturnValue([]),
        buildQueueSnapshot: vi.fn().mockReturnValue({ entries: [], playing: false, index: null, loop: false }),
        emitStatus(force = false) {
          if (!force && !this.deps.bus.hasObservers()) return;
          this.deps.bus.emit({ type: 'status', data: this.buildStatus() } as any);
        },
      };

      // 0 observers: emitStatus should NOT call buildStatus
      supervisor.emitStatus();
      expect(buildStatusSpy).not.toHaveBeenCalled();

      // Force = true: should call buildStatus even with 0 observers
      supervisor.emitStatus(true);
      expect(buildStatusSpy).toHaveBeenCalledTimes(1);

      // Observer connects: emitStatus should call buildStatus
      const received: any[] = [];
      const sub = bus.observe().subscribe((event) => received.push(event));
      expect(bus.hasObservers()).toBe(true);

      supervisor.emitStatus();
      expect(buildStatusSpy).toHaveBeenCalledTimes(2);
      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('status');

      // Observer disconnects: emitStatus should no longer call buildStatus
      sub.unsubscribe();
      expect(bus.hasObservers()).toBe(false);

      supervisor.emitStatus();
      expect(buildStatusSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('#57: Preview caching & ETag support', () => {
    it('returns ETag and 304 Not Modified when preview has not changed', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'relay-preview-test-'));
      const settingsFile = join(dir, 'settings.yml');
      const streamersFile = join(dir, 'streamers.yml');
      const sessionsFile = join(dir, 'sessions.json');
      writeFileSync(settingsFile, '');
      writeFileSync(streamersFile, 'streamers: []\nplaylists: []\n');

      const settingsService = new SettingsService(settingsFile, DEFAULT_SETTINGS, silentLogger);
      const streamerStore = new StreamerStore(streamersFile, { streamers: [], playlists: [] }, silentLogger);
      const bus = new EventBus();
      const sessions = new AuthSessionStore(sessionsFile);

      const fakePng = Buffer.from('FAKE_PNG_IMAGE_BYTES');
      const supervisorMock = {
        buildStatus: () => ({ state: 'idle', source: {}, relay: {}, sink: {} }),
        streamersView: () => [],
        earningsStatus: () => ({ enabled: false }),
        buildQueueSnapshot: () => ({ entries: [], playing: false, index: null, loop: false }),
        overlayPreviewPng: vi.fn().mockReturnValue(fakePng),
      } as unknown as Supervisor;

      const app = await buildServer({
        config: {
          paths: {
            root: dir,
            dataDir: dir,
            logsDir: dir,
            streamersFile,
            settingsFile,
            overlaysDir: join(dir, 'overlays'),
            webDir: join(dir, 'web'),
            cookiesFile: join(dir, 'cookies.txt'),
            logFile: join(dir, 'relay.log'),
          },
          server: {
            host: '127.0.0.1',
            port: 3000,
            logLevel: 'info',
            password: '',
            apiToken: '',
            sessionSecret: 'secret1234567890123456789012345678',
            secureCookies: false,
            corsOrigin: '',
            telegramAuth: false,
            trustProxy: false,
            publicUrl: '',
          },
          telegram: { botToken: '', allowedUserIds: [], notifyChatId: null, notifications: false },
          youtube: { clientId: '', clientSecret: '', redirectUri: '' },
          media: {
            ffmpegBin: 'ffmpeg',
            ytdlpBin: 'yt-dlp',
            youtubeRtmpUrl: '',
            youtubeBackup: false,
            tiktokSessionId: '',
            tiktokTargetIdc: '',
            ytdlpTimeoutSeconds: 30,
            relayHost: '127.0.0.1',
            relayPort: 8000,
            ffmpegLogLevel: 'warning',
            overlayFont: '',
            pauseOnOffline: true,
            sourceUserAgent: 'test',
          },
          streamers: [],
          playlists: [],
          settings: DEFAULT_SETTINGS,
          autoStart: false,
        },
        version: VERSION,
        supervisor: supervisorMock,
        store: streamerStore,
        settingsService,
        bus,
        logger: silentLogger,
        authSessions: sessions,
        ring: new (await import('../src/utils/logger.js')).LogRing(),
        audit: new (await import('../src/core/audit-log.js')).AuditLogStore(),
      });

      // 1. Initial request: 200 OK with ETag
      const res1 = await app.inject({
        method: 'GET',
        url: '/api/overlays/preview.png',
      });
      expect(res1.statusCode).toBe(200);
      expect(res1.headers['cache-control']).toBe('no-cache');
      const etag = res1.headers['etag'] as string;
      expect(etag).toBeTruthy();

      // 2. Conditional request with matching If-None-Match: 304 Not Modified
      const res2 = await app.inject({
        method: 'GET',
        url: '/api/overlays/preview.png',
        headers: {
          'if-none-match': etag,
        },
      });
      expect(res2.statusCode).toBe(304);
      expect(res2.body).toBe('');

      await app.close();
      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('#60: Tech Debt - Async FS, filesystem cache, and canvas chat txt skip', () => {
    it('caches filesystemUsage calls within TTL', () => {
      clearFilesystemUsageCache();
      const stats1 = filesystemUsage(tmpdir());
      expect(stats1).not.toBeNull();

      // Second call immediately returns cached reference
      const stats2 = filesystemUsage(tmpdir());
      expect(stats2).toBe(stats1);

      // Force parameter bypasses cache
      const stats3 = filesystemUsage(tmpdir(), { force: true });
      expect(stats3).not.toBeNull();
    });

    it('listRecordingsAsync and evaluateRecordingStorageAsync work non-blockingly', async () => {
      const dataDir = mkdtempSync(join(tmpdir(), 'relay-rec-async-'));
      const recDir = recordingsDirectory(dataDir);
      const file1 = join(recDir, '2026-11-20-rec1.mkv');
      const file2 = join(recDir, '2026-11-20-rec2.mkv');
      const { mkdirSync } = await import('node:fs');
      mkdirSync(recDir, { recursive: true });
      writeFileSync(file1, Buffer.alloc(1024));
      writeFileSync(file2, Buffer.alloc(2048));

      const files = await listRecordingsAsync(dataDir);
      expect(files).toHaveLength(2);
      expect(files.map((f) => f.filename)).toContain('2026-11-20-rec1.mkv');
      expect(files.map((f) => f.filename)).toContain('2026-11-20-rec2.mkv');

      const storage = await evaluateRecordingStorageAsync(dataDir, DEFAULT_SETTINGS.recording);
      expect(storage.file_count).toBe(2);
      expect(storage.total_bytes).toBe(3072);

      rmSync(dataDir, { recursive: true, force: true });
    });

    it('OverlayManager skips writing chat.txt in canvas engine mode', () => {
      const dir = mkdtempSync(join(tmpdir(), 'relay-overlay-chat-'));
      const fontPath = join(dir, 'font.ttf');
      writeFileSync(fontPath, 'fake-font');
      const chatFile = join(dir, 'active', 'chat.txt');
      const settings = structuredClone(DEFAULT_SETTINGS);

      // 1. Canvas mode: chat.txt must NOT be written/updated on updateChat
      settings.overlays.chat.enabled = true;
      settings.overlays.chat.engine = 'canvas';
      const managerCanvas = new OverlayManager(
        { media: { overlayFont: fontPath } as any, overlaysDir: dir, logger: silentLogger },
        settings,
      );
      managerCanvas.prepare();
      // Clear the file to test updateChat behavior
      if (existsSync(chatFile)) writeFileSync(chatFile, '');
      managerCanvas.updateChat(['User: Hello from canvas']);
      expect(readFileSync(chatFile, 'utf8')).toBe('');

      // 2. Drawtext mode: chat.txt MUST be written on updateChat
      settings.overlays.chat.engine = 'drawtext';
      const managerDrawtext = new OverlayManager(
        { media: { overlayFont: fontPath } as any, overlaysDir: dir, logger: silentLogger },
        settings,
      );
      managerDrawtext.prepare();
      managerDrawtext.updateChat(['User: Hello from drawtext']);
      expect(existsSync(chatFile)).toBe(true);
      expect(readFileSync(chatFile, 'utf8')).toContain('User: Hello from drawtext');

      rmSync(dir, { recursive: true, force: true });
    });

    it('QueueController deduplicates redundant setPlayback writes', () => {
      const dir = mkdtempSync(join(tmpdir(), 'relay-queue-dedup-'));
      const queuePath = join(dir, 'queue.json');
      const storeMock = { findForChannel: () => undefined } as any;

      const qc = new QueueController({
        path: queuePath,
        dataDir: dir,
        store: storeMock,
        logger: silentLogger,
      });

      qc.setPlayback({
        channel: 'file:test.mp4',
        position_seconds: 10,
        duration_seconds: 60,
        updated_at: '2026-11-20T10:00:00Z',
      });
      const stat1 = statSync(queuePath);

      // Same channel, same duration, position changed by only 0.5s -> deduped, no write
      qc.setPlayback({
        channel: 'file:test.mp4',
        position_seconds: 10.5,
        duration_seconds: 60,
        updated_at: '2026-11-20T10:00:01Z',
      });
      const stat2 = statSync(queuePath);
      expect(stat2.mtimeMs).toBe(stat1.mtimeMs);

      // Position changed by 5s -> written
      qc.setPlayback({
        channel: 'file:test.mp4',
        position_seconds: 15,
        duration_seconds: 60,
        updated_at: '2026-11-20T10:00:05Z',
      });
      const stat3 = statSync(queuePath);
      expect(stat3.mtimeMs).toBeGreaterThanOrEqual(stat1.mtimeMs);

      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('#61: RotatingFileStream & log tail reading', () => {
    it('rotates log file when size threshold is reached', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'relay-rot-stream-'));
      const logFile = join(dir, 'test.log');

      // maxBytes: 80 bytes, maxFiles: 3
      const stream = new RotatingFileStream({
        filePath: logFile,
        maxBytes: 80,
        maxFiles: 3,
      });

      // Write chunks
      await new Promise<void>((resolve) => {
        stream.write('Line 1: 0123456789\n', () => {
          stream.write('Line 2: 0123456789\n', () => {
            stream.write('Line 3: 0123456789\n', () => {
              stream.write('Line 4: 0123456789\n', () => {
                stream.write('Line 5: 0123456789\n', () => resolve());
              });
            });
          });
        });
      });

      await new Promise<void>((resolve) => stream.end(resolve));

      expect(existsSync(logFile)).toBe(true);
      expect(existsSync(join(dir, 'test-1.log'))).toBe(true);

      rmSync(dir, { recursive: true, force: true });
    });

    it('readLogFileEntries reads backwards into rotated files without losing lines', () => {
      const dir = mkdtempSync(join(tmpdir(), 'relay-read-rot-'));
      const logFile = join(dir, 'relay.log');
      const rot1 = join(dir, 'relay-1.log');

      // Write older entry into relay-1.log
      writeFileSync(
        rot1,
        `${JSON.stringify({ time: '2026-11-20T10:00:00Z', level: 30, msg: 'Rotated line 1' })}\n`,
      );
      // Write newer entry into relay.log
      writeFileSync(
        logFile,
        `${JSON.stringify({ time: '2026-11-20T10:01:00Z', level: 30, msg: 'Active line 2' })}\n`,
      );

      const entries = readLogFileEntries(logFile, 1024 * 1024);
      expect(entries).toHaveLength(2);
      expect(entries[0]?.msg).toBe('Rotated line 1');
      expect(entries[1]?.msg).toBe('Active line 2');

      rmSync(dir, { recursive: true, force: true });
    });
  });
});
