import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { Logger } from 'pino';
import { runCommand } from '../../utils/process.js';
import {
  MAX_MUSIC_DURATION_SECONDS,
  MAX_SFX_DURATION_SECONDS,
  SOUNDBOARD_EXTENSIONS,
  type SoundEntry,
  type SoundKind,
} from './types.js';

interface SoundIndexFile {
  version: 1;
  sounds: SoundEntry[];
}

export interface SoundProbeResult {
  duration: number;
  codec: string;
}

/** Detects allowed audio container/codec signatures by magic bytes. */
export function detectAudioMagic(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE') {
    return 'wav';
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'OggS') {
    return 'ogg';
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'fLaC') {
    return 'flac';
  }
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    return 'm4a';
  }
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3') {
    return 'mp3';
  }
  // Raw MPEG-1/2 Layer III frame sync (11 set bits + non-reserved layer).
  if (buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0 && (buffer[1]! & 0x06) !== 0) {
    return 'mp3';
  }
  return null;
}

/** Normalizes an uploaded audio filename; returns null if extension is unsupported. */
export function normalizeSoundFilename(originalName: string): string | null {
  const base = basename(originalName).trim();
  const ext = extname(base).toLowerCase();
  if (!SOUNDBOARD_EXTENSIONS.includes(ext as (typeof SOUNDBOARD_EXTENSIONS)[number])) {
    return null;
  }
  const stem = base
    .slice(0, base.length - ext.length)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return `${stem || 'sound'}${ext}`;
}

export async function probeSoundFile(ffprobeBin: string, filePath: string): Promise<SoundProbeResult> {
  const result = await runCommand(
    ffprobeBin,
    [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=codec_name:format=duration',
      '-of',
      'json',
      filePath,
    ],
    { timeoutMs: 15_000 },
  );
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || 'Audio-Datei konnte nicht analysiert werden');
  }
  const parsed = JSON.parse(result.stdout) as {
    streams?: Array<{ codec_name?: string }>;
    format?: { duration?: string };
  };
  const codec = parsed.streams?.[0]?.codec_name ?? '';
  const duration = Number(parsed.format?.duration ?? 0);
  if (!codec || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('Datei enthält keinen gültigen Audiostream');
  }
  return { codec, duration };
}

export class SoundboardStore {
  private readonly dir: string;
  private readonly cacheDir: string;
  private readonly indexPath: string;
  private readonly ffmpegBin: string;
  private readonly ffprobeBin: string;
  private readonly logger: Logger;
  private sounds: SoundEntry[] = [];
  private readonly pcmCache = new Map<string, Buffer>();
  private pcmCacheBytes = 0;
  private maxCacheBytes: number;

  constructor(options: {
    dataDir: string;
    ffmpegBin: string;
    ffprobeBin: string;
    logger: Logger;
    cacheMb?: number;
  }) {
    this.dir = join(options.dataDir, 'sounds');
    this.cacheDir = join(this.dir, 'cache');
    this.indexPath = join(this.dir, 'index.json');
    this.ffmpegBin = options.ffmpegBin;
    this.ffprobeBin = options.ffprobeBin;
    this.logger = options.logger;
    this.maxCacheBytes = Math.max(16, options.cacheMb ?? 128) * 1024 * 1024;
    this.load();
  }

  setCacheMb(cacheMb: number): void {
    this.maxCacheBytes = Math.max(16, cacheMb) * 1024 * 1024;
    this.evictCache();
  }

  list(): SoundEntry[] {
    return this.sounds.map((s) => ({ ...s }));
  }

  get(id: string): SoundEntry | undefined {
    const found = this.sounds.find((s) => s.id === id);
    return found ? { ...found } : undefined;
  }

  findByNameOrId(query: string): SoundEntry | undefined {
    const q = query.trim().toLowerCase();
    if (!q) return undefined;
    const exactId = this.sounds.find((s) => s.id.toLowerCase() === q);
    if (exactId) return { ...exactId };
    const exactName = this.sounds.find((s) => s.name.toLowerCase() === q);
    if (exactName) return { ...exactName };
    const partial = this.sounds.find((s) => s.name.toLowerCase().includes(q));
    return partial ? { ...partial } : undefined;
  }

  soundFilePath(entry: SoundEntry): string {
    return join(this.dir, entry.file);
  }

  async addFromBuffer(options: {
    originalName: string;
    buffer: Buffer;
    kind: SoundKind;
    name?: string;
    color?: string;
    hotkey?: string;
    gain_db?: number;
  }): Promise<SoundEntry> {
    const normalized = normalizeSoundFilename(options.originalName);
    if (!normalized) {
      throw new Error(`Nicht unterstütztes Audioformat (${SOUNDBOARD_EXTENSIONS.join(', ')})`);
    }
    if (!detectAudioMagic(options.buffer)) {
      throw new Error('Ungültige Audiodatei (Magic-Byte-Prüfung fehlgeschlagen)');
    }
    mkdirSync(this.dir, { recursive: true });
    const id = randomUUID().slice(0, 8);
    const filename = `${id}-${normalized}`;
    const targetPath = join(this.dir, filename);
    writeFileSync(targetPath, options.buffer, { mode: 0o600 });

    try {
      const probe = await probeSoundFile(this.ffprobeBin, targetPath);
      const maxDuration =
        options.kind === 'music' ? MAX_MUSIC_DURATION_SECONDS : MAX_SFX_DURATION_SECONDS;
      if (probe.duration > maxDuration) {
        throw new Error(
          options.kind === 'music'
            ? `Musikdatei zu lang (max. ${MAX_MUSIC_DURATION_SECONDS / 60} Minuten)`
            : `SFX zu lang (max. ${MAX_SFX_DURATION_SECONDS} Sekunden)`,
        );
      }

      const displayName =
        options.name?.trim() ||
        basename(options.originalName, extname(options.originalName)).trim() ||
        filename;

      const entry: SoundEntry = {
        id,
        name: displayName.slice(0, 80),
        file: filename,
        kind: options.kind,
        duration: Math.round(probe.duration * 100) / 100,
        gain_db: Math.max(-30, Math.min(12, options.gain_db ?? 0)),
        color: options.color?.trim() || (options.kind === 'music' ? '#38bdf8' : '#22d3ee'),
        hotkey: (options.hotkey ?? '').trim().toUpperCase().slice(0, 1),
        created_at: new Date().toISOString(),
      };
      this.sounds.push(entry);
      this.save();
      return { ...entry };
    } catch (error) {
      if (existsSync(targetPath)) unlinkSync(targetPath);
      throw error;
    }
  }

  update(
    id: string,
    patch: Partial<Pick<SoundEntry, 'name' | 'kind' | 'gain_db' | 'color' | 'hotkey'>>,
  ): SoundEntry | null {
    const entry = this.sounds.find((s) => s.id === id);
    if (!entry) return null;
    if (patch.name !== undefined && patch.name.trim()) {
      entry.name = patch.name.trim().slice(0, 80);
    }
    if (patch.kind !== undefined) {
      const maxDuration =
        patch.kind === 'music' ? MAX_MUSIC_DURATION_SECONDS : MAX_SFX_DURATION_SECONDS;
      if (entry.duration > maxDuration) {
        throw new Error(`Datei ist zu lang für Kategorie "${patch.kind}"`);
      }
      entry.kind = patch.kind;
    }
    if (patch.gain_db !== undefined) {
      entry.gain_db = Math.max(-30, Math.min(12, patch.gain_db));
    }
    if (patch.color !== undefined && patch.color.trim()) {
      entry.color = patch.color.trim().slice(0, 24);
    }
    if (patch.hotkey !== undefined) {
      entry.hotkey = patch.hotkey.trim().toUpperCase().slice(0, 1);
    }
    this.save();
    return { ...entry };
  }

  delete(id: string): boolean {
    const idx = this.sounds.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    const [removed] = this.sounds.splice(idx, 1);
    this.save();
    if (removed) {
      const filePath = join(this.dir, removed.file);
      if (existsSync(filePath)) unlinkSync(filePath);
      const cachedPath = join(this.cacheDir, `${removed.id}.pcm`);
      if (existsSync(cachedPath)) unlinkSync(cachedPath);
      const mem = this.pcmCache.get(removed.id);
      if (mem) {
        this.pcmCacheBytes -= mem.byteLength;
        this.pcmCache.delete(removed.id);
      }
    }
    return true;
  }

  /** Returns decoded 48kHz stereo s16le PCM buffer (from memory LRU, disk cache, or ffmpeg). */
  async getPcm(id: string): Promise<Buffer> {
    const existing = this.pcmCache.get(id);
    if (existing) {
      // Refresh LRU position.
      this.pcmCache.delete(id);
      this.pcmCache.set(id, existing);
      return existing;
    }

    const entry = this.sounds.find((s) => s.id === id);
    if (!entry) throw new Error(`Sound "${id}" nicht gefunden`);

    const cachePath = join(this.cacheDir, `${id}.pcm`);
    let pcm: Buffer;
    if (existsSync(cachePath)) {
      pcm = readFileSync(cachePath);
    } else {
      const sourcePath = join(this.dir, entry.file);
      if (!existsSync(sourcePath)) {
        throw new Error(`Audiodatei fehlt: ${entry.file}`);
      }
      mkdirSync(this.cacheDir, { recursive: true });
      const tmpPath = `${cachePath}.tmp-${process.pid}`;
      const result = await runCommand(
        this.ffmpegBin,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          sourcePath,
          '-vn',
          '-af',
          'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000',
          '-ar',
          '48000',
          '-ac',
          '2',
          '-f',
          's16le',
          tmpPath,
        ],
        { timeoutMs: 60_000 },
      );
      if (result.code !== 0) {
        if (existsSync(tmpPath)) unlinkSync(tmpPath);
        throw new Error(result.stderr.trim() || 'Audio-Dekodierung fehlgeschlagen');
      }
      renameSync(tmpPath, cachePath);
      pcm = readFileSync(cachePath);
    }

    this.putCache(id, pcm);
    return pcm;
  }

  private putCache(id: string, pcm: Buffer): void {
    if (pcm.byteLength > this.maxCacheBytes) return;
    const prev = this.pcmCache.get(id);
    if (prev) {
      this.pcmCacheBytes -= prev.byteLength;
      this.pcmCache.delete(id);
    }
    this.pcmCache.set(id, pcm);
    this.pcmCacheBytes += pcm.byteLength;
    this.evictCache();
  }

  private evictCache(): void {
    while (this.pcmCacheBytes > this.maxCacheBytes && this.pcmCache.size > 0) {
      const oldestKey = this.pcmCache.keys().next().value;
      if (!oldestKey) break;
      const buf = this.pcmCache.get(oldestKey);
      this.pcmCache.delete(oldestKey);
      if (buf) this.pcmCacheBytes -= buf.byteLength;
    }
  }

  private load(): void {
    if (!existsSync(this.indexPath)) {
      this.sounds = [];
      return;
    }
    try {
      const raw = JSON.parse(readFileSync(this.indexPath, 'utf8')) as Partial<SoundIndexFile>;
      this.sounds = Array.isArray(raw.sounds) ? raw.sounds : [];
    } catch (error) {
      this.logger.warn({ err: String(error) }, 'Soundboard-Index konnte nicht geladen werden');
      this.sounds = [];
    }
  }

  private save(): void {
    mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.indexPath}.tmp-${process.pid}`;
    const payload: SoundIndexFile = { version: 1, sounds: this.sounds };
    writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
    renameSync(tmp, this.indexPath);
  }
}
