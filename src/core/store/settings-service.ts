import type { Logger } from 'pino';
import { SettingsSchema, formatZodError, type Settings } from '../config/schema.js';
import { ValidationError } from '../../utils/errors.js';
import { readYamlFile, writeYamlFile } from '../../utils/fs.js';
import { deepMerge } from '../../utils/format.js';

export type SanitizedSettings = Omit<
  Settings,
  'online' | 'chat' | 'earnings' | 'overlays' | 'secondary_sink' | 'webhooks'
> & {
  online: Omit<Settings['online'], 'api_key'> & { api_key_set: boolean };
  chat: Omit<Settings['chat'], 'api_key'> & { api_key_set: boolean };
  earnings: Omit<Settings['earnings'], 'api_key'> & { api_key_set: boolean };
  overlays: Omit<Settings['overlays'], 'chat'> & {
    chat: Omit<Settings['overlays']['chat'], 'api_key'> & { api_key_set: boolean };
  };
  secondary_sink: Omit<Settings['secondary_sink'], 'stream_key'> & { stream_key_set: boolean };
  webhooks: Omit<Settings['webhooks'], 'url' | 'secret'> & {
    url_set: boolean;
    url_host: string;
    secret_set: boolean;
  };
};

function safeUrlHost(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).host;
  } catch {
    return '';
  }
}

export class SettingsService {
  private readonly path: string;
  private readonly logger: Logger;
  private current: Settings;

  constructor(path: string, initial: Settings, logger: Logger) {
    this.path = path;
    this.current = structuredClone(initial);
    this.logger = logger;
  }

  get(): Settings {
    return structuredClone(this.current);
  }

  /** Reloads settings from disk (e.g. after a backup restore). */
  reload(): Settings {
    const raw = readYamlFile(this.path);
    const parsed = SettingsSchema.safeParse(raw ?? {});
    if (parsed.success) {
      this.current = parsed.data;
    }
    return this.get();
  }

  /** Settings safe for the API/UI: secrets are replaced by *_set flags. */
  sanitized(): SanitizedSettings {
    const settings = this.get();
    return {
      ...settings,
      online: { ...settings.online, api_key: undefined, api_key_set: Boolean(settings.online.api_key) },
      chat: { ...settings.chat, api_key: undefined, api_key_set: Boolean(settings.chat.api_key) },
      earnings: {
        ...settings.earnings,
        api_key: undefined,
        api_key_set: Boolean(settings.earnings.api_key),
      },
      overlays: {
        ...settings.overlays,
        chat: {
          ...settings.overlays.chat,
          api_key: undefined,
          api_key_set: Boolean(settings.overlays.chat.api_key),
        },
      },
      secondary_sink: {
        ...settings.secondary_sink,
        stream_key: undefined,
        stream_key_set: Boolean(settings.secondary_sink.stream_key),
      },
      webhooks: {
        ...settings.webhooks,
        url: undefined,
        secret: undefined,
        url_set: Boolean(settings.webhooks.url),
        url_host: safeUrlHost(settings.webhooks.url),
        secret_set: Boolean(settings.webhooks.secret),
      },
    } as SanitizedSettings;
  }

  update(patch: unknown): { previous: Settings; next: Settings } {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new ValidationError('Einstellungen müssen ein Objekt sein');
    }
    const clean = stripSecretFlags(patch as Record<string, unknown>);
    const merged = deepMerge(this.get(), clean);
    // An empty/absent api_key keeps the stored secret. Explicit null clears it.
    const raw = patch as Record<string, Record<string, unknown>>;
    if (raw.online && !('api_key' in raw.online)) merged.online.api_key = this.current.online.api_key;
    if (raw.chat && !('api_key' in raw.chat)) merged.chat.api_key = this.current.chat.api_key;
    if (raw.earnings && !('api_key' in raw.earnings)) {
      merged.earnings.api_key = this.current.earnings.api_key;
    }
    if (raw.secondary_sink && !('stream_key' in raw.secondary_sink)) {
      merged.secondary_sink.stream_key = this.current.secondary_sink.stream_key;
    }
    if (raw.webhooks) {
      if (!('url' in raw.webhooks)) merged.webhooks.url = this.current.webhooks.url;
      if (!('secret' in raw.webhooks)) merged.webhooks.secret = this.current.webhooks.secret;
    }
    const parsed = SettingsSchema.safeParse(merged);
    if (!parsed.success) {
      throw new ValidationError(`Ungültige Einstellungen: ${formatZodError(parsed.error)}`, parsed.error.issues);
    }
    const previous = this.current;
    this.current = parsed.data;
    this.persist();
    return { previous, next: this.get() };
  }

  private persist(): void {
    writeYamlFile(this.path, this.current);
    this.logger.info({ file: this.path }, 'Einstellungen gespeichert');
  }
}

function stripSecretFlags(input: Record<string, unknown>): Record<string, unknown> {
  const result = structuredClone(input);
  for (const section of ['online', 'chat', 'earnings']) {
    const value = result[section];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      delete (value as Record<string, unknown>).api_key_set;
    }
  }
  const overlays = result.overlays;
  if (overlays && typeof overlays === 'object' && !Array.isArray(overlays)) {
    const chat = (overlays as Record<string, unknown>).chat;
    if (chat && typeof chat === 'object' && !Array.isArray(chat)) {
      delete (chat as Record<string, unknown>).api_key_set;
    }
  }
  const secondary = result.secondary_sink;
  if (secondary && typeof secondary === 'object' && !Array.isArray(secondary)) {
    delete (secondary as Record<string, unknown>).stream_key_set;
  }
  const webhooks = result.webhooks;
  if (webhooks && typeof webhooks === 'object' && !Array.isArray(webhooks)) {
    delete (webhooks as Record<string, unknown>).url_set;
    delete (webhooks as Record<string, unknown>).url_host;
    delete (webhooks as Record<string, unknown>).secret_set;
  }
  return result;
}

export function readSettingsFile(path: string): unknown {
  return readYamlFile(path);
}
