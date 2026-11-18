/**
 * Maximum duration of an automatic offline pause. Returns `null` when the
 * pause should run indefinitely (0 or invalid values).
 */
export function pauseLimitDelayMs(maxMinutes: number): number | null {
  if (!Number.isFinite(maxMinutes) || maxMinutes <= 0) return null;
  return Math.round(maxMinutes * 60_000);
}
