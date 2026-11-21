import { connect } from 'node:net';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { DelayBuffer } from '../src/core/relay/delay-buffer.js';

const logger = pino({ level: 'silent' });
const buffers: DelayBuffer[] = [];

function port(): number {
  return 34000 + Math.floor(Math.random() * 2000);
}

async function setup(
  delaySeconds = 1,
  options: { enabled?: boolean; catchupRate?: number; autoTick?: boolean; fallbackBitrateKbps?: number } = {},
): Promise<{ buffer: DelayBuffer; port: number }> {
  const relayPort = port();
  const buffer = new DelayBuffer({
    host: '127.0.0.1',
    port: relayPort,
    delaySeconds,
    enabled: options.enabled ?? true,
    maxBytes: 4 * 1024 * 1024,
    fallbackBitrateKbps: options.fallbackBitrateKbps ?? 2000,
    catchupRate: options.catchupRate,
    autoTick: options.autoTick,
    logger,
  });
  await buffer.start();
  buffers.push(buffer);
  return { buffer, port: relayPort };
}

function connectClient(relayPort: number): Promise<{
  write: (data: Buffer) => void;
  chunks: Buffer[];
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const socket = connect(relayPort, '127.0.0.1');
    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.once('connect', () =>
      resolve({
        write: (data) => socket.write(data),
        chunks,
        close: () => socket.destroy(),
      }),
    );
    socket.once('error', reject);
  });
}

afterEach(async () => {
  await Promise.all(buffers.splice(0).map((buffer) => buffer.stop()));
});

describe('DelayBuffer', () => {
  it('holds packets for the configured delay and forwards them in order', async () => {
    const { buffer, port: relayPort } = await setup(1);
    const client = await connectClient(relayPort);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(buffer.stats().outputConnected).toBe(true);

    buffer.enqueue(Buffer.from('first'));
    buffer.enqueue(Buffer.from('second'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(client.chunks).toHaveLength(0);

    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(Buffer.concat(client.chunks).toString()).toBe('firstsecond');
    expect(buffer.stats().forwardedBytes).toBe(11);
    client.close();
  });

  it('drops buffered data on reset', async () => {
    const { buffer, port: relayPort } = await setup(0.5);
    const client = await connectClient(relayPort);
    buffer.enqueue(Buffer.from('stale'));
    buffer.reset();
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(Buffer.concat(client.chunks).toString()).toBe('');
    client.close();
  });

  it('enforces the byte limit and counts dropped data', async () => {
    const { buffer } = await setup(30);
    const chunk = Buffer.alloc(1024, 1);
    for (let index = 0; index < 100; index += 1) buffer.enqueue(chunk);
    const stats = buffer.stats();
    expect(stats.bufferedBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
    buffer.setMaxBytes(64 * 1024);
    expect(buffer.stats().bufferedBytes).toBeLessThanOrEqual(64 * 1024);
    expect(buffer.stats().droppedBytes).toBeGreaterThan(0);
  });

  it('drains excess backlog at 1.01x catch-up pacing and returns to 1.0x', async () => {
    const { buffer, port: relayPort } = await setup(2, {
      autoTick: false,
      catchupRate: 1.01,
      fallbackBitrateKbps: 800,
    });
    const client = await connectClient(relayPort);
    await new Promise((resolve) => setTimeout(resolve, 40));
    buffer.reset();

    const stepMs = 100;
    const chunkSize = 10_000; // 100 KB/s (800 kbps)
    let now = 1_000_000;
    for (let elapsed = 0; elapsed <= 5_000; elapsed += stepMs) {
      buffer.enqueue(Buffer.alloc(chunkSize, 1), now + elapsed);
    }
    now += 5_000;
    buffer.tick(now);

    const initial = buffer.stats(now);
    expect(initial.catchingUp).toBe(true);
    expect(initial.pacingMultiplier).toBe(1.01);
    expect(initial.excessSeconds).toBeGreaterThan(0.5);

    let step = 0;
    while (buffer.stats(now).catchingUp && step < 4_000) {
      step += 1;
      now += stepMs;
      buffer.enqueue(Buffer.alloc(chunkSize, 1), now);
      buffer.tick(now);
      if (step % 50 === 0) {
        client.chunks.length = 0;
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
    }

    const settled = buffer.stats(now);
    expect(settled.catchingUp).toBe(false);
    expect(settled.pacingMultiplier).toBe(1);
    expect(settled.bufferSeconds).toBeLessThanOrEqual(2.2);
    expect(settled.excessSeconds).toBeLessThanOrEqual(0.2);
    expect(settled.droppedBytes).toBe(0);
    client.close();
  });

  it('does not trigger catch-up when catchupRate is 1', async () => {
    const { buffer, port: relayPort } = await setup(2, {
      autoTick: false,
      catchupRate: 1,
      fallbackBitrateKbps: 800,
    });
    const client = await connectClient(relayPort);
    await new Promise((resolve) => setTimeout(resolve, 40));
    buffer.reset();

    for (let elapsed = 0; elapsed <= 6_000; elapsed += 100) {
      buffer.enqueue(Buffer.alloc(10_000, 1), 2_000_000 + elapsed);
    }
    buffer.tick(2_006_000);
    const stats = buffer.stats(2_006_000);
    expect(stats.catchingUp).toBe(false);
    expect(stats.pacingMultiplier).toBe(1);
    expect(stats.excessSeconds).toBeGreaterThan(1);
    client.close();
  });

  it('activates catch-up pacing for backlog even when delay is disabled', async () => {
    const { buffer, port: relayPort } = await setup(0, {
      enabled: false,
      autoTick: false,
      catchupRate: 1.01,
      fallbackBitrateKbps: 800,
    });
    const client = await connectClient(relayPort);
    await new Promise((resolve) => setTimeout(resolve, 40));
    buffer.reset();

    for (let elapsed = 0; elapsed <= 3_000; elapsed += 100) {
      buffer.enqueue(Buffer.alloc(10_000, 1), 3_000_000 + elapsed);
    }
    buffer.tick(3_003_000);
    const stats = buffer.stats(3_003_000);
    expect(stats.delaySeconds).toBe(0);
    expect(stats.catchingUp).toBe(true);
    expect(stats.pacingMultiplier).toBe(1.01);
    client.close();
  });
});
