import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/core/config/loader.js';
import { DEFAULT_SETTINGS } from '../src/core/config/schema.js';
import { DelayBuffer } from '../src/core/relay/delay-buffer.js';
import { MpegTsRelay } from '../src/core/relay/relay-server.js';
import { OutputFanout } from '../src/core/supervisor/output-fanout.js';

describe('OutputFanout', () => {
  let tempDir: string;
  let relay: MpegTsRelay;
  let buffer: DelayBuffer;
  const logger = pino({ level: 'silent' });

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'relay-fanout-test-'));
    buffer = new DelayBuffer({
      host: '127.0.0.1',
      port: 19124,
      delaySeconds: 1,
      enabled: false,
      maxBytes: 10 * 1024 * 1024,
      catchupRate: 1.01,
      logger,
    });
    relay = new MpegTsRelay({ host: '127.0.0.1', port: 19123, logger, buffer });
  });

  afterEach(async () => {
    await relay.stop();
    await buffer.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('initializes and reports statuses for secondary sink and recording', async () => {
    const config = loadConfig({ cwd: tempDir, env: { DATA_DIR: join(tempDir, 'data') } });
    const secrets: string[] = [];
    const fanout = new OutputFanout({
      config,
      settings: DEFAULT_SETTINGS,
      relay,
      logger,
      registerSecret: (s) => secrets.push(s),
    });

    const status = fanout.status();
    expect(status.secondarySink).toBeDefined();
    expect(status.secondarySink?.running).toBe(false);
    expect(status.recording).toBeDefined();
    expect(status.recording?.active).toBe(false);
    expect(fanout.recordingFilename()).toBeNull();
    expect(fanout.diskWarning()).toBeNull();

    await fanout.stop();
  });

  it('updates settings and registers secrets', async () => {
    const config = loadConfig({ cwd: tempDir, env: { DATA_DIR: join(tempDir, 'data') } });
    const secrets: string[] = [];
    const fanout = new OutputFanout({
      config,
      settings: DEFAULT_SETTINGS,
      relay,
      logger,
      registerSecret: (s) => secrets.push(s),
    });

    const updatedSettings = {
      ...DEFAULT_SETTINGS,
      secondary_sink: {
        ...DEFAULT_SETTINGS.secondary_sink,
        stream_key: 'super-secret-rtmp-key',
      },
    };

    fanout.updateSettings(updatedSettings);
    expect(secrets).toContain('super-secret-rtmp-key');
    await fanout.stop();
  });
});
