import type { Settings, SettingsUpdate } from '../api/types.js';

export type EditableSettingsSectionId =
  | 'delay'
  | 'video'
  | 'audio'
  | 'watchdog'
  | 'refresh'
  | 'startup'
  | 'pause'
  | 'monitor'
  | 'earnings'
  | 'chat'
  | 'title'
  | 'webhooks'
  | 'mcp';

export type SettingsSectionId =
  | EditableSettingsSectionId
  | 'tiktok_accounts'
  | 'totp'
  | 'sessions'
  | 'appearance';

export interface SettingsSectionMeta {
  id: SettingsSectionId;
  domId: string;
  label: string;
  editable: boolean;
  restartRequired?: boolean;
}

export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
  { id: 'delay', domId: 'settings-delay', label: 'Verzögerung', editable: true, restartRequired: true },
  { id: 'video', domId: 'settings-video', label: 'Video', editable: true, restartRequired: true },
  { id: 'audio', domId: 'settings-audio', label: 'Audio', editable: true, restartRequired: true },
  { id: 'watchdog', domId: 'settings-watchdog', label: 'Watchdog', editable: true },
  { id: 'refresh', domId: 'settings-refresh', label: 'Auto-Refresh', editable: true },
  { id: 'startup', domId: 'settings-startup', label: 'Startbildschirm', editable: true },
  { id: 'pause', domId: 'settings-pause', label: 'Pause', editable: true },
  { id: 'monitor', domId: 'settings-monitor', label: 'Online-Monitor', editable: true },
  { id: 'earnings', domId: 'settings-earnings', label: 'Einnahmen', editable: true },
  { id: 'chat', domId: 'settings-chat', label: 'Chat-Overlay', editable: true },
  { id: 'title', domId: 'settings-title', label: 'YouTube & Stream-Key', editable: true },
  { id: 'webhooks', domId: 'settings-webhooks', label: 'Webhooks', editable: true },
  { id: 'mcp', domId: 'settings-mcp', label: 'MCP-Server & KI-Agenten', editable: true },
  { id: 'tiktok_accounts', domId: 'settings-tiktok-accounts', label: 'TikTok-Konten', editable: false },
  { id: 'appearance', domId: 'settings-appearance', label: 'Erscheinungsbild', editable: false },
  { id: 'totp', domId: 'settings-totp', label: '2FA (TOTP)', editable: false },
  { id: 'sessions', domId: 'settings-sessions', label: 'Sessions', editable: false },
];

export const EDITABLE_SETTINGS_SECTIONS: readonly EditableSettingsSectionId[] = [
  'delay',
  'video',
  'audio',
  'watchdog',
  'refresh',
  'startup',
  'pause',
  'monitor',
  'earnings',
  'chat',
  'title',
  'webhooks',
  'mcp',
];

export interface SettingsSecretsDraft {
  onlineApiKey: string;
  chatApiKey: string;
  earningsApiKey: string;
  globalYoutubeKey?: string;
  clearGlobalYoutubeKey?: boolean;
  webhookUrl?: string;
  webhookSecret?: string;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Build the partial `PUT /api/settings` payload for a single settings card. */
export function buildSectionPayload(
  section: EditableSettingsSectionId,
  current: Settings,
  secrets: SettingsSecretsDraft,
): Partial<SettingsUpdate> {
  switch (section) {
    case 'delay':
      return {
        delay_buffer: {
          enabled: current.delay_buffer.enabled,
          size: toNumber(current.delay_buffer.size, 30),
          catchup_rate: toNumber(current.delay_buffer.catchup_rate, 1.01),
        },
      };
    case 'video':
      return {
        video: {
          resolution: current.video.resolution,
          fps: toNumber(current.video.fps, 30),
          video_bitrate: toNumber(current.video.video_bitrate, 4000),
          audio_bitrate: toNumber(current.video.audio_bitrate, 128),
          preset: current.video.preset,
          encoder: current.video.encoder,
          layout: clone(current.video.layout),
        },
        source: {
          reencode: current.source.reencode,
        },
      };
    case 'audio': {
      const audio = current.audio ?? {
        normalize: 'off',
        target_lufs: -16,
        gain_db: 0,
        silence_detect: false,
        silence_threshold_db: -50,
        silence_seconds: 15,
      };
      return {
        audio: {
          normalize: audio.normalize,
          target_lufs: toNumber(audio.target_lufs, -16),
          gain_db: toNumber(audio.gain_db, 0),
          silence_detect: audio.silence_detect,
          silence_threshold_db: toNumber(audio.silence_threshold_db, -50),
          silence_seconds: toNumber(audio.silence_seconds, 15),
        },
      };
    }
    case 'watchdog':
      return {
        watchdog: {
          stall_timeout: toNumber(current.watchdog.stall_timeout, 30),
          min_bitrate: toNumber(current.watchdog.min_bitrate, 500),
          min_source_rate_percent: toNumber(current.watchdog.min_source_rate_percent, 85),
          interval: toNumber(current.watchdog.interval, 5),
          auto_reconnect: current.watchdog.auto_reconnect,
        },
      };
    case 'refresh':
      return {
        auto_refresh: {
          enabled: current.auto_refresh.enabled,
          interval: toNumber(current.auto_refresh.interval, 20),
        },
      };
    case 'startup':
      return {
        startup: {
          enabled: current.startup.enabled,
          duration_seconds: toNumber(current.startup.duration_seconds, 10),
          text: current.startup.text,
          subtext: current.startup.subtext,
          color: current.startup.color,
          background: current.startup.background.trim(),
          font: current.startup.font.trim(),
          text_color: current.startup.text_color.trim() || 'white',
          fit: current.startup.fit,
        },
      };
    case 'pause':
      return {
        pause: {
          enabled: current.pause.enabled,
          text: current.pause.text,
          subtext: current.pause.subtext,
          max_minutes: toNumber(current.pause.max_minutes, 15),
          grace_seconds: toNumber(current.pause.grace_seconds, 2),
          color: current.pause.color,
          background: current.pause.background.trim(),
          font: current.pause.font.trim(),
          text_color: current.pause.text_color.trim() || 'white',
          fit: current.pause.fit,
        },
      };
    case 'monitor':
      return {
        online: {
          enabled: current.online.enabled,
          source_url: current.online.source_url.trim(),
          interval: toNumber(current.online.interval, 30),
          auto_switch_preferred: current.online.auto_switch_preferred,
          ...(secrets.onlineApiKey.trim() ? { api_key: secrets.onlineApiKey.trim() } : {}),
        },
      };
    case 'earnings':
      return {
        earnings: {
          enabled: current.earnings.enabled,
          source_url: current.earnings.source_url.trim(),
          interval: toNumber(current.earnings.interval, 300),
          period: current.earnings.period,
          view: current.earnings.view,
          overlay_enabled: current.earnings.overlay_enabled,
          overlay_position: current.earnings.overlay_position,
          overlay_template: current.earnings.overlay_template,
          overlay_font_size: toNumber(current.earnings.overlay_font_size, 22),
          overlay_margin: toNumber(current.earnings.overlay_margin, 32),
          overlay_offset_x: toNumber(current.earnings.overlay_offset_x, 0),
          overlay_offset_y: toNumber(current.earnings.overlay_offset_y, 0),
          overlay_font_color: current.earnings.overlay_font_color,
          overlay_box_color: current.earnings.overlay_box_color,
          overlay_show_box: current.earnings.overlay_show_box,
          ...(secrets.earningsApiKey.trim() ? { api_key: secrets.earningsApiKey.trim() } : {}),
        },
      };
    case 'chat':
      return {
        chat: {
          api_url: current.chat.api_url.trim(),
          ...(secrets.chatApiKey.trim() ? { api_key: secrets.chatApiKey.trim() } : {}),
        },
      };
    case 'title': {
      const nextGlobalKey = secrets.globalYoutubeKey?.trim() ?? '';
      return {
        streaming: {
          title_template: current.streaming.title_template,
          global_key_enabled: Boolean(current.streaming.global_key_enabled),
          ...(secrets.clearGlobalYoutubeKey
            ? { global_youtube_key: '' }
            : nextGlobalKey
              ? { global_youtube_key: nextGlobalKey }
              : {}),
        },
      };
    }
    case 'webhooks': {
      const hooks = current.webhooks ?? {
        enabled: false,
        url_set: false,
        url_host: '',
        format: 'generic',
        secret_set: false,
        cooldown_seconds: 60,
        events: ['stream_error', 'pause_limit', 'reconnect_failed', 'youtube_auth_required', 'disk_warning'],
      };
      const nextUrl = secrets.webhookUrl?.trim() ?? '';
      const nextSecret = secrets.webhookSecret?.trim() ?? '';
      return {
        webhooks: {
          enabled: hooks.enabled,
          format: hooks.format,
          cooldown_seconds: toNumber(hooks.cooldown_seconds, 60),
          events: clone(hooks.events),
          ...(nextUrl ? { url: nextUrl } : {}),
          ...(nextSecret ? { secret: nextSecret } : {}),
        },
      };
    }
    case 'mcp': {
      const mcp = current.mcp ?? {
        enabled: true,
        allow_destructive: true,
        require_auth: false,
        server_name: 'relay-mcp-server',
      };
      return {
        mcp: {
          enabled: mcp.enabled,
          allow_destructive: mcp.allow_destructive,
          require_auth: mcp.require_auth,
          server_name: mcp.server_name.trim() || 'relay-mcp-server',
        },
      };
    }
  }
}

/** Build the complete `PUT /api/settings` payload across all editable cards. */
export function buildAllSectionsPayload(
  current: Settings,
  secrets: SettingsSecretsDraft,
): SettingsUpdate {
  const combined: Partial<SettingsUpdate> = {};
  for (const section of EDITABLE_SETTINGS_SECTIONS) {
    Object.assign(combined, buildSectionPayload(section, current, secrets));
  }
  return combined as SettingsUpdate;
}

/** Determine whether a single settings card has unsaved changes compared to `baseline`. */
export function isSectionDirty(
  section: EditableSettingsSectionId,
  current: Settings,
  baseline: Settings,
  secrets: SettingsSecretsDraft,
): boolean {
  switch (section) {
    case 'delay':
      return JSON.stringify(current.delay_buffer) !== JSON.stringify(baseline.delay_buffer);
    case 'video':
      return (
        JSON.stringify(current.video) !== JSON.stringify(baseline.video) ||
        JSON.stringify(current.source) !== JSON.stringify(baseline.source)
      );
    case 'audio':
      return JSON.stringify(current.audio ?? null) !== JSON.stringify(baseline.audio ?? null);
    case 'watchdog':
      return JSON.stringify(current.watchdog) !== JSON.stringify(baseline.watchdog);
    case 'refresh':
      return JSON.stringify(current.auto_refresh) !== JSON.stringify(baseline.auto_refresh);
    case 'startup':
      return JSON.stringify(current.startup) !== JSON.stringify(baseline.startup);
    case 'pause':
      return JSON.stringify(current.pause) !== JSON.stringify(baseline.pause);
    case 'monitor':
      return (
        secrets.onlineApiKey.length > 0 ||
        JSON.stringify(current.online) !== JSON.stringify(baseline.online)
      );
    case 'earnings':
      return (
        secrets.earningsApiKey.length > 0 ||
        JSON.stringify(current.earnings) !== JSON.stringify(baseline.earnings)
      );
    case 'chat':
      return (
        secrets.chatApiKey.length > 0 ||
        JSON.stringify(current.chat) !== JSON.stringify(baseline.chat)
      );
    case 'title':
      return (
        (secrets.globalYoutubeKey?.trim().length ?? 0) > 0 ||
        Boolean(secrets.clearGlobalYoutubeKey) ||
        JSON.stringify(current.streaming) !== JSON.stringify(baseline.streaming)
      );
    case 'webhooks':
      return (
        (secrets.webhookUrl?.length ?? 0) > 0 ||
        (secrets.webhookSecret?.length ?? 0) > 0 ||
        JSON.stringify(current.webhooks ?? null) !== JSON.stringify(baseline.webhooks ?? null)
      );
    case 'mcp':
      return JSON.stringify(current.mcp ?? null) !== JSON.stringify(baseline.mcp ?? null);
  }
}

/** Copy the server-confirmed values for a single section into `target` without touching other cards. */
export function applySavedSection(
  section: EditableSettingsSectionId,
  target: Settings,
  saved: Settings,
): void {
  switch (section) {
    case 'delay':
      target.delay_buffer = clone(saved.delay_buffer);
      return;
    case 'video':
      target.video = clone(saved.video);
      target.source = clone(saved.source);
      return;
    case 'audio':
      if (saved.audio) target.audio = clone(saved.audio);
      return;
    case 'watchdog':
      target.watchdog = clone(saved.watchdog);
      return;
    case 'refresh':
      target.auto_refresh = clone(saved.auto_refresh);
      return;
    case 'startup':
      target.startup = clone(saved.startup);
      return;
    case 'pause':
      target.pause = clone(saved.pause);
      return;
    case 'monitor':
      target.online = clone(saved.online);
      return;
    case 'earnings':
      target.earnings = clone(saved.earnings);
      return;
    case 'chat':
      target.chat = clone(saved.chat);
      return;
    case 'title':
      target.streaming = clone(saved.streaming);
      return;
    case 'webhooks':
      if (saved.webhooks) target.webhooks = clone(saved.webhooks);
      return;
    case 'mcp':
      if (saved.mcp) target.mcp = clone(saved.mcp);
      return;
  }
}
