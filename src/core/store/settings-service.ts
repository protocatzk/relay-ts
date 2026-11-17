import type { Logger } from 'pino';
import { SettingsSchema, formatZodError, type Settings } from '../config/schema.js';
import { ValidationError } from '../../utils/errors.js';
import { readYamlFile, writeYamlFile } from '../../utils/fs.js';
import { deepMerge } from '../../utils/format.js';

export type SanitizedSettings = Omit<Settings, 'online' | 'chat' | 'earnings'> & {
  online: Omit<Settings['online'], 'api_key'> & { api_key_set: boolean };
  chat: Omit<Settings['chat'], 'api_key'> & { api_key_set: boolean };
  earnings: Omit<Settings['earnings'], 'api_key'> & { api_key_set: boolean };
};

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
  return result;
}

export function readSettingsFile(path: string): unknown {
  return readYamlFile(path);
}
