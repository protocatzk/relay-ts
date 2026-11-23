import { chmodSync, existsSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Logger } from 'pino';
import { runCommand } from '../../utils/process.js';
import { AppError, ValidationError } from '../../utils/errors.js';
import { ensureDir } from '../../utils/fs.js';

export interface CreateBackupOptions {
  rootDir: string;
  dataDir: string;
  configDir: string;
  logger?: Logger;
}

export interface BackupArchiveInfo {
  archivePath: string;
  filename: string;
  size: number;
}

export interface InspectBackupResult {
  ok: boolean;
  entries: string[];
  error?: string;
}

export interface RestoreBackupOptions {
  archivePath: string;
  rootDir: string;
  dataDir: string;
  configDir: string;
  logger?: Logger;
}

export interface RestoreBackupResult {
  ok: boolean;
  rollbackPath: string;
  entriesCount: number;
}

export function backupsDirectory(dataDir: string): string {
  return join(dataDir, 'backups');
}

function escapesRoot(relPath: string): boolean {
  return relPath === '..' || relPath.startsWith(`..${sep}`) || isAbsolute(relPath);
}

function commonParent(a: string, b: string): string | null {
  const partsA = resolve(a).split(sep).filter(Boolean);
  const partsB = resolve(b).split(sep).filter(Boolean);
  const common: string[] = [];
  for (let i = 0; i < Math.min(partsA.length, partsB.length); i += 1) {
    if (partsA[i] !== partsB[i]) break;
    common.push(partsA[i]!);
  }
  if (common.length === 0) return null;
  return sep + common.join(sep);
}

/**
 * Determines the directory that tar uses with `-C` and that the archive's
 * relative members refer to. The configured root is only usable when it
 * actually contains both config/ and data/. In the native systemd layout the
 * working directory is the release directory (`/srv/relay/current`), while
 * config/ and data/ live next to the releases — using it verbatim made tar
 * emit `../config` members (and writes fail on the read-only release tree).
 */
export function backupArchiveRoot(options: {
  rootDir: string;
  dataDir: string;
  configDir: string;
}): string {
  const relConfig = relative(options.rootDir, options.configDir);
  const relData = relative(options.rootDir, options.dataDir);
  if (!escapesRoot(relConfig) && !escapesRoot(relData)) {
    return options.rootDir;
  }

  const parent = commonParent(options.configDir, options.dataDir);
  if (!parent || parent === sep) {
    throw new AppError(
      'backup_root_invalid',
      'Backup-Verzeichnisse (config/ und data/) müssen ein gemeinsames Elternverzeichnis haben',
    );
  }

  // The archive whitelist only accepts top-level `config/` and `data/`
  // entries; arbitrary directory names would produce archives that can never
  // be restored.
  if (basename(options.configDir) !== 'config' || basename(options.dataDir) !== 'data') {
    throw new AppError(
      'backup_root_invalid',
      'Backup-Verzeichnisse müssen den Namen "config" und "data" tragen',
    );
  }

  return parent;
}

/**
 * Creates a tar.gz backup archive of config/ and data/ excluding runtime sessions and media.
 */
export async function createBackupArchive(options: CreateBackupOptions): Promise<BackupArchiveInfo> {
  const backupsDir = backupsDirectory(options.dataDir);
  ensureDir(backupsDir);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `relay-backup-${stamp}.tar.gz`;
  const archivePath = join(backupsDir, filename);

  const archiveRoot = backupArchiveRoot(options);
  const relConfig = relative(archiveRoot, options.configDir) || 'config';
  const relData = relative(archiveRoot, options.dataDir) || 'data';

  const args = [
    '-czf',
    archivePath,
    '--exclude=data/sessions.json',
    '--exclude=data/overlays/active',
    '--exclude=data/overlays/*.png',
    '--exclude=data/recordings',
    '--exclude=data/media',
    '--exclude=data/backups',
    '-C',
    archiveRoot,
    relConfig,
    relData,
  ];

  options.logger?.info({ archivePath }, 'Backup-Archiv wird erstellt');
  const res = await runCommand('tar', args, { timeoutMs: 60_000 });
  if (res.code !== 0 || !existsSync(archivePath)) {
    throw new AppError('backup_failed', `Erstellung des Backups fehlgeschlagen: ${res.stderr || 'tar Fehler'}`);
  }

  try {
    chmodSync(archivePath, 0o600);
  } catch {
    /* ignore */
  }

  const stat = statSync(archivePath);
  return {
    archivePath,
    filename,
    size: stat.size,
  };
}

/**
 * Validates a tar.gz archive before restoring: verifies integrity, blocks path traversal,
 * symlinks, hardlinks, and unexpected root directories.
 */
export async function inspectBackupArchive(archivePath: string): Promise<InspectBackupResult> {
  if (!existsSync(archivePath)) {
    return { ok: false, entries: [], error: 'Archivdatei existiert nicht' };
  }

  // 1. List names
  const listRes = await runCommand('tar', ['-tzf', archivePath], { timeoutMs: 30_000 });
  if (listRes.code !== 0) {
    return { ok: false, entries: [], error: 'Ungültiges oder beschädigtes tar.gz Archiv' };
  }

  const entries = listRes.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    return { ok: false, entries: [], error: 'Das Archiv ist leer' };
  }

  for (const entry of entries) {
    // Check path traversal & absolute paths
    if (entry.startsWith('/') || entry.startsWith('\\') || /(^|\/)\.\.(\/|$)/.test(entry)) {
      return { ok: false, entries, error: `Archiv enthält unsichere Pfade: ${entry}` };
    }

    // Check root directory whitelist
    const top = entry.split('/')[0];
    if (top !== 'config' && top !== 'data') {
      return {
        ok: false,
        entries,
        error: `Unerwarteter Pfad im Archiv (nur config/ und data/ erlaubt): ${entry}`,
      };
    }
  }

  // 2. Check for symlinks or hard links
  const verboseRes = await runCommand('tar', ['-tvzf', archivePath], { timeoutMs: 30_000 });
  if (verboseRes.code === 0) {
    const lines = verboseRes.stdout.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // 'l' at start indicates symbolic link; 'h' indicates hard link
      if (trimmed.startsWith('l') || trimmed.startsWith('h') || trimmed.includes(' -> ')) {
        return {
          ok: false,
          entries,
          error: `Symlinks oder Verknüpfungen im Archiv sind aus Sicherheitsgründen nicht erlaubt (${trimmed})`,
        };
      }
    }
  }

  return { ok: true, entries };
}

/**
 * Restores a validated backup archive into rootDir after creating a safety rollback backup.
 */
export async function restoreBackupArchive(options: RestoreBackupOptions): Promise<RestoreBackupResult> {
  const inspection = await inspectBackupArchive(options.archivePath);
  if (!inspection.ok) {
    throw new ValidationError(inspection.error ?? 'Archiv-Validierung fehlgeschlagen');
  }

  const backupsDir = backupsDirectory(options.dataDir);
  ensureDir(backupsDir);

  // Safety Rollback
  const rollbackStamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const rollbackFilename = `rollback-${rollbackStamp}.tar.gz`;
  const rollbackPath = join(backupsDir, rollbackFilename);

  const archiveRoot = backupArchiveRoot(options);
  const relConfig = relative(archiveRoot, options.configDir) || 'config';
  const relData = relative(archiveRoot, options.dataDir) || 'data';

  options.logger?.info({ rollbackPath }, 'Sicherheits-Rollback vor Wiederherstellung wird erstellt');
  await runCommand(
    'tar',
    [
      '-czf',
      rollbackPath,
      '--exclude=data/sessions.json',
      '--exclude=data/overlays/active',
      '--exclude=data/recordings',
      '--exclude=data/media',
      '--exclude=data/backups',
      '-C',
      archiveRoot,
      relConfig,
      relData,
    ],
    { timeoutMs: 60_000 },
  );

  try {
    chmodSync(rollbackPath, 0o600);
  } catch {
    /* ignore */
  }

  // Extract
  options.logger?.info({ archive: basename(options.archivePath) }, 'Backup-Archiv wird entpackt');
  const extractRes = await runCommand('tar', ['-xzf', options.archivePath, '-C', archiveRoot], {
    timeoutMs: 60_000,
  });

  if (extractRes.code !== 0) {
    throw new AppError(
      'restore_failed',
      `Wiederherstellung fehlgeschlagen: ${extractRes.stderr || 'tar Fehler'}`,
    );
  }

  // Restore secure 0600 file permissions
  const sensitiveFiles = [
    join(options.configDir, 'settings.yml'),
    join(options.configDir, 'streamers.yml'),
    join(options.dataDir, 'scenes.json'),
    join(options.dataDir, 'schedules.json'),
    join(options.dataDir, 'queue.json'),
    join(options.dataDir, 'youtube-auth.json'),
  ];
  for (const file of sensitiveFiles) {
    if (existsSync(file)) {
      try {
        chmodSync(file, 0o600);
      } catch {
        /* ignore */
      }
    }
  }

  return {
    ok: true,
    rollbackPath,
    entriesCount: inspection.entries.length,
  };
}
