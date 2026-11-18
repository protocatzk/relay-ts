import { randomBytes } from 'node:crypto';

interface Entry {
  value: string;
  type: string;
  expiresAt: number;
}

/**
 * Short opaque references for callback_data. Telegram limits callback payloads
 * to 64 bytes; streamer, playlist and broadcast ids can be longer, so buttons
 * carry a compact ref instead of the real id.
 */
export class RefStore {
  private readonly byKey = new Map<string, string>();
  private readonly byRef = new Map<string, Entry>();

  constructor(
    private readonly ttlMs = 30 * 60 * 1000,
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {}

  get(type: string, value: string): string {
    this.cleanup();
    const key = `${type}:${value}`;
    const existing = this.byKey.get(key);
    if (existing && this.byRef.has(existing)) return existing;
    if (this.byRef.size >= this.maxEntries) {
      const oldest = [...this.byRef.entries()].sort(
        (a, b) => a[1].expiresAt - b[1].expiresAt,
      )[0];
      if (oldest) {
        this.byRef.delete(oldest[0]);
        this.byKey.delete(`${oldest[1].type}:${oldest[1].value}`);
      }
    }
    const ref = randomBytes(6).toString('hex');
    this.byRef.set(ref, { value, type, expiresAt: this.now() + this.ttlMs });
    this.byKey.set(key, ref);
    return ref;
  }

  resolve(ref: string, type?: string): string | null {
    this.cleanup();
    const entry = this.byRef.get(ref);
    if (!entry) return null;
    if (type && entry.type !== type) return null;
    return entry.value;
  }

  forget(type: string, value: string): void {
    const key = `${type}:${value}`;
    const ref = this.byKey.get(key);
    if (ref) this.byRef.delete(ref);
    this.byKey.delete(key);
  }

  private cleanup(): void {
    const cutoff = this.now();
    for (const [ref, entry] of this.byRef) {
      if (entry.expiresAt < cutoff) {
        this.byRef.delete(ref);
        this.byKey.delete(`${entry.type}:${entry.value}`);
      }
    }
  }
}
