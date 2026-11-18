export type OverlayPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type StreamQuality = 'best' | '1080p' | '720p' | '480p' | '360p';

export type StreamState =
  | 'idle'
  | 'starting'
  | 'live'
  | 'reconnecting'
  | 'paused'
  | 'stopping'
  | 'error';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type VideoPreset = 'ultrafast' | 'veryfast' | 'faster' | 'fast' | 'medium';

export interface ChatOverlay {
  enabled: boolean;
  engine: 'canvas' | 'drawtext';
  position: OverlayPosition;
  style: 'bubbles' | 'panel' | 'minimal';
  max_lines: number;
  max_messages: number;
  max_age_seconds: number;
  panel_height: number;
  font_size: number;
  font_color: string;
  box_color: string;
  bubble_opacity: number;
  panel_width: number;
  render_fps: number;
  show_timestamps: boolean;
  show_badges: boolean;
  show_tiers: boolean;
  show_stats: boolean;
  name_colors: boolean;
  api_url: string;
  api_key_set: boolean;
  poll_interval: number;
  delay: number;
}

export interface ClockOverlay {
  enabled: boolean;
  position: OverlayPosition;
  format: string;
  font_size: number;
  font_color: string;
  box_color: string;
  show_box: boolean;
  margin: number;
}

export interface TextOverlay {
  enabled: boolean;
  position: OverlayPosition;
  text: string;
  font_size: number;
  font_color: string;
  box_color: string;
  marquee: boolean;
  speed: number;
  show_box: boolean;
  margin: number;
}

export interface StreamerOverlays {
  chat: ChatOverlay;
  clock: ClockOverlay;
  text: TextOverlay;
}

export interface Streamer {
  id: string;
  name: string;
  tiktok: string;
  youtube_key_set: boolean;
  youtube_key_source: 'streamer' | 'env' | 'none';
  quality: StreamQuality;
  auto_start: boolean;
  preferred: boolean;
  enabled: boolean;
  own_stream: boolean;
  overlays: StreamerOverlays;
  status: {
    online: boolean | null;
    active: boolean;
  };
}

export interface StreamSourceStatus {
  online: boolean | null;
  resolving: boolean;
  connected: boolean;
  pid: number | null;
  last_data_at: string | null;
  bitrate_kbps: number | null;
  reconnects: number;
}

export interface RelayStatus {
  ingest_clients: number;
  output_connected: boolean;
  buffer_seconds: number;
  buffered_bytes: number;
  dropped_bytes: number;
  delay_seconds: number;
  pacing_kbps: number | null;
  total_bytes: number;
}

export interface SinkStatus {
  running: boolean;
  pid: number | null;
  bitrate_kbps: number | null;
  target_bitrate_kbps: number | null;
  fps: number | null;
  dropped_frames: number;
  speed: string | null;
  last_progress_at: string | null;
  restarts: number;
}

export interface WatchdogStatus {
  stall_timeout: number;
  stall_count: number;
  last_stall_at: string | null;
  last_error: string | null;
  reconnecting: boolean;
}

export interface AutoRefreshStatus {
  enabled: boolean;
  interval_minutes: number;
  next_refresh_in_seconds: number | null;
  last_refresh_at: string | null;
  count: number;
}

export interface ActivePlaylist {
  id: string;
  name: string;
  index: number;
  total: number;
}

export interface StatusPayload {
  state: StreamState;
  active_streamer_id: string | null;
  active_streamer_name: string | null;
  active_playlist: ActivePlaylist | null;
  started_at: string | null;
  uptime_seconds: number;
  source: StreamSourceStatus;
  relay: RelayStatus;
  sink: SinkStatus;
  watchdog: WatchdogStatus;
  auto_refresh: AutoRefreshStatus;
  chat: ChatStatus;
  earnings: EarningsSnapshot | null;
  version: string;
}

export interface EarningsSnapshot {
  enabled: boolean;
  configured: boolean;
  streamer_id: string | null;
  net: number | null;
  gross: number | null;
  coins: number | null;
  viewers: number | null;
  currency: 'EUR' | 'USD';
  top_gift: string | null;
  updated_at: string | null;
  error: string | null;
}

export interface ChatStatus {
  enabled: boolean;
  engine: 'canvas' | 'drawtext' | null;
  messages: number;
  last_message_at: string | null;
  api_configured: boolean;
  canvas_active: boolean;
}

export interface TitlePreview {
  streamer_id: string;
  template: string;
  title: string;
}

export interface LogEntry {
  time: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

export interface DelayBufferSettings {
  enabled: boolean;
  size: number;
}

export interface VideoSettings {
  resolution: string;
  fps: number;
  video_bitrate: number;
  audio_bitrate: number;
  preset: VideoPreset;
}

export interface WatchdogSettings {
  stall_timeout: number;
  min_bitrate: number;
  min_source_rate_percent: number;
  interval: number;
  auto_reconnect: boolean;
}

export interface AutoRefreshSettings {
  enabled: boolean;
  interval: number;
}

export interface PauseSettings {
  enabled: boolean;
  text: string;
  subtext: string;
  max_minutes: number;
}

export interface OnlineSettings {
  enabled: boolean;
  source_url: string;
  api_key_set: boolean;
  interval: number;
  auto_switch_preferred: boolean;
}

export interface Settings {
  delay_buffer: DelayBufferSettings;
  video: VideoSettings;
  watchdog: WatchdogSettings;
  auto_refresh: AutoRefreshSettings;
  pause: PauseSettings;
  online: OnlineSettings;
  chat: ChatSettings;
  streaming: StreamingSettings;
  earnings: EarningsSettings;
}

export interface StreamingSettings {
  title_template: string;
}

export interface EarningsSettings {
  enabled: boolean;
  source_url: string;
  api_key_set: boolean;
  interval: number;
  view: 'compact' | 'standard' | 'detailed';
  overlay_enabled: boolean;
  overlay_position: OverlayPosition;
  overlay_template: string;
  overlay_font_size: number;
}

export interface ChatSettings {
  api_url: string;
  api_key_set: boolean;
}

export interface SettingsUpdate {
  delay_buffer: DelayBufferSettings;
  video: VideoSettings;
  watchdog: WatchdogSettings;
  auto_refresh: AutoRefreshSettings;
  pause: PauseSettings;
  online: {
    enabled: boolean;
    source_url: string;
    interval: number;
    auto_switch_preferred: boolean;
    api_key?: string;
  };
  chat: {
    api_url: string;
    api_key?: string;
  };
  streaming: {
    title_template: string;
  };
  earnings: {
    enabled: boolean;
    source_url: string;
    interval: number;
    view: 'compact' | 'standard' | 'detailed';
    overlay_enabled: boolean;
    overlay_position: OverlayPosition;
    overlay_template: string;
    overlay_font_size: number;
    api_key?: string;
  };
}

export interface Playlist {
  id: string;
  name: string;
  channels: string[];
  auto_advance: boolean;
  wrap: boolean;
  advance_delay_seconds: number;
  end_after_minutes?: number | null;
  end_time?: string | null;
  youtube_key_set: boolean;
  active?: boolean;
  index?: number | null;
}

export interface PlaylistInput {
  id?: string;
  name: string;
  channels: string[];
  auto_advance: boolean;
  wrap: boolean;
  advance_delay_seconds: number;
  end_after_minutes?: number | null;
  end_time?: string | null;
  youtube_key?: string;
}

export interface AuthMe {
  authenticated: boolean;
  auth_required: boolean;
}

export interface AuthMethods {
  auth_required: boolean;
  password_auth: boolean;
  telegram_auth: boolean;
  telegram_bot_username: string;
}

export interface TelegramLoginRequest {
  token: string;
  bot_username: string;
  deep_link: string;
  expires_in: number;
}

export interface TelegramLoginStatus {
  status: 'pending' | 'approved' | 'denied' | 'expired';
  user?: string;
}

export interface StreamerOverlaysInput {
  chat: {
    enabled: boolean;
    engine: 'canvas' | 'drawtext';
    position: OverlayPosition;
    style: 'bubbles' | 'panel' | 'minimal';
    max_lines: number;
    font_size: number;
    font_color: string;
    box_color: string;
    bubble_opacity: number;
    panel_width: number;
    render_fps: number;
    show_timestamps: boolean;
    show_badges: boolean;
    api_url: string;
    poll_interval: number;
    delay: number;
    api_key?: string;
  };
  clock: ClockOverlay;
  text: TextOverlay;
}

export interface StreamerInput {
  name: string;
  tiktok: string;
  youtube_key?: string;
  quality: StreamQuality;
  auto_start: boolean;
  preferred: boolean;
  enabled: boolean;
  own_stream: boolean;
  overlays: StreamerOverlaysInput;
}

export interface StudioPreviewInput {
  streamer_id?: string;
  overlays: StreamerOverlaysInput;
  sample?: boolean;
  max_dimension?: number;
}

export interface StreamerCreateInput extends StreamerInput {
  id: string;
}

export interface QuickStartInput {
  tiktok: string;
  youtube_key: string;
  name?: string;
}

export interface BulkAddInput {
  channels: string[];
  playlist_id?: string;
}

export interface BulkAddResult {
  created: Streamer[];
  skipped: string[];
  playlist_id: string | null;
}

export interface LogsResponse {
  lines: LogEntry[];
}

export interface StreamersResponse {
  streamers: Streamer[];
}

export interface PlaylistsResponse {
  playlists: Playlist[];
}

export interface ApiErrorDetail {
  code: string;
  message: string;
}

export interface ApiErrorBody {
  error: ApiErrorDetail;
}
