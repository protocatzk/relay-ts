import type { LiveBroadcastResource } from './client.js';

/**
 * Automation policy for YouTube broadcasts. The global settings provide the
 * defaults; callers can override them per broadcast through `override`, so a
 * future per-broadcast store can opt out without touching this module.
 */
export interface AutomationPolicy {
  mode: 'off' | 'relay_only' | 'all';
  autoTransition: boolean;
  autoStart: boolean;
  autoStop: boolean;
}

export interface AutomationSettings {
  auto_transition: boolean;
  auto_mode?: 'off' | 'relay_only' | 'all';
  auto_start: boolean;
  auto_stop: boolean;
  default_privacy: 'public' | 'unlisted' | 'private';
  default_dvr: boolean;
}

/** Returns true/false to override the global setting, or undefined to inherit. */
export type AutomationOverride = (
  broadcastId: string,
) => { auto_start?: boolean; auto_stop?: boolean } | undefined;

export interface BroadcastSelectionOptions {
  /** Restrict candidates to broadcasts created by RELAY. */
  managedIds?: ReadonlySet<string>;
  /** Clock for tests. */
  now?: number;
  /** Only start broadcasts scheduled within this distance from now. */
  windowMs?: number;
}

const STARTABLE = new Set(['created', 'ready', 'testing']);
const COMPLETABLE = new Set(['live', 'testing']);
const DEFAULT_START_WINDOW_MS = 30 * 60 * 1000;

export function automationPolicy(settings: AutomationSettings): AutomationPolicy {
  const mode = settings.auto_transition ? (settings.auto_mode ?? 'relay_only') : 'off';
  return {
    mode,
    autoTransition: mode !== 'off',
    autoStart: settings.auto_start,
    autoStop: settings.auto_stop,
  };
}

function autoStartEnabled(
  broadcast: LiveBroadcastResource,
  policy: AutomationPolicy,
  override?: AutomationOverride,
): boolean {
  if (!policy.autoTransition || !policy.autoStart) return false;
  const value = override?.(broadcast.id)?.auto_start;
  return value ?? true;
}

function autoStopEnabled(
  broadcast: LiveBroadcastResource,
  policy: AutomationPolicy,
  override?: AutomationOverride,
): boolean {
  if (!policy.autoTransition || !policy.autoStop) return false;
  const value = override?.(broadcast.id)?.auto_stop;
  return value ?? true;
}

function isManaged(broadcast: LiveBroadcastResource, options: BroadcastSelectionOptions): boolean {
  return !options.managedIds || options.managedIds.has(broadcast.id);
}

function isWithinStartWindow(
  broadcast: LiveBroadcastResource,
  options: BroadcastSelectionOptions,
): boolean {
  const scheduled = Date.parse(broadcast.snippet?.scheduledStartTime ?? '');
  if (!Number.isFinite(scheduled)) return false;
  const now = options.now ?? Date.now();
  const windowMs = options.windowMs ?? DEFAULT_START_WINDOW_MS;
  return Math.abs(scheduled - now) <= windowMs;
}

/**
 * Picks the broadcast RELAY should start. Without a set of managed IDs this
 * keeps the old behaviour for the explicit `all` mode; with managed IDs it only
 * considers broadcasts RELAY created itself.
 */
export function pickBroadcastToStart(
  broadcasts: LiveBroadcastResource[],
  streamId: string,
  policy: AutomationPolicy,
  override?: AutomationOverride,
  options: BroadcastSelectionOptions = {},
): LiveBroadcastResource | null {
  const now = options.now ?? Date.now();
  return (
    broadcasts
      .filter((item) => item.contentDetails?.boundStreamId === streamId)
      .filter((item) => STARTABLE.has(item.status?.lifeCycleStatus ?? ''))
      .filter((item) => isManaged(item, options))
      .filter((item) => isWithinStartWindow(item, { ...options, now }))
      .filter((item) => autoStartEnabled(item, policy, override))
      .sort((a, b) => {
        const left = Date.parse(a.snippet?.scheduledStartTime ?? '');
        const right = Date.parse(b.snippet?.scheduledStartTime ?? '');
        return Math.abs(left - now) - Math.abs(right - now);
      })[0] ?? null
  );
}

/** Picks live/testing broadcasts bound to the given ingest that should end. */
export function pickBroadcastsToComplete(
  broadcasts: LiveBroadcastResource[],
  streamId: string,
  policy: AutomationPolicy,
  override?: AutomationOverride,
  options: BroadcastSelectionOptions = {},
): LiveBroadcastResource[] {
  return broadcasts
    .filter((item) => item.contentDetails?.boundStreamId === streamId)
    .filter((item) => COMPLETABLE.has(item.status?.lifeCycleStatus ?? ''))
    .filter((item) => isManaged(item, options))
    .filter((item) => autoStopEnabled(item, policy, override));
}
