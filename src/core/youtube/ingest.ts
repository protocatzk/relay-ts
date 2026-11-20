import { resolveStreamKey } from '../config/schema.js';
import { sortStreamersByPriority } from '../streamer-order.js';
import type { StreamerStore } from '../store/streamer-store.js';
import { ValidationError } from '../../utils/errors.js';

/**
 * Broadcasts created through RELAY must be bound to the ingest RELAY is
 * actually sending to. Otherwise YouTube Studio shows a fresh, idle ingest and
 * rejects the transition to live even though RELAY is streaming.
 *
 * Order: active streamer, preferred streamer (by priority), first enabled
 * streamer with a key (by priority), then YOUTUBE_STREAM_KEY.
 */
export function resolveRelayIngestKey(
  store: Pick<StreamerStore, 'list'>,
  activeStreamerId: string | null,
): string {
  const active = store.list().find((streamer) => streamer.id === activeStreamerId);
  if (active?.enabled) {
    const { key } = resolveStreamKey(active);
    if (key) return key;
  }

  const candidates = sortStreamersByPriority(
    store.list().filter((streamer) => streamer.enabled),
  );

  for (const streamer of candidates) {
    const { key } = resolveStreamKey(streamer);
    if (key) return key;
  }

  const envKey = resolveStreamKey({}).key;
  if (envKey) return envKey;

  throw new ValidationError(
    'Kein RELAY-Ingest konfiguriert. Bitte bei einem Streamer einen YouTube-Key hinterlegen.',
  );
}
