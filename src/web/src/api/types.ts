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

export type VideoEncoderSetting = 'auto' | 'libx264' | 'h264_qsv' | 'h264_nvenc' | 'h264_amf';

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
  offset_x: number;
  offset_y: number;
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
  offset_x: number;
  offset_y: number;
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
  offset_x: number;
  offset_y: number;
}

export interface StreamerOverlays {
  chat: ChatOverlay;
  clock: ClockOverlay;
  text: TextOverlay;
  logo: LogoOverlay;
}

export interface LogoOverlay {
  enabled: boolean;
  position: OverlayPosition;
  width: number;
  opacity: number;
  margin: number;
  offset_x: number;
  offset_y: number;
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
  priority: number;
  enabled: boolean;
  own_stream: boolean;
  video_mode: 'copy' | 'reencode';
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
  manual_screen: 'startup' | 'pause' | null;
  started_at: string | null;
  uptime_seconds: number;
  source: StreamSourceStatus;
  relay: RelayStatus;
  sink: SinkStatus;
  watchdog: WatchdogStatus;
  auto_refresh: AutoRefreshStatus;
  chat: ChatStatus;
  media: {
    file: string;
    duration_seconds: number;
    position_seconds: number;
  } | null;
  secondary_sink?: {
    enabled: boolean;
    provider: 'twitch' | 'kick' | 'custom';
    mode: 'copy' | 'reencode';
    running: boolean;
    pid: number | null;
    bitrate_kbps: number | null;
    fps: number | null;
    restarts: number;
    last_error: string | null;
  };
  recording?: {
    enabled: boolean;
    active: boolean;
    filename: string | null;
    started_at: string | null;
    bytes: number;
    disk_warning: string | null;
    last_error: string | null;
  };
  version: string;
}

export type QueueEntryKind = 'file' | 'streamer' | 'screen';

export interface QueueViewEntry {
  id: string;
  channel: string;
  kind: QueueEntryKind;
  label: string;
  duration_seconds?: number | null;
}

export interface QueueSnapshot {
  entries: QueueViewEntry[];
  playing: boolean;
  index: number | null;
  loop?: boolean;
}

export interface EarningsRates {
  usd_per_diamond: number | null;
  gross_usd_per_coin: number | null;
  usd_to_eur_rate: number | null;
}

export interface EarningsTopGift {
  name: string;
  coins: number | null;
  count: number | null;
}

export interface EarningsTopGifter {
  username: string;
  display_name: string | null;
  coins: number | null;
}

export interface EarningsSession {
  id: string | null;
  started_at: string | null;
  ended_at: string | null;
  status: string | null;
  peak_viewers: number | null;
  last_fan_tickets: number | null;
  coins: number | null;
  gifts: number | null;
  net: number | null;
  gross: number | null;
  currency: 'EUR' | 'USD';
}

export interface EarningsDiagnostics {
  state: string | null;
  is_running: boolean | null;
  connected_since: string | null;
  last_event_at: string | null;
  last_message: string | null;
  reconnect_attempts: number | null;
  current_viewers: number | null;
  peak_viewers: number | null;
  room_fan_tickets: number | null;
  gifts_received_session: number | null;
  coins_received_session: number | null;
  session_id: string | null;
}

export type EarningsStatus =
  | 'unconfigured'
  | 'disabled'
  | 'inactive'
  | 'checking'
  | 'missing'
  | 'error'
  | 'ok';

export interface EarningsDelta {
  net: number | null;
  gross: number | null;
  coins: number | null;
  since: string | null;
}

export type EarningsPeriod = 'today' | '24h' | '7d' | '30d' | 'all';

export interface EarningsHistoryPoint {
  at: string;
  streamer_id: string;
  period: EarningsPeriod;
  net: number | null;
  gross: number | null;
  coins: number | null;
  currency: 'EUR' | 'USD';
}

export interface EarningsSnapshot {
  enabled: boolean;
  configured: boolean;
  status: EarningsStatus;
  streamer_id: string | null;
  streamer_name: string | null;
  streamer_handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  room_id: string | null;
  is_live: boolean | null;
  period: string;
  period_label: string;
  view: 'compact' | 'standard' | 'detailed';
  interval_seconds: number;
  net: number | null;
  gross: number | null;
  coins: number | null;
  viewers: number | null;
  followers: number | null;
  gifts: number | null;
  gifts_sent: number | null;
  gifters: number | null;
  currency: 'EUR' | 'USD';
  session: EarningsSession | null;
  top_gift: EarningsTopGift | null;
  top_gifter: EarningsTopGifter | null;
  rates: EarningsRates | null;
  diagnostics: EarningsDiagnostics | null;
  delta: EarningsDelta | null;
  last_seen_at: string | null;
  source: string | null;
  updated_at: string | null;
  last_run_at: string | null;
  missing: boolean;
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

export interface VideoLayout {
  enabled: boolean;
  scale: number;
  position_x: number;
  position_y: number;
}

export interface VideoSettings {
  resolution: string;
  fps: number;
  video_bitrate: number;
  audio_bitrate: number;
  preset: VideoPreset;
  encoder: VideoEncoderSetting;
  layout: VideoLayout;
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
  grace_seconds: number;
  color: string;
  background: string;
  font: string;
  text_color: string;
  fit: 'cover' | 'contain' | 'stretch';
}

export interface StartupSettings {
  enabled: boolean;
  duration_seconds: number;
  text: string;
  subtext: string;
  color: string;
  background: string;
  font: string;
  text_color: string;
  fit: 'cover' | 'contain' | 'stretch';
}

export interface PausePreviewInput {
  screen?: 'pause' | 'startup';
  text?: string;
  subtext?: string;
  color?: string;
  background?: string;
  font?: string;
  text_color?: string;
  fit?: 'cover' | 'contain' | 'stretch';
}

export interface PauseAsset {
  filename: string;
  path: string;
  size: number;
  kind: 'image' | 'video' | 'font';
  mime: string;
  animated: boolean;
  loopable: boolean;
  width: number | null;
  height: number | null;
  duration: number | null;
  warning: string | null;
}

export interface OnlineSettings {
  enabled: boolean;
  source_url: string;
  api_key_set: boolean;
  interval: number;
  auto_switch_preferred: boolean;
}

export interface SourceSettings {
  reencode: 'off' | 'always' | 'on_reconnect';
}

export interface SecondarySinkSettings {
  enabled: boolean;
  provider: 'twitch' | 'kick' | 'custom';
  rtmp_url: string;
  stream_key_set: boolean;
  mode: 'copy' | 'reencode';
}

export interface RecordingSettings {
  enabled: boolean;
  max_total_mb: number;
  min_free_mb: number;
  auto_delete: boolean;
}

export interface RecordingFile {
  filename: string;
  size: number;
  modified_at: string;
  active: boolean;
}

export interface RecordingsListResponse {
  files: RecordingFile[];
  storage: {
    total_bytes: number;
    file_count: number;
    max_total_mb: number;
    min_free_mb: number;
    disk_warning: string | null;
    filesystem: {
      total_bytes: number;
      free_bytes: number;
      available_bytes: number;
    } | null;
  };
  active: string | null;
}

export interface Settings {
  delay_buffer: DelayBufferSettings;
  video: VideoSettings;
  source: SourceSettings;
  watchdog: WatchdogSettings;
  auto_refresh: AutoRefreshSettings;
  pause: PauseSettings;
  startup: StartupSettings;
  online: OnlineSettings;
  chat: ChatSettings;
  streaming: StreamingSettings;
  earnings: EarningsSettings;
  overlays: StreamerOverlays;
  secondary_sink?: SecondarySinkSettings;
  recording?: RecordingSettings;
}

export interface StreamingSettings {
  title_template: string;
}

export interface YouTubeAutomationStatus {
  mode: 'off' | 'relay_only' | 'all';
  auto_transition: boolean;
  auto_start: boolean;
  auto_stop: boolean;
}

export interface YouTubeStatus {
  configured: boolean;
  connected: boolean;
  account: {
    channel_id: string;
    channel_title: string;
  };
  scopes: string[];
  connected_at: string | null;
  expires_at: string | null;
  automation: YouTubeAutomationStatus;
}

export interface YouTubeBroadcast {
  id: string;
  title: string;
  description: string;
  status: string;
  privacy: string;
  scheduled_start: string | null;
  actual_start: string | null;
  actual_end: string | null;
  bound_stream_id: string | null;
  stream_status: string | null;
  stream_health: string | null;
  thumbnail_url: string | null;
  watch_url: string;
  relay_managed: boolean;
}

export interface YouTubeBroadcastList {
  items: YouTubeBroadcast[];
  fetched_at: string;
}

export interface YouTubeBroadcastInput {
  title: string;
  description?: string;
  scheduled_start: string;
  privacy: 'public' | 'unlisted' | 'private';
  enable_dvr?: boolean;
  enable_auto_start?: boolean;
  enable_auto_stop?: boolean;
  streamer_id?: string;
}

export type YouTubeBroadcastUpdate = Partial<Omit<YouTubeBroadcastInput, 'streamer_id'>>;

export type YouTubeBroadcastTransition = 'testing' | 'live' | 'complete';

export interface EarningsSettings {
  enabled: boolean;
  source_url: string;
  api_key_set: boolean;
  interval: number;
  period: 'today' | '24h' | '7d' | '30d' | 'all';
  view: 'compact' | 'standard' | 'detailed';
  overlay_enabled: boolean;
  overlay_position: OverlayPosition;
  overlay_template: string;
  overlay_font_size: number;
  overlay_margin: number;
  overlay_offset_x: number;
  overlay_offset_y: number;
  overlay_font_color: string;
  overlay_box_color: string;
  overlay_show_box: boolean;
}

export interface ChatSettings {
  api_url: string;
  api_key_set: boolean;
}

export interface SettingsUpdate {
  delay_buffer: DelayBufferSettings;
  video: VideoSettings;
  source?: SourceSettings;
  watchdog: WatchdogSettings;
  auto_refresh: AutoRefreshSettings;
  pause: PauseSettings;
  startup: StartupSettings;
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
  overlays?: StreamerOverlaysInput;
  secondary_sink?: {
    enabled: boolean;
    provider: 'twitch' | 'kick' | 'custom';
    rtmp_url: string;
    stream_key?: string;
    mode: 'copy' | 'reencode';
  };
  recording?: RecordingSettings;
  earnings: {
    enabled: boolean;
    source_url: string;
    interval: number;
    view: 'compact' | 'standard' | 'detailed';
    overlay_enabled: boolean;
    overlay_position: OverlayPosition;
    overlay_template: string;
    overlay_font_size: number;
    overlay_margin: number;
    overlay_offset_x: number;
    overlay_offset_y: number;
    overlay_font_color: string;
    overlay_box_color: string;
    overlay_show_box: boolean;
    period: 'today' | '24h' | '7d' | '30d' | 'all';
    api_key?: string;
  };
}

export interface MediaFile {
  filename: string;
  path: string;
  size: number;
  modified_at: string;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  is_h264?: boolean | null;
  codec?: string | null;
  thumbnail_url?: string;
}

export interface MediaStorageSummary {
  total_bytes: number;
  file_count: number;
  filesystem: {
    total_bytes: number;
    free_bytes: number;
    available_bytes: number;
  } | null;
}

export interface MediaListResponse {
  files: MediaFile[];
  storage?: MediaStorageSummary;
}

export interface MediaUploadResult {
  file: {
    filename: string;
    size: number;
    modified_at: string;
    is_h264: boolean;
    codec?: string | null;
    width?: number | null;
    height: number | null;
    duration?: number | null;
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

export interface AuthSessionInfo {
  id: string;
  user: string;
  provider: 'password' | 'telegram';
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  current: boolean;
}

export interface AuthMethods {
  auth_required: boolean;
  password_auth: boolean;
  totp_enabled: boolean;
  telegram_auth: boolean;
  telegram_bot_username: string;
}

export interface LoginResult {
  ok: true;
  auth_required?: boolean;
  recovery_code_used?: boolean;
  recovery_codes_remaining?: number;
}

export interface TotpStatus {
  enabled: boolean;
  enabled_at: string | null;
  recovery_codes_remaining: number;
  pending_setup: boolean;
  password_configured: boolean;
}

export interface TotpSetupResponse {
  secret: string;
  otpauth_url: string;
  qr_svg: string;
  expires_in: number;
}

export interface TotpEnableResponse {
  ok: true;
  status: TotpStatus;
  recovery_codes: string[];
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
  logo: LogoOverlay;
}

export interface StreamerInput {
  name: string;
  tiktok: string;
  youtube_key?: string;
  quality: StreamQuality;
  auto_start: boolean;
  preferred: boolean;
  priority: number;
  enabled: boolean;
  own_stream: boolean;
}

export interface StudioPreviewInput {
  streamer_id?: string;
  overlays: StreamerOverlaysInput;
  earnings?: Partial<EarningsSettings>;
  video_layout?: Partial<VideoLayout>;
  video_aspect?: '9:16' | '16:9' | '1:1';
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
  total?: number;
  offset?: number;
  limit?: number;
  has_more?: boolean;
}

export interface LogQueryParams {
  limit?: number;
  offset?: number;
  level?: LogLevel;
  q?: string;
  streamer?: string;
  since?: string;
  until?: string;
}

export interface LogPageResponse {
  lines: LogEntry[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

export type AuditSource = 'web' | 'api' | 'telegram' | 'system';

export interface AuditEntry {
  time: string;
  actor: string;
  source: AuditSource;
  action: string;
  target: string | null;
  result: 'ok' | 'error';
  detail?: string;
}

export interface AuditQueryParams {
  actor?: string;
  action?: string;
  source?: AuditSource;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface AuditPageResponse {
  entries: AuditEntry[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
  actors: string[];
  actions: string[];
}

export interface DirectoryStorageStats {
  exists: boolean;
  bytes: number;
  files: number;
}

export interface DiagnosticsSnapshot {
  collected_at: string;
  version: string;
  node_version: string;
  platform: string;
  pid: number;
  uptime_seconds: number;
  memory: {
    rss_bytes: number;
    heap_used_bytes: number;
    heap_total_bytes: number;
  };
  tools: {
    ffmpeg: string | null;
    ytdlp: string | null;
  };
  encoder: {
    active: string;
    available: string[];
  };
  ports: {
    http: number;
    relay_host: string;
    relay: number;
    playback: number;
  };
  storage: {
    media: DirectoryStorageStats;
    logs: DirectoryStorageStats;
    backups: DirectoryStorageStats;
    data: DirectoryStorageStats;
    filesystem: {
      total_bytes: number;
      free_bytes: number;
      available_bytes: number;
    } | null;
  };
  metrics: {
    started_at: string;
    uptime_seconds: number;
    counters: Record<string, number>;
  };
  recent_errors: LogEntry[];
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
