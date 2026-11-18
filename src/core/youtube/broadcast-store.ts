import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from 'pino';
import { ensureDir } from '../../utils/fs.js';

export interface RelayBroadcastRecord {
  id: string;
  stream_id: string;
  title: string;
  scheduled_start: string;
  created_at: string;
  status: string;
}

interface BroadcastDocument {
  version: 1;
  broadcasts: RelayBroadcastRecord[];
}

/**
 * Local registry of broadcasts created through RELAY. Auto-start and auto-stop
 * must never touch broadcasts created in YouTube Studio (Quick Live), and a
 * restart must still know which IDs belong to RELAY.
 */
export class YouTubeBroadcastStore {
  private records = new Map<string, RelayBroadcastRecord>();

  constructor(
    private readonly path: string,
    private readonly logger: Logger,
  ) {
    this.load();
  }

  list(): RelayBroadcastRecord[] {
    return [...this.records.values()];
  }

  ids(): Set<string> {
    return new Set(this.records.keys());
  }

  get(id: string): RelayBroadcastRecord | undefined {
    const record = this.records.get(id);
    return record ? { ...record } : undefined;
  }

  upsert(record: RelayBroadcastRecord): void {
    this.records.set(record.id, { ...record });
    this.save();
  }

  updateStatus(id: string, status: string): void {
    const record = this.records.get(id);
    if (!record) return;
    record.status = status;
    this.save();
  }

  updateStream(id: string, streamId: string): void {
    const record = this.records.get(id);
    if (!record) return;
    record.stream_id = streamId;
    this.save();
  }

  remove(id: string): void {
    if (!this.records.delete(id)) return;
    this.save();
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<BroadcastDocument>;
      for (const record of parsed.broadcasts ?? []) {
        if (
          record &&
          typeof record.id === 'string' &&
          typeof record.stream_id === 'string' &&
          typeof record.created_at === 'string'
        ) {
          this.records.set(record.id, {
            id: record.id,
            stream_id: record.stream_id,
            title: typeof record.title === 'string' ? record.title : '',
            scheduled_start:
              typeof record.scheduled_start === 'string' ? record.scheduled_start : '',
            created_at: record.created_at,
            status: typeof record.status === 'string' ? record.status : 'created',
          });
        }
      }
    } catch (error) {
      this.logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'YouTube-Broadcast-Registry konnte nicht gelesen werden',
      );
    }
  }

  private save(): void {
    const document: BroadcastDocument = {
      version: 1,
      broadcasts: this.list(),
    };
    try {
      ensureDir(dirname(this.path));
      const temporary = `${this.path}.tmp`;
      writeFileSync(temporary, JSON.stringify(document, null, 2), { mode: 0o600 });
      renameSync(temporary, this.path);
    } catch (error) {
      this.logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'YouTube-Broadcast-Registry konnte nicht geschrieben werden',
      );
    }
  }
}
