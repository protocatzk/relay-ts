import { connect } from 'node:net';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { DelayBuffer } from '../src/core/relay/delay-buffer.js';

const logger = pino({ level: 'silent' });
const buffers: DelayBuffer[] = [];

function port(): number {
  return 34000 + Math.floor(Math.random() * 2000);
}

async function setup(delaySeconds = 1): Promise<{ buffer: DelayBuffer; port: number }> {
  const relayPort = port();
  const buffer = new DelayBuffer({
    host: '127.0.0.1',
    port: relayPort,
    delaySeconds,
    enabled: true,
    maxBytes: 4 * 1024 * 1024,
    fallbackBitrateKbps: 2000,
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
});
