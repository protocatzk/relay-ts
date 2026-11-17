export function nowIso(): string {
  return new Date().toISOString();
}

export function isoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function secondsSince(value: Date | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  return Math.max(0, Math.round((now - value.getTime()) / 100) / 10);
}

export function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

export function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function normalizeHandle(value: string): string {
  return value
    .trim()
    .replace(/^@+/, '')
    .replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

export function maskSecret(value: string | undefined | null): string {
  if (!value) return '';
  if (value.length <= 4) return '***';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (Array.isArray(base)) {
    return (Array.isArray(patch) ? patch : base) as T;
  }
  if (base && typeof base === 'object') {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base;
    const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
      if (value === undefined) continue;
      const current = result[key];
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        result[key] = deepMerge(current, value);
      } else if (value !== null) {
        result[key] = value;
      }
    }
    return result as T;
  }
  return (patch === undefined ? base : patch) as T;
}
