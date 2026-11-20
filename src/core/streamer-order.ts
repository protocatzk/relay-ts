import type { StreamerConfig } from './config/schema.js';

export type PrioritizableStreamer = Pick<StreamerConfig, 'id' | 'name' | 'priority' | 'preferred'>;

/**
 * Priority order shared by auto-start, preferred-streamer takeover and ingest
 * selection. Lower numbers win; preferred and the name act as stable
 * tie-breakers for configurations that never set an explicit priority.
 */
export function compareStreamerPriority(
  left: PrioritizableStreamer,
  right: PrioritizableStreamer,
): number {
  if (left.priority !== right.priority) return left.priority - right.priority;
  if (left.preferred !== right.preferred) return left.preferred ? -1 : 1;
  const byName = left.name.localeCompare(right.name, 'de', { sensitivity: 'base' });
  if (byName !== 0) return byName;
  return left.id.localeCompare(right.id);
}

export function sortStreamersByPriority<T extends PrioritizableStreamer>(
  streamers: readonly T[],
): T[] {
  return [...streamers].sort(compareStreamerPriority);
}
