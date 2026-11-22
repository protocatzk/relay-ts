import type { StatusSnapshot } from '../events.js';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Renders a crisp Unicode progress bar.
 * Example: formatProgressBar(65, 100, 10) => "[██████░░░░] 65%"
 */
export function formatProgressBar(
  value: number,
  max: number,
  width = 10,
): string {
  if (max <= 0) return `[${'░'.repeat(width)}] 0%`;
  const ratio = Math.max(0, Math.min(1, value / max));
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const pct = Math.round(ratio * 100);
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${pct}%`;
}

/**
 * Formats expandable quote block for Telegram Bot API (HTML mode).
 */
export function formatExpandableQuote(text: string): string {
  return `<blockquote expandable>${escapeHtml(text)}</blockquote>`;
}

export function formatBitrate(kbps: number | null | undefined): string {
  if (kbps == null || Number.isNaN(kbps)) return '–';
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${Math.round(kbps)} kbps`;
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Builds a modern live status text card with Unicode badges,
 * progress meters and optional dashboard links.
 */
export function renderLiveStatusCard(
  snap: StatusSnapshot,
  options?: {
    dashboardUrl?: string;
    streamerName?: string;
  },
): string {
  const isLive = snap.state === 'live';
  const isPaused = snap.state === 'paused' || snap.manual_screen === 'pause';
  const isStarting = snap.state === 'starting' || snap.manual_screen === 'startup';

  const stateBadge = isLive
    ? '🔴 <b>LIVE</b>'
    : isPaused
      ? '⏸ <b>PAUSE</b>'
      : isStarting
        ? '🟡 <b>STARTET</b>'
        : '⚪️ <b>IDLE</b>';

  const streamer = escapeHtml(
    options?.streamerName ?? snap.active_streamer_name ?? snap.active_streamer_id ?? 'Keiner',
  );
  const uptime = formatDuration(snap.uptime_seconds);

  const lines: string[] = [
    `<b>RELAY Restreamer</b> · ${stateBadge}`,
    `👤 <b>Sender:</b> ${streamer} · ⏱ <code>${uptime}</code>`,
  ];

  if (snap.active_scene_name) {
    lines.push(`🎨 <b>Szene:</b> ${escapeHtml(snap.active_scene_name)}`);
  }

  // Source info
  const srcBitrate = formatBitrate(snap.source?.bitrate_kbps);
  const srcStatus = snap.source?.connected ? '✅ verbunden' : '❌ getrennt';
  lines.push(`📡 <b>Quelle:</b> ${srcStatus} (${srcBitrate})`);

  // Relay buffer meter
  if (snap.relay) {
    const bufSec = snap.relay.buffer_seconds ?? 0;
    const targetSec = snap.relay.delay_seconds ?? 0;
    if (targetSec > 0) {
      const bar = formatProgressBar(bufSec, targetSec, 8);
      lines.push(`⏳ <b>Puffer:</b> <code>${bufSec.toFixed(1)}s/${targetSec}s</code> ${bar}`);
    } else {
      lines.push(`⏳ <b>Puffer:</b> <code>${bufSec.toFixed(1)}s</code> (Direct)`);
    }
  }

  // Sink info
  if (snap.sink?.running) {
    const sinkFps = snap.sink.fps ? `${snap.sink.fps} fps` : '–';
    const sinkSpeed = snap.sink.speed ?? '1x';
    const sinkBitrate = formatBitrate(snap.sink.bitrate_kbps);
    lines.push(`🚀 <b>YouTube-Sink:</b> ${sinkBitrate} · ${sinkFps} · <code>${sinkSpeed}</code>`);
  }

  if (options?.dashboardUrl) {
    lines.push(`\n🔗 <a href="${escapeHtml(options.dashboardUrl)}">Web-Cockpit öffnen</a>`);
  }

  return lines.join('\n');
}
