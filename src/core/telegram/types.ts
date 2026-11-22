import type { Logger } from 'pino';
import type { LogEntry } from '../../utils/logger.js';
import type { QueueSnapshot, StatusSnapshot } from '../events.js';
import type { TelegramAuthStore } from './auth-store.js';

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  date?: number;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: {
    retry_after?: number;
  };
}

export interface TelegramWebAppInfo {
  url: string;
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: TelegramWebAppInfo;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
  [key: string]: unknown;
}

export interface TelegramReplyKeyboardMarkup {
  keyboard: Array<Array<{ text: string }>>;
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
}

export interface TelegramReplyKeyboardRemove {
  remove_keyboard: true;
}

export interface TelegramBotCommand {
  command: string;
  description: string;
}

export type TelegramMenuButton =
  | { type: 'default' }
  | { type: 'commands' }
  | { type: 'web_app'; text: string; web_app: TelegramWebAppInfo };

export type TelegramChatAction =
  | 'typing'
  | 'upload_photo'
  | 'record_video'
  | 'upload_video'
  | 'record_voice'
  | 'upload_voice'
  | 'upload_document'
  | 'choose_sticker'
  | 'find_location'
  | 'record_video_note'
  | 'upload_video_note';

export interface TelegramInputMediaPhoto {
  type: 'photo';
  media: string;
  caption?: string;
  parse_mode?: 'HTML' | 'MarkdownV2';
}

export interface TelegramStreamerSummary {
  id: string;
  name: string;
  tiktok: string;
  quality?: string;
  enabled: boolean;
  youtube_key_set?: boolean;
  status: { online: boolean | null; active: boolean };
}

export interface TelegramPlaylistSummary {
  id: string;
  name: string;
  channels: string[];
  active: boolean;
  index: number | null;
  auto_advance?: boolean;
  wrap?: boolean;
}

export interface TelegramSettingsSummary {
  delay_seconds: number;
  pause_enabled: boolean;
  pause_max_minutes: number;
  pause_grace_seconds: number;
  startup_enabled: boolean;
  startup_seconds: number;
  auto_reconnect: boolean;
  auto_refresh_minutes: number;
  earnings_period: string;
  earnings_view: string;
  youtube_auto_transition: boolean;
  overlay_chat: boolean;
  overlay_clock: boolean;
  overlay_text: boolean;
}

export interface TelegramSessionInfo {
  id: string;
  user: string;
  provider: string;
  last_seen_at: string;
}

export interface TelegramMediaInfo {
  filename: string;
  size: number;
}

export interface TelegramYouTubeBroadcast {
  id: string;
  title: string;
  status: string;
  privacy: string;
  scheduled_start: string | null;
}

export interface TelegramEarnings {
  period_label: string;
  currency: string;
  net: number | null;
  coins: number | null;
  viewers: number | null;
  gifts: number | null;
  updated_at: string | null;
}

export interface TelegramControl {
  status(): StatusSnapshot;
  streamers(): TelegramStreamerSummary[];
  playlists(): TelegramPlaylistSummary[];
  start(streamerId: string): Promise<unknown>;
  stop(): Promise<unknown>;
  playlistNext(): Promise<unknown>;
  playlistPrevious(): Promise<unknown>;
  pause(): Promise<unknown>;
  resume(): Promise<unknown>;
  logs(limit: number): LogEntry[];
  queryLogs?(filter: {
    limit?: number;
    level?: 'debug' | 'info' | 'warn' | 'error';
    q?: string;
  }): LogEntry[];
  mediaDelete?(filename: string): Promise<unknown>;
  settings?(): TelegramSettingsSummary;
  sessions?(): TelegramSessionInfo[];
  revokeSession?(id: string): boolean;
  revokeAllSessions?(): number;
  media?(): TelegramMediaInfo[];
  earnings?(): TelegramEarnings | null;
  youtubeStatus?(): { connected: boolean; channel_title: string };
  youtubeBroadcasts?(): Promise<TelegramYouTubeBroadcast[]>;
  youtubeTransition?(id: string, status: 'live' | 'complete'): Promise<unknown>;
  youtubePublish?(id: string): Promise<unknown>;
  youtubeUpdateTitle?(id: string, title: string): Promise<unknown>;
  titleTemplate?(): string;
  showScreen?(type: 'startup' | 'pause'): Promise<unknown>;
  hideScreen?(): Promise<unknown>;
  toggleOverlay?(key: 'chat' | 'clock' | 'text'): Promise<unknown>;
  setEarningsPeriod?(period: 'today' | '24h' | '7d' | '30d' | 'all'): Promise<unknown>;
  streamerCreate?(input: Record<string, unknown>): unknown | Promise<unknown>;
  streamerUpdate?(id: string, patch: Record<string, unknown>): unknown | Promise<unknown>;
  streamerDelete?(id: string): Promise<unknown>;
  playlistCreate?(input: Record<string, unknown>): unknown | Promise<unknown>;
  playlistUpdate?(id: string, patch: Record<string, unknown>): unknown | Promise<unknown>;
  playlistDelete?(id: string): Promise<unknown>;
  playlistPlay?(id: string): Promise<unknown>;
  settingsUpdate?(patch: Record<string, unknown>): Promise<unknown>;
  youtubeCreate?(input: {
    title: string;
    scheduled_start: string;
    privacy: 'public' | 'unlisted' | 'private';
    streamer_id?: string;
  }): Promise<unknown>;
  youtubeAssign?(id: string, streamerId: string): Promise<unknown>;
  scenes?(): { id: string; name: string; active: boolean }[];
  activateScene?(id: string): Promise<unknown>;
  addMarker?(label?: string): Promise<{ id: string; label: string; offset_seconds: number } | null> | { id: string; label: string; offset_seconds: number } | null;
  previewFrame?(): Promise<Buffer | null>;
  queue?(): QueueSnapshot;
  queuePlay?(index?: number): Promise<unknown>;
  queueNext?(): Promise<unknown>;
  queueStop?(): Promise<unknown>;
  queueRemove?(id: string): Promise<unknown>;
  queueSeek?(seconds: number): Promise<unknown>;
  queuePlayNow?(channel: string): Promise<unknown>;
  clip?(filename: string, start: number, end: number, label: string): Promise<unknown>;
}

export interface TelegramBotOptions {
  token: string;
  allowedUserIds: number[];
  /** Public dashboard base URL for links and Telegram Web App menu buttons. */
  dashboardUrl?: string;
  auth: TelegramAuthStore;
  logger: Logger;
}
