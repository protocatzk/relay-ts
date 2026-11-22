import {
  existsSync,
  readFileSync,
} from 'node:fs';
import { appendFile, chmod, rename, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ensureDir } from '../utils/fs.js';

export type AuditSource = 'web' | 'api' | 'telegram' | 'system' | 'mcp' | 'agent';
export type AuditResult = 'ok' | 'error';

export interface AuditEntry {
  time: string;
  actor: string;
  source: AuditSource;
  action: string;
  target: string | null;
  result: AuditResult;
  detail?: string;
}

export interface AuditQuery {
  actor?: string;
  action?: string;
  source?: AuditSource;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface AuditQueryResult {
  entries: AuditEntry[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
  actors: string[];
  actions: string[];
}

export interface AuditStoreOptions {
  maxBytes?: number;
  maxFiles?: number;
  redact?: (text: string) => string;
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2 MiB per JSONL file
const DEFAULT_MAX_FILES = 3;

/**
 * Append-only JSONL audit trail (`data/audit.jsonl`, mode 0600) with size-based
 * rotation and secret redaction.
 */
export class AuditLogStore {
  private readonly path?: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly redact: (text: string) => string;
  private readonly memory: AuditEntry[] = [];
  private readonly writeQueue: AuditEntry[] = [];
  private writePromise: Promise<void> = Promise.resolve();

  constructor(path?: string, options: AuditStoreOptions = {}) {
    this.path = path;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    this.redact = options.redact ?? ((value) => value);
  }

  record(input: Omit<AuditEntry, 'time'> & { time?: string }): AuditEntry {
    const entry: AuditEntry = {
      time: input.time ?? new Date().toISOString(),
      actor: this.sanitize(input.actor, 120) || 'unknown',
      source: input.source,
      action: this.sanitize(input.action, 80) || 'unknown',
      target: input.target ? this.sanitize(input.target, 160) : null,
      result: input.result,
      ...(input.detail ? { detail: this.sanitize(input.detail, 240) } : {}),
    };

    if (!this.path) {
      this.memory.push(entry);
      if (this.memory.length > 2000) {
        this.memory.splice(0, this.memory.length - 2000);
      }
      return entry;
    }

    this.writeQueue.push(entry);
    this.writePromise = this.writePromise.then(async () => {
      if (!this.path) return;
      try {
        ensureDir(dirname(this.path));
        await this.rotateIfNeededAsync();
        await appendFile(this.path, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
        try {
          await chmod(this.path, 0o600);
        } catch {
          /* best effort on non-POSIX mounts */
        }
      } catch {
        /* audit write failures must never break stream control */
        this.memory.push(entry);
      } finally {
        const idx = this.writeQueue.indexOf(entry);
        if (idx !== -1) this.writeQueue.splice(idx, 1);
      }
    });
    return entry;
  }

  async flush(): Promise<void> {
    await this.writePromise;
  }

  query(filter: AuditQuery = {}): AuditQueryResult {
    const all = this.loadAllNewestFirst();
    const actors = [...new Set(all.map((entry) => entry.actor))].sort();
    const actions = [...new Set(all.map((entry) => entry.action))].sort();

    const actorFilter = filter.actor?.trim().toLowerCase();
    const actionFilter = filter.action?.trim().toLowerCase();
    const textFilter = filter.q?.trim().toLowerCase();

    const matched = all.filter((entry) => {
      if (filter.source && entry.source !== filter.source) return false;
      if (actorFilter && entry.actor.toLowerCase() !== actorFilter) return false;
      if (actionFilter && entry.action.toLowerCase() !== actionFilter) return false;
      if (textFilter) {
        const haystack =
          `${entry.actor} ${entry.action} ${entry.target ?? ''} ${entry.detail ?? ''}`.toLowerCase();
        if (!haystack.includes(textFilter)) return false;
      }
      return true;
    });

    const limit = Math.min(500, Math.max(1, filter.limit ?? 100));
    const offset = Math.max(0, filter.offset ?? 0);
    const entries = matched.slice(offset, offset + limit);

    return {
      entries,
      total: matched.length,
      offset,
      limit,
      has_more: offset + entries.length < matched.length,
      actors,
      actions,
    };
  }

  private sanitize(value: string, maxLen: number): string {
    return this.redact(value).replace(/[\r\n]+/g, ' ').trim().slice(0, maxLen);
  }

  private async rotateIfNeededAsync(): Promise<void> {
    if (!this.path || !existsSync(this.path)) return;
    let size: number;
    try {
      const s = await stat(this.path);
      size = s.size;
    } catch {
      return;
    }
    if (size < this.maxBytes) return;

    for (let index = this.maxFiles; index >= 1; index -= 1) {
      const target = `${this.path}.${index}`;
      const source = index === 1 ? this.path : `${this.path}.${index - 1}`;
      if (!existsSync(source)) continue;
      if (index === this.maxFiles && existsSync(target)) {
        try {
          await unlink(target);
        } catch {
          /* ignore */
        }
      }
      try {
        await rename(source, target);
      } catch {
        /* ignore */
      }
    }
  }

  private loadAllNewestFirst(): AuditEntry[] {
    if (!this.path) {
      return [...this.memory, ...this.writeQueue].reverse();
    }
    const files: string[] = [];
    for (let index = this.maxFiles; index >= 1; index -= 1) {
      const candidate = `${this.path}.${index}`;
      if (existsSync(candidate)) files.push(candidate);
    }
    if (existsSync(this.path)) files.push(this.path);

    const parsed: AuditEntry[] = [];
    for (const file of files) {
      try {
        const content = readFileSync(file, 'utf8');
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try {
            const raw = JSON.parse(line) as Partial<AuditEntry>;
            if (typeof raw.time === 'string' && typeof raw.action === 'string') {
              parsed.push({
                time: raw.time,
                actor: typeof raw.actor === 'string' ? raw.actor : 'unknown',
                source:
                  raw.source === 'web' ||
                  raw.source === 'api' ||
                  raw.source === 'telegram' ||
                  raw.source === 'system'
                    ? raw.source
                    : 'system',
                action: raw.action,
                target: typeof raw.target === 'string' ? raw.target : null,
                result: raw.result === 'error' ? 'error' : 'ok',
                ...(typeof raw.detail === 'string' ? { detail: raw.detail } : {}),
              });
            }
          } catch {
            /* skip malformed line */
          }
        }
      } catch {
        /* ignore unreadable rotated file */
      }
    }
    for (const queued of this.writeQueue) {
      parsed.push(queued);
    }
    return parsed.reverse();
  }
}
