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

export interface LiveBroadcastResource {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    scheduledStartTime?: string;
    actualStartTime?: string;
    actualEndTime?: string;
    thumbnails?: { default?: { url?: string } };
  };
  status?: {
    lifeCycleStatus?: string;
    privacyStatus?: string;
  };
  contentDetails?: {
    boundStreamId?: string;
  };
}

export interface LiveStreamResource {
  id: string;
  status?: {
    streamStatus?: string;
    healthStatus?: { status?: string };
  };
  cdn?: {
    ingestionInfo?: { streamName?: string };
  };
}

export interface LiveChatMessageResource {
  id: string;
  snippet?: {
    type?: string;
    displayMessage?: string;
    publishedAt?: string;
    textMessageDetails?: { messageText?: string };
  };
  authorDetails?: {
    channelId?: string;
    displayName?: string;
    profileImageUrl?: string;
    isChatModerator?: boolean;
    isChatOwner?: boolean;
    isChatSponsor?: boolean;
  };
}

export interface LiveChatMessagesResponse {
  nextPageToken?: string;
  pollingIntervalMillis?: number;
  offlineAt?: string;
  items?: LiveChatMessageResource[];
}

export interface BroadcastInsertBody {
  snippet: {
    title: string;
    description?: string;
    scheduledStartTime: string;
  };
  status: {
    privacyStatus: 'public' | 'unlisted' | 'private';
    selfDeclaredMadeForKids?: boolean;
  };
  contentDetails: {
    enableDvr?: boolean;
    enableAutoStart?: boolean;
    enableAutoStop?: boolean;
    recordFromStart?: boolean;
  };
}

export interface BroadcastUpdateBody {
  snippet?: {
    title?: string;
    description?: string;
    scheduledStartTime?: string;
  };
  status?: {
    privacyStatus?: 'public' | 'unlisted' | 'private';
  };
}

async function request<T>(
  accessToken: string,
  path: string,
  params: Record<string, string | number | undefined> = {},
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    accept: 'application/json',
  };
  if (init.body !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
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

/** Lists broadcasts of the authenticated channel (single page, newest first). */
export async function listBroadcasts(
  accessToken: string,
  options: { maxResults?: number; status?: string } = {},
): Promise<LiveBroadcastResource[]> {
  const data = await request<{ items?: LiveBroadcastResource[] }>(accessToken, '/liveBroadcasts', {
    part: 'snippet,status,contentDetails',
    mine: 'true',
    broadcastType: 'all',
    maxResults: options.maxResults ?? 50,
    broadcastStatus: options.status,
  });
  return data.items ?? [];
}

/** Lists ingest streams; the RTMP key inside `cdn` is intentionally dropped. */
export async function listLiveStreams(accessToken: string): Promise<LiveStreamResource[]> {
  const data = await request<{ items?: LiveStreamResource[] }>(accessToken, '/liveStreams', {
    part: 'id,status,cdn',
    mine: 'true',
    maxResults: 50,
  });
  return (data.items ?? []).map((item) => ({
    id: item.id,
    status: {
      streamStatus: item.status?.streamStatus,
      healthStatus: { status: item.status?.healthStatus?.status },
    },
    cdn: { ingestionInfo: { streamName: item.cdn?.ingestionInfo?.streamName } },
  }));
}

export async function getBroadcast(
  accessToken: string,
  id: string,
): Promise<LiveBroadcastResource | null> {
  const data = await request<{ items?: LiveBroadcastResource[] }>(accessToken, '/liveBroadcasts', {
    part: 'snippet,status,contentDetails',
    id,
  });
  return data.items?.[0] ?? null;
}

export async function insertBroadcast(
  accessToken: string,
  body: BroadcastInsertBody,
): Promise<LiveBroadcastResource> {
  return request<LiveBroadcastResource>(
    accessToken,
    '/liveBroadcasts',
    { part: 'snippet,status,contentDetails' },
    { method: 'POST', body },
  );
}

export async function updateBroadcast(
  accessToken: string,
  id: string,
  body: BroadcastUpdateBody,
): Promise<LiveBroadcastResource> {
  return request<LiveBroadcastResource>(
    accessToken,
    '/liveBroadcasts',
    { part: 'snippet,status' },
    { method: 'PUT', body: { id, ...body } },
  );
}

export async function bindBroadcast(
  accessToken: string,
  id: string,
  streamId: string,
): Promise<LiveBroadcastResource> {
  return request<LiveBroadcastResource>(
    accessToken,
    '/liveBroadcasts/bind',
    { part: 'id,contentDetails', id, streamId },
    { method: 'POST' },
  );
}

export async function transitionBroadcast(
  accessToken: string,
  id: string,
  status: 'testing' | 'live' | 'complete',
): Promise<LiveBroadcastResource> {
  return request<LiveBroadcastResource>(
    accessToken,
    '/liveBroadcasts/transition',
    { part: 'status', broadcastStatus: status, id },
    { method: 'POST' },
  );
}

export async function deleteBroadcast(accessToken: string, id: string): Promise<void> {
  await request<null>(accessToken, '/liveBroadcasts', { id }, { method: 'DELETE' });
}

export async function insertLiveStream(
  accessToken: string,
  title: string,
): Promise<LiveStreamResource> {
  return request<LiveStreamResource>(
    accessToken,
    '/liveStreams',
    { part: 'snippet,status,cdn' },
    {
      method: 'POST',
      body: {
        snippet: { title: title.slice(0, 128) },
        cdn: { ingestionType: 'rtmp', frameRate: 'variable', resolution: 'variable' },
        status: { streamStatus: 'active' },
      },
    },
  );
}

/** Resolves the active liveChatId for a YouTube video/broadcast ID. */
export async function fetchActiveLiveChatId(
  accessToken: string,
  videoId: string,
): Promise<string | null> {
  const data = await request<{
    items?: { liveStreamingDetails?: { activeLiveChatId?: string } }[];
  }>(accessToken, '/videos', {
    part: 'liveStreamingDetails',
    id: videoId,
  });
  return data.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null;
}

/** Fetches a single page of YouTube live chat messages. */
export async function listLiveChatMessages(
  accessToken: string,
  liveChatId: string,
  pageToken?: string,
): Promise<LiveChatMessagesResponse> {
  return request<LiveChatMessagesResponse>(accessToken, '/liveChat/messages', {
    part: 'snippet,authorDetails',
    liveChatId,
    maxResults: 50,
    pageToken,
  });
}

export interface ThumbnailItem {
  url?: string;
  width?: number;
  height?: number;
}

export interface ThumbnailSetResponse {
  kind?: string;
  etag?: string;
  items?: {
    default?: ThumbnailItem;
    medium?: ThumbnailItem;
    high?: ThumbnailItem;
    standard?: ThumbnailItem;
    maxres?: ThumbnailItem;
  }[];
}

/** Uploads and assigns a thumbnail image to a YouTube video / live broadcast. */
export async function setBroadcastThumbnail(
  accessToken: string,
  videoId: string,
  imageBuffer: Buffer,
  mimeType: string,
): Promise<ThumbnailSetResponse> {
  const url = new URL('https://www.googleapis.com/upload/youtube/v3/thumbnails/set');
  url.searchParams.set('videoId', videoId);
  url.searchParams.set('uploadType', 'media');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': mimeType,
        accept: 'application/json',
      },
      body: imageBuffer,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new YouTubeApiError('Die YouTube-API ist nicht erreichbar.', 'network_error');
  }

  const data = (await response.json().catch(() => null)) as
    | (ThumbnailSetResponse & GoogleErrorBody)
    | null;
  if (!response.ok) {
    const reason = data?.error?.errors?.[0]?.reason ?? `http_${response.status}`;
    if (response.status === 401) {
      throw new YouTubeApiError('Die YouTube-Anmeldung ist abgelaufen.', 'unauthorized', 409);
    }
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
      throw new YouTubeApiError('Das YouTube-API-Tageslimit ist erreicht.', 'quota_exceeded', 429);
    }
    throw new YouTubeApiError(
      `YouTube hat den Thumbnail-Upload abgelehnt (${reason}).`,
      reason,
      response.status >= 500 ? 502 : 400,
    );
  }
  return (data ?? {}) as ThumbnailSetResponse;
}
