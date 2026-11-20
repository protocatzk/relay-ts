export interface LiveSortableStreamer {
  name: string;
  enabled: boolean;
  preferred: boolean;
  priority: number;
  status: {
    active: boolean;
    online: boolean | null;
  };
}

export interface PrioritySortableStreamer {
  name: string;
  preferred: boolean;
  priority: number;
}

/** Lower priority wins; preferred and the name break ties. */
export function compareStreamerPriority(
  left: PrioritySortableStreamer,
  right: PrioritySortableStreamer,
): number {
  if (left.priority !== right.priority) return left.priority - right.priority;
  if (left.preferred !== right.preferred) return left.preferred ? -1 : 1;
  return left.name.localeCompare(right.name, 'de', { sensitivity: 'base' });
}

export function sortStreamersByPriority<T extends PrioritySortableStreamer>(
  streamers: readonly T[],
): T[] {
  return [...streamers].sort(compareStreamerPriority);
}

/** Active/live streamers first, then unknown, then offline. */
export function sortStreamersByLive<T extends LiveSortableStreamer>(streamers: readonly T[]): T[] {
  const rank = (streamer: T): number => {
    if (streamer.status.active) return 0;
    if (streamer.status.online === true) return 1;
    if (streamer.status.online === null) return 2;
    return 3;
  };
  return [...streamers].sort((left, right) => {
    const byLive = rank(left) - rank(right);
    if (byLive !== 0) return byLive;
    const byPriority = compareStreamerPriority(left, right);
    if (byPriority !== 0) return byPriority;
    if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
    return 0;
  });
}
