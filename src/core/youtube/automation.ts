import type { LiveBroadcastResource } from './client.js';

/**
 * Automation policy for YouTube broadcasts. The global settings provide the
 * defaults; callers can override them per broadcast through `override`, so a
 * future per-broadcast store can opt out without touching this module.
 */
export interface AutomationPolicy {
  autoTransition: boolean;
  autoStart: boolean;
  autoStop: boolean;
}

export interface AutomationSettings {
  auto_transition: boolean;
  auto_start: boolean;
  auto_stop: boolean;
  default_privacy: 'public' | 'unlisted' | 'private';
  default_dvr: boolean;
}

/** Returns true/false to override the global setting, or undefined to inherit. */
export type AutomationOverride = (
  broadcastId: string,
) => { auto_start?: boolean; auto_stop?: boolean } | undefined;

const STARTABLE = new Set(['created', 'ready', 'testing']);
const COMPLETABLE = new Set(['live', 'testing']);

export function automationPolicy(settings: AutomationSettings): AutomationPolicy {
  return {
    autoTransition: settings.auto_transition,
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

/** Picks the nearest upcoming broadcast bound to the given ingest. */
export function pickBroadcastToStart(
  broadcasts: LiveBroadcastResource[],
  streamId: string,
  policy: AutomationPolicy,
  override?: AutomationOverride,
): LiveBroadcastResource | null {
  return (
    broadcasts
      .filter((item) => item.contentDetails?.boundStreamId === streamId)
      .filter((item) => STARTABLE.has(item.status?.lifeCycleStatus ?? ''))
      .filter((item) => autoStartEnabled(item, policy, override))
      .sort((a, b) =>
        (a.snippet?.scheduledStartTime ?? '').localeCompare(
          b.snippet?.scheduledStartTime ?? '',
        ),
      )[0] ?? null
  );
}

/** Picks live/testing broadcasts bound to the given ingest that should end. */
export function pickBroadcastsToComplete(
  broadcasts: LiveBroadcastResource[],
  streamId: string,
  policy: AutomationPolicy,
  override?: AutomationOverride,
): LiveBroadcastResource[] {
  return broadcasts
    .filter((item) => item.contentDetails?.boundStreamId === streamId)
    .filter((item) => COMPLETABLE.has(item.status?.lifeCycleStatus ?? ''))
    .filter((item) => autoStopEnabled(item, policy, override));
}
