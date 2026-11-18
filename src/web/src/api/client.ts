import type {
  AuthMe,
  AuthMethods,
  AuthSessionInfo,
  BulkAddInput,
  BulkAddResult,
  EarningsHistoryPoint,
  EarningsPeriod,
  EarningsSnapshot,
  PauseAsset,
  PausePreviewInput,
  LogEntry,
  LogsResponse,
  MediaFile,
  Playlist,
  PlaylistInput,
  PlaylistsResponse,
  Settings,
  SettingsUpdate,
  StatusPayload,
  Streamer,
  StreamerCreateInput,
  StreamerInput,
  StreamerOverlaysInput,
  StreamersResponse,
  StudioPreviewInput,
  QuickStartInput,
  TelegramLoginRequest,
  TelegramLoginStatus,
  TitlePreview,
  YouTubeStatus,
} from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  signal?: AbortSignal;
  /** Set to false to handle 401 responses locally (used by auth endpoints). */
  authRedirect?: boolean;
}

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function extractMessage(data: unknown, status: number): { code: string; message: string } {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    const error = record['error'];
    if (error && typeof error === 'object') {
      const detail = error as Record<string, unknown>;
      const code = typeof detail['code'] === 'string' ? detail['code'] : 'http_error';
      const message = typeof detail['message'] === 'string' ? detail['message'] : '';
      if (message) return { code, message };
    }
    if (typeof record['message'] === 'string' && record['message']) {
      return { code: 'http_error', message: record['message'] };
    }
  }
  return {
    code: status === 0 ? 'network_error' : 'http_error',
    message:
      status === 0
        ? 'Verbindung zum Server fehlgeschlagen.'
        : `Anfrage fehlgeschlagen (HTTP ${status}).`,
  };
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'include',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'network_error', 'Verbindung zum Server fehlgeschlagen.');
  }

  const contentType = response.headers.get('content-type') ?? '';
  let data: unknown = null;
  if (response.status !== 204) {
    if (contentType.includes('application/json')) {
      data = await response.json().catch(() => null);
    } else {
      await response.text().catch(() => '');
    }
  }

  if (!response.ok) {
    const { code, message } = extractMessage(data, response.status);
    if (response.status === 401 && options.authRedirect !== false) {
      unauthorizedHandler?.();
    }
    throw new ApiError(response.status, code, message);
  }

  return data as T;
}

function normalizeList<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const value = (data as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}

function normalizeLogs(data: unknown): LogEntry[] {
  return normalizeList<LogEntry>(data, 'lines');
}

function unwrapResource<T>(data: unknown, key: string): T {
  if (data && typeof data === 'object' && key in data) {
    return (data as Record<string, unknown>)[key] as T;
  }
  return data as T;
}

export interface AuthApi {
  me(): Promise<AuthMe>;
  methods(): Promise<AuthMethods>;
  login(password: string): Promise<{ ok: true }>;
  telegramRequest(): Promise<TelegramLoginRequest>;
  telegramCheck(token: string): Promise<TelegramLoginStatus>;
  logout(): Promise<{ ok: true }>;
  sessions(): Promise<{ sessions: AuthSessionInfo[] }>;
  revokeSession(id: string): Promise<{ ok: true }>;
  revokeAllSessions(): Promise<{ ok: true; removed: number }>;
}

export interface StatusApi {
  get(): Promise<StatusPayload>;
}

export interface StreamersApi {
  list(): Promise<Streamer[]>;
  get(id: string): Promise<Streamer>;
  create(body: StreamerCreateInput): Promise<Streamer>;
  update(id: string, body: StreamerInput): Promise<Streamer>;
  remove(id: string): Promise<void>;
  start(id: string): Promise<unknown>;
  stop(id: string): Promise<unknown>;
  switchTo(id: string): Promise<unknown>;
  title(id: string): Promise<TitlePreview>;
  bulkAdd(body: BulkAddInput): Promise<BulkAddResult>;
}

export interface SettingsApi {
  get(): Promise<Settings>;
  update(body: Partial<SettingsUpdate>): Promise<Settings>;
}

export interface PlaylistsApi {
  list(): Promise<Playlist[]>;
  create(body: PlaylistInput): Promise<unknown>;
  update(id: string, body: PlaylistInput): Promise<unknown>;
  remove(id: string): Promise<unknown>;
  play(id: string): Promise<unknown>;
  next(): Promise<unknown>;
  previous(): Promise<unknown>;
  tune(playlistId: string, channel: string): Promise<unknown>;
  stop(): Promise<unknown>;
}

export const api = {
  auth: {
    me: () => request<AuthMe>('/api/auth/me', { authRedirect: false }),
    methods: () => request<AuthMethods>('/api/auth/methods', { authRedirect: false }),
    login: (password: string) =>
      request<{ ok: true }>('/api/auth/login', {
        method: 'POST',
        body: { password },
        authRedirect: false,
      }),
    telegramRequest: () =>
      request<TelegramLoginRequest>('/api/auth/telegram/request', {
        method: 'POST',
        authRedirect: false,
      }),
    telegramCheck: (token: string) =>
      request<TelegramLoginStatus>('/api/auth/telegram/check', {
        method: 'POST',
        body: { token },
        authRedirect: false,
      }),
    logout: () =>
      request<{ ok: true }>('/api/auth/logout', { method: 'POST', authRedirect: false }),
    sessions: () => request<{ sessions: AuthSessionInfo[] }>('/api/auth/sessions'),
    revokeSession: (id: string) =>
      request<{ ok: true }>(`/api/auth/sessions/${encodeURIComponent(id)}/revoke`, {
        method: 'POST',
      }),
    revokeAllSessions: () =>
      request<{ ok: true; removed: number }>('/api/auth/sessions/revoke-all', {
        method: 'POST',
      }),
  } satisfies AuthApi,

  status: {
    get: () => request<StatusPayload>('/api/status'),
  } satisfies StatusApi,

  earnings: {
    get: () => request<EarningsSnapshot | null>('/api/earnings'),
    history: (period: EarningsPeriod, limit = 240) =>
      request<{ period: EarningsPeriod; points: EarningsHistoryPoint[] }>(
        `/api/earnings/history?period=${encodeURIComponent(period)}&limit=${limit}`,
      ),
    setPeriod: (period: EarningsPeriod) =>
      request<{ ok: true; earnings: EarningsSnapshot | null }>('/api/earnings/period', {
        method: 'POST',
        body: { period },
      }),
    refresh: () =>
      request<{ ok: true; earnings: EarningsSnapshot | null }>('/api/earnings/refresh', {
        method: 'POST',
      }),
  },

  streamers: {
    list: async () => normalizeList<Streamer>(await request<StreamersResponse>('/api/streamers'), 'streamers'),
    get: async (id: string) =>
      unwrapResource<Streamer>(
        await request<unknown>(`/api/streamers/${encodeURIComponent(id)}`),
        'streamer',
      ),
    create: async (body: StreamerCreateInput) =>
      unwrapResource<Streamer>(
        await request<unknown>('/api/streamers', { method: 'POST', body }),
        'streamer',
      ),
    update: async (id: string, body: StreamerInput) =>
      unwrapResource<Streamer>(
        await request<unknown>(`/api/streamers/${encodeURIComponent(id)}`, { method: 'PUT', body }),
        'streamer',
      ),
    remove: async (id: string) => {
      await request<unknown>(`/api/streamers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    start: (id: string) =>
      request<unknown>(`/api/streamers/${encodeURIComponent(id)}/start`, { method: 'POST' }),
    stop: (id: string) =>
      request<unknown>(`/api/streamers/${encodeURIComponent(id)}/stop`, { method: 'POST' }),
    switchTo: (id: string) =>
      request<unknown>(`/api/streamers/${encodeURIComponent(id)}/switch`, { method: 'POST' }),
    title: (id: string) =>
      request<TitlePreview>(`/api/streamers/${encodeURIComponent(id)}/title`),
    bulkAdd: (body: BulkAddInput) =>
      request<BulkAddResult>('/api/streamers/bulk', { method: 'POST', body }),
  } satisfies StreamersApi,

  settings: {
    get: () => request<Settings>('/api/settings'),
    update: (body: Partial<SettingsUpdate>) => request<Settings>('/api/settings', { method: 'PUT', body }),
  } satisfies SettingsApi,

  media: {
    list: () => request<{ files: MediaFile[] }>('/api/media'),
  },

  playlists: {
    list: async () =>
      normalizeList<Playlist>(await request<PlaylistsResponse>('/api/playlists'), 'playlists'),
    create: (body: PlaylistInput) =>
      request<unknown>('/api/playlists', { method: 'POST', body }),
    update: (id: string, body: PlaylistInput) =>
      request<unknown>(`/api/playlists/${encodeURIComponent(id)}`, { method: 'PUT', body }),
    remove: (id: string) =>
      request<unknown>(`/api/playlists/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    play: (id: string) =>
      request<unknown>(`/api/playlists/${encodeURIComponent(id)}/play`, { method: 'POST' }),
    next: () => request<unknown>('/api/playlists/next', { method: 'POST' }),
    previous: () => request<unknown>('/api/playlists/previous', { method: 'POST' }),
    tune: (playlistId: string, channel: string) =>
      request<unknown>(
        `/api/playlists/${encodeURIComponent(playlistId)}/tune/${encodeURIComponent(channel)}`,
        { method: 'POST' },
      ),
    stop: () => request<unknown>('/api/playlists/stop', { method: 'POST' }),
  } satisfies PlaylistsApi,

  logs: {
    list: async (limit = 300) => normalizeLogs(await request<LogsResponse>(`/api/logs?limit=${limit}`)),
    clear: () => request<{ ok: true }>('/api/logs', { method: 'DELETE' }),
  },

  overlays: {
    previewUrl: (sample = false): string =>
      `/api/overlays/preview.png${sample ? '?sample=1&' : '?'}t=${Date.now()}`,
    save: (overlays: StreamerOverlaysInput) =>
      request<Settings>('/api/overlays', { method: 'PUT', body: { overlays } }),
    studioPreview: async (body: StudioPreviewInput, signal?: AbortSignal): Promise<Blob> => {
      let response: Response;
      try {
        response = await fetch('/api/overlays/studio.png', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'image/png' },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        throw new ApiError(0, 'network_error', 'Verbindung zum Server fehlgeschlagen.');
      }
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const { code, message } = extractMessage(data, response.status);
        if (response.status === 401) unauthorizedHandler?.();
        throw new ApiError(response.status, code, message);
      }
      return response.blob();
    },
  },

  chat: {
    test: (username: string, text: string) =>
      request<{ ok: true; count: number }>('/api/chat/test', {
        method: 'POST',
        body: { username, text },
      }),
  },

  system: {
    restartSink: () => request<unknown>('/api/system/restart-sink', { method: 'POST' }),
    refreshSource: () => request<unknown>('/api/system/refresh', { method: 'POST' }),
    reload: () => request<{ ok: true; changed: boolean }>('/api/reload', { method: 'POST' }),
    checkOnline: () => request<{ ok: true }>('/api/online/check', { method: 'POST' }),
  },

  quickstart: (body: QuickStartInput) =>
    request<unknown>('/api/quickstart', { method: 'POST', body }),

  screens: {
    show: (type: 'startup' | 'pause') =>
      request<unknown>(`/api/screens/${type}/start`, { method: 'POST' }),
    stop: () => request<unknown>('/api/screens/stop', { method: 'POST' }),
  },

  pause: {
    start: () => request<unknown>('/api/pause/start', { method: 'POST' }),    stop: () => request<unknown>('/api/pause/stop', { method: 'POST' }),
    assetUrl: (filename: string): string =>
      `/api/pause/assets/${encodeURIComponent(filename)}`,
    upload: async (file: File): Promise<PauseAsset> => {
      const form = new FormData();
      form.append('file', file);
      let response: Response;
      try {
        response = await fetch('/api/pause/assets', {
          method: 'POST',
          credentials: 'include',
          body: form,
        });
      } catch {
        throw new ApiError(0, 'network_error', 'Verbindung zum Server fehlgeschlagen.');
      }
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const { code, message } = extractMessage(data, response.status);
        if (response.status === 401) unauthorizedHandler?.();
        throw new ApiError(response.status, code, message);
      }
      return (data as { asset: PauseAsset }).asset;
    },
    remove: (filename: string) =>
      request<{ ok: true }>(`/api/pause/assets/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      }),
    preview: async (body: PausePreviewInput, signal?: AbortSignal): Promise<Blob> => {
      let response: Response;
      try {
        response = await fetch('/api/pause/preview.png', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        throw new ApiError(0, 'network_error', 'Verbindung zum Server fehlgeschlagen.');
      }
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const { code, message } = extractMessage(data, response.status);
        if (response.status === 401) unauthorizedHandler?.();
        throw new ApiError(response.status, code, message);
      }
      return response.blob();
    },
  },
  youtube: {
    status: () => request<YouTubeStatus>('/api/youtube/status'),
    start: () => request<{ url: string }>('/api/youtube/oauth/start'),
    disconnect: () =>
      request<YouTubeStatus>('/api/youtube/oauth/disconnect', { method: 'POST' }),
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Ein unbekannter Fehler ist aufgetreten.';
}
