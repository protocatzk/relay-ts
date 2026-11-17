import type { LogLevel, StreamState } from '@/src/api/types';

export const STATE_LABELS: Record<StreamState, string> = {
  idle: 'Bereit',
  starting: 'Startet',
  live: 'Live',
  reconnecting: 'Verbinde neu',
  paused: 'Pausiert',
  stopping: 'Stoppt',
  error: 'Fehler',
};

export const STATE_TONES: Record<StreamState, string> = {
  idle: 'neutral',
  starting: 'info',
  live: 'success',
  reconnecting: 'warning',
  paused: 'warning',
  stopping: 'info',
  error: 'danger',
};

export const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'Debug',
  info: 'Info',
  warn: 'Warn',
  error: 'Error',
};

export function stateLabel(state: StreamState | null | undefined): string {
  return state ? STATE_LABELS[state] : 'Unbekannt';
}

export function stateTone(state: StreamState | null | undefined): string {
  return state ? STATE_TONES[state] : 'neutral';
}

export function formatUptime(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return '–';
  const seconds = Math.floor(totalSeconds);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  if (days > 0) return `${days} T ${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  return `${pad(minutes)}:${pad(secs)}`;
}

export function formatNumber(
  value: number | null | undefined,
  digits = 0,
  fallback = '–',
): string {
  if (value == null || !Number.isFinite(value)) return fallback;
  return value.toLocaleString('de-DE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatBitrate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '–';
  if (value >= 1000) return `${formatNumber(value / 1000, 1)} Mbit/s`;
  return `${formatNumber(value, 0)} kbit/s`;
}

export function formatFps(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '–';
  return `${formatNumber(value, value % 1 === 0 ? 0 : 1)} fps`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '–';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${formatNumber(value, index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatSeconds(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '–';
  if (value < 60) return `${formatNumber(value, value % 1 === 0 ? 0 : 1)} s`;
  return formatUptime(value);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '–';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatClockTime(iso: string | null | undefined): string {
  if (!iso) return '–';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function pad(value: number): string {
  return String(value).padStart(2, '0');
}
