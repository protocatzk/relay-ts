import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { load, dump } from 'js-yaml';

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export async function ensureDirAsync(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function writeFileAtomicAsync(path: string, content: string, mode?: number): Promise<void> {
  await ensureDirAsync(dirname(path));
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: mode ?? 0o600 });
  await rename(temporary, path);
  if (mode !== undefined) {
    try {
      await chmod(path, mode);
    } catch {
      // Best effort (e.g. CIFS mounts).
    }
  }
}

export function writeFileAtomic(path: string, content: string, mode?: number): void {
  ensureDir(dirname(path));
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, content, { encoding: 'utf8', mode: mode ?? 0o600 });
  renameSync(temporary, path);
  if (mode !== undefined) {
    try {
      chmodSync(path, mode);
    } catch {
      // Best effort (e.g. CIFS mounts).
    }
  }
}

export function readYamlFile(path: string): unknown {
  if (!existsSync(path)) return undefined;
  const raw = readFileSync(path, 'utf8');
  if (!raw.trim()) return undefined;
  return load(raw, { filename: path });
}

export function writeYamlFile(path: string, value: unknown): void {
  const header =
    '# Restreamer TS configuration\n# This file is managed by the dashboard. Manual edits are supported.\n';
  writeFileAtomic(path, header + dump(value, { noRefs: true, lineWidth: 120, sortKeys: false }), 0o600);
}

export function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFile(path: string, value: unknown): void {
  writeFileAtomic(path, JSON.stringify(value, null, 2), 0o600);
}

export async function writeJsonFileAsync(path: string, value: unknown): Promise<void> {
  await writeFileAtomicAsync(path, JSON.stringify(value, null, 2), 0o600);
}
