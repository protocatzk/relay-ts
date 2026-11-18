import { AppError } from '../../utils/errors.js';

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const REQUEST_TIMEOUT_MS = 15_000;

interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    errors?: { reason?: string; message?: string }[];
  };
}

export class YouTubeApiError extends AppError {
  readonly reason: string;

  constructor(message: string, reason: string, status = 502) {
    super('youtube_api_failed', message, status, { reason });
    this.name = 'YouTubeApiError';
    this.reason = reason;
  }
}

export interface ChannelInfo {
  id: string;
  title: string;
}

async function request<T>(
  accessToken: string,
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new YouTubeApiError('Die YouTube-API ist nicht erreichbar.', 'network_error');
  }

  const data = (await response.json().catch(() => null)) as (T & GoogleErrorBody) | null;
  if (!response.ok) {
    const reason = data?.error?.errors?.[0]?.reason ?? `http_${response.status}`;
    if (response.status === 401) {
      throw new YouTubeApiError('Die YouTube-Anmeldung ist abgelaufen.', 'unauthorized', 409);
    }
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
      throw new YouTubeApiError('Das YouTube-API-Tageslimit ist erreicht.', 'quota_exceeded', 429);
    }
    throw new YouTubeApiError(
      `YouTube hat die Anfrage abgelehnt (${reason}).`,
      reason,
      response.status >= 500 ? 502 : 400,
    );
  }
  return data as T;
}

/** Returns the channel of the authenticated account, or null when none exists. */
export async function fetchChannelInfo(accessToken: string): Promise<ChannelInfo | null> {
  const data = await request<{ items?: { id?: string; snippet?: { title?: string } }[] }>(
    accessToken,
    '/channels',
    { part: 'snippet', mine: 'true' },
  );
  const item = data.items?.[0];
  if (!item?.id) return null;
  return { id: item.id, title: item.snippet?.title ?? '' };
}

export { request as youtubeApiRequest };
