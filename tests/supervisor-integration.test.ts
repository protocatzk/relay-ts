import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/core/config/loader.js';
import { StreamerSchema } from '../src/core/config/schema.js';
import { EventBus } from '../src/core/events.js';
import { StreamerStore } from '../src/core/store/streamer-store.js';
import { SettingsService } from '../src/core/store/settings-service.js';
import { Supervisor } from '../src/core/supervisor/supervisor.js';

const logger = pino({ level: 'silent' });

function fakeScripts(dir: string): { ffmpeg: string; ytdlp: string } {
  const ffmpeg = join(dir, 'fake-ffmpeg.mjs');
  const ytdlp = join(dir, 'fake-ytdlp.mjs');
  writeFileSync(
    ffmpeg,
    `#!/usr/bin/env node
import net from 'node:net';
const args = process.argv.slice(2);
if (args.includes('-version')) { console.log('ffmpeg version fake'); process.exit(0); }
const tcp = args.find((arg) => String(arg).startsWith('tcp://'));
const rtmp = args.find((arg) => String(arg).startsWith('rtmp://'));
if (!tcp) process.exit(0);
const url = new URL(tcp);
const socket = net.connect({ host: url.hostname, port: Number(url.port) });
socket.on('error', () => {});
let media = 0;
const chunk = Buffer.alloc(188 * 20, 0x47);
const progress = () => {
  media += 100000;
  console.log('out_time_us=' + media);
  console.log('bitrate=2000.0kbits/s');
  console.log('fps=25.0');
  console.log('speed=1.0x');
  console.log('progress=continue');
};
const timer = setInterval(() => {
  if (!rtmp && socket.writable) socket.write(chunk);
  progress();
}, 200);
progress();
const stop = () => { clearInterval(timer); socket.destroy(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
`,
  );
  writeFileSync(
    ytdlp,
    `#!/usr/bin/env node
if (process.argv.includes('--version')) { console.log('2026.01.01'); process.exit(0); }
console.log(JSON.stringify({
  is_live: true,
  title: 'Integration Test',
  formats: [{ url: 'http://fake/stream.flv', vcodec: 'avc1', height: 720, tbr: 2000, format_id: 'fake' }]
}));
`,
  );
  chmodSync(ffmpeg, 0o755);
  chmodSync(ytdlp, 0o755);
  return { ffmpeg, ytdlp };
}

async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('timeout waiting for condition');
}

let supervisor: Supervisor | null = null;
let temp: string | null = null;

afterEach(async () => {
  if (supervisor) {
    await supervisor.shutdown().catch(() => undefined);
    supervisor = null;
  }
  if (temp) {
    rmSync(temp, { recursive: true, force: true });
    temp = null;
  }
});

describe('Supervisor integration', () => {
  it(
    'bridges a source exit with the pause screen and reconnects',
    async () => {
      temp = mkdtempSync(join(tmpdir(), 'relay-supervisor-'));
      const bin = fakeScripts(temp);
      const relayPort = 19000 + Math.floor(Math.random() * 1000);
      const config = loadConfig({
        cwd: temp,
        env: {
          RELAY_PORT: String(relayPort),
          FFMPEG_BIN: bin.ffmpeg,
          YTDLP_BIN: bin.ytdlp,
          DELAY_BUFFER_ENABLED: 'false',
          AUTO_REFRESH: 'false',
          PAUSE_GRACE_SECONDS: '0',
          MIN_BITRATE: '0',
          SOURCE_MIN_RATE_PERCENT: '0',
          AUTO_START: 'false',
          LOG_LEVEL: 'silent',
        },
      });
      const store = new StreamerStore(
        config.paths.streamersFile,
        {
          streamers: [
            StreamerSchema.parse({
              id: 'alpha',
              name: 'Alpha',
              tiktok: 'alpha',
              youtube_key: 'test-key',
            }),
          ],
          playlists: [],
        },
        logger,
      );
      const settingsService = new SettingsService(
        config.paths.settingsFile,
        config.settings,
        logger,
      );
      supervisor = new Supervisor({
        config,
        settingsService,
        store,
        logger,
        bus: new EventBus(),
        redact: (text) => text,
        registerSecret: () => undefined,
      });
      await supervisor.init();
      const started = await supervisor.start('alpha');
      expect(started.state).toBe('live');

      const manual = await supervisor.showScreen('pause');
      expect(manual).toMatchObject({ state: 'paused', manual_screen: 'pause' });
      expect(manual.sink.running).toBe(true);
      expect(manual.source.connected).toBe(false);
      const hidden = await supervisor.hideScreen();
      expect(hidden.manual_screen).toBeNull();
      await waitFor(() => {
        const status = supervisor!.buildStatus();
        return status.state === 'live' && status.source.connected;
      }, 4000);

      const sourcePid = supervisor.buildStatus().source.pid;
      expect(sourcePid).toBeTruthy();
      process.kill(sourcePid!, 'SIGTERM');

      await waitFor(() => supervisor!.buildStatus().state === 'paused', 4000);
      expect(supervisor.buildStatus().sink.running).toBe(true);

      await waitFor(() => {
        const status = supervisor!.buildStatus();
        return status.state === 'live' && status.source.connected;
      }, 8000);
      expect(supervisor.buildStatus().source.connected).toBe(true);
    },
    20_000,
  );

  it(
    'shows the startup screen before the source goes live',
    async () => {
      temp = mkdtempSync(join(tmpdir(), 'relay-supervisor-'));
      const bin = fakeScripts(temp);
      const relayPort = 19100 + Math.floor(Math.random() * 1000);
      const config = loadConfig({
        cwd: temp,
        env: {
          RELAY_PORT: String(relayPort),
          FFMPEG_BIN: bin.ffmpeg,
          YTDLP_BIN: bin.ytdlp,
          DELAY_BUFFER_ENABLED: 'false',
          AUTO_REFRESH: 'false',
          STARTUP_ENABLED: 'true',
          STARTUP_DURATION_SECONDS: '1',
          MIN_BITRATE: '0',
          SOURCE_MIN_RATE_PERCENT: '0',
          AUTO_START: 'false',
          LOG_LEVEL: 'silent',
        },
      });
      const store = new StreamerStore(
        config.paths.streamersFile,
        {
          streamers: [
            StreamerSchema.parse({
              id: 'alpha',
              name: 'Alpha',
              tiktok: 'alpha',
              youtube_key: 'test-key',
            }),
          ],
          playlists: [],
        },
        logger,
      );
      const settingsService = new SettingsService(
        config.paths.settingsFile,
        config.settings,
        logger,
      );
      supervisor = new Supervisor({
        config,
        settingsService,
        store,
        logger,
        bus: new EventBus(),
        redact: (text) => text,
        registerSecret: () => undefined,
      });
      await supervisor.init();
      const started = await supervisor.start('alpha');
      expect(started.state).toBe('starting');
      expect(started.sink.running).toBe(true);
      expect(started.source.connected).toBe(false);

      await waitFor(() => {
        const status = supervisor!.buildStatus();
        return status.state === 'live' && status.source.connected;
      }, 6000);
    },
    20_000,
  );
});
