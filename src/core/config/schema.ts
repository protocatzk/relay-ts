import { z } from 'zod';

export const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export const QUALITIES = ['best', '1080p', '720p', '480p', '360p'] as const;
export const RESOLUTIONS = [
  '720x1280',
  '1280x720',
  '1080x1920',
  '1920x1080',
  '1600x900',
] as const;
export const PRESETS = ['ultrafast', 'veryfast', 'faster', 'fast', 'medium'] as const;
export const VIDEO_TUNES = ['zerolatency', 'film', 'animation', 'off'] as const;
/** Video encoders selectable in the dashboard; `auto` probes at startup. */
export const VIDEO_ENCODERS = ['auto', 'libx264', 'h264_qsv', 'h264_nvenc', 'h264_amf'] as const;

export type VideoPreset = (typeof PRESETS)[number];
export type VideoTuneSetting = (typeof VIDEO_TUNES)[number];
export type VideoEncoderSetting = (typeof VIDEO_ENCODERS)[number];

const PositionSchema = z.enum(POSITIONS);
const ColorSchema = z
  .string()
  .regex(/^(#?[0-9a-fA-F]{6}(@[0-9.]+)?|[a-zA-Z]+(@[0-9.]+)?)$/, 'Ungültige Farbe');

export const ChatOverlaySchema = z.object({
  enabled: z.boolean().default(false),
  engine: z.enum(['canvas', 'drawtext']).default('canvas'),
  position: PositionSchema.default('bottom-left'),
  style: z.enum(['bubbles', 'panel', 'minimal']).default('bubbles'),
  layout_mode: z.preprocess(
    (val) => (val === 'pillar_monitor' || val === 'starship_cockpit' ? 'glass_minimal' : val),
    z.enum(['standard', 'glass_minimal', 'ultra_clean']).default('standard'),
  ),
  top_banner_enabled: z.boolean().default(true),
  chat_monitor_enabled: z.boolean().default(true),
  banner_show_stats: z.boolean().default(true),
  banner_show_goal: z.boolean().default(true),
  max_lines: z.number().int().min(1).max(30).default(8),
  max_messages: z.number().int().min(1).max(100).default(30),
  max_age_seconds: z.number().int().min(0).max(3600).default(0),
  panel_height: z.number().int().min(0).max(1920).default(0),
  font_size: z.number().int().min(8).max(96).default(22),
  font_color: ColorSchema.default('white'),
  box_color: ColorSchema.default('black@0.45'),
  bubble_opacity: z.number().min(0).max(1).default(1),
  panel_width: z.number().int().min(0).max(1920).default(0),
  render_fps: z.number().int().min(1).max(30).default(10),
  show_timestamps: z.boolean().default(false),
  show_badges: z.boolean().default(true),
  show_tiers: z.boolean().default(true),
  show_stats: z.boolean().default(false),
  /** Regie queue in the chat overlay, below the chat or centered in pillar mode (#97). */
  queue_enabled: z.boolean().default(false),
  queue_max_entries: z.number().int().min(1).max(10).default(5),
  queue_font_size: z.number().int().min(0).max(72).default(0),
  queue_font_color: ColorSchema.default('white'),
  queue_active_color: ColorSchema.default('#00f0ff'),
  queue_box_color: ColorSchema.default('black@0.45'),
  queue_show_box: z.boolean().default(true),
  queue_offset_x: z.number().int().min(-1920).max(1920).default(0),
  queue_offset_y: z.number().int().min(-1080).max(1080).default(0),
  show_earnings_card: z.boolean().default(false),
  earnings_card_interval_seconds: z.number().int().min(10).max(3600).default(120),
  name_colors: z.boolean().default(true),
  offset_x: z.number().int().min(-1920).max(1920).default(0),
  offset_y: z.number().int().min(-1080).max(1080).default(0),
  api_url: z.string().default(''),
  api_key: z.string().default(''),
  poll_interval: z.number().min(1).max(60).default(3),
  delay: z.number().min(0).max(300).default(0),
});

export const ClockOverlaySchema = z.object({
  enabled: z.boolean().default(false),
  position: PositionSchema.default('top-right'),
  format: z.string().min(1).max(64).default('%H:%M:%S'),
  font_size: z.number().int().min(8).max(96).default(28),
  font_color: ColorSchema.default('white'),
  box_color: ColorSchema.default('black@0.45'),
  show_box: z.boolean().default(true),
  margin: z.number().int().min(0).max(200).default(32),
  offset_x: z.number().int().min(-1920).max(1920).default(0),
  offset_y: z.number().int().min(-1080).max(1080).default(0),
});

export const TextOverlaySchema = z.object({
  enabled: z.boolean().default(false),
  position: PositionSchema.default('top-left'),
  text: z.string().max(500).default(''),
  font_size: z.number().int().min(8).max(96).default(28),
  font_color: ColorSchema.default('white'),
  box_color: ColorSchema.default('black@0.45'),
  marquee: z.boolean().default(false),
  speed: z.number().min(10).max(1000).default(120),
  show_box: z.boolean().default(true),
  margin: z.number().int().min(0).max(200).default(32),
  offset_x: z.number().int().min(-1920).max(1920).default(0),
  offset_y: z.number().int().min(-1080).max(1080).default(0),
});

export const LogoOverlaySchema = z.object({
  enabled: z.boolean().default(false),
  position: PositionSchema.default('top-left'),
  width: z.number().int().min(32).max(1024).default(160),
  opacity: z.number().min(0).max(1).default(1),
  margin: z.number().int().min(0).max(200).default(32),
  offset_x: z.number().int().min(-1920).max(1920).default(0),
  offset_y: z.number().int().min(-1080).max(1080).default(0),
});

export const VersionOverlaySchema = z.object({
  enabled: z.boolean().default(false),
  position: PositionSchema.default('bottom-right'),
  prefix: z.string().max(40).default('RELAY v'),
  show_update_hint: z.boolean().default(false),
  update_hint: z.string().max(60).default('Update verfügbar'),
  font_size: z.number().int().min(8).max(72).default(16),
  font_color: ColorSchema.default('white@0.75'),
  box_color: ColorSchema.default('black@0.35'),
  show_box: z.boolean().default(true),
  margin: z.number().int().min(0).max(200).default(24),
  offset_x: z.number().int().min(-1920).max(1920).default(0),
  offset_y: z.number().int().min(-1080).max(1080).default(0),
});

export const OverlaysSchema = z.object({
  chat: ChatOverlaySchema.optional(),
  clock: ClockOverlaySchema.optional(),
  text: TextOverlaySchema.optional(),
  logo: LogoOverlaySchema.optional(),
  version: VersionOverlaySchema.optional(),
});

export const OverlaysSettingsSchema = z.object({
  chat: ChatOverlaySchema.default(ChatOverlaySchema.parse({})),
  clock: ClockOverlaySchema.default(ClockOverlaySchema.parse({})),
  text: TextOverlaySchema.default(TextOverlaySchema.parse({})),
  logo: LogoOverlaySchema.default(LogoOverlaySchema.parse({})),
  version: VersionOverlaySchema.default(VersionOverlaySchema.parse({})),
});

export const StreamerFieldsSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9_-]*$/, 'ID darf nur a-z, 0-9, _ und - enthalten'),
    name: z.string().min(1).max(120),
    tiktok: z.string().min(1).max(300),
    youtube_key: z.string().max(300).optional(),
    youtube_key_env: z.string().max(120).optional(),
    quality: z.enum(QUALITIES).default('best'),
    auto_start: z.boolean().default(false),
    preferred: z.boolean().default(false),
    /** Lower values win for auto-start and preferred-streamer takeover. */
    priority: z.number().int().min(0).max(999).default(0),
    enabled: z.boolean().default(true),
    own_stream: z.boolean().default(false),
    group: z.string().trim().max(64).default(''),
    /** TikTok account whose session is used for this streamer ('' = active account). */
    tiktok_account: z.string().trim().max(64).default(''),
    source: z.enum(['manual', 'discovery']).optional(),
    // Kept for compatibility with the Python restreamer configuration.
    video_mode: z.enum(['copy', 'reencode']).default('copy'),
  })
  .passthrough();

export const StreamerSchema = StreamerFieldsSchema;

export const StreamerUpdateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    tiktok: z.string().min(1).max(300).optional(),
    youtube_key: z.string().max(300).optional(),
    youtube_key_env: z.string().max(120).optional(),
    quality: z.enum(QUALITIES).optional(),
    auto_start: z.boolean().optional(),
    preferred: z.boolean().optional(),
    priority: z.number().int().min(0).max(999).optional(),
    enabled: z.boolean().optional(),
    own_stream: z.boolean().optional(),
    group: z.string().trim().max(64).optional(),
    tiktok_account: z.string().trim().max(64).optional(),
    source: z.enum(['manual', 'discovery']).optional(),
    video_mode: z.enum(['copy', 'reencode']).optional(),
  })
  .passthrough();

export const PlaylistSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Playlist-ID darf nur a-z, 0-9, _ und - enthalten'),
    name: z.string().min(1).max(120),
    channels: z.array(z.string().min(1)).min(1),
    auto_advance: z.boolean().default(true),
    wrap: z.boolean().default(false),
    advance_delay_seconds: z.number().min(0).max(600).default(5),
    end_after_minutes: z.number().min(1).max(1440).nullable().optional(),
    end_time: z
      .string()
      .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Uhrzeit muss HH:MM sein')
      .nullable()
      .optional(),
    youtube_key: z.string().max(300).optional(),
    youtube_key_env: z.string().max(120).optional(),
  })
  .passthrough();

export const PlaylistUpdateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    channels: z.array(z.string().min(1)).min(1).optional(),
    auto_advance: z.boolean().optional(),
    wrap: z.boolean().optional(),
    advance_delay_seconds: z.number().min(0).max(600).optional(),
    end_after_minutes: z.number().min(1).max(1440).nullable().optional(),
    end_time: z
      .string()
      .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Uhrzeit muss HH:MM sein')
      .nullable()
      .optional(),
    youtube_key: z.string().max(300).optional(),
    youtube_key_env: z.string().max(120).optional(),
  })
  .passthrough();

export const DelayBufferSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  size: z.number().min(0).max(300).default(30),
  max_bytes: z.number().int().min(1).max(512).default(32),
  catchup_rate: z.number().min(1).max(1.1).default(1.01),
});

export const SourceSettingsSchema = z.object({
  // `on_reconnect` keeps the cheap `-c copy` for the initial pull and only
  // re-encodes once the source had to reconnect, so the relay always carries a
  // clean, keyframe-aligned stream and the sink does not stutter on mid-GOP
  // decode errors.
  reencode: z.enum(['off', 'always', 'on_reconnect']).default('on_reconnect'),
});

export const VideoLayoutSchema = z.object({
  enabled: z.boolean().default(false),
  scale: z.number().int().min(50).max(400).default(100),
  position_x: z.number().int().min(0).max(100).default(50),
  position_y: z.number().int().min(0).max(100).default(50),
});

export const VideoSettingsSchema = z.object({
  resolution: z.enum(RESOLUTIONS).default('720x1280'),
  fps: z.number().int().min(1).max(60).default(25),
  video_bitrate: z.number().int().min(500).max(50_000).default(4000),
  audio_bitrate: z.number().int().min(32).max(320).default(128),
  preset: z.enum(PRESETS).default('veryfast'),
  tune: z.enum(VIDEO_TUNES).default('zerolatency'),
  encoder: z.enum(VIDEO_ENCODERS).default('auto'),
  layout: VideoLayoutSchema.default(VideoLayoutSchema.parse({})),
});

export const WatchdogSettingsSchema = z.object({
  stall_timeout: z.number().int().min(5).max(600).default(30),
  min_bitrate: z.number().int().min(0).max(100_000).default(500),
  min_source_rate_percent: z.number().int().min(0).max(200).default(85),
  interval: z.number().int().min(1).max(60).default(5),
  auto_reconnect: z.boolean().default(true),
  max_reconnect_delay: z.number().int().min(2).max(300).default(60),
});

export const AutoRefreshSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  interval: z.number().int().min(1).max(720).default(20),
});

export const PauseSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  text: z.string().max(200).default('Stream pausiert'),
  subtext: z.string().max(200).default('Gleich geht es weiter'),
  color: z
    .string()
    .regex(/^(0x[0-9a-fA-F]{6}|#[0-9a-fA-F]{6})$/, 'Farbe muss 0xRRGGBB oder #RRGGBB sein')
    .default('0x101820'),
  max_minutes: z.number().int().min(0).max(1440).default(15),
  grace_seconds: z.number().int().min(0).max(60).default(2),
  background: z.string().max(500).default(''),
  font: z.string().max(500).default(''),
  text_color: z.string().max(64).default('white'),
  fit: z.enum(['cover', 'contain', 'stretch']).default('cover'),
  disconnect_asset: z.string().max(500).default(''),
  disconnect_max_minutes: z.number().int().min(0).max(1440).default(5),
});

export const StartupSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  duration_seconds: z.number().int().min(0).max(300).default(10),
  text: z.string().max(200).default('Gleich geht’s los.'),
  subtext: z.string().max(200).default('Der Stream startet in wenigen Minuten.'),
  color: z
    .string()
    .regex(/^(0x[0-9a-fA-F]{6}|#[0-9a-fA-F]{6})$/, 'Farbe muss 0xRRGGBB oder #RRGGBB sein')
    .default('0x101820'),
  background: z.string().max(500).default(''),
  font: z.string().max(500).default(''),
  text_color: z.string().max(64).default('white'),
  fit: z.enum(['cover', 'contain', 'stretch']).default('cover'),
});

export const OnlineSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  // `external` polls source_url (e.g. TokTracker overview); `tiktok` checks
  // every enabled streamer directly via TikTok's api-live endpoint.
  provider: z.enum(['external', 'tiktok']).default('external'),
  // TikTok account whose session is used for the tiktok provider ('' = the
  // active account / data/cookies.txt).
  account_id: z.string().max(64).default(''),
  source_url: z.string().default(''),
  api_key: z.string().default(''),
  interval: z.number().int().min(10).max(3600).default(60),
  auto_switch_preferred: z.boolean().default(false),
});

export const ChatSettingsSchema = z.object({
  api_url: z.string().default(''),
  api_key: z.string().default(''),
});

export const StreamingSettingsSchema = z.object({
  title_template: z.string().max(200).default('{name} – LIVE'),
  global_key_enabled: z.boolean().default(false),
  global_youtube_key: z.string().max(300).default(''),
});

export const EarningsSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  source_url: z.string().default(''),
  api_key: z.string().default(''),
  interval: z.number().int().min(30).max(3600).default(300),
  period: z.enum(['today', '24h', '7d', '30d', 'all']).default('today'),
  view: z.enum(['compact', 'standard', 'detailed']).default('standard'),
  overlay_enabled: z.boolean().default(false),
  overlay_position: PositionSchema.default('top-left'),
  overlay_template: z.string().max(2000).default('{net} € · {coins} Coins'),
  overlay_font_size: z.number().int().min(8).max(96).default(22),
  overlay_margin: z.number().int().min(0).max(200).default(32),
  overlay_offset_x: z.number().int().min(-1920).max(1920).default(0),
  overlay_offset_y: z.number().int().min(-1080).max(1080).default(0),
  overlay_font_color: ColorSchema.default('white'),
  overlay_box_color: ColorSchema.default('black@0.45'),
  overlay_show_box: z.boolean().default(true),
  goal_amount: z.number().min(0).max(1_000_000).default(0),
  goal_label: z.string().max(80).default('Tagesziel'),
  goal_bar_enabled: z.boolean().default(true),
});

export const YouTubeAutomationSettingsSchema = z.object({
  auto_transition: z.boolean().default(true),
  auto_mode: z.enum(['off', 'relay_only', 'all']).default('relay_only'),
  auto_start: z.boolean().default(true),
  auto_stop: z.boolean().default(true),
  default_privacy: z.enum(['public', 'unlisted', 'private']).default('unlisted'),
  default_dvr: z.boolean().default(true),
  /**
   * Selected YouTube ingest (RTMP) endpoint for the sink. Empty keeps the
   * environment default (`media.youtubeRtmpUrl`); non-empty values must be
   * full rtmp:// or rtmps:// URLs.
   */
  rtmp_url: z
    .string()
    .max(500)
    .default('')
    .refine((value) => !value.trim() || /^rtmps?:\/\//i.test(value.trim()), {
      message: 'RTMP-Endpoint muss mit rtmp:// oder rtmps:// beginnen',
    }),
});

export const SecondarySinkSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(['twitch', 'kick', 'custom']).default('twitch'),
  rtmp_url: z.string().max(500).default('rtmp://live.twitch.tv/app'),
  stream_key: z.string().max(300).default(''),
  mode: z.enum(['copy', 'reencode']).default('reencode'),
});

export const RecordingSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  max_total_mb: z.number().int().min(0).max(1_000_000).default(10_240),
  min_free_mb: z.number().int().min(0).max(500_000).default(1024),
  auto_delete: z.boolean().default(false),
});

export const AudioSettingsSchema = z.object({
  normalize: z.enum(['off', 'loudnorm', 'dynaudnorm']).default('off'),
  target_lufs: z.number().min(-30).max(-6).default(-16),
  gain_db: z.number().min(-24).max(24).default(0),
  silence_detect: z.boolean().default(false),
  silence_threshold_db: z.number().min(-80).max(-10).default(-50),
  silence_seconds: z.number().int().min(2).max(300).default(15),
});

export const WEBHOOK_EVENTS = [
  'stream_error',
  'pause_limit',
  'reconnect_failed',
  'youtube_auth_required',
  'disk_warning',
  'audio_silence',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export const WebhooksSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().max(1000).default(''),
  format: z.enum(['generic', 'discord', 'slack']).default('generic'),
  secret: z.string().max(256).default(''),
  cooldown_seconds: z.number().int().min(0).max(3600).default(60),
  events: z
    .array(z.enum(WEBHOOK_EVENTS))
    .default(['stream_error', 'pause_limit', 'reconnect_failed', 'youtube_auth_required', 'disk_warning']),
});

export const LoggingSettingsSchema = z.object({
  log_level: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  log_file_mb: z.number().int().min(1).max(1000).default(20),
  log_files: z.number().int().min(1).max(50).default(5),
});

export const DISCOVERY_PROVIDERS = ['live_page', 'room_info', 'search_api'] as const;
export type DiscoveryProviderName = (typeof DISCOVERY_PROVIDERS)[number];

export const DiscoverySettingsSchema = z.object({
  enabled: z.boolean().default(true),
  providers: z
    .array(z.enum(DISCOVERY_PROVIDERS))
    .default(['live_page', 'room_info', 'search_api']),
  cache_seconds: z.number().int().min(15).max(600).default(90),
  region: z.string().min(2).max(8).default('DE'),
  language: z.string().min(2).max(8).default('de'),
});

export const McpSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  allow_destructive: z.boolean().default(true),
  require_auth: z.boolean().default(false),
  server_name: z.string().min(1).max(64).default('relay-mcp-server'),
});

export const RtmpIngestSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.number().int().min(1).max(65535).default(1935),
  stream_key: z.string().max(256).default('gaming-live'),
  auto_takeover: z.boolean().default(true),
});

export const SinkSettingsSchema = z.object({
  /** How long the YouTube sink waits for a blocked RTMP write before it
   * aborts. Congestion windows of a few seconds are survived instead of
   * killing the stream. */
  rw_timeout_seconds: z.number().int().min(5).max(300).default(15),
});

export const SoundboardSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  ducking: z.boolean().default(true),
  duck_db: z.number().min(-30).max(-3).default(-12),
  master_gain_db: z.number().min(-40).max(12).default(0),
  sfx_gain_db: z.number().min(-40).max(12).default(0),
  music_gain_db: z.number().min(-40).max(12).default(0),
  max_concurrent: z.number().int().min(1).max(16).default(4),
  cache_mb: z.number().int().min(16).max(1024).default(128),
});

export const SettingsSchema = z.object({
  delay_buffer: DelayBufferSettingsSchema.default(DelayBufferSettingsSchema.parse({})),
  video: VideoSettingsSchema.default(VideoSettingsSchema.parse({})),
  sink: SinkSettingsSchema.default(SinkSettingsSchema.parse({})),
  audio: AudioSettingsSchema.default(AudioSettingsSchema.parse({})),
  soundboard: SoundboardSettingsSchema.default(SoundboardSettingsSchema.parse({})),
  source: SourceSettingsSchema.default(SourceSettingsSchema.parse({})),
  watchdog: WatchdogSettingsSchema.default(WatchdogSettingsSchema.parse({})),
  auto_refresh: AutoRefreshSettingsSchema.default(AutoRefreshSettingsSchema.parse({})),
  pause: PauseSettingsSchema.default(PauseSettingsSchema.parse({})),
  startup: StartupSettingsSchema.default(StartupSettingsSchema.parse({})),
  online: OnlineSettingsSchema.default(OnlineSettingsSchema.parse({})),
  chat: ChatSettingsSchema.default(ChatSettingsSchema.parse({})),
  streaming: StreamingSettingsSchema.default(StreamingSettingsSchema.parse({})),
  earnings: EarningsSettingsSchema.default(EarningsSettingsSchema.parse({})),
  overlays: OverlaysSettingsSchema.default(OverlaysSettingsSchema.parse({})),
  youtube: YouTubeAutomationSettingsSchema.default(YouTubeAutomationSettingsSchema.parse({})),
  secondary_sink: SecondarySinkSettingsSchema.default(SecondarySinkSettingsSchema.parse({})),
  recording: RecordingSettingsSchema.default(RecordingSettingsSchema.parse({})),
  webhooks: WebhooksSettingsSchema.default(WebhooksSettingsSchema.parse({})),
  logging: LoggingSettingsSchema.default(LoggingSettingsSchema.parse({})),
  discovery: DiscoverySettingsSchema.default(DiscoverySettingsSchema.parse({})),
  mcp: McpSettingsSchema.default(McpSettingsSchema.parse({})),
  rtmp_ingest: RtmpIngestSettingsSchema.default(RtmpIngestSettingsSchema.parse({})),
});

export const StreamersFileSchema = z
  .object({
    streamers: z.array(StreamerSchema).default([]),
    playlists: z.array(PlaylistSchema).default([]),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type StreamerConfig = z.infer<typeof StreamerSchema>;
export type SoundboardSettings = z.infer<typeof SoundboardSettingsSchema>;
export type PlaylistConfig = z.infer<typeof PlaylistSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type SinkSettings = z.infer<typeof SinkSettingsSchema>;
export type AudioSettings = z.infer<typeof AudioSettingsSchema>;
export type WebhooksSettings = z.infer<typeof WebhooksSettingsSchema>;
export type YouTubeAutomationSettings = z.infer<typeof YouTubeAutomationSettingsSchema>;
export type SecondarySinkSettings = z.infer<typeof SecondarySinkSettingsSchema>;
export type RecordingSettings = z.infer<typeof RecordingSettingsSchema>;
export type LoggingSettings = z.infer<typeof LoggingSettingsSchema>;
export type DiscoverySettings = z.infer<typeof DiscoverySettingsSchema>;
export type McpSettings = z.infer<typeof McpSettingsSchema>;
export type RtmpIngestSettings = z.infer<typeof RtmpIngestSettingsSchema>;
export type ChatOverlayConfig = z.infer<typeof ChatOverlaySchema>;
export type ClockOverlayConfig = z.infer<typeof ClockOverlaySchema>;
export type TextOverlayConfig = z.infer<typeof TextOverlaySchema>;
export type SourceSettings = z.infer<typeof SourceSettingsSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join('.') : 'root';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

export type StreamKeySource = 'global' | 'streamer' | 'env' | 'none';

export interface GlobalStreamKeyOverride {
  enabled: boolean;
  key: string;
}

let globalKeyOverride: GlobalStreamKeyOverride = { enabled: false, key: '' };

export function setGlobalStreamKeyOverride(override: GlobalStreamKeyOverride): void {
  globalKeyOverride = {
    enabled: Boolean(override.enabled),
    key: (override.key ?? '').trim(),
  };
}

export function getGlobalStreamKeyOverride(): GlobalStreamKeyOverride {
  return { ...globalKeyOverride };
}

/** Resolve the effective YouTube stream key for a streamer. */
export function resolveStreamKey(
  streamer: Pick<StreamerConfig, 'youtube_key' | 'youtube_key_env'>,
  env: NodeJS.ProcessEnv = process.env,
): { key: string; source: StreamKeySource } {
  if (globalKeyOverride.enabled && globalKeyOverride.key) {
    return { key: globalKeyOverride.key, source: 'global' };
  }
  if (streamer.youtube_key && streamer.youtube_key.trim()) {
    return { key: streamer.youtube_key.trim(), source: 'streamer' };
  }
  const envName = streamer.youtube_key_env?.trim();
  if (envName && env[envName]?.trim()) {
    return { key: env[envName]!.trim(), source: 'env' };
  }
  if (globalKeyOverride.key) {
    return { key: globalKeyOverride.key, source: 'global' };
  }
  if (env.YOUTUBE_STREAM_KEY?.trim()) {
    return { key: env.YOUTUBE_STREAM_KEY.trim(), source: 'env' };
  }
  return { key: '', source: 'none' };
}
