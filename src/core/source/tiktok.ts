export const OFFLINE_MARKERS = [
  'is not currently live',
  'not currently live',
  'user is not live',
  'currently offline',
  'live event will begin',
  'this live event has ended',
  'the live event has ended',
  'no live stream',
  'livestream is not',
  'streamer is offline',
  'this account is private',
];

export interface TikTokFormat {
  url?: string;
  vcodec?: string;
  acodec?: string;
  height?: number;
  width?: number;
  resolution?: string;
  quality?: number;
  tbr?: number;
  format_id?: string;
  protocol?: string;
}

export interface TikTokInfo {
  url?: string;
  title?: string;
  is_live?: boolean;
  live_status?: string;
  vcodec?: string;
  height?: number;
  resolution?: string;
  formats?: TikTokFormat[];
  id?: string;
  uploader?: string;
  webpage_url?: string;
}

export interface ResolvedStream {
  url: string;
  vcodec: string;
  height: number | null;
  formatId: string | null;
  isH264: boolean;
  title: string;
  resolvedAt: Date;
}

export function normalizeTikTokUrl(input: string): string {
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(www\.)?tiktok\.com\//i.test(value)) return `https://${value}`;
  const handle = value.replace(/^@+/, '');
  return `https://www.tiktok.com/@${handle}/live`;
}

export function formatHeight(format: TikTokFormat): number {
  if (typeof format.height === 'number' && format.height > 0) return Math.floor(format.height);
  const resolution = String(format.resolution ?? '');
  const match = /(\d+)x(\d+)/.exec(resolution);
  if (match) return Math.max(Number(match[1]), Number(match[2]));
  const short = /(\d+)p/.exec(resolution);
  return short ? Number(short[1]) : 0;
}

export function isAudioOnly(format: TikTokFormat): boolean {
  if (String(format.vcodec ?? '').toLowerCase() === 'none') return true;
  if (String(format.format_id ?? '').toLowerCase().endsWith('-ao')) return true;
  return String(format.url ?? '').includes('only_audio=1');
}

export function isH264Format(format: TikTokFormat): boolean {
  return /^(avc1|avc3|h264)/i.test(String(format.vcodec ?? ''));
}

export interface SelectFormatOptions {
  quality?: 'best' | '1080p' | '720p' | '480p' | '360p';
}

export function selectFormat(
  info: TikTokInfo,
  options: SelectFormatOptions = {},
): { url: string; vcodec: string; height: number | null; formatId: string | null; isH264: boolean } {
  const formats = (info.formats ?? []).filter(
    (format) => Boolean(format.url) && !isAudioOnly(format),
  );
  const targetHeight = options.quality && options.quality !== 'best' ? Number(options.quality.replace('p', '')) : null;

  if (formats.length > 0) {
    const h264 = formats.filter(isH264Format);
    const pool = h264.length > 0 ? h264 : formats;
    const withinQuality = targetHeight
      ? pool.filter((format) => {
          const height = formatHeight(format);
          return height === 0 || height <= targetHeight;
        })
      : pool;
    const candidates = withinQuality.length > 0 ? withinQuality : pool;
    const best = candidates.reduce((left, right) => {
      const leftScore = [formatHeight(left), Number(left.quality ?? 0), Number(left.tbr ?? 0)];
      const rightScore = [formatHeight(right), Number(right.quality ?? 0), Number(right.tbr ?? 0)];
      for (let index = 0; index < leftScore.length; index += 1) {
        if (leftScore[index]! !== rightScore[index]!) {
          return leftScore[index]! > rightScore[index]! ? left : right;
        }
      }
      return left;
    });
    return {
      url: String(best.url),
      vcodec: String(best.vcodec ?? ''),
      height: formatHeight(best) || null,
      formatId: best.format_id ?? null,
      isH264: isH264Format(best),
    };
  }

  if (!info.url) {
    throw new Error('yt-dlp lieferte weder Formate noch eine Stream-URL');
  }
  return {
    url: info.url,
    vcodec: String(info.vcodec ?? ''),
    height: info.height ?? (formatHeight({ resolution: info.resolution }) || null),
    formatId: null,
    isH264: /^(avc1|avc3|h264)/i.test(String(info.vcodec ?? '')),
  };
}

export function looksOffline(text: string): boolean {
  const lower = text.toLowerCase();
  return OFFLINE_MARKERS.some((marker) => lower.includes(marker));
}
