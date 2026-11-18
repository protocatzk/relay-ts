import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import { z } from 'zod';
import {
  DEFAULT_SETTINGS,
  PlaylistSchema,
  SettingsSchema,
  StreamerSchema,
  StreamersFileSchema,
  formatZodError,
  type PlaylistConfig,
  type Settings,
  type StreamerConfig,
} from './schema.js';
import { ConfigError } from '../../utils/errors.js';
import { ensureDir, readYamlFile, writeFileAtomic, writeYamlFile } from '../../utils/fs.js';
import { deepMerge, parseBoolean, parseNumber } from '../../utils/format.js';
import type { LogLevel } from '../../utils/logger.js';

export interface AppPaths {
  root: string;
  streamersFile: string;
  settingsFile: string;
  logsDir: string;
  dataDir: string;
  overlaysDir: string;
  webDir: string;
  cookiesFile: string;
  logFile: string;
}

export interface ServerConfig {
  host: string;
  port: number;
  logLevel: LogLevel;
  password: string;
  apiToken: string;
  sessionSecret: string;
  secureCookies: boolean;
  corsOrigin: string;
  telegramAuth: boolean;
}

export interface TelegramConfig {
  botToken: string;
  allowedUserIds: number[];
  notifyChatId: number | null;
  notifications: boolean;
}

export interface MediaConfig {
  ffmpegBin: string;
  ytdlpBin: string;
  youtubeRtmpUrl: string;
  youtubeBackup: boolean;
  tiktokSessionId: string;
  tiktokTargetIdc: string;
  ytdlpTimeoutSeconds: number;
  relayHost: string;
  relayPort: number;
  ffmpegLogLevel: string;
  overlayFont: string;
  pauseOnOffline: boolean;
  sourceUserAgent: string;
}

export interface LoadedConfig {
  paths: AppPaths;
  server: ServerConfig;
  telegram: TelegramConfig;
  media: MediaConfig;
  settings: Settings;
  streamers: StreamerConfig[];
  playlists: PlaylistConfig[];
  autoStart: boolean;
}

export interface LoadOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  argv?: string[];
}

function resolvePath(cwd: string, value: string | undefined, fallback: string): string {
  const target = value?.trim() || fallback;
  return isAbsolute(target) ? target : resolve(cwd, target);
}

function parseLogLevel(value: string | undefined): LogLevel {
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') return value;
  return 'info';
}

function parseBitrate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(value.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  const suffix = match[2]?.toLowerCase();
  if (suffix === 'm') return Math.round(amount * 1000);
  return Math.round(amount);
}

function parseIdList(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(/[\s,;]+/)
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item !== 0);
}

function parseOptionalInt(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) ? parsed : null;
}

function parseCli(argv: string[]): {
  streamersFile?: string;
  settingsFile?: string;
  port?: number;
  host?: string;
  logLevel?: LogLevel;
  noAutoStart?: boolean;
} {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        config: { type: 'string' },
        streamers: { type: 'string' },
        settings: { type: 'string' },
        port: { type: 'string' },
        host: { type: 'string' },
        'log-level': { type: 'string' },
        'no-auto-start': { type: 'boolean' },
      },
      strict: false,
      allowPositionals: true,
    });
    const config = typeof values.config === 'string' ? values.config : undefined;
    const streamers =
      (typeof values.streamers === 'string' ? values.streamers : undefined) ?? config;
    return {
      streamersFile: streamers,
      settingsFile: typeof values.settings === 'string' ? values.settings : undefined,
      port: typeof values.port === 'string' ? Number(values.port) : undefined,
      host: typeof values.host === 'string' ? values.host : undefined,
      logLevel:
        typeof values['log-level'] === 'string'
          ? parseLogLevel(values['log-level'])
          : undefined,
      noAutoStart: values['no-auto-start'] === true,
    };
  } catch {
    return {};
  }
}

export function readStreamersFile(path: string): {
  streamers: StreamerConfig[];
  playlists: PlaylistConfig[];
  settings?: Record<string, unknown>;
} {
  const raw = readYamlFile(path);
  if (raw === undefined) {
    return { streamers: [], playlists: [] };
  }
  const parsed = StreamersFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(`Ungültige Konfiguration in ${path}: ${formatZodError(parsed.error)}`);
  }
  const ids = new Set<string>();
  for (const streamer of parsed.data.streamers) {
    if (ids.has(streamer.id)) {
      throw new ConfigError(`Doppelte Streamer-ID "${streamer.id}" in ${path}`);
    }
    ids.add(streamer.id);
  }
  const playlistIds = new Set<string>();
  for (const playlist of parsed.data.playlists) {
    if (playlistIds.has(playlist.id)) {
      throw new ConfigError(`Doppelte Playlist-ID "${playlist.id}" in ${path}`);
    }
    playlistIds.add(playlist.id);
  }
  return {
    streamers: parsed.data.streamers,
    playlists: parsed.data.playlists,
    settings: parsed.data.settings,
  };
}

let dotenvLoaded = false;

export function loadConfig(options: LoadOptions = {}): LoadedConfig {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  if (!dotenvLoaded) {
    dotenv.config({ quiet: true });
    dotenvLoaded = true;
  }
  const cli = parseCli(options.argv ?? process.argv.slice(2));

  const root = resolvePath(cwd, env.ROOT_DIR, cwd);
  const dataDir = resolvePath(root, env.DATA_DIR, 'data');
  const logsDir = resolvePath(root, env.LOGS_DIR, 'logs');
  const configDir = resolvePath(root, env.CONFIG_DIR, 'config');
  const paths: AppPaths = {
    root,
    streamersFile: resolvePath(cwd, cli.streamersFile ?? env.STREAMERS_FILE, `${configDir}/streamers.yml`),
    settingsFile: resolvePath(cwd, cli.settingsFile ?? env.SETTINGS_FILE, `${configDir}/settings.yml`),
    logsDir,
    dataDir,
    overlaysDir: resolvePath(dataDir, env.OVERLAYS_DIR, 'overlays'),
    webDir: resolvePath(root, env.WEB_DIR, 'web/dist'),
    cookiesFile: resolvePath(root, env.COOKIES_FILE, `${dataDir}/cookies.txt`),
    logFile: resolvePath(logsDir, env.LOG_FILE, 'restreamer.log'),
  };
  ensureDir(paths.logsDir);
  ensureDir(paths.dataDir);
  ensureDir(paths.overlaysDir);
  ensureDir(configDir);

  if (!existsSync(paths.streamersFile)) {
    writeYamlFile(paths.streamersFile, {
      streamers: [],
      playlists: [],
      settings: {},
    });
  }

  const file = readStreamersFile(paths.streamersFile);
  const settingsRaw: Record<string, unknown> = {};
  if (file.settings) Object.assign(settingsRaw, file.settings);
  const settingsFileRaw = readYamlFile(paths.settingsFile);
  if (settingsFileRaw !== undefined && typeof settingsFileRaw !== 'object') {
    throw new ConfigError(`${paths.settingsFile} muss ein YAML-Objekt enthalten`);
  }
  if (settingsFileRaw) Object.assign(settingsRaw, settingsFileRaw as Record<string, unknown>);
  let migratedOverlays = false;
  if (!Object.hasOwn(settingsRaw, 'overlays') && file.streamers.length > 0) {
    const source =
      file.streamers.find(
        (streamer) =>
          streamer.overlays.chat.enabled ||
          streamer.overlays.clock.enabled ||
          streamer.overlays.text.enabled,
      ) ?? file.streamers[0]!;
    settingsRaw.overlays = structuredClone(source.overlays);
    migratedOverlays = true;
  }
  applyEnvSettings(
    settingsRaw,
    env,
    parseBoolean(env.SETTINGS_ENV_OVERRIDES) ?? false,
  );
  const settingsResult = SettingsSchema.safeParse(deepMerge(DEFAULT_SETTINGS, settingsRaw));
  if (!settingsResult.success) {
    throw new ConfigError(`Ungültige Einstellungen: ${formatZodError(settingsResult.error)}`);
  }
  if (migratedOverlays) {
    writeYamlFile(paths.settingsFile, settingsResult.data);
  }

  const password = (env.DASHBOARD_PASSWORD ?? '').trim();
  const apiToken = env.API_TOKEN?.trim() ?? '';
  const sessionSecret =
    env.SESSION_SECRET?.trim() ||
    createHash('sha256').update(`restreamer-ts:${password || apiToken || 'public'}`).digest('hex');
  const port = cli.port ?? parseNumber(env.SERVER_PORT) ?? parseNumber(env.PORT) ?? 3000;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`SERVER_PORT ist ungültig: ${String(port)}`);
  }
  const relayPort = parseNumber(env.RELAY_PORT) ?? 12345;
  if (!Number.isInteger(relayPort) || relayPort < 1 || relayPort > 65534) {
    throw new ConfigError('RELAY_PORT muss zwischen 1 und 65534 liegen (Playback nutzt Port+1)');
  }
  const corsOrigin = env.CORS_ORIGIN?.trim() ?? '';
  if (corsOrigin === '*') {
    throw new ConfigError('CORS_ORIGIN darf nicht "*" sein, wenn Cookies verwendet werden');
  }
  const secureCookies = parseBoolean(env.SECURE_COOKIES) ?? false;

  const telegram: TelegramConfig = {
    botToken: env.TELEGRAM_BOT_TOKEN?.trim() ?? '',
    allowedUserIds: parseIdList(env.TELEGRAM_ALLOWED_USER_IDS),
    notifyChatId: parseOptionalInt(env.TELEGRAM_NOTIFY_CHAT_ID),
    notifications: parseBoolean(env.TELEGRAM_NOTIFICATIONS) ?? true,
  };
  const telegramAuth = Boolean(telegram.botToken && telegram.allowedUserIds.length > 0);

  const server: ServerConfig = {
    host: cli.host ?? env.SERVER_HOST ?? '0.0.0.0',
    port,
    logLevel: cli.logLevel ?? parseLogLevel(env.LOG_LEVEL),
    password,
    apiToken,
    sessionSecret,
    secureCookies,
    corsOrigin,
    telegramAuth,
  };

  const media: MediaConfig = {
    ffmpegBin: env.FFMPEG_BIN?.trim() || 'ffmpeg',
    ytdlpBin: env.YTDLP_BIN?.trim() || 'yt-dlp',
    youtubeRtmpUrl: env.YOUTUBE_RTMP_URL?.trim() || 'rtmp://a.rtmp.youtube.com/live2',
    youtubeBackup: parseBoolean(env.YOUTUBE_BACKUP) ?? false,
    tiktokSessionId: env.TIKTOK_SESSION_ID?.trim() ?? '',
    tiktokTargetIdc: env.TIKTOK_TARGET_IDC?.trim() ?? '',
    ytdlpTimeoutSeconds: parseNumber(env.YTDLP_TIMEOUT) ?? 45,
    relayHost: env.RELAY_HOST?.trim() || '127.0.0.1',
    relayPort,
    ffmpegLogLevel: env.FFMPEG_LOGLEVEL?.trim() || 'warning',
    overlayFont: env.OVERLAY_FONT?.trim() || '',
    pauseOnOffline: parseBoolean(env.PAUSE_ON_OFFLINE) ?? true,
    sourceUserAgent:
      env.SOURCE_USER_AGENT?.trim() ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  };

  if (media.tiktokSessionId) {
    ensureCookieFile(paths.cookiesFile, media.tiktokSessionId, media.tiktokTargetIdc);
  }

  return {
    paths,
    server,
    telegram,
    media,
    settings: settingsResult.data,
    streamers: file.streamers,
    playlists: file.playlists,
    autoStart: !(cli.noAutoStart ?? (parseBoolean(env.AUTO_START) === false)),
  };
}

export function ensureCookieFile(path: string, sessionId: string, targetIdc = ''): void {
  const expires = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const lines = ['# Netscape HTTP Cookie File', '# Generated by restreamer-ts', ''];
  lines.push(`.tiktok.com\tTRUE\t/\tTRUE\t${expires}\tsessionid\t${sessionId}`);
  if (targetIdc) {
    lines.push(`.tiktok.com\tTRUE\t/\tTRUE\t${expires}\ttt-target-idc\t${targetIdc}`);
  }
  writeFileAtomic(path, `${lines.join('\n')}\n`, 0o600);
}

export function applyEnvSettings(
  target: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  overrides = false,
): void {
  const hasPath = (path: string[]): boolean => {
    let cursor: unknown = target;
    for (const key of path) {
      if (!cursor || typeof cursor !== 'object' || !Object.hasOwn(cursor, key)) return false;
      cursor = (cursor as Record<string, unknown>)[key];
    }
    return true;
  };
  const set = (path: string[], value: unknown) => {
    if (value === undefined) return;
    if (!overrides && hasPath(path)) return;
    let cursor = target;
    for (let index = 0; index < path.length - 1; index += 1) {
      const key = path[index]!;
      if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
      cursor = cursor[key] as Record<string, unknown>;
    }
    cursor[path[path.length - 1]!] = value;
  };

  set(['delay_buffer', 'enabled'], parseBoolean(env.DELAY_BUFFER_ENABLED));
  set(['delay_buffer', 'size'], parseNumber(env.RELAY_DELAY_SECONDS) ?? parseNumber(env.DELAY_SECONDS));
  set(['video', 'resolution'], env.OUTPUT_RESOLUTION?.trim() || undefined);
  set(['video', 'fps'], parseNumber(env.OUTPUT_FPS));
  set(['video', 'video_bitrate'], parseBitrate(env.VIDEO_BITRATE));
  set(['video', 'audio_bitrate'], parseBitrate(env.AUDIO_BITRATE));
  set(['video', 'preset'], env.X264_PRESET?.trim() || undefined);
  set(['watchdog', 'stall_timeout'], parseNumber(env.STALL_TIMEOUT));
  set(['watchdog', 'min_bitrate'], parseBitrate(env.MIN_BITRATE));
  set(['watchdog', 'min_source_rate_percent'], parseNumber(env.SOURCE_MIN_RATE_PERCENT));
  set(['watchdog', 'interval'], parseNumber(env.WATCHDOG_INTERVAL));
  set(['watchdog', 'auto_reconnect'], parseBoolean(env.AUTO_RECONNECT));
  set(['auto_refresh', 'enabled'], parseBoolean(env.AUTO_REFRESH));
  set(['auto_refresh', 'interval'], parseNumber(env.AUTO_REFRESH_MINUTES));
  set(['pause', 'enabled'], parseBoolean(env.PAUSE_ENABLED));
  set(['pause', 'text'], env.PAUSE_TEXT?.trim() || undefined);
  set(['pause', 'subtext'], env.PAUSE_SUBTEXT?.trim() || undefined);
  set(['online', 'enabled'], parseBoolean(env.ONLINE_CHECK_ENABLED));
  set(['online', 'source_url'], env.ONLINE_SOURCE_URL?.trim() || undefined);
  set(['online', 'api_key'], env.ONLINE_SOURCE_API_KEY?.trim() || undefined);
  set(['online', 'interval'], parseNumber(env.ONLINE_CHECK_INTERVAL_SECONDS));
  set(['online', 'auto_switch_preferred'], parseBoolean(env.ONLINE_AUTO_SWITCH_PREFERRED));
  set(['chat', 'api_url'], env.CHAT_API_URL?.trim() || undefined);
  set(['chat', 'api_key'], env.CHAT_API_KEY?.trim() || undefined);
  set(['streaming', 'title_template'], env.YOUTUBE_TITLE_TEMPLATE?.trim() || undefined);
  set(['earnings', 'enabled'], parseBoolean(env.EARNINGS_ENABLED));
  set(['earnings', 'source_url'], env.EARNINGS_SOURCE_URL?.trim() || undefined);
  set(['earnings', 'api_key'], env.EARNINGS_SOURCE_API_KEY?.trim() || undefined);
  set(['earnings', 'interval'], parseNumber(env.EARNINGS_REFRESH_SECONDS));
  set(['earnings', 'view'], env.EARNINGS_VIEW?.trim() || undefined);
  set(['earnings', 'overlay_enabled'], parseBoolean(env.EARNINGS_OVERLAY_ENABLED));
  set(['earnings', 'overlay_template'], env.EARNINGS_OVERLAY_TEMPLATE?.trim() || undefined);
  set(['earnings', 'overlay_font_size'], parseNumber(env.EARNINGS_OVERLAY_FONT_SIZE));
}

/** Validates a single streamer for CRUD operations. */
export function parseStreamer(value: unknown): StreamerConfig {
  const result = StreamerSchema.safeParse(value);
  if (!result.success) {
    throw new ConfigError(`Ungültiger Streamer: ${formatZodError(result.error)}`, result.error.issues);
  }
  return result.data;
}

export function parsePlaylist(value: unknown): PlaylistConfig {
  const result = PlaylistSchema.safeParse(value);
  if (!result.success) {
    throw new ConfigError(`Ungültige Playlist: ${formatZodError(result.error)}`, result.error.issues);
  }
  return result.data;
}

export function zodIssues(error: z.ZodError): unknown {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

export function fileSize(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}
