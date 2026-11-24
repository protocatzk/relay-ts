import { existsSync, readFileSync, statSync } from 'node:fs';
import type { Logger } from 'pino';
import type { StreamerConfig } from '../config/schema.js';
import type { MediaConfig } from '../config/loader.js';
import { ResolveError, StreamerOfflineError } from '../../utils/errors.js';
import { runCommand } from '../../utils/process.js';
import { normalizeHandle } from '../../utils/format.js';
import {
  looksOffline,
  normalizeTikTokUrl,
  selectFormat,
  type ResolvedStream,
  type TikTokInfo,
} from './tiktok.js';

export interface ResolverDeps {
  media: MediaConfig;
  logger: Logger;
  cookiesFile: string;
  /**
   * Per-streamer TikTok session (#95). Falls back to `cookiesFile` when the
   * streamer has no explicit account.
   */
  sessionFor?: (streamer: StreamerConfig) => { cookieFile: string | null; cookieHeader: string | null };
  redact?: (text: string) => string;
  runner?: typeof runCommand;
  /** Injectable for tests; defaults to the TikTok mobile API. */
  apiLive?: (streamer: StreamerConfig) => Promise<ResolvedStream>;
}

export function buildResolveArgs(
  streamer: StreamerConfig,
  options: { cookiesFile: string; media: MediaConfig },
): string[] {
  const args = [
    '--dump-single-json',
    '--no-warnings',
    '--no-playlist',
    '--no-progress',
    '--no-check-formats',
    '--socket-timeout',
    '20',
    '--retries',
    '3',
  ];
  if (options.cookiesFile && existsSync(options.cookiesFile) && statSync(options.cookiesFile).size > 0) {
    args.push('--cookies', options.cookiesFile);
  }
  args.push(normalizeTikTokUrl(streamer.tiktok));
  return args;
}

/** Read a Netscape cookie file into an HTTP Cookie header (incl. HttpOnly). */
export function readCookieHeader(path: string): string | null {
  if (!path || !existsSync(path) || statSync(path).size === 0) return null;
  const now = Math.floor(Date.now() / 1000);
  const values = new Map<string, string>();
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    let line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#HttpOnly_')) line = line.slice('#HttpOnly_'.length);
    else if (line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 7) continue;
    const expiry = Number(parts[4]);
    if (Number.isFinite(expiry) && expiry > 0 && expiry < now) continue;
    values.set(parts[5]!, parts[6]!);
  }
  if (values.size === 0) return null;
  return [...values.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

interface ApiLiveQuality {
  url: string;
  vcodec: string;
  height: number | null;
  bitrate: number;
  formatId: string;
  isH264: boolean;
}

function parseStreamData(
  raw: unknown,
  label: string,
): ApiLiveQuality[] {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const data = (parsed as Record<string, unknown>).data;
  if (!data || typeof data !== 'object') return [];

  const result: ApiLiveQuality[] = [];
  for (const [quality, value] of Object.entries(data as Record<string, unknown>)) {
    if (quality === 'ao' || !value || typeof value !== 'object') continue;
    const main = (value as Record<string, unknown>).main;
    if (!main || typeof main !== 'object') continue;
    const mainRecord = main as Record<string, unknown>;
    const url = mainRecord.flv ?? mainRecord.hls;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) continue;

    let vcodec = '';
    let height: number | null = null;
    let bitrate = 0;
    const sdk = mainRecord.sdk_params;
    if (typeof sdk === 'string') {
      try {
        const params = JSON.parse(sdk) as Record<string, unknown>;
        vcodec = String(params.VCodec ?? params.vcodec ?? '');
        bitrate = Number(params.vbitrate ?? 0) || 0;
        const resolution = String(params.resolution ?? '');
        const match = /(\d+)x(\d+)/.exec(resolution);
        if (match) height = Math.max(Number(match[1]), Number(match[2]));
      } catch {
        // Ignore malformed sdk_params.
      }
    }
    result.push({
      url,
      vcodec,
      height,
      bitrate,
      formatId: `${label}-${quality}`,
      isH264: !vcodec || /^(avc|h264)/i.test(vcodec),
    });
  }
  return result;
}

export interface ApiLiveResult {
  url: string;
  vcodec: string;
  height: number | null;
  formatId: string;
  isH264: boolean;
  title: string;
}

/** Parse TikTok's /api-live/user/room response, including liveSubOnly rooms. */
export function parseApiLivePayload(
  payload: unknown,
  quality: StreamerConfig['quality'],
): ApiLiveResult {
  if (!payload || typeof payload !== 'object') {
    throw new ResolveError('TikTok Live-API lieferte keine Daten');
  }
  const data = (payload as Record<string, unknown>).data;
  if (!data || typeof data !== 'object') {
    throw new StreamerOfflineError('TikTok meldet keinen aktiven Live-Room');
  }
  const dataRecord = data as Record<string, unknown>;
  const user = dataRecord.user && typeof dataRecord.user === 'object'
    ? (dataRecord.user as Record<string, unknown>)
    : {};
  const liveRoom = dataRecord.liveRoom && typeof dataRecord.liveRoom === 'object'
    ? (dataRecord.liveRoom as Record<string, unknown>)
    : {};
  const liveStatus = Number(user.status ?? liveRoom.status ?? 0);
  if (liveStatus !== 2) {
    throw new StreamerOfflineError('TikTok meldet keinen aktiven Live-Room');
  }

  const streamData = liveRoom.streamData && typeof liveRoom.streamData === 'object'
    ? (liveRoom.streamData as Record<string, unknown>)
    : {};
  const pull = streamData.pull_data && typeof streamData.pull_data === 'object'
    ? (streamData.pull_data as Record<string, unknown>)
    : {};
  const hevc = liveRoom.hevcStreamData && typeof liveRoom.hevcStreamData === 'object'
    ? (liveRoom.hevcStreamData as Record<string, unknown>)
    : {};
  const hevcPull = hevc.pull_data && typeof hevc.pull_data === 'object'
    ? (hevc.pull_data as Record<string, unknown>)
    : {};
  const formats = [
    ...parseStreamData(pull.stream_data, 'api-live'),
    ...parseStreamData(hevcPull.stream_data, 'api-live-hevc'),
  ];
  if (formats.length === 0) {
    throw new ResolveError(
      'TikTok meldet den Stream als live, liefert aber ohne gültige Login-Session keine Stream-URL',
    );
  }

  const targetHeight =
    quality === 'best' ? null : Number(quality.replace('p', '')) || null;
  const h264 = formats.filter((format) => format.isH264);
  let candidates = h264.length > 0 ? h264 : formats;
  if (targetHeight) {
    const withinQuality = candidates.filter(
      (format) => format.height === null || format.height <= targetHeight,
    );
    if (withinQuality.length > 0) candidates = withinQuality;
  }
  candidates.sort(
    (left, right) =>
      (right.height ?? 0) - (left.height ?? 0) || right.bitrate - left.bitrate,
  );
  const selected = candidates[0]!;
  return {
    url: selected.url,
    vcodec: selected.vcodec,
    height: selected.height,
    formatId: selected.formatId,
    isH264: selected.isH264,
    title: String(liveRoom.title ?? '') || '',
  };
}

export class TikTokResolver {
  private readonly deps: ResolverDeps;

  constructor(deps: ResolverDeps) {
    this.deps = deps;
  }

  async resolve(streamer: StreamerConfig): Promise<ResolvedStream> {
    if (streamer.tiktok.startsWith('rtmp://') || streamer.tiktok.startsWith('rtmps://')) {
      return {
        url: streamer.tiktok,
        vcodec: 'h264',
        height: 720,
        formatId: 'rtmp',
        isH264: true,
        title: streamer.name,
        resolvedAt: new Date(),
      };
    }

    try {
      return await this.resolveWithYtDlp(streamer);
    } catch (error) {
      this.deps.logger.warn(
        { streamer: streamer.id, err: error instanceof Error ? error.message : String(error) },
        'yt-dlp-Auflösung fehlgeschlagen – versuche TikTok-Live-API',
      );
      try {
        return await (this.deps.apiLive ?? ((item) => this.resolveViaApiLive(item)))(streamer);
      } catch (fallbackError) {
        // Prefer the fallback error when it carries a more useful reason
        // (e.g. "live but no stream URL without a valid login").
        if (
          fallbackError instanceof ResolveError &&
          !/keine Daten|nicht ausgeführt|kein gültiges JSON/i.test(fallbackError.message)
        ) {
          throw fallbackError;
        }
        throw error;
      }
    }
  }

  private async resolveViaApiLive(streamer: StreamerConfig): Promise<ResolvedStream> {
    const handle = normalizeHandle(streamer.tiktok);
    const url = new URL('https://www.tiktok.com/api-live/user/room');
    url.searchParams.set('aid', '1988');
    url.searchParams.set('sourceType', '54');
    url.searchParams.set('uniqueId', handle);
    const headers: Record<string, string> = {
      accept: 'application/json',
      referer: `https://www.tiktok.com/@${handle}/live`,
      'user-agent': this.deps.media.sourceUserAgent,
    };
    const session = this.deps.sessionFor?.(streamer);
    const cookie = session?.cookieHeader ?? readCookieHeader(session?.cookieFile ?? this.deps.cookiesFile);
    if (cookie) headers.cookie = cookie;

    let payload: unknown;
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        throw new ResolveError(`TikTok Live-API antwortete mit HTTP ${response.status}`);
      }
      payload = await response.json();
    } catch (error) {
      if (error instanceof ResolveError) throw error;
      throw new ResolveError(
        `TikTok Live-API nicht erreichbar: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const parsed = parseApiLivePayload(payload, streamer.quality);
    this.deps.logger.info(
      {
        streamer: streamer.id,
        source: 'tiktok-api-live',
        height: parsed.height,
        vcodec: parsed.vcodec,
        h264: parsed.isH264,
      },
      'Stream-URL über TikTok-Live-API aufgelöst',
    );
    return {
      url: parsed.url,
      vcodec: parsed.vcodec,
      height: parsed.height,
      formatId: parsed.formatId,
      isH264: parsed.isH264,
      title: parsed.title || streamer.name,
      resolvedAt: new Date(),
    };
  }

  private async resolveWithYtDlp(streamer: StreamerConfig): Promise<ResolvedStream> {
    const session = this.deps.sessionFor?.(streamer);
    const args = buildResolveArgs(streamer, {
      cookiesFile: session?.cookieFile ?? this.deps.cookiesFile,
      media: this.deps.media,
    });
    this.deps.logger.info(
      { streamer: streamer.id, url: args[args.length - 1] },
      'TikTok-Stream wird aufgelöst',
    );
    const result = await (this.deps.runner ?? runCommand)(this.deps.media.ytdlpBin, args, {
      timeoutMs: this.deps.media.ytdlpTimeoutSeconds * 1000,
      logger: this.deps.logger,
      redact: this.deps.redact,
      maxOutputBytes: 16 * 1024 * 1024,
    }).catch((error: unknown) => {
      throw new ResolveError(
        `yt-dlp konnte nicht ausgeführt werden: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    if (result.code !== 0) {
      const output = `${result.stderr}\n${result.stdout}`;
      if (looksOffline(output)) {
        throw new StreamerOfflineError(`@${streamer.tiktok} ist aktuell nicht live`);
      }
      const detail = this.deps.redact
        ? this.deps.redact(output.trim().slice(-1200))
        : output.trim().slice(-1200);
      throw new ResolveError(
        `yt-dlp konnte den Stream nicht auflösen: ${detail || `Exit-Code ${result.code}`}`,
      );
    }

    let info: TikTokInfo;
    try {
      info = JSON.parse(result.stdout) as TikTokInfo;
    } catch {
      throw new ResolveError('yt-dlp lieferte kein gültiges JSON');
    }

    if (info.is_live === false || info.live_status === 'not_started') {
      throw new StreamerOfflineError(`@${streamer.tiktok} ist aktuell nicht live`);
    }

    const format = (() => {
      try {
        return selectFormat(info, { quality: streamer.quality });
      } catch (error) {
        throw new ResolveError(
          `Kein nutzbares Stream-Format gefunden: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })();
    this.deps.logger.info(
      {
        streamer: streamer.id,
        height: format.height,
        vcodec: format.vcodec,
        h264: format.isH264,
        title: info.title,
      },
      'Stream-URL aufgelöst',
    );
    return {
      url: format.url,
      vcodec: format.vcodec,
      height: format.height,
      formatId: format.formatId,
      isH264: format.isH264,
      title: info.title ?? streamer.name,
      resolvedAt: new Date(),
    };
  }
}
