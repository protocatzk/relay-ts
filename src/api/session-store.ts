import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { writeJsonFile } from '../utils/fs.js';

export type AuthProvider = 'password' | 'telegram';

export interface AuthSession {
  id: string;
  user: string;
  provider: AuthProvider;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 100;

/**
 * Server-side dashboard sessions. The browser only holds the signed session
 * id; removing an entry invalidates the cookie immediately.
 *
 * Sessions survive restarts through a 0600 JSON file. Expired entries are
 * removed on load and on access.
 */
export class AuthSessionStore {
  private readonly sessions = new Map<string, AuthSession>();
  private readonly ttlMs: number;
  private readonly path?: string;

  constructor(path?: string, ttlMs = DEFAULT_TTL_MS) {
    this.path = path;
    this.ttlMs = ttlMs;
    this.load();
  }

  create(user: string, provider: AuthProvider): AuthSession {
    this.cleanup();
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = [...this.sessions.values()].sort((a, b) => a.lastSeenAt - b.lastSeenAt)[0];
      if (oldest) this.sessions.delete(oldest.id);
    }
    const now = Date.now();
    const session: AuthSession = {
      id: randomBytes(32).toString('hex'),
      user: user || 'Dashboard',
      provider,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.sessions.set(session.id, session);
    this.persist();
    return { ...session };
  }

  get(id: string | null | undefined): AuthSession | null {
    if (!id) return null;
    this.cleanup();
    const session = this.sessions.get(id);
    if (!session) return null;
    session.lastSeenAt = Date.now();
    return { ...session };
  }

  revoke(id: string | null | undefined): boolean {
    if (!id) return false;
    const deleted = this.sessions.delete(id);
    if (deleted) this.persist();
    return deleted;
  }

  revokeAll(exceptId?: string): number {
    let removed = 0;
    for (const id of this.sessions.keys()) {
      if (id === exceptId) continue;
      this.sessions.delete(id);
      removed += 1;
    }
    if (removed > 0) this.persist();
    return removed;
  }

  list(): AuthSession[] {
    this.cleanup();
    return [...this.sessions.values()]
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map((session) => ({ ...session }));
  }

  get size(): number {
    this.cleanup();
    return this.sessions.size;
  }

  private cleanup(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(id);
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  private load(): void {
    if (!this.path || !existsSync(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as unknown;
      if (!Array.isArray(raw)) return;
      const now = Date.now();
      for (const candidate of raw) {
        if (!candidate || typeof candidate !== 'object') continue;
        const session = candidate as AuthSession;
        if (
          typeof session.id !== 'string' ||
          typeof session.user !== 'string' ||
          typeof session.expiresAt !== 'number' ||
          session.expiresAt <= now
        ) {
          continue;
        }
        this.sessions.set(session.id, {
          id: session.id,
          user: session.user,
          provider: session.provider === 'telegram' ? 'telegram' : 'password',
          createdAt: typeof session.createdAt === 'number' ? session.createdAt : now,
          lastSeenAt: typeof session.lastSeenAt === 'number' ? session.lastSeenAt : now,
          expiresAt: session.expiresAt,
        });
      }
    } catch {
      /* a corrupt session file is treated as logged out */
    }
  }

  private persist(): void {
    if (!this.path) return;
    try {
      const sessions = [...this.sessions.values()]
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
        .map((session) => ({ ...session }));
      writeJsonFile(this.path, sessions);
    } catch {
      /* session persistence is best-effort; memory remains authoritative */
    }
  }
}
