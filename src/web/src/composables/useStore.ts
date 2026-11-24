import { markRaw, reactive } from 'vue';
import { api } from '@/src/api/client';
import type {
  AuthMe,
  DiscoveryResponse,
  EarningsSnapshot,
  LogEntry,
  LoginResult,
  Playlist,
  QueueSnapshot,
  StatusPayload,
  Streamer,
} from '@/src/api/types';
import { StatusPatchStore } from '@/src/composables/status-patch';
import { recordStatus, resetTelemetry } from '@/src/composables/useTelemetry';

export type ConnectionMode = 'connecting' | 'live' | 'offline';

export interface StoreState {
  authenticated: boolean;
  authRequired: boolean;
  authChecked: boolean;
  status: StatusPayload | null;
  streamers: Streamer[];
  playlists: Playlist[];
  earnings: EarningsSnapshot | null;
  queue: QueueSnapshot | null;
  discovery: DiscoveryResponse | null;
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
  earnings: null,
  queue: null,
  discovery: null,
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
    const next = await api.status.get();
    store.status = markRaw(mergePendingPatch(next));
    recordStatus(store.status);
  } finally {
    store.loading.status = false;
  }
}

/* ------------------------------------------------------- optimistic status (#88) */

const statusPatcher = new StatusPatchStore(store);

/** True while an optimistic status patch has not been confirmed or rolled back. */
export function hasPendingPatch(): boolean {
  return statusPatcher.hasPending;
}

/**
 * Applies a local guess immediately so the UI reacts within one frame. The
 * previous server snapshot is kept for `rollbackStatus`.
 */
export function patchStatus(patch: Partial<StatusPayload>): void {
  statusPatcher.patch(patch);
}

/** Drops the local guess and restores the snapshot from before the click. */
export function rollbackStatus(): void {
  statusPatcher.rollback();
}

/** Keeps whatever the server says next; the guess has been confirmed. */
export function confirmStatus(): void {
  statusPatcher.confirm();
}

/** Merges a fresh server snapshot without discarding a young local guess. */
function mergePendingPatch(next: StatusPayload): StatusPayload {
  return statusPatcher.merge(next);
}

export async function refreshStreamers(): Promise<void> {
  store.loading.streamers = true;
  try {
    store.streamers = markRaw(await api.streamers.list());
  } finally {
    store.loading.streamers = false;
  }
}

export async function refreshPlaylists(): Promise<void> {
  store.loading.playlists = true;
  try {
    store.playlists = markRaw(await api.playlists.list());
  } finally {
    store.loading.playlists = false;
  }
}

export async function refreshEarnings(): Promise<void> {
  const earnings = await api.earnings.get();
  store.earnings = earnings ? markRaw(earnings) : null;
}

export async function refreshQueue(): Promise<void> {
  store.queue = markRaw(await api.queue.get());
}

/** Applies a queue snapshot returned by a mutation without an extra round-trip. */
export function applyQueue(snapshot: QueueSnapshot): void {
  store.queue = markRaw(snapshot);
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
  void refreshEarnings().catch(() => undefined);
  void refreshQueue().catch(() => undefined);
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
      if (payload && typeof payload === 'object' && 'state' in payload) {
        store.status = markRaw(mergePendingPatch(payload));
        recordStatus(store.status!);
      }
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
        store.streamers = markRaw(payload);
      } else if (Array.isArray(payload?.streamers)) {
        store.streamers = markRaw(payload.streamers);
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

  source.addEventListener('earnings', (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as EarningsSnapshot | null;
      store.earnings = payload ? markRaw(payload) : null;
    } catch {
      /* ignore malformed events */
    }
  });

  source.addEventListener('queue', (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as QueueSnapshot;
      if (payload && Array.isArray(payload.entries)) {
        store.queue = markRaw(payload);
      }
    } catch {
      /* ignore malformed events */
    }
  });

  source.addEventListener('discovery', (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as DiscoveryResponse;
      if (payload && Array.isArray(payload.hits)) {
        store.discovery = markRaw(payload);
      }
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
  await Promise.allSettled([
    refreshStatus(),
    refreshStreamers(),
    refreshPlaylists(),
    refreshEarnings(),
    refreshQueue(),
  ]);
  connectEvents();
}

export function resetSession(): void {
  stopEvents();
  initialized = false;
  logKeys = new Set<string>();
  resetTelemetry();
  store.authenticated = false;
  store.authChecked = false;
  store.status = null;
  store.streamers = [];
  store.playlists = [];
  store.earnings = null;
  store.queue = null;
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

export async function loginWithPassword(
  password: string,
  totpCode?: string,
): Promise<LoginResult> {
  const result = await api.auth.login(password, totpCode);
  const me = await api.auth.me();
  store.authenticated = me.authenticated;
  store.authRequired = me.auth_required;
  store.authChecked = true;
  return result;
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
    refreshEarnings,
    refreshQueue,
    applyQueue,
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
    patchStatus,
    rollbackStatus,
    confirmStatus,
    hasPendingPatch,
  };
}
