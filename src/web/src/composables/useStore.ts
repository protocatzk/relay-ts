import { reactive } from 'vue';
import { api } from '@/src/api/client';
import type { AuthMe, LogEntry, Playlist, StatusPayload, Streamer } from '@/src/api/types';

export type ConnectionMode = 'connecting' | 'live' | 'offline';

export interface StoreState {
  authenticated: boolean;
  authRequired: boolean;
  authChecked: boolean;
  status: StatusPayload | null;
  streamers: Streamer[];
  playlists: Playlist[];
  logs: LogEntry[];
  sseConnected: boolean;
  connectionMode: ConnectionMode;
  loading: {
    status: boolean;
    streamers: boolean;
    playlists: boolean;
    logs: boolean;
  };
}

const MAX_LOGS = 2000;

export const store = reactive<StoreState>({
  authenticated: false,
  authRequired: false,
  authChecked: false,
  status: null,
  streamers: [],
  playlists: [],
  logs: [],
  sseConnected: false,
  connectionMode: 'connecting',
  loading: {
    status: false,
    streamers: false,
    playlists: false,
    logs: false,
  },
});

let initialized = false;
let eventSource: EventSource | null = null;
let pollTimer: number | null = null;
let logKeys = new Set<string>();

function logKey(entry: LogEntry): string {
  return `${entry.time}|${entry.level}|${entry.msg}`;
}

function sortLogs(): void {
  store.logs.sort((a, b) => {
    const aTime = Date.parse(a.time);
    const bTime = Date.parse(b.time);
    if (Number.isNaN(aTime) || Number.isNaN(bTime)) return 0;
    return aTime - bTime;
  });
  if (store.logs.length > MAX_LOGS) {
    store.logs.splice(0, store.logs.length - MAX_LOGS);
    logKeys = new Set(store.logs.map(logKey));
  }
}

export function appendLog(entry: LogEntry): void {
  if (!entry || typeof entry.time !== 'string' || typeof entry.msg !== 'string') return;
  const key = logKey(entry);
  if (logKeys.has(key)) return;
  logKeys.add(key);
  store.logs.push(entry);
  if (store.logs.length > MAX_LOGS) {
    const removed = store.logs.shift();
    if (removed) logKeys.delete(logKey(removed));
  }
}

export function mergeLogs(entries: LogEntry[]): void {
  let added = false;
  for (const entry of entries) {
    if (!entry || typeof entry.time !== 'string' || typeof entry.msg !== 'string') continue;
    const key = logKey(entry);
    if (logKeys.has(key)) continue;
    logKeys.add(key);
    store.logs.push(entry);
    added = true;
  }
  if (added) sortLogs();
}

export function clearLogs(): void {
  store.logs.splice(0, store.logs.length);
  logKeys = new Set<string>();
}

export async function refreshStatus(): Promise<void> {
  store.loading.status = true;
  try {
    store.status = await api.status.get();
  } finally {
    store.loading.status = false;
  }
}

export async function refreshStreamers(): Promise<void> {
  store.loading.streamers = true;
  try {
    store.streamers = await api.streamers.list();
  } finally {
    store.loading.streamers = false;
  }
}

export async function refreshPlaylists(): Promise<void> {
  store.loading.playlists = true;
  try {
    store.playlists = await api.playlists.list();
  } finally {
    store.loading.playlists = false;
  }
}

export async function refreshLogs(limit = 300): Promise<void> {
  store.loading.logs = true;
  try {
    mergeLogs(await api.logs.list(limit));
  } finally {
    store.loading.logs = false;
  }
}

function startPolling(): void {
  if (pollTimer !== null) return;
  void refreshStatus().catch(() => undefined);
  pollTimer = window.setInterval(() => {
    void refreshStatus().catch(() => undefined);
    void refreshStreamers().catch(() => undefined);
    void refreshPlaylists().catch(() => undefined);
  }, 10_000);
}

function stopPolling(): void {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function connectEvents(): void {
  if (eventSource) return;
  if (typeof EventSource === 'undefined') {
    store.connectionMode = 'offline';
    startPolling();
    return;
  }

  store.connectionMode = 'connecting';
  const source = new EventSource('/api/events');
  eventSource = source;

  source.addEventListener('open', () => {
    store.sseConnected = true;
    store.connectionMode = 'live';
    stopPolling();
  });

  source.addEventListener('status', (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as StatusPayload;
      if (payload && typeof payload === 'object' && 'state' in payload) store.status = payload;
    } catch {
      /* ignore malformed events */
    }
  });

  source.addEventListener('streamers', (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as
        | Streamer[]
        | { streamers?: Streamer[] };
      if (Array.isArray(payload)) {
        store.streamers = payload;
      } else if (Array.isArray(payload?.streamers)) {
        store.streamers = payload.streamers;
      }
    } catch {
      /* ignore malformed events */
    }
  });

  source.addEventListener('log', (event) => {
    try {
      const entry = JSON.parse((event as MessageEvent<string>).data) as LogEntry;
      appendLog(entry);
    } catch {
      /* ignore malformed events */
    }
  });

  source.addEventListener('error', () => {
    store.sseConnected = false;
    store.connectionMode = 'offline';
    startPolling();
  });
}

export function stopEvents(): void {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  stopPolling();
  store.sseConnected = false;
  store.connectionMode = 'offline';
}

export async function bootstrap(): Promise<void> {
  if (initialized) return;
  initialized = true;
  await Promise.allSettled([refreshStatus(), refreshStreamers(), refreshPlaylists()]);
  connectEvents();
}

export function resetSession(): void {
  stopEvents();
  initialized = false;
  logKeys = new Set<string>();
  store.authenticated = false;
  store.authChecked = false;
  store.status = null;
  store.streamers = [];
  store.playlists = [];
  store.logs = [];
  store.loading.status = false;
  store.loading.streamers = false;
  store.loading.playlists = false;
  store.loading.logs = false;
}

export async function loadAuth(): Promise<AuthMe | null> {
  try {
    const me = await api.auth.me();
    store.authenticated = me.authenticated;
    store.authRequired = me.auth_required;
    store.authChecked = true;
    return me;
  } catch {
    store.authChecked = true;
    store.authenticated = false;
    return null;
  }
}

export async function loginWithPassword(password: string): Promise<void> {
  await api.auth.login(password);
  const me = await api.auth.me();
  store.authenticated = me.authenticated;
  store.authRequired = me.auth_required;
  store.authChecked = true;
}

export async function logout(): Promise<void> {
  try {
    await api.auth.logout();
  } catch {
    /* the local session is cleared regardless */
  }
  resetSession();
  // Prevent the login route from immediately re-checking the session and
  // bouncing back to the dashboard when the cookie could not be cleared.
  store.authChecked = true;
}

export function useStore() {
  return {
    store,
    bootstrap,
    refreshStatus,
    refreshStreamers,
    refreshPlaylists,
    refreshLogs,
    connectEvents,
    stopEvents,
    resetSession,
    loadAuth,
    loginWithPassword,
    logout,
    appendLog,
    mergeLogs,
    clearLogs,
  };
}
