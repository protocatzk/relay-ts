import type { LogRing, Logger } from '../utils/logger.js';
import type { LoadedConfig } from '../core/config/loader.js';
import type { EventBus } from '../core/events.js';
import type { SettingsService } from '../core/store/settings-service.js';
import type { StreamerStore } from '../core/store/streamer-store.js';
import type { Supervisor } from '../core/supervisor/supervisor.js';

export interface ApiContext {
  config: LoadedConfig;
  logger: Logger;
  store: StreamerStore;
  settingsService: SettingsService;
  supervisor: Supervisor;
  bus: EventBus;
  ring: LogRing;
  version: string;
}
