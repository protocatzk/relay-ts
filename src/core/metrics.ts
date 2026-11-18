export type MetricName =
  | 'source_exits_total'
  | 'source_reconnects_total'
  | 'reconnect_success_total'
  | 'reconnect_failures_total'
  | 'pause_starts_total'
  | 'pause_limit_hits_total'
  | 'sink_restarts_total'
  | 'watchdog_triggers_total'
  | 'playlist_advances_total'
  | 'manual_screens_total'
  | 'startup_screens_total'
  | 'chat_poll_errors_total'
  | 'earnings_poll_errors_total';

const METRIC_NAMES: readonly MetricName[] = [
  'source_exits_total',
  'source_reconnects_total',
  'reconnect_success_total',
  'reconnect_failures_total',
  'pause_starts_total',
  'pause_limit_hits_total',
  'sink_restarts_total',
  'watchdog_triggers_total',
  'playlist_advances_total',
  'manual_screens_total',
  'startup_screens_total',
  'chat_poll_errors_total',
  'earnings_poll_errors_total',
];

const counters = new Map<MetricName, number>();
const startedAt = new Date();

export function incMetric(name: MetricName, value = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + value);
}

export interface MetricsSnapshot {
  started_at: string;
  uptime_seconds: number;
  counters: Record<MetricName, number>;
}

/** Process-wide counters; no external dependency, JSON-friendly. */
export function metricsSnapshot(): MetricsSnapshot {
  const result = {} as Record<MetricName, number>;
  for (const name of METRIC_NAMES) result[name] = counters.get(name) ?? 0;
  return {
    started_at: startedAt.toISOString(),
    uptime_seconds: Math.round(process.uptime()),
    counters: result,
  };
}

/** Test helper to keep counter assertions isolated. */
export function resetMetrics(): void {
  counters.clear();
}
