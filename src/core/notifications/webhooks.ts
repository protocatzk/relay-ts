import { createHmac } from 'node:crypto';
import type { Logger } from 'pino';
import type { WebhookEventType, WebhooksSettings } from '../config/schema.js';
import { incMetric } from '../metrics.js';
import { AppError, ValidationError, toErrorMessage } from '../../utils/errors.js';
import { VERSION } from '../../version.js';

export interface WebhookDispatcherOptions {
  getSettings: () => WebhooksSettings;
  logger: Logger;
  fetcher?: typeof fetch;
  version?: string;
  now?: () => number;
}

const DISCORD_COLORS: Record<WebhookEventType, number> = {
  stream_error: 0xed4245,
  pause_limit: 0xfee75c,
  reconnect_failed: 0xed4245,
  youtube_auth_required: 0xfaa61a,
  disk_warning: 0xfaa61a,
  audio_silence: 0xfee75c,
};

export function buildWebhookPayload(
  format: WebhooksSettings['format'],
  event: WebhookEventType,
  title: string,
  message: string,
  timestamp: string,
  version: string,
  details?: Record<string, unknown>,
): Record<string, unknown> {
  if (format === 'discord') {
    const fields = details
      ? Object.entries(details)
          .filter(([, value]) => value !== undefined && value !== null && value !== '')
          .slice(0, 8)
          .map(([name, value]) => ({
            name,
            value: String(value).slice(0, 256),
            inline: true,
          }))
      : [];
    return {
      username: 'RELAY',
      embeds: [
        {
          title,
          description: message,
          color: DISCORD_COLORS[event] ?? 0x5865f2,
          timestamp,
          fields: [{ name: 'Event', value: event, inline: true }, ...fields],
          footer: { text: `RELAY v${version}` },
        },
      ],
    };
  }
  if (format === 'slack') {
    const extra = details
      ? Object.entries(details)
          .filter(([, value]) => value !== undefined && value !== null && value !== '')
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(' · ')
      : '';
    return {
      text: `[RELAY] *${title}* (${event})\n${message}${extra ? `\n_${extra}_` : ''}`,
    };
  }
  return {
    event,
    title,
    message,
    timestamp,
    version,
    ...(details ? { details } : {}),
  };
}

/**
 * Fault-isolated outbound webhook notifications (#47).
 * Failures or timeouts never disrupt streaming or throw out of `notify()`.
 */
export class WebhookDispatcher {
  private readonly options: WebhookDispatcherOptions;
  private readonly lastSent = new Map<WebhookEventType, number>();

  constructor(options: WebhookDispatcherOptions) {
    this.options = options;
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  notify(
    event: WebhookEventType,
    title: string,
    message: string,
    details?: Record<string, unknown>,
  ): void {
    const settings = this.options.getSettings();
    const url = settings.url.trim();
    if (!settings.enabled || !/^https?:\/\//i.test(url)) return;
    if (!settings.events.includes(event)) return;

    const now = this.now();
    const cooldownMs = Math.max(0, settings.cooldown_seconds) * 1000;
    const previous = this.lastSent.get(event) ?? 0;
    if (cooldownMs > 0 && previous > 0 && now - previous < cooldownMs) return;

    this.lastSent.set(event, now);
    void this.post(settings, url, event, title, message, details).catch((error: unknown) => {
      incMetric('webhook_errors_total');
      this.options.logger.warn(
        { event, err: toErrorMessage(error) },
        'Webhook-Versand fehlgeschlagen',
      );
    });
  }

  async sendTest(): Promise<{ ok: true; status: number }> {
    const settings = this.options.getSettings();
    const url = settings.url.trim();
    if (!/^https?:\/\//i.test(url)) {
      throw new ValidationError('Keine gültige Webhook-URL konfiguriert (http:// oder https://)');
    }
    try {
      const status = await this.post(
        settings,
        url,
        'stream_error',
        'Test-Benachrichtigung',
        'Dieser Test-Webhook bestätigt die Verbindung von RELAY.',
        { test: true },
      );
      return { ok: true, status };
    } catch (error) {
      incMetric('webhook_errors_total');
      if (error instanceof AppError) throw error;
      throw new AppError('webhook_failed', `Webhook fehlgeschlagen: ${toErrorMessage(error)}`, 502);
    }
  }

  private async post(
    settings: WebhooksSettings,
    url: string,
    event: WebhookEventType,
    title: string,
    message: string,
    details?: Record<string, unknown>,
  ): Promise<number> {
    const fetcher = this.options.fetcher ?? fetch;
    const version = this.options.version ?? VERSION;
    const timestamp = new Date(this.now()).toISOString();
    const payload = buildWebhookPayload(
      settings.format,
      event,
      title,
      message,
      timestamp,
      version,
      details,
    );
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': `RELAY/${version}`,
    };
    const secret = settings.secret.trim();
    if (secret) {
      const sig = createHmac('sha256', secret).update(body).digest('hex');
      headers['x-relay-signature'] = `sha256=${sig}`;
    }
    const response = await fetcher(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new AppError('webhook_failed', `HTTP ${response.status}`, 502);
    }
    return response.status;
  }
}
