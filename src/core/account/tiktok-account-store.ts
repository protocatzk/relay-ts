import { existsSync, readFileSync } from 'node:fs';
import type { Logger } from 'pino';
import { z } from 'zod';
import { writeFileAtomic } from '../../utils/fs.js';
import { ensureCookieFile } from '../config/loader.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

export const TikTokAccountSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(100),
  username: z.string().max(100).default(''),
  sessionId: z.string().min(1).max(500),
  targetIdc: z.string().max(50).default(''),
  active: z.boolean().default(false),
  created_at: z.string().datetime().default(() => new Date().toISOString()),
});

export type TikTokAccount = z.infer<typeof TikTokAccountSchema>;

export interface TikTokAccountPublic {
  id: string;
  label: string;
  username: string;
  targetIdc: string;
  active: boolean;
  has_cookie: boolean;
  created_at: string;
}

export interface TikTokAccountStoreOptions {
  filePath: string;
  cookiesFile: string;
  logger: Logger;
  initialSessionId?: string;
  initialTargetIdc?: string;
}

export class TikTokAccountStore {
  private readonly filePath: string;
  private readonly cookiesFile: string;
  private readonly logger: Logger;
  private accounts: TikTokAccount[] = [];

  constructor(options: TikTokAccountStoreOptions) {
    this.filePath = options.filePath;
    this.cookiesFile = options.cookiesFile;
    this.logger = options.logger;
    this.load(options.initialSessionId, options.initialTargetIdc);
  }

  private load(fallbackSessionId?: string, fallbackTargetIdc?: string): void {
    if (existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.accounts = parsed
            .map((item) => {
              const res = TikTokAccountSchema.safeParse(item);
              return res.success ? res.data : null;
            })
            .filter((acc): acc is TikTokAccount => acc !== null);
        }
      } catch (err) {
        this.logger.warn({ err }, 'Konnte tiktok-accounts.json nicht parsen');
      }
    }

    // Falls noch kein Account existiert, aber media.tiktokSessionId vorhanden ist, initialen anlegen
    if (this.accounts.length === 0 && fallbackSessionId) {
      const initial: TikTokAccount = {
        id: 'default',
        label: 'Standard Account',
        username: '',
        sessionId: fallbackSessionId,
        targetIdc: fallbackTargetIdc || '',
        active: true,
        created_at: new Date().toISOString(),
      };
      this.accounts.push(initial);
      this.persist();
      ensureCookieFile(this.cookiesFile, initial.sessionId, initial.targetIdc);
    }
  }

  private persist(): void {
    try {
      writeFileAtomic(this.filePath, JSON.stringify(this.accounts, null, 2), 0o600);
    } catch (err) {
      this.logger.error({ err }, 'Fehler beim Speichern von tiktok-accounts.json');
    }
  }

  list(): TikTokAccountPublic[] {
    return this.accounts.map((acc) => ({
      id: acc.id,
      label: acc.label,
      username: acc.username,
      targetIdc: acc.targetIdc,
      active: acc.active,
      has_cookie: Boolean(acc.sessionId),
      created_at: acc.created_at,
    }));
  }

  getActive(): TikTokAccount | null {
    return this.accounts.find((acc) => acc.active) ?? this.accounts[0] ?? null;
  }

  create(input: { label: string; sessionId: string; targetIdc?: string; username?: string }): TikTokAccountPublic {
    const id = `acc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const parsed = TikTokAccountSchema.safeParse({
      id,
      label: input.label.trim(),
      username: (input.username || '').trim(),
      sessionId: input.sessionId.trim(),
      targetIdc: (input.targetIdc || '').trim(),
      active: this.accounts.length === 0,
      created_at: new Date().toISOString(),
    });

    if (!parsed.success) {
      throw new ValidationError('Ungültige Account-Daten');
    }

    this.accounts.push(parsed.data);
    if (parsed.data.active) {
      ensureCookieFile(this.cookiesFile, parsed.data.sessionId, parsed.data.targetIdc);
    }
    this.persist();

    return {
      id: parsed.data.id,
      label: parsed.data.label,
      username: parsed.data.username,
      targetIdc: parsed.data.targetIdc,
      active: parsed.data.active,
      has_cookie: true,
      created_at: parsed.data.created_at,
    };
  }

  activate(id: string): TikTokAccountPublic {
    const acc = this.accounts.find((a) => a.id === id);
    if (!acc) {
      throw new NotFoundError(`TikTok Account ${id} nicht gefunden`);
    }

    for (const a of this.accounts) {
      a.active = a.id === id;
    }

    ensureCookieFile(this.cookiesFile, acc.sessionId, acc.targetIdc);
    this.persist();

    this.logger.info({ id: acc.id, label: acc.label }, 'TikTok-Account gewechselt');

    return {
      id: acc.id,
      label: acc.label,
      username: acc.username,
      targetIdc: acc.targetIdc,
      active: true,
      has_cookie: true,
      created_at: acc.created_at,
    };
  }

  remove(id: string): void {
    const index = this.accounts.findIndex((a) => a.id === id);
    if (index === -1) {
      throw new NotFoundError(`TikTok Account ${id} nicht gefunden`);
    }

    const wasActive = this.accounts[index]!.active;
    this.accounts.splice(index, 1);

    if (wasActive && this.accounts.length > 0) {
      this.accounts[0]!.active = true;
      ensureCookieFile(this.cookiesFile, this.accounts[0]!.sessionId, this.accounts[0]!.targetIdc);
    }

    this.persist();
  }
}
