import type { LogRing, Logger } from '../utils/logger.js';
import type { LoadedConfig } from '../core/config/loader.js';
import type { EventBus } from '../core/events.js';
import type { SettingsService } from '../core/store/settings-service.js';
import type { StreamerStore } from '../core/store/streamer-store.js';
import type { Supervisor } from '../core/supervisor/supervisor.js';
import type { TelegramAuthStore } from '../core/telegram/auth-store.js';
import type { TelegramBot } from '../core/telegram/bot.js';
import type { YouTubeAuthService } from '../core/youtube/service.js';
import type { AuthSessionStore } from './session-store.js';
import type { TotpStore } from './totp-store.js';

export interface ApiContext {
  config: LoadedConfig;
  logger: Logger;
  store: StreamerStore;
  settingsService: SettingsService;
  supervisor: Supervisor;
  bus: EventBus;
  ring: LogRing;
  version: string;
  authSessions: AuthSessionStore;
  totp?: TotpStore;
  telegramAuth?: TelegramAuthStore;
  telegramBot?: TelegramBot | null;
  youtubeAuth?: YouTubeAuthService;
}
