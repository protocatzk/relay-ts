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

interface Ring {
  buf: number[];
  head: number;
  size: number;
}

const METRICS: TelemetryMetric[] = [
  'source_kbps',
  'sink_kbps',
  'sink_fps',
  'relay_buffer_s',
  'relay_delay_s',
  'watchdog_stalls',
];

function newRing(): Ring {
  return { buf: new Array<number>(TELEMETRY_WINDOW), head: 0, size: 0 };
}

/** O(1) ring buffers; not reactive, only written to on each sample. */
const rings = {} as Record<TelemetryMetric, Ring>;
for (const metric of METRICS) rings[metric] = newRing();

/** Reactive, chronologically ordered snapshots (rebuilt once per sample). */
const series = reactive({} as Record<TelemetryMetric, number[]>);
for (const metric of METRICS) series[metric] = [];

let lastRecordedAt = 0;

function ordered(ring: Ring): number[] {
  const { buf, head, size } = ring;
  if (size < TELEMETRY_WINDOW) return buf.slice(0, size);
  const out = new Array<number>(TELEMETRY_WINDOW);
  for (let i = 0; i < TELEMETRY_WINDOW; i += 1) {
    out[i] = buf[(head + i) % TELEMETRY_WINDOW];
  }
  return out;
}

function push(metric: TelemetryMetric, value: number | null | undefined): void {
  if (value == null || !Number.isFinite(value)) return;
  const ring = rings[metric];
  if (ring.size < TELEMETRY_WINDOW) {
    ring.buf[ring.size] = value;
    ring.size += 1;
  } else {
    ring.buf[ring.head] = value;
    ring.head = (ring.head + 1) % TELEMETRY_WINDOW;
  }
  series[metric] = ordered(ring);
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
  for (const metric of METRICS) {
    rings[metric] = newRing();
    series[metric] = [];
  }
  lastRecordedAt = 0;
}

export function useTelemetry() {
  return {
    series: (metric: TelemetryMetric) => series[metric],
  };
}
