import { randomBytes } from 'node:crypto';

export * from './webapp.js';

export type TelegramAuthStatus = 'pending' | 'approved' | 'denied';

export interface PendingTelegramAuth {
  token: string;
  createdAt: number;
  status: TelegramAuthStatus;
  user: string;
  clientInfo: string;
}

/**
 * Short-lived browser login tokens that are approved from the Telegram bot.
 * One process handles both the bot and the web app, so an in-memory map is
 * sufficient. Sessions themselves are stateless (signed HttpOnly cookie).
 */
export class TelegramAuthStore {
  static readonly TOKEN_TTL_MS = 10 * 60 * 1000;
  static readonly MAX_PENDING = 100;

  private tokens = new Map<string, PendingTelegramAuth>();

  create(clientInfo: string): PendingTelegramAuth {
    this.cleanup();
    if (this.tokens.size >= TelegramAuthStore.MAX_PENDING) {
      const oldest = [...this.tokens.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
      if (oldest) this.tokens.delete(oldest.token);
    }
    const token = randomBytes(16).toString('hex');
    const entry: PendingTelegramAuth = {
      token,
      createdAt: Date.now(),
      status: 'pending',
      user: '',
      clientInfo: clientInfo.slice(0, 120),
    };
    this.tokens.set(token, entry);
    return { ...entry };
  }

  get(token: string): PendingTelegramAuth | null {
    this.cleanup();
    const entry = this.tokens.get(token);
    return entry ? { ...entry } : null;
  }

  approve(token: string, user: string): boolean {
    this.cleanup();
    const entry = this.tokens.get(token);
    if (!entry || entry.status !== 'pending') return false;
    entry.status = 'approved';
    entry.user = user || 'Telegram';
    return true;
  }

  deny(token: string): boolean {
    this.cleanup();
    const entry = this.tokens.get(token);
    if (!entry || entry.status !== 'pending') return false;
    entry.status = 'denied';
    return true;
  }

  delete(token: string): void {
    this.tokens.delete(token);
  }

  private cleanup(): void {
    const cutoff = Date.now() - TelegramAuthStore.TOKEN_TTL_MS;
    for (const [token, entry] of this.tokens) {
      if (entry.createdAt < cutoff) this.tokens.delete(token);
    }
  }
}
