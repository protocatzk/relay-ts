import { describe, expect, it } from 'vitest';
import { buildQueueWindow } from '../src/core/overlays/chat-engine.js';

const labels = ['Streamer 1', 'Streamer 2', 'Streamer 3', 'Streamer 4', 'Streamer 5', 'Streamer 6'];

describe('chat overlay queue window (#97)', () => {
  it('centers the running entry inside the visible window', () => {
    const window = buildQueueWindow(labels, 3, 5);
    expect(window.labels).toEqual([
      'Streamer 2',
      'Streamer 3',
      'Streamer 4',
      'Streamer 5',
      'Streamer 6',
    ]);
    expect(window.activeOffset).toBe(2);
    expect(window.hasBefore).toBe(true);
    expect(window.hasAfter).toBe(false);
  });

  it('keeps the active entry visible at the queue start and end', () => {
    const first = buildQueueWindow(labels, 0, 3);
    expect(first.labels).toEqual(['Streamer 1', 'Streamer 2', 'Streamer 3']);
    expect(first.activeOffset).toBe(0);
    expect(first.hasBefore).toBe(false);

    const last = buildQueueWindow(labels, 5, 3);
    expect(last.labels).toEqual(['Streamer 4', 'Streamer 5', 'Streamer 6']);
    expect(last.activeOffset).toBe(2);
    expect(last.hasAfter).toBe(false);
  });

  it('starts at the top when the queue is idle and marks no entry', () => {
    const window = buildQueueWindow(labels, null, 4);
    expect(window.labels).toEqual(['Streamer 1', 'Streamer 2', 'Streamer 3', 'Streamer 4']);
    expect(window.activeOffset).toBe(-1);
    expect(window.hasBefore).toBe(false);
    expect(window.hasAfter).toBe(true);
  });

  it('handles empty queues and short lists', () => {
    expect(buildQueueWindow([], 0, 5)).toEqual({
      labels: [],
      activeOffset: -1,
      hasBefore: false,
      hasAfter: false,
    });
    const short = buildQueueWindow(['Alpha'], 0, 5);
    expect(short.labels).toEqual(['Alpha']);
    expect(short.hasBefore).toBe(false);
    expect(short.hasAfter).toBe(false);
  });
});
