/**
 * Shared discovery feed (#92).
 *
 * Owns results, filters and regie actions once, so the cockpit panel, the
 * `/discovery` view and the command palette work on the same state. Module-level
 * like `useTikTokAccounts`: opening the panel must not refetch what the view
 * already loaded.
 */
import { computed, ref } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { DiscoveryHit, DiscoveryProviderStatus, Streamer } from '@/src/api/types';
import { useStore } from '@/src/composables/useStore';
import { pushToast } from '@/src/composables/useToast';
import {
  applyViewOptions,
  countLive,
  filterHits,
  providerTone,
  sortHits,
  type DiscoverySort,
} from '@/src/utils/discovery-filter';

export type DiscoveryMode = 'trending' | 'search' | 'following';
export type DiscoveryPane = 'grid' | 'zapper';

const STORAGE_KEY = 'relay.discovery.prefs';
const HISTORY_LIMIT = 8;
/** Refresh an idle feed after this long when the tab becomes visible again. */
const STALE_AFTER_MS = 60_000;

export const REGION_OPTIONS = [
  { code: 'DE', label: '🇩🇪 Deutschland (DE)' },
  { code: 'AT', label: '🇦🇹 Österreich (AT)' },
  { code: 'CH', label: '🇨🇭 Schweiz (CH)' },
  { code: 'US', label: '🇺🇸 USA (US)' },
  { code: 'GB', label: '🇬🇧 Großbritannien (GB)' },
  { code: 'FR', label: '🇫🇷 Frankreich (FR)' },
  { code: 'ES', label: '🇪🇸 Spanien (ES)' },
  { code: 'IT', label: '🇮🇹 Italien (IT)' },
  { code: 'NL', label: '🇳🇱 Niederlande (NL)' },
  { code: 'PL', label: '🇵🇱 Polen (PL)' },
  { code: 'TR', label: '🇹🇷 Türkei (TR)' },
  { code: 'BR', label: '🇧🇷 Brasilien (BR)' },
  { code: 'JP', label: '🇯🇵 Japan (JP)' },
] as const;

export const QUICK_TOPICS = [
  { label: '🇩🇪 Deutsch', keyword: 'deutsch' },
  { label: '🎮 Gaming', keyword: 'gaming' },
  { label: '🎵 Musik', keyword: 'musik' },
  { label: '💬 Talk', keyword: 'talk' },
  { label: 'Fortnite', keyword: 'fortnite' },
  { label: '🍳 Lifestyle', keyword: 'kochen' },
] as const;

export const SORT_OPTIONS: { value: DiscoverySort; label: string }[] = [
  { value: 'live', label: 'Live zuerst' },
  { value: 'viewers', label: 'Zuschauer' },
  { value: 'name', label: 'Name' },
];

interface StoredPrefs {
  mode?: DiscoveryMode;
  region?: string;
  history?: string[];
}

function readPrefs(): StoredPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredPrefs) : {};
  } catch {
    return {};
  }
}

function writePrefs(prefs: StoredPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage may be unavailable */
  }
}

const prefs = readPrefs();

/* ------------------------------------------------------------------ state */

const query = ref('');
const mode = ref<DiscoveryMode>(prefs.mode ?? 'trending');
const pane = ref<DiscoveryPane>('grid');
const region = ref(typeof prefs.region === 'string' ? prefs.region : 'DE');
const onlyLive = ref(false);
const sort = ref<DiscoverySort>('live');
const minViewers = ref(0);
const history = ref<string[]>(Array.isArray(prefs.history) ? prefs.history.slice(0, HISTORY_LIMIT) : []);

const hits = ref<DiscoveryHit[]>([]);
const providers = ref<DiscoveryProviderStatus[]>([]);
const loading = ref(false);
const loadingMore = ref(false);
const page = ref(0);
const hasMore = ref(true);
const error = ref<string | null>(null);
const lastFetchedAt = ref(0);
const actionBusy = ref<string | null>(null);
const justAdded = ref<Map<string, Streamer>>(new Map());
const failedAvatars = ref<Set<string>>(new Set());
const zapperIndex = ref(0);
const selectedAccountId = ref('');

let started = false;
let requestId = 0;

/* ------------------------------------------------------------- computed */

const liveHits = computed(() => hits.value.filter((hit) => hit.live));
const totalLive = computed(() => countLive(hits.value));
const visibleHits = computed(() =>
  applyViewOptions(hits.value, { liveOnly: onlyLive.value, minViewers: minViewers.value, sort: sort.value }),
);
const hasActiveFilter = computed(() => onlyLive.value || minViewers.value > 0);
const currentZapperHit = computed<DiscoveryHit | null>(
  () => liveHits.value[zapperIndex.value] ?? liveHits.value[0] ?? null,
);
const providerErrors = computed(() =>
  providers.value.filter((provider) => provider.status !== 'online' && provider.last_error),
);
const allProvidersOffline = computed(
  () => providers.value.length > 0 && providers.value.every((provider) => provider.status !== 'online'),
);
const refreshedLabel = computed(() => {
  if (!lastFetchedAt.value) return '–';
  const seconds = Math.max(0, Math.round((Date.now() - lastFetchedAt.value) / 1000));
  if (seconds < 60) return `vor ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return `vor ${minutes} min`;
});

/* --------------------------------------------------------------- loading */

function rememberPrefs(): void {
  writePrefs({ mode: mode.value, region: region.value, history: history.value });
}

function rememberSearch(term: string): void {
  const trimmed = term.trim();
  if (trimmed.length < 2) return;
  history.value = [trimmed, ...history.value.filter((entry) => entry !== trimmed)].slice(0, HISTORY_LIMIT);
  rememberPrefs();
}

function clearSearchHistory(): void {
  history.value = [];
  rememberPrefs();
}

function applyResponse(response: { hits: DiscoveryHit[]; providers: DiscoveryProviderStatus[] }, reset: boolean): void {
  hits.value = reset ? response.hits : [...hits.value, ...response.hits];
  providers.value = response.providers;
  lastFetchedAt.value = Date.now();
}

async function fetchPage(targetPage: number): Promise<{ hits: DiscoveryHit[]; providers: DiscoveryProviderStatus[] }> {
  const trimmed = query.value.trim();
  if (mode.value === 'search' && trimmed) {
    return api.discovery.search(trimmed, { region: region.value, page: targetPage, limit: 20 });
  }
  if (mode.value === 'following') {
    return api.discovery.following({
      page: targetPage,
      limit: 20,
      account_id: selectedAccountId.value || undefined,
    });
  }
  return api.discovery.trending({ region: region.value, page: targetPage, limit: 30 });
}

async function load(reset = true): Promise<void> {
  const ticket = ++requestId;
  if (reset) {
    loading.value = true;
    error.value = null;
    page.value = 0;
    hasMore.value = true;
  }
  try {
    const response = await fetchPage(reset ? 0 : page.value + 1);
    // A newer request supersedes this one (fast typing, region switch).
    if (ticket !== requestId) return;
    if (reset) {
      hits.value = response.hits;
      providers.value = response.providers;
      lastFetchedAt.value = Date.now();
    } else {
      const known = new Set(hits.value.map((hit) => hit.handle));
      const fresh = response.hits.filter((hit) => !known.has(hit.handle));
      hasMore.value = fresh.length > 0;
      if (fresh.length > 0) {
        hits.value = [...hits.value, ...fresh];
        providers.value = response.providers;
        lastFetchedAt.value = Date.now();
      }
    }
    if (reset) page.value = 0;
    else if (hasMore.value) page.value += 1;
  } catch (err) {
    if (ticket !== requestId) return;
    if (reset) error.value = errorMessage(err);
    // Pagination errors stay silent; the list keeps what it has.
  } finally {
    if (ticket === requestId && reset) loading.value = false;
  }
}

async function loadTrending(): Promise<void> {
  mode.value = 'trending';
  query.value = '';
  rememberPrefs();
  await load();
}

async function runSearch(term?: string): Promise<void> {
  if (typeof term === 'string') query.value = term;
  const trimmed = query.value.trim();
  if (!trimmed) {
    await loadTrending();
    return;
  }
  mode.value = 'search';
  rememberSearch(trimmed);
  await load();
}

async function loadFollowing(opts?: { accountId?: string }): Promise<void> {
  if (typeof opts?.accountId === 'string') selectedAccountId.value = opts.accountId;
  mode.value = 'following';
  query.value = '';
  rememberPrefs();
  await load();
}

async function loadMore(): Promise<void> {
  if (loading.value || loadingMore.value || !hasMore.value) return;
  loadingMore.value = true;
  try {
    await load(false);
  } finally {
    loadingMore.value = false;
  }
}

/** Refresh whatever mode is active; used by the panel footer and visibility. */
async function refresh(): Promise<void> {
  if (mode.value === 'following') await loadFollowing();
  else if (mode.value === 'search' && query.value.trim()) await runSearch();
  else await loadTrending();
}

function setRegion(next: string): void {
  region.value = next;
  rememberPrefs();
  void refresh();
}

function setMode(next: DiscoveryMode): void {
  if (mode.value === next && next !== 'search') return;
  if (next === 'trending') {
    void loadTrending();
  } else if (next === 'following') {
    void loadFollowing();
  } else {
    mode.value = 'search';
  }
}

function setQuery(next: string): void {
  query.value = next;
}

function clearQuery(): void {
  query.value = '';
  if (mode.value === 'search') void loadTrending();
}

function selectTopic(keyword: string): void {
  void runSearch(keyword);
}

/* ---------------------------------------------------------------- zapper */

function openZapperAt(handle?: string): void {
  if (handle) {
    const index = liveHits.value.findIndex((hit) => hit.handle === handle);
    zapperIndex.value = index >= 0 ? index : 0;
  } else if (zapperIndex.value >= liveHits.value.length) {
    zapperIndex.value = 0;
  }
  pane.value = 'zapper';
  // Preload early so zapping past the end keeps working.
  if (zapperIndex.value >= liveHits.value.length - 2) void loadMore();
}

function showGrid(): void {
  pane.value = 'grid';
}

function stepZapper(direction: 1 | -1): void {
  const total = liveHits.value.length;
  if (total === 0) return;
  if (direction === 1) {
    zapperIndex.value = (zapperIndex.value + 1) % total;
    if (zapperIndex.value >= total - 2) void loadMore();
  } else {
    zapperIndex.value = (zapperIndex.value - 1 + total) % total;
  }
}

/* --------------------------------------------------------------- actions */

const existingByHandle = computed(() => {
  const map = new Map<string, Streamer>();
  for (const streamer of useStore().store.streamers) {
    map.set(streamer.tiktok.toLowerCase().replace(/^@/, ''), streamer);
  }
  return map;
});

function getExisting(handle: string): Streamer | undefined {
  const normalized = handle.toLowerCase().replace(/^@/, '');
  return existingByHandle.value.get(normalized) ?? justAdded.value.get(normalized);
}

function markAvatarFailed(handle: string): void {
  if (failedAvatars.value.has(handle)) return;
  const next = new Set(failedAvatars.value);
  next.add(handle);
  failedAvatars.value = next;
}

async function handleAdd(hit: DiscoveryHit): Promise<void> {
  actionBusy.value = `add:${hit.handle}`;
  try {
    const result = await api.discovery.add(hit.handle, hit.display_name);
    justAdded.value.set(hit.handle.toLowerCase().replace(/^@/, ''), result.streamer);
    await useStore().refreshStreamers();
    pushToast(`„${hit.display_name}“ wurde deaktiviert angelegt.`, 'success');
  } catch (err) {
    pushToast(`Speichern fehlgeschlagen: ${errorMessage(err)}`, 'error');
  } finally {
    actionBusy.value = null;
  }
}

async function handleActivate(streamer: Streamer): Promise<void> {
  actionBusy.value = `activate:${streamer.id}`;
  try {
    await api.streamers.update(streamer.id, { enabled: true });
    await useStore().refreshStreamers();
    pushToast(`„${streamer.name}“ ist nun aktiv.`, 'success');
  } catch (err) {
    pushToast(`Aktivieren fehlgeschlagen: ${errorMessage(err)}`, 'error');
  } finally {
    actionBusy.value = null;
  }
}

async function handleQueue(hit: DiscoveryHit): Promise<void> {
  actionBusy.value = `queue:${hit.handle}`;
  try {
    await api.discovery.queue(hit.handle, 'next');
    await useStore().refreshStreamers();
    pushToast(`„${hit.display_name}“ ist das nächste Ziel in der Regie-Queue.`, 'success');
  } catch (err) {
    pushToast(`Queue-Einreihen fehlgeschlagen: ${errorMessage(err)}`, 'error');
  } finally {
    actionBusy.value = null;
  }
}

async function handleSwitch(hit: DiscoveryHit): Promise<void> {
  actionBusy.value = `switch:${hit.handle}`;
  try {
    await api.discovery.switch(hit.handle);
    const { refreshStreamers, refreshStatus } = useStore();
    await Promise.all([refreshStreamers(), refreshStatus()]);
    pushToast(`Restream auf „${hit.display_name}“ gestartet.`, 'success');
  } catch (err) {
    pushToast(`Umschalten fehlgeschlagen: ${errorMessage(err)}`, 'error');
  } finally {
    actionBusy.value = null;
  }
}

/* ------------------------------------------------------------- lifecycle */

function onVisibilityChange(): void {
  if (document.hidden) return;
  if (Date.now() - lastFetchedAt.value <= STALE_AFTER_MS) return;
  if (mode.value === 'search' && !query.value.trim()) return;
  void refresh();
}

/** Idempotent: loads once and attaches the visibility refresh. */
function start(): void {
  if (started) return;
  started = true;
  document.addEventListener('visibilitychange', onVisibilityChange);
  if (hits.value.length === 0) void refresh();
}

export function useDiscoveryFeed() {
  return {
    // state
    query,
    mode,
    pane,
    region,
    onlyLive,
    sort,
    minViewers,
    history,
    hits,
    providers,
    loading,
    loadingMore,
    hasMore,
    error,
    lastFetchedAt,
    actionBusy,
    failedAvatars,
    zapperIndex,
    selectedAccountId,
    // computed
    liveHits,
    totalLive,
    visibleHits,
    hasActiveFilter,
    currentZapperHit,
    providerErrors,
    allProvidersOffline,
    refreshedLabel,
    // loading
    loadTrending,
    runSearch,
    loadFollowing,
    loadMore,
    refresh,
    setRegion,
    setMode,
    setQuery,
    clearQuery,
    selectTopic,
    rememberSearch,
    clearSearchHistory,
    // zapper
    openZapperAt,
    showGrid,
    stepZapper,
    // actions
    getExisting,
    markAvatarFailed,
    handleAdd,
    handleActivate,
    handleQueue,
    handleSwitch,
    // misc
    providerTone,
    filterHits,
    sortHits,
    start,
  };
}
