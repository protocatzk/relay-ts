import type { Logger } from 'pino';
import type { Settings } from '../config/schema.js';

export interface AutoRefreshOptions {
  settings: Settings;
  logger: Logger;
  onRefresh: () => Promise<void>;
}

/**
 * Periodically re-resolves the TikTok URL. TikTok stream URLs expire after a
 * while; refreshing before that happens avoids a visible outage.
 */
export class AutoRefresh {
  private options: AutoRefreshOptions;
  private timer?: NodeJS.Timeout;
  private nextAt: number | null = null;
  private count = 0;
  private lastRefreshAt: Date | null = null;
  private running = false;

  constructor(options: AutoRefreshOptions) {
    this.options = options;
  }

  start(): void {
    this.stop();
    if (!this.options.settings.auto_refresh.enabled) {
      this.options.logger.info('Auto-Refresh deaktiviert');
      return;
    }
    this.schedule();
    this.options.logger.info(
      { intervalMinutes: this.options.settings.auto_refresh.interval },
      'Auto-Refresh gestartet',
    );
  }

  private schedule(): void {
    const intervalMs = Math.max(1, this.options.settings.auto_refresh.interval) * 60_000;
    this.nextAt = Date.now() + intervalMs;
    this.timer = setTimeout(() => void this.fire(), intervalMs);
  }

  private async fire(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.timer = undefined;
    try {
      this.count += 1;
      await this.options.onRefresh();
      this.lastRefreshAt = new Date();
    } catch (error) {
      this.options.logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'Auto-Refresh fehlgeschlagen',
      );
    } finally {
      this.running = false;
      if (this.options.settings.auto_refresh.enabled) this.schedule();
    }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.nextAt = null;
  }

  updateSettings(settings: Settings): void {
    const previous = this.options.settings;
    this.options.settings = settings;
    if (
      previous.auto_refresh.enabled !== settings.auto_refresh.enabled ||
      previous.auto_refresh.interval !== settings.auto_refresh.interval
    ) {
      this.start();
    }
  }

  markRefreshed(): void {
    this.lastRefreshAt = new Date();
  }

  stats(): {
    enabled: boolean;
    intervalMinutes: number;
    nextRefreshInSeconds: number | null;
    lastRefreshAt: Date | null;
    count: number;
  } {
    return {
      enabled: this.options.settings.auto_refresh.enabled,
      intervalMinutes: this.options.settings.auto_refresh.interval,
      nextRefreshInSeconds: this.nextAt ? Math.max(0, Math.round((this.nextAt - Date.now()) / 1000)) : null,
      lastRefreshAt: this.lastRefreshAt,
      count: this.count,
    };
  }
}
