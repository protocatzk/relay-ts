import type { Logger } from 'pino';
import { existsSync } from 'node:fs';
import { readJsonFile, writeJsonFile } from '../../utils/fs.js';

export interface TelegramNotifySettings {
  enabled: boolean;
  live: boolean;
  reconnect: boolean;
  error: boolean;
}

export type NotifyCategory = Exclude<keyof TelegramNotifySettings, 'enabled'>;

export const DEFAULT_NOTIFY_SETTINGS: TelegramNotifySettings = {
  enabled: true,
  live: true,
  reconnect: true,
  error: true,
};

/** Persisted per-category notification switches for the Telegram bot. */
export class TelegramNotifyStore {
  private readonly path: string | null;
  private readonly logger: Logger;
  private settings: TelegramNotifySettings;
  private loaded = false;

  constructor(
    path: string | null,
    initial: TelegramNotifySettings,
    logger: Logger,
  ) {
    this.path = path;
    this.settings = { ...initial };
    this.logger = logger;
  }

  get(): TelegramNotifySettings {
    this.load();
    return { ...this.settings };
  }

  update(patch: Partial<TelegramNotifySettings>): TelegramNotifySettings {
    this.load();
    this.settings = { ...this.settings, ...patch };
    this.persist();
    return this.get();
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.path || !existsSync(this.path)) return;
    const raw = readJsonFile<Partial<TelegramNotifySettings> | null>(this.path, null);
    if (!raw || typeof raw !== 'object') return;
    for (const key of ['enabled', 'live', 'reconnect', 'error'] as const) {
      if (typeof raw[key] === 'boolean') this.settings[key] = raw[key];
    }
  }

  private persist(): void {
    if (!this.path) return;
    try {
      writeJsonFile(this.path, this.settings);
    } catch (error) {
      this.logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'Telegram-Benachrichtigungen konnten nicht gespeichert werden',
      );
    }
  }
}
