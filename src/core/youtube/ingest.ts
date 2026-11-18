import { resolveStreamKey } from '../config/schema.js';
import type { StreamerStore } from '../store/streamer-store.js';
import { ValidationError } from '../../utils/errors.js';

/**
 * Broadcasts created through RELAY must be bound to the ingest RELAY is
 * actually sending to. Otherwise YouTube Studio shows a fresh, idle ingest and
 * rejects the transition to live even though RELAY is streaming.
 *
 * Order: active streamer, preferred streamer, first enabled streamer with a
 * key, then YOUTUBE_STREAM_KEY.
 */
export function resolveRelayIngestKey(
  store: Pick<StreamerStore, 'list'>,
  activeStreamerId: string | null,
): string {
  const rank = (streamer: { id: string; preferred: boolean }): number =>
    streamer.id === activeStreamerId ? 0 : streamer.preferred ? 1 : 2;
  const candidates = store
    .list()
    .filter((streamer) => streamer.enabled)
    .sort((a, b) => rank(a) - rank(b));

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
