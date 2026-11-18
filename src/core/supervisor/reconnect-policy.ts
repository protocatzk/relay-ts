import type { Settings } from '../config/schema.js';

/** Exponential backoff capped by the configured maximum. */
export function nextReconnectDelay(attempt: number, maxReconnectDelaySeconds: number): number {
  const maximum = Math.max(2, maxReconnectDelaySeconds) * 1000;
  return Math.min(maximum, 2000 * 2 ** Math.min(6, Math.max(0, attempt - 1)));
}

export function reconnectDelayForSettings(attempt: number, settings: Settings): number {
  return nextReconnectDelay(attempt, settings.watchdog.max_reconnect_delay);
}

/** Manual reconnect delays may be provided explicitly; otherwise use backoff. */
export function reconnectDelay(attempt: number, settings: Settings, explicitMs?: number): number {
  return explicitMs ?? reconnectDelayForSettings(attempt, settings);
}
