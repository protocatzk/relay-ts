import { beforeEach, describe, expect, it } from 'vitest';
import { incMetric, metricsSnapshot, resetMetrics } from '../src/core/metrics.js';

describe('metrics', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('reports every known counter with zero by default', () => {
    const snapshot = metricsSnapshot();
    expect(snapshot.counters.source_exits_total).toBe(0);
    expect(snapshot.counters.pause_starts_total).toBe(0);
    expect(snapshot.counters.sink_restarts_total).toBe(0);
    expect(Object.keys(snapshot.counters).length).toBeGreaterThan(10);
  });

  it('increments counters and adds deltas', () => {
    incMetric('source_exits_total');
    incMetric('source_exits_total', 2);
    incMetric('chat_poll_errors_total');
    const snapshot = metricsSnapshot();
    expect(snapshot.counters.source_exits_total).toBe(3);
    expect(snapshot.counters.chat_poll_errors_total).toBe(1);
    expect(snapshot.counters.earnings_poll_errors_total).toBe(0);
  });
});
