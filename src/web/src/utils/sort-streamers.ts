export interface LiveSortableStreamer {
  name: string;
  enabled: boolean;
  preferred: boolean;
  status: {
    active: boolean;
    online: boolean | null;
  };
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
    if (left.preferred !== right.preferred) return left.preferred ? -1 : 1;
    if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
    return left.name.localeCompare(right.name, 'de', { sensitivity: 'base' });
  });
}
