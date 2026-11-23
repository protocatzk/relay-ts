import { existsSync, readFileSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { writeJsonFile } from '../utils/fs.js';

export type ApiKeyScope =
  | '*'
  | 'admin'
  | 'read:status'
  | 'read:streamers'
  | 'read:recordings'
  | 'read:logs'
  | 'control:stream'
  | 'control:queue'
  | 'control:overlays'
  | 'manage:streamers'
  | 'manage:media';

export interface ApiKeyRecord {
  id: string;
  name: string;
  key_hash: string;
  prefix: string;
  scopes: string[];
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  revoked: boolean;
}

export interface ApiKeyPublic {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  revoked: boolean;
  status: 'active' | 'expired' | 'revoked';
}

export interface CreateApiKeyResult {
  key: string;
  record: ApiKeyPublic;
}

export const ALL_SCOPES: { scope: ApiKeyScope; label: string; description: string }[] = [
  { scope: '*', label: 'Vollzugriff (Admin)', description: 'Alle Berechtigungen inkl. Systemeinstellungen und Schlüssel-Management' },
  { scope: 'read:status', label: 'Status lesen', description: 'Live-Status, Metriken und Vorschau abrufen' },
  { scope: 'read:streamers', label: 'Kanäle & Playlists lesen', description: 'Streamer-Liste, Gruppen und Playlists abrufen' },
  { scope: 'control:stream', label: 'Stream-Steuerung', description: 'Streamer starten/stoppen, umschalten, Bildschirme steuern' },
  { scope: 'control:queue', label: 'Regie-Queue steuern', description: 'Einträge in die Regie-Queue einfügen, verschieben, skippen' },
  { scope: 'control:overlays', label: 'Overlays steuern', description: 'Szenen aktivieren, Quick-Nachrichten senden' },
  { scope: 'manage:streamers', label: 'Kanäle verwalten', description: 'Streamer anlegen, bearbeiten oder löschen' },
  { scope: 'read:recordings', label: 'Aufnahmen lesen', description: 'Aufnahmeliste und Clips einsehen' },
  { scope: 'manage:media', label: 'Medien verwalten', description: 'Lokale Medien hochladen, umbenennen oder löschen' },
  { scope: 'read:logs', label: 'Logs & Diagnose', description: 'System-Logs und Diagnoseberichte abrufen' },
];

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key.trim()).digest('hex');
}

export function safeHashCompare(key: string, storedHash: string): boolean {
  const incomingHash = hashApiKey(key);
  const a = Buffer.from(incomingHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export class ApiKeyStore {
  private readonly keys = new Map<string, ApiKeyRecord>();
  private readonly path?: string;

  constructor(path?: string) {
    this.path = path;
    this.load();
  }

  private load(): void {
    if (!this.path || !existsSync(this.path)) return;
    try {
      const raw = readFileSync(this.path, 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item?.id && item?.key_hash) {
            this.keys.set(item.id, {
              id: String(item.id),
              name: String(item.name || 'API-Key'),
              key_hash: String(item.key_hash),
              prefix: String(item.prefix || 'rel_live_'),
              scopes: Array.isArray(item.scopes) ? item.scopes.map(String) : ['*'],
              created_at: String(item.created_at || new Date().toISOString()),
              expires_at: item.expires_at ? String(item.expires_at) : null,
              last_used_at: item.last_used_at ? String(item.last_used_at) : null,
              last_used_ip: item.last_used_ip ? String(item.last_used_ip) : null,
              revoked: Boolean(item.revoked),
            });
          }
        }
      }
    } catch {
      // Ignoriere fehlerhafte Datei
    }
  }

  private persist(): void {
    if (!this.path) return;
    const array = Array.from(this.keys.values());
    writeJsonFile(this.path, array);
  }

  list(): ApiKeyPublic[] {
    const now = Date.now();
    return Array.from(this.keys.values()).map((r) => {
      let status: 'active' | 'expired' | 'revoked' = 'active';
      if (r.revoked) {
        status = 'revoked';
      } else if (r.expires_at && new Date(r.expires_at).getTime() < now) {
        status = 'expired';
      }
      return {
        id: r.id,
        name: r.name,
        prefix: r.prefix,
        scopes: [...r.scopes],
        created_at: r.created_at,
        expires_at: r.expires_at,
        last_used_at: r.last_used_at,
        last_used_ip: r.last_used_ip,
        revoked: r.revoked,
        status,
      };
    });
  }

  getById(id: string): ApiKeyRecord | null {
    const record = this.keys.get(id);
    return record ? { ...record } : null;
  }

  create(opts: {
    name: string;
    scopes?: string[];
    expiresInDays?: number | null;
  }): CreateApiKeyResult {
    const randomHex = randomBytes(24).toString('hex');
    const fullKey = `rel_live_${randomHex}`;
    const prefix = `rel_live_${randomHex.slice(0, 6)}...`;
    const id = `key_${randomBytes(8).toString('hex')}`;
    const now = new Date();
    const expiresAt =
      typeof opts.expiresInDays === 'number'
        ? new Date(now.getTime() + opts.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
        : null;

    const scopes = opts.scopes && opts.scopes.length > 0 ? opts.scopes : ['*'];

    const record: ApiKeyRecord = {
      id,
      name: opts.name.trim() || 'API Key',
      key_hash: hashApiKey(fullKey),
      prefix,
      scopes,
      created_at: now.toISOString(),
      expires_at: expiresAt,
      last_used_at: null,
      last_used_ip: null,
      revoked: false,
    };

    this.keys.set(id, record);
    this.persist();

    return {
      key: fullKey,
      record: {
        id: record.id,
        name: record.name,
        prefix: record.prefix,
        scopes: [...record.scopes],
        created_at: record.created_at,
        expires_at: record.expires_at,
        last_used_at: record.last_used_at,
        last_used_ip: record.last_used_ip,
        revoked: record.revoked,
        status: 'active',
      },
    };
  }

  revoke(id: string): boolean {
    const record = this.keys.get(id);
    if (!record) return false;
    record.revoked = true;
    this.persist();
    return true;
  }

  delete(id: string): boolean {
    const deleted = this.keys.delete(id);
    if (deleted) this.persist();
    return deleted;
  }

  authenticate(rawKey: string, ip?: string): ApiKeyRecord | null {
    const trimmed = rawKey.trim();
    if (!trimmed.startsWith('rel_live_')) return null;

    const now = Date.now();
    for (const record of this.keys.values()) {
      if (record.revoked) continue;
      if (record.expires_at && new Date(record.expires_at).getTime() < now) continue;

      if (safeHashCompare(trimmed, record.key_hash)) {
        record.last_used_at = new Date().toISOString();
        if (ip) record.last_used_ip = ip;
        this.persist();
        return { ...record };
      }
    }
    return null;
  }
}
