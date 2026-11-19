import { reactive } from 'vue';
import type { StatusPayload } from '@/src/api/types';

export type TelemetryMetric =
  | 'source_kbps'
  | 'sink_kbps'
  | 'sink_fps'
  | 'relay_buffer_s'
  | 'relay_delay_s'
  | 'watchdog_stalls';

/** Rolling window size in samples (~5 minutes at the 2 s status interval). */
export const TELEMETRY_WINDOW = 150;

const buffers = reactive<Record<TelemetryMetric, number[]>>({
  source_kbps: [],
  sink_kbps: [],
  sink_fps: [],
  relay_buffer_s: [],
  relay_delay_s: [],
  watchdog_stalls: [],
});

let lastRecordedAt = 0;

function push(metric: TelemetryMetric, value: number | null | undefined): void {
  if (value == null || !Number.isFinite(value)) return;
  const buffer = buffers[metric];
  buffer.push(value);
  if (buffer.length > TELEMETRY_WINDOW) {
    buffer.splice(0, buffer.length - TELEMETRY_WINDOW);
  }
}

/**
 * Record one telemetry sample from a status snapshot. Called on every status
 * update (SSE or polling). The 1.5 s guard prevents near-duplicate samples when
 * SSE and the fallback poll overlap.
 */
export function recordStatus(status: StatusPayload | null): void {
  if (!status) return;
  const now = Date.now();
  if (now - lastRecordedAt < 1500) return;
  lastRecordedAt = now;

  push('source_kbps', status.source.bitrate_kbps);
  push('sink_kbps', status.sink.bitrate_kbps);
  push('sink_fps', status.sink.fps);
  push('relay_buffer_s', status.relay.buffer_seconds);
  push('relay_delay_s', status.relay.delay_seconds);
  push('watchdog_stalls', status.watchdog.stall_count);
}

export function resetTelemetry(): void {
  (Object.keys(buffers) as TelemetryMetric[]).forEach((metric) => {
    buffers[metric].length = 0;
  });
  lastRecordedAt = 0;
}

export function useTelemetry() {
  return {
    series: (metric: TelemetryMetric) => buffers[metric],
  };
}
