import type { StatusSnapshot, StreamState } from './events.js';

export type MetricName =
  | 'source_exits_total'
  | 'source_reconnects_total'
  | 'reconnect_success_total'
  | 'reconnect_failures_total'
  | 'pause_starts_total'
  | 'pause_limit_hits_total'
  | 'sink_restarts_total'
  | 'sink_dts_errors_total'
  | 'sink_silence_events_total'
  | 'watchdog_triggers_total'
  | 'playlist_advances_total'
  | 'manual_screens_total'
  | 'startup_screens_total'
  | 'disconnect_protection_events_total'
  | 'chat_poll_errors_total'
  | 'earnings_poll_errors_total'
  | 'webhook_errors_total';

const METRIC_NAMES: readonly MetricName[] = [
  'source_exits_total',
  'source_reconnects_total',
  'reconnect_success_total',
  'reconnect_failures_total',
  'pause_starts_total',
  'pause_limit_hits_total',
  'sink_restarts_total',
  'sink_dts_errors_total',
  'sink_silence_events_total',
  'watchdog_triggers_total',
  'playlist_advances_total',
  'manual_screens_total',
  'startup_screens_total',
  'disconnect_protection_events_total',
  'chat_poll_errors_total',
  'earnings_poll_errors_total',
  'webhook_errors_total',
];

const STREAM_STATES: readonly StreamState[] = [
  'idle',
  'starting',
  'live',
  'reconnecting',
  'paused',
  'stopping',
  'error',
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

/** Prometheus / OpenMetrics text exposition for scraping (#47). */
export function formatPrometheusMetrics(
  snapshot: MetricsSnapshot,
  status?: StatusSnapshot,
  queueLength?: number,
): string {
  const lines: string[] = [
    '# HELP relay_uptime_seconds Process uptime in seconds',
    '# TYPE relay_uptime_seconds gauge',
    `relay_uptime_seconds ${snapshot.uptime_seconds}`,
  ];

  for (const name of METRIC_NAMES) {
    const metric = `relay_${name}`;
    lines.push(`# HELP ${metric} Total ${name.replaceAll('_', ' ')}`);
    lines.push(`# TYPE ${metric} counter`);
    lines.push(`${metric} ${snapshot.counters[name] ?? 0}`);
  }

  if (status) {
    lines.push('# HELP relay_stream_state Current stream supervisor state (1 = active)');
    lines.push('# TYPE relay_stream_state gauge');
    for (const state of STREAM_STATES) {
      lines.push(`relay_stream_state{state="${state}"} ${status.state === state ? 1 : 0}`);
    }

    const pushGauge = (name: string, help: string, value: number | null | undefined) => {
      if (value === null || value === undefined || !Number.isFinite(value)) return;
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name} ${value}`);
    };

    pushGauge('relay_source_connected', 'Source connected to relay ingest (0/1)', status.source.connected ? 1 : 0);
    pushGauge('relay_source_bitrate_kbps', 'Measured source bitrate in kbps', status.source.bitrate_kbps);
    pushGauge('relay_source_reconnects', 'Active session source reconnect count', status.source.reconnects);

    pushGauge('relay_buffer_seconds', 'Current relay delay buffer age in seconds', status.relay.buffer_seconds);
    pushGauge('relay_buffer_delay_seconds', 'Configured relay delay in seconds', status.relay.delay_seconds);
    pushGauge('relay_buffer_excess_seconds', 'Excess buffer latency above delay target in seconds', status.relay.excess_seconds);
    pushGauge('relay_buffer_bytes', 'Current relay buffered bytes', status.relay.buffered_bytes);
    pushGauge('relay_buffer_dropped_bytes', 'Dropped relay bytes due to buffer caps', status.relay.dropped_bytes);
    pushGauge('relay_buffer_catching_up', 'Whether relay catch-up pacing is active (0/1)', status.relay.catching_up ? 1 : 0);
    pushGauge('relay_buffer_pacing_multiplier', 'Current relay pacing multiplier', status.relay.pacing_multiplier);

    pushGauge('relay_sink_running', 'YouTube sink process running (0/1)', status.sink.running ? 1 : 0);
    pushGauge('relay_sink_bitrate_kbps', 'Measured YouTube sink bitrate in kbps', status.sink.bitrate_kbps);
    pushGauge('relay_sink_fps', 'Measured YouTube sink output FPS', status.sink.fps);
    pushGauge('relay_sink_dropped_frames', 'Dropped frames reported by YouTube sink', status.sink.dropped_frames);
    pushGauge('relay_sink_restarts', 'YouTube sink restart count in active session', status.sink.restarts);
    pushGauge('relay_sink_dts_errors', 'YouTube sink DTS error count in active session', status.sink.dts_errors);
    pushGauge('relay_sink_silence_active', 'Whether audio silence detection is currently triggered (0/1)', status.sink.silence_active ? 1 : 0);

    if (status.disconnect_protection) {
      pushGauge(
        'relay_disconnect_protection_active',
        'Whether disconnect protection slate/loop is currently active (0/1)',
        status.disconnect_protection.active ? 1 : 0,
      );
    }

    if (status.recording) {
      pushGauge('relay_recording_active', 'Whether local MKV recording is active (0/1)', status.recording.active ? 1 : 0);
      pushGauge('relay_recording_bytes', 'Current MKV recording size in bytes', status.recording.bytes);
    }
  }

  if (queueLength !== undefined && Number.isFinite(queueLength)) {
    lines.push('# HELP relay_queue_entries Number of entries in the Regie queue');
    lines.push('# TYPE relay_queue_entries gauge');
    lines.push(`relay_queue_entries ${queueLength}`);
  }

  return `${lines.join('\n')}\n`;
}

/** Test helper to keep counter assertions isolated. */
export function resetMetrics(): void {
  counters.clear();
}
