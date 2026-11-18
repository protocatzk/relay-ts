import type { Logger } from 'pino';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { writeJsonFile } from '../../utils/fs.js';

export interface YouTubeTokens {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
  /** Epoch milliseconds. */
  expiry_date: number;
}

export interface YouTubeAccount {
  channel_id: string;
  channel_title: string;
}

export interface YouTubeAuthRecord {
  version: 1;
  account: YouTubeAccount;
  tokens: YouTubeTokens;
  connected_at: string;
  updated_at: string;
}

/**
 * Persists the single linked YouTube account. Tokens are stored in plain text
 * with mode 0600 inside the container-only `data/` directory; they are never
 * logged or returned by the API.
 */
export class YouTubeAuthStore {
  constructor(
    private readonly file: string,
    private readonly logger: Logger,
  ) {}

  read(): YouTubeAuthRecord | null {
    if (!existsSync(this.file)) return null;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      return this.validate(raw);
    } catch {
      this.logger.warn({ file: this.file }, 'YouTube-Token-Datei ist unlesbar');
      return null;
    }
  }

  write(record: YouTubeAuthRecord): void {
    writeJsonFile(this.file, record);
  }

  clear(): boolean {
    if (!existsSync(this.file)) return false;
    try {
      rmSync(this.file, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  private validate(raw: unknown): YouTubeAuthRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const value = raw as Partial<YouTubeAuthRecord>;
    const tokens = value.tokens;
    if (!tokens || typeof tokens !== 'object') return null;
    if (typeof tokens.access_token !== 'string' || !tokens.access_token) return null;
    if (typeof tokens.refresh_token !== 'string' || !tokens.refresh_token) return null;
    if (typeof tokens.expiry_date !== 'number' || !Number.isFinite(tokens.expiry_date)) return null;
    const account = value.account ?? { channel_id: '', channel_title: '' };
    return {
      version: 1,
      account: {
        channel_id: typeof account.channel_id === 'string' ? account.channel_id : '',
        channel_title: typeof account.channel_title === 'string' ? account.channel_title : '',
      },
      tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        scope: typeof tokens.scope === 'string' ? tokens.scope : '',
        token_type: typeof tokens.token_type === 'string' ? tokens.token_type : 'Bearer',
        expiry_date: tokens.expiry_date,
      },
      connected_at: typeof value.connected_at === 'string' ? value.connected_at : '',
      updated_at: typeof value.updated_at === 'string' ? value.updated_at : '',
    };
  }
}
