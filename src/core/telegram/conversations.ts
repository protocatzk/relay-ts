interface Entry {
  flow: string;
  data: Record<string, string>;
  expiresAt: number;
}

/**
 * Tracks guided text-input flows (create streamer, edit playlist, search logs).
 * A flow belongs to exactly one chat/user pair and expires automatically.
 */
export class ConversationStore {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ttlMs = 5 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  start(chatId: number, userId: number, flow: string, data: Record<string, string> = {}): void {
    this.entries.set(this.key(chatId, userId), {
      flow,
      data,
      expiresAt: this.now() + this.ttlMs,
    });
  }

  get(chatId: number, userId: number): { flow: string; data: Record<string, string> } | null {
    const entry = this.entries.get(this.key(chatId, userId));
    if (!entry) return null;
    if (entry.expiresAt < this.now()) {
      this.entries.delete(this.key(chatId, userId));
      return null;
    }
    return { flow: entry.flow, data: { ...entry.data } };
  }

  clear(chatId: number, userId: number): void {
    this.entries.delete(this.key(chatId, userId));
  }

  private key(chatId: number, userId: number): string {
    return `${chatId}:${userId}`;
  }
}
