/**
 * Pure guard helpers for the regie actions (#88).
 *
 * Kept free of aliases and DOM APIs so the Node typecheck and Vitest can import
 * them directly; `actions.ts` re-exports everything for the app.
 */
import type { StatusPayload, Streamer } from '../api/types.js';
import { sortStreamersByLive } from '../utils/sort-streamers.js';

export interface ActionContext {
  status: StatusPayload | null;
  streamers: Streamer[];
}

export function canStart(status: StatusPayload | null): boolean {
  const state = status?.state ?? null;
  return state !== 'starting' && state !== 'live' && state !== 'reconnecting' && state !== 'stopping';
}

export function canStop(status: StatusPayload | null): boolean {
  if (!status) return false;
  if (status.state === 'stopping') return false;
  return (
    Boolean(status.active_streamer_id) ||
    status.manual_screen !== null ||
    status.state === 'starting' ||
    status.state === 'reconnecting'
  );
}

export function canToggleScreens(status: StatusPayload | null): boolean {
  const state = status?.state ?? null;
  return (
    state === 'live' ||
    state === 'paused' ||
    state === 'reconnecting' ||
    state === 'idle' ||
    state === 'error'
  );
}

/**
 * Next live streamer for "Umschalten": any enabled streamer that is online and
 * not the one currently on air. Sorted like the dashboard list so the action
 * matches what the operator sees.
 */
export function nextSwitchCandidate(
  status: StatusPayload | null,
  streamers: Streamer[],
): Streamer | null {
  const activeId = status?.active_streamer_id ?? null;
  return (
    sortStreamersByLive(streamers).find(
      (streamer) => streamer.enabled && streamer.status.online === true && streamer.id !== activeId,
    ) ?? null
  );
}

/** Reason why "Umschalten" is blocked, or null when it can run. */
export function switchReason(ctx: ActionContext): string | null {
  if (!ctx.status?.active_streamer_id) return 'Kein aktiver Streamer';
  return nextSwitchCandidate(ctx.status, ctx.streamers) ? null : 'Kein weiterer Live-Streamer';
}
