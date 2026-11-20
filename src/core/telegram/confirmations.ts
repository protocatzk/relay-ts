import { randomBytes } from 'node:crypto';

export type PendingAction =
  | { type: 'stop' }
  | { type: 'revoke-session'; id: string }
  | { type: 'revoke-all-sessions' }
  | { type: 'youtube-transition'; id: string; status: 'live' | 'complete' }
  | { type: 'youtube-publish'; id: string }
  | { type: 'youtube-title'; id: string; title: string }
  | { type: 'playlist-remove-channel'; id: string; index: number }
  | { type: 'media-delete'; filename: string }
  | { type: 'streamer-delete'; id: string }
  | { type: 'playlist-delete'; id: string };

interface Entry {
  action: PendingAction;
  chatId: number;
  userId: number;
  expiresAt: number;
}

/**
 * Short-lived, single-use confirmations for destructive Telegram actions.
 * Nonces are bound to the chat and user, so forwarding a message to another
 * account cannot execute the action.
 */
export class ConfirmationStore {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ttlMs = 60_000,
    private readonly maxEntries = 200,
    private readonly now: () => number = Date.now,
  ) {}

  create(chatId: number, userId: number, action: PendingAction): string {
    this.cleanup();
    if (this.entries.size >= this.maxEntries) {
      const oldest = [...this.entries.entries()].sort(
        (a, b) => a[1].expiresAt - b[1].expiresAt,
      )[0];
      if (oldest) this.entries.delete(oldest[0]);
    }
    const nonce = randomBytes(12).toString('hex');
    this.entries.set(nonce, {
      action,
      chatId,
      userId,
      expiresAt: this.now() + this.ttlMs,
    });
    return nonce;
  }

  /** Consumes a nonce; returns null for expired, reused or foreign callbacks. */
  consume(nonce: string, chatId: number, userId: number): PendingAction | null {
    const entry = this.entries.get(nonce);
    if (!entry) return null;
    if (entry.expiresAt < this.now()) {
      this.entries.delete(nonce);
      return null;
    }
    // A foreign chat/user must not be able to burn the legitimate nonce.
    if (entry.chatId !== chatId || entry.userId !== userId) return null;
    this.entries.delete(nonce);
    return entry.action;
  }

  cancel(nonce: string, chatId: number, userId: number): boolean {
    const entry = this.entries.get(nonce);
    if (!entry) return false;
    this.entries.delete(nonce);
    return entry.chatId === chatId && entry.userId === userId;
  }

  private cleanup(): void {
    const cutoff = this.now();
    for (const [nonce, entry] of this.entries) {
      if (entry.expiresAt < cutoff) this.entries.delete(nonce);
    }
  }
}
