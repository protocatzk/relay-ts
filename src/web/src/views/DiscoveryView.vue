<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import ModalDialog from '@/src/components/ModalDialog.vue';
import type { DiscoveryHit, DiscoveryProviderStatus, Streamer, TikTokAccountPublic } from '@/src/api/types';
import { useStore } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';
import {
  DEFAULT_AVATAR_SVG_URL,
  resolveAvatarSrc,
} from '@/src/composables/useAvatarFallback';

type ZapperPlayerStatus = 'idle' | 'connecting' | 'playing' | 'error' | 'unsupported';
type Mpegts = typeof import('mpegts.js').default;
type Player = ReturnType<Mpegts['createPlayer']>;

const { store, refreshStreamers, refreshStatus } = useStore();
const { pushToast } = useToast();

const query = ref('');
const mode = ref<'trending' | 'search' | 'following'>('trending');
const viewMode = ref<'grid' | 'zapper'>('grid');
const selectedRegion = ref('DE');
const onlyLive = ref(false);
const loading = ref(false);
const loadingMore = ref(false);
const currentPage = ref(0);
const hasMorePages = ref(true);
const error = ref<string | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);

const accounts = ref<TikTokAccountPublic[]>([]);
const activeAccount = ref<TikTokAccountPublic | null>(null);
const accountModalOpen = ref(false);
const accountForm = ref({ label: '', sessionId: '', targetIdc: '', username: '' });
const accountSaving = ref(false);

const hits = ref<DiscoveryHit[]>([]);
const providers = ref<DiscoveryProviderStatus[]>([]);
const lastFetchedAt = ref<number>(0);
const actionBusy = ref<string | null>(null);
const justAdded = ref<Map<string, Streamer>>(new Map());
const failedAvatars = ref<Set<string>>(new Set());

function avatarSrcFor(hit: DiscoveryHit): string | null {
  return resolveAvatarSrc(hit.avatar_url, failedAvatars.value.has(hit.handle));
}

function isUsingFallbackAvatar(hit: DiscoveryHit): boolean {
  return !hit.avatar_url || failedAvatars.value.has(hit.handle);
}

function onAvatarError(handle: string, event: Event): void {
  if (!failedAvatars.value.has(handle)) {
    const next = new Set(failedAvatars.value);
    next.add(handle);
    failedAvatars.value = next;
    return;
  }
  const img = event.target as HTMLImageElement | null;
  if (img && img.src && !img.src.endsWith(DEFAULT_AVATAR_SVG_URL)) {
    img.src = DEFAULT_AVATAR_SVG_URL;
  }
}

function zapperPosterFor(hit: DiscoveryHit): string {
  if (hit.cover_url) return hit.cover_url;
  return avatarSrcFor(hit) ?? DEFAULT_AVATAR_SVG_URL;
}

// Live-Zapper state
const zapperIndex = ref(0);
const zapperVideoRef = ref<HTMLVideoElement | null>(null);
const zapperMuted = ref(false);
const zapperStatus = ref<ZapperPlayerStatus>('idle');
const zapperError = ref<string>('');
let mpegtsLib: Mpegts | null = null;
const zapperPlayer = shallowRef<Player | null>(null);

const regionOptions = [
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
];

const quickTopics = [
  { label: '🇩🇪 Deutsch', keyword: 'deutsch' },
  { label: '🎮 Gaming', keyword: 'gaming' },
  { label: '🎵 Musik', keyword: 'musik' },
  { label: '💬 Talk', keyword: 'talk' },
  { label: 'Fortnite', keyword: 'fortnite' },
  { label: '🍳 Lifestyle', keyword: 'kochen' },
];

const zapperHits = computed(() => hits.value.filter((h) => h.live));
const currentZapperHit = computed<DiscoveryHit | null>(
  () => zapperHits.value[zapperIndex.value] ?? zapperHits.value[0] ?? null,
);

// Keep in sync with store.discovery if SSE pushes updates for default region
watch(
  () => store.discovery,
  (val) => {
    if (
      val &&
      mode.value === 'trending' &&
      !query.value.trim() &&
      selectedRegion.value === 'DE' &&
      viewMode.value === 'grid'
    ) {
      hits.value = val.hits;
      providers.value = val.providers;
      lastFetchedAt.value = Date.now();
    }
  },
  { immediate: true },
);

async function loadMpegts(): Promise<Mpegts> {
  if (!mpegtsLib) {
    const mod = await import('mpegts.js');
    mpegtsLib = mod.default;
  }
  return mpegtsLib;
}

function destroyZapperPlayer(): void {
  const current = zapperPlayer.value;
  zapperPlayer.value = null;
  if (!current) return;
  try {
    current.pause();
    current.unload();
    current.detachMediaElement();
    current.destroy();
  } catch {
    /* already destroyed */
  }
}

async function startZapperPlayer(): Promise<void> {
  destroyZapperPlayer();
  const hit = currentZapperHit.value;
  if (viewMode.value !== 'zapper' || !hit || !hit.live) {
    zapperStatus.value = 'idle';
    return;
  }

  await nextTick();
  const videoEl = zapperVideoRef.value;
  if (!videoEl) return;

  const lib = await loadMpegts();
  if (!lib.isSupported()) {
    zapperStatus.value = 'unsupported';
    zapperError.value = 'Dein Browser unterstützt keine MSE-Live-Wiedergabe.';
    return;
  }

  zapperError.value = '';
  zapperStatus.value = 'connecting';
  const streamUrl = `/api/discovery/preview/${encodeURIComponent(hit.handle)}?t=${Date.now()}`;

  const instance = lib.createPlayer(
    { type: 'flv', isLive: true, url: streamUrl },
    {
      enableWorker: false,
      lazyLoad: false,
      liveBufferLatencyChasing: true,
      liveBufferLatencyMaxLatency: 3,
      liveBufferLatencyMinRemain: 0.4,
    },
  );
  zapperPlayer.value = instance;

  instance.on(lib.Events.ERROR, (_type, detail) => {
    if (zapperPlayer.value !== instance) return;
    zapperStatus.value = 'error';
    zapperError.value = `Stream-Vorschau konnte nicht geladen werden (${detail}).`;
  });

  instance.on(lib.Events.MEDIA_INFO, () => {
    if (zapperPlayer.value !== instance) return;
    zapperStatus.value = 'playing';
  });

  videoEl.muted = zapperMuted.value;
  instance.attachMediaElement(videoEl);
  instance.load();
  const playback = instance.play();
  if (playback && typeof playback.then === 'function') {
    void playback.catch(() => {
      if (zapperPlayer.value !== instance) return;
      // Fallback to muted autoplay if browser blocked unmuted playback
      if (!zapperMuted.value && videoEl) {
        zapperMuted.value = true;
        videoEl.muted = true;
        void instance.play()?.catch(() => {
          zapperStatus.value = 'error';
          zapperError.value = 'Autoplay vom Browser blockiert – bitte auf Play klicken.';
        });
      }
    });
  }
}

function toggleZapperMute(): void {
  zapperMuted.value = !zapperMuted.value;
  if (zapperVideoRef.value) {
    zapperVideoRef.value.muted = zapperMuted.value;
  }
}

async function loadMoreHits(): Promise<void> {
  if (loadingMore.value || loading.value || !hasMorePages.value) return;
  loadingMore.value = true;
  const nextPage = currentPage.value + 1;
  try {
    const trimmed = query.value.trim();
    const res =
      mode.value === 'search' && trimmed
        ? await api.discovery.search(trimmed, { region: selectedRegion.value, page: nextPage, limit: 20 })
        : mode.value === 'following'
        ? await api.discovery.following({ page: nextPage, limit: 20 })
        : await api.discovery.trending({ region: selectedRegion.value, page: nextPage, limit: 30 });

    const existingHandles = new Set(hits.value.map((h) => h.handle));
    const freshHits = res.hits.filter((h) => !existingHandles.has(h.handle));
    if (freshHits.length === 0) {
      hasMorePages.value = false;
    } else {
      hits.value = [...hits.value, ...freshHits];
      currentPage.value = nextPage;
    }
  } catch {
    // Silent on background pagination
  } finally {
    loadingMore.value = false;
  }
}

function openZapperAt(handle?: string): void {
  if (handle) {
    const idx = zapperHits.value.findIndex((h) => h.handle === handle);
    zapperIndex.value = idx >= 0 ? idx : 0;
  } else if (zapperIndex.value >= zapperHits.value.length) {
    zapperIndex.value = 0;
  }
  viewMode.value = 'zapper';
  void startZapperPlayer();
  if (zapperIndex.value >= zapperHits.value.length - 2) {
    void loadMoreHits();
  }
}

function switchViewMode(target: 'grid' | 'zapper'): void {
  if (target === 'grid') {
    viewMode.value = 'grid';
    destroyZapperPlayer();
    zapperStatus.value = 'idle';
  } else {
    openZapperAt();
  }
}

function prevZapperStreamer(): void {
  if (zapperIndex.value <= 0) return;
  zapperIndex.value -= 1;
  void startZapperPlayer();
}

async function nextZapperStreamer(): Promise<void> {
  if (zapperIndex.value < zapperHits.value.length - 1) {
    zapperIndex.value += 1;
    void startZapperPlayer();
    if (zapperIndex.value >= zapperHits.value.length - 2) {
      void loadMoreHits();
    }
    return;
  }
  if (hasMorePages.value && !loadingMore.value) {
    const prevCount = zapperHits.value.length;
    await loadMoreHits();
    if (zapperHits.value.length > prevCount) {
      zapperIndex.value = prevCount;
      void startZapperPlayer();
    }
  }
}

async function loadTrending(): Promise<void> {
  mode.value = 'trending';
  currentPage.value = 0;
  hasMorePages.value = true;
  loading.value = true;
  error.value = null;
  try {
    const res = await api.discovery.trending({ region: selectedRegion.value });
    hits.value = res.hits;
    providers.value = res.providers;
    lastFetchedAt.value = Date.now();
    zapperIndex.value = 0;
    if (viewMode.value === 'zapper') {
      void startZapperPlayer();
    }
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

async function runSearch(): Promise<void> {
  const trimmed = query.value.trim();
  if (!trimmed) {
    await loadTrending();
    return;
  }
  mode.value = 'search';
  currentPage.value = 0;
  hasMorePages.value = true;
  loading.value = true;
  error.value = null;
  try {
    const res = await api.discovery.search(trimmed, { region: selectedRegion.value });
    hits.value = res.hits;
    providers.value = res.providers;
    lastFetchedAt.value = Date.now();
    zapperIndex.value = 0;
    if (viewMode.value === 'zapper') {
      void startZapperPlayer();
    }
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

async function loadAccounts(): Promise<void> {
  try {
    const res = await api.discovery.accounts();
    accounts.value = res.accounts;
    activeAccount.value = res.active;
  } catch {
    // optional
  }
}

async function activateAccount(id: string): Promise<void> {
  try {
    const res = await api.discovery.activateAccount(id);
    pushToast(`Account „${res.account.label}“ aktiviert.`, 'success');
    await loadAccounts();
    if (mode.value === 'following') {
      void loadFollowing();
    }
  } catch (err) {
    pushToast(errorMessage(err), 'error');
  }
}

async function removeAccount(id: string): Promise<void> {
  try {
    await api.discovery.removeAccount(id);
    pushToast('Account entfernt.', 'success');
    await loadAccounts();
    if (mode.value === 'following') {
      void loadFollowing();
    }
  } catch (err) {
    pushToast(errorMessage(err), 'error');
  }
}

async function saveAccount(): Promise<void> {
  if (!accountForm.value.label.trim() || !accountForm.value.sessionId.trim()) {
    pushToast('Bitte Label und sessionid angeben.', 'error');
    return;
  }
  accountSaving.value = true;
  try {
    const res = await api.discovery.addAccount(accountForm.value);
    pushToast(`Account „${res.account.label}“ gespeichert.`, 'success');
    accountModalOpen.value = false;
    accountForm.value = { label: '', sessionId: '', targetIdc: '', username: '' };
    await loadAccounts();
    if (mode.value === 'following') {
      void loadFollowing();
    }
  } catch (err) {
    pushToast(errorMessage(err), 'error');
  } finally {
    accountSaving.value = false;
  }
}

async function loadFollowing(): Promise<void> {
  mode.value = 'following';
  currentPage.value = 0;
  hasMorePages.value = true;
  loading.value = true;
  error.value = null;
  try {
    const res = await api.discovery.following();
    hits.value = res.hits;
    providers.value = res.providers;
    lastFetchedAt.value = Date.now();
    zapperIndex.value = 0;
    if (viewMode.value === 'zapper') {
      void startZapperPlayer();
    }
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

function handleRegionChange(): void {
  if (mode.value === 'trending' || !query.value.trim()) {
    void loadTrending();
  } else {
    void runSearch();
  }
}

function selectTopic(keyword: string): void {
  if (mode.value === 'search' && query.value.trim().toLowerCase() === keyword.toLowerCase()) {
    query.value = '';
    void loadTrending();
    return;
  }
  query.value = keyword;
  void runSearch();
}

function handleSearchSubmit(event: Event): void {
  event.preventDefault();
  void runSearch();
}

function handleSearchInput(): void {
  if (!query.value.trim() && mode.value === 'search') {
    void loadTrending();
  }
}

function switchMode(newMode: 'trending' | 'search' | 'following'): void {
  mode.value = newMode;
  if (newMode === 'trending') {
    query.value = '';
    void loadTrending();
  } else if (newMode === 'following') {
    query.value = '';
    void loadFollowing();
  } else if (query.value.trim()) {
    void runSearch();
  } else {
    void nextTick(() => {
      searchInputRef.value?.focus();
    });
  }
}

const existingStreamersMap = computed(() => {
  const map = new Map<string, Streamer>();
  for (const s of store.streamers) {
    map.set(s.tiktok.toLowerCase().replace(/^@/, ''), s);
  }
  return map;
});

const displayedHits = computed(() => {
  let list = hits.value;
  if (onlyLive.value) {
    list = list.filter((h) => h.live);
  }
  return list;
});

const providerErrors = computed(() =>
  providers.value.filter((p) => p.status !== 'online' && p.last_error),
);

function getExisting(handle: string): Streamer | undefined {
  const normalized = handle.toLowerCase().replace(/^@/, '');
  return existingStreamersMap.value.get(normalized) || justAdded.value.get(normalized);
}

async function handleAdd(hit: DiscoveryHit): Promise<void> {
  actionBusy.value = `add:${hit.handle}`;
  try {
    const res = await api.discovery.add(hit.handle, hit.display_name);
    justAdded.value.set(hit.handle.toLowerCase().replace(/^@/, ''), res.streamer);
    await refreshStreamers();
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
    await refreshStreamers();
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
    await refreshStreamers();
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
    await Promise.all([refreshStreamers(), refreshStatus()]);
    pushToast(`Restream auf „${hit.display_name}“ gestartet.`, 'success');
  } catch (err) {
    pushToast(`Umschalten fehlgeschlagen: ${errorMessage(err)}`, 'error');
  } finally {
    actionBusy.value = null;
  }
}

function providerClass(status: DiscoveryProviderStatus): string {
  if (status.status === 'online') return 'provider-online';
  if (status.status === 'rate_limited') return 'provider-limited';
  return 'provider-offline';
}

function onKeyDown(event: KeyboardEvent): void {
  if (viewMode.value !== 'zapper') return;
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

  if (event.key === 'ArrowDown' || event.key === 'j') {
    event.preventDefault();
    void nextZapperStreamer();
  } else if (event.key === 'ArrowUp' || event.key === 'k') {
    event.preventDefault();
    prevZapperStreamer();
  } else if (event.key === 'm' || event.key === 'M') {
    event.preventDefault();
    toggleZapperMute();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    switchViewMode('grid');
  }
}

function onVisibilityChange(): void {
  if (document.hidden) {
    if (viewMode.value === 'zapper') {
      destroyZapperPlayer();
    }
    return;
  }
  if (viewMode.value === 'zapper') {
    void startZapperPlayer();
  } else if (Date.now() - lastFetchedAt.value > 60_000) {
    if (mode.value === 'trending') void loadTrending();
    else if (query.value.trim()) void runSearch();
  }
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('keydown', onKeyDown);
  void loadAccounts();
  if (hits.value.length === 0) {
    void loadTrending();
  }
});

onBeforeUnmount(() => {
  destroyZapperPlayer();
});

onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('keydown', onKeyDown);
});
</script>

<template>
  <div class="page discovery-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">Discovery</h1>
        <p class="page-description">
          Neue TikTok-Live-Streamer nach Themen, Begriffen oder @Handle durchsuchen, im Live-Zapper vorhören und per Klick übernehmen.
        </p>
      </div>

      <!-- Provider Status Badges -->
      <div v-if="providers.length > 0" class="providers-bar" role="status" aria-label="Status der Discovery-Provider">
        <span
          v-for="p in providers"
          :key="p.name"
          class="provider-pill"
          :class="providerClass(p)"
          :title="p.last_error ? `${p.name}: ${p.last_error}` : `${p.name}: OK`"
        >
          <span class="provider-dot" aria-hidden="true"></span>
          {{ p.name }}
          <span class="provider-state">{{ p.status }}</span>
        </span>
      </div>
    </header>

    <!-- Toolbar / Search Section -->
    <section class="card discovery-toolbar">
      <form class="search-form" @submit="handleSearchSubmit">
        <div class="field field-search">
          <label class="sr-only" for="discovery-search">TikTok-Handle oder Begriff suchen</label>
          <span class="search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8" />
              <path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </span>
          <input
            id="discovery-search"
            ref="searchInputRef"
            v-model="query"
            type="search"
            placeholder="Begriff (z. B. Gaming, Musik, Talk) oder @handle…"
            autocomplete="off"
            spellcheck="false"
            @input="handleSearchInput"
          />
        </div>
        <button type="submit" class="btn btn-primary" :disabled="loading">
          <span v-if="loading" class="spinner" aria-hidden="true"></span>
          <span>Suchen</span>
        </button>
      </form>

      <div class="filter-controls">
        <div class="mode-toggles" role="group" aria-label="Quelle wählen">
          <button
            type="button"
            class="btn btn-sm"
            :class="mode === 'trending' ? 'btn-primary' : 'btn-ghost'"
            @click="switchMode('trending')"
          >
            🔥 Trending
          </button>
          <button
            type="button"
            class="btn btn-sm"
            :class="mode === 'following' ? 'btn-primary' : 'btn-ghost'"
            @click="switchMode('following')"
          >
            👥 Gefolgt
          </button>
          <button
            type="button"
            class="btn btn-sm"
            :class="mode === 'search' ? 'btn-primary' : 'btn-ghost'"
            @click="switchMode('search')"
          >
            🔍 Suche
          </button>
        </div>

        <div class="mode-toggles" role="group" aria-label="Darstellung wählen">
          <button
            type="button"
            class="btn btn-sm"
            :class="viewMode === 'grid' ? 'btn-primary' : 'btn-ghost'"
            @click="switchViewMode('grid')"
          >
            🗂 Karten
          </button>
          <button
            type="button"
            class="btn btn-sm"
            :class="viewMode === 'zapper' ? 'btn-primary' : 'btn-ghost'"
            :disabled="zapperHits.length === 0"
            title="Wie in TikTok Live mit Pfeiltasten durch aktive Streams zappen"
            @click="switchViewMode('zapper')"
          >
            📺 Live-Zapper
          </button>
        </div>

        <div class="region-filter">
          <label class="sr-only" for="discovery-region">Land / Region wählen</label>
          <select
            id="discovery-region"
            v-model="selectedRegion"
            class="region-select"
            :disabled="loading"
            aria-label="Länderfilter"
            @change="handleRegionChange"
          >
            <option v-for="r in regionOptions" :key="r.code" :value="r.code">
              {{ r.label }}
            </option>
          </select>
        </div>

        <!-- TikTok Account Switcher Pill -->
        <div class="account-pill-wrapper">
          <button
            type="button"
            class="btn btn-sm btn-ghost account-pill"
            :title="activeAccount ? `Aktiver TikTok-Account: ${activeAccount.label}` : 'TikTok-Account verwalten'"
            @click="accountModalOpen = true"
          >
            <span>👤</span>
            <span class="account-label">{{ activeAccount?.label || 'Kein Account' }}</span>
            <span v-if="accounts.length > 1" class="badge badge-xs tone-neutral">{{ accounts.length }}</span>
          </button>
        </div>

        <div class="topic-chips" role="group" aria-label="Schnellfilter nach Themen">
          <button
            v-for="topic in quickTopics"
            :key="topic.keyword"
            type="button"
            class="btn btn-sm topic-chip"
            :class="
              mode === 'search' && query.trim().toLowerCase() === topic.keyword
                ? 'btn-primary'
                : 'btn-ghost'
            "
            :disabled="loading"
            @click="selectTopic(topic.keyword)"
          >
            {{ topic.label }}
          </button>
        </div>

        <label v-if="viewMode === 'grid'" class="toggle-label" for="filter-only-live">
          <input id="filter-only-live" v-model="onlyLive" type="checkbox" />
          <span>Nur Live</span>
        </label>

        <button
          type="button"
          class="btn btn-ghost btn-sm refresh-btn"
          title="Aktualisieren"
          :disabled="loading"
          @click="mode === 'trending' ? loadTrending() : runSearch()"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" :class="{ 'spin-icon': loading }">
            <path
              d="M4 12a8 8 0 0 1 14.93-4M20 12a8 8 0 0 1-14.93 4"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
            <path d="M19 4v4h-4M5 20v-4h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
          <span class="sr-only">Aktualisieren</span>
        </button>
      </div>
    </section>

    <!-- Error Banner -->
    <div v-if="error" class="alert alert-error" role="alert">
      <span>{{ error }}</span>
      <button type="button" class="btn btn-sm btn-ghost" @click="error = null">Schließen</button>
    </div>

    <!-- Loading State -->
    <div v-if="loading && hits.length === 0" class="empty">
      <span class="spinner spinner-lg" aria-hidden="true"></span>
      <p>Lade Discovery-Vorschläge…</p>
    </div>

    <!-- Empty State -->
    <div v-else-if="displayedHits.length === 0" class="empty">
      <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="m15 9-6 6M9 9l6 6" />
      </svg>
      <p v-if="query.trim()">Keine passenden Streamer für „{{ query }}“ gefunden.</p>
      <p v-else>Aktuell sind keine Live-Streams verfügbar.</p>
      <p v-if="providerErrors.length > 0" class="empty-hint mono">
        Provider-Hinweis: {{ providerErrors.map((p) => `${p.name} (${p.last_error})`).join(', ') }}
      </p>
    </div>

    <!-- TIKTOK LIVE-ZAPPER VIEW -->
    <section
      v-else-if="viewMode === 'zapper' && currentZapperHit"
      class="zapper-container"
      aria-label="TikTok Live-Zapper"
    >
      <div class="zapper-stage">
        <!-- Blurred Ambient Backdrop -->
        <div
          class="zapper-backdrop"
          :style="{ backgroundImage: `url(${zapperPosterFor(currentZapperHit)})` }"
          aria-hidden="true"
        ></div>

        <!-- Live FLV Video Element -->
        <video
          ref="zapperVideoRef"
          class="zapper-video"
          playsinline
          autoplay
          :muted="zapperMuted"
          :poster="zapperPosterFor(currentZapperHit)"
        ></video>

        <!-- Top HUD Bar -->
        <div class="zapper-top-bar">
          <div class="zapper-badges mono">
            <span class="badge badge-live-pulse">● LIVE</span>
            <span v-if="currentZapperHit.viewers !== null" class="zapper-pill">
              👥 {{ currentZapperHit.viewers.toLocaleString('de-DE') }}
            </span>
            <span class="zapper-pill">
              #{{ zapperIndex + 1 }} / {{ zapperHits.length }}{{ hasMorePages ? '+' : '' }}
            </span>
            <span v-if="zapperStatus === 'connecting'" class="zapper-pill">
              <span class="spinner" aria-hidden="true"></span> Verbinde…
            </span>
          </div>

          <div class="zapper-top-actions">
            <button
              type="button"
              class="btn btn-sm zapper-ctrl-btn"
              :title="zapperMuted ? 'Ton einschalten (Taste M)' : 'Stummschalten (Taste M)'"
              @click="toggleZapperMute"
            >
              {{ zapperMuted ? '🔇 Stumm' : '🔊 Ton an' }}
            </button>
            <button
              type="button"
              class="btn btn-sm zapper-ctrl-btn"
              title="Vorschau neu verbinden"
              @click="startZapperPlayer"
            >
              🔄
            </button>
            <button
              type="button"
              class="btn btn-sm zapper-ctrl-btn"
              title="Zurück zur Karten-Übersicht (Esc)"
              @click="switchViewMode('grid')"
            >
              ✕ Karten
            </button>
          </div>
        </div>

        <!-- Center Error / Retry Overlay -->
        <div v-if="zapperStatus === 'error' || zapperStatus === 'unsupported'" class="zapper-error-overlay">
          <p>{{ zapperError }}</p>
          <div class="zapper-error-actions">
            <button type="button" class="btn btn-sm btn-outline" @click="startZapperPlayer">
              🔄 Erneut versuchen
            </button>
            <button type="button" class="btn btn-sm btn-primary" @click="nextZapperStreamer">
              ▼ Nächster Streamer
            </button>
          </div>
        </div>

        <!-- Bottom Streamer & Regie HUD -->
        <div class="zapper-bottom-hud">
          <div class="zapper-streamer-info">
            <div class="avatar-wrap">
              <img
                v-if="avatarSrcFor(currentZapperHit)"
                :src="avatarSrcFor(currentZapperHit)!"
                :alt="`Avatar von ${currentZapperHit.display_name}`"
                class="avatar-img"
                :class="{ 'is-fallback-avatar': isUsingFallbackAvatar(currentZapperHit) }"
                referrerpolicy="no-referrer"
                @error="onAvatarError(currentZapperHit.handle, $event)"
              />
              <div v-else class="avatar-fallback">
                {{ (currentZapperHit.display_name || currentZapperHit.handle).slice(0, 2).toUpperCase() }}
              </div>
              <span class="status-indicator status-live"></span>
            </div>

            <div class="zapper-text">
              <div class="zapper-name-line">
                <h2 class="zapper-title-name">{{ currentZapperHit.display_name }}</h2>
                <a
                  :href="`https://www.tiktok.com/@${currentZapperHit.handle}/live`"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="zapper-handle mono"
                >
                  @{{ currentZapperHit.handle }} ↗
                </a>
                <span
                  v-if="getExisting(currentZapperHit.handle)"
                  class="badge"
                  :class="getExisting(currentZapperHit.handle)?.enabled ? 'badge-info' : 'badge-warning'"
                >
                  {{ getExisting(currentZapperHit.handle)?.enabled ? 'IN LISTE (AKTIV)' : 'IN LISTE (AUS)' }}
                </span>
              </div>
              <p v-if="currentZapperHit.title" class="zapper-room-title">
                {{ currentZapperHit.title }}
              </p>
              <p v-else-if="currentZapperHit.bio" class="zapper-room-bio">
                {{ currentZapperHit.bio }}
              </p>
            </div>
          </div>

          <div class="zapper-regie-actions">
            <!-- Speichern / Aktivieren -->
            <template v-if="!getExisting(currentZapperHit.handle)">
              <button
                type="button"
                class="btn btn-sm btn-outline"
                :disabled="Boolean(actionBusy)"
                @click="handleAdd(currentZapperHit)"
              >
                <span v-if="actionBusy === `add:${currentZapperHit.handle}`" class="spinner" aria-hidden="true"></span>
                <span>💾 Speichern</span>
              </button>
            </template>
            <template v-else-if="!getExisting(currentZapperHit.handle)?.enabled">
              <button
                type="button"
                class="btn btn-sm btn-warning"
                :disabled="Boolean(actionBusy)"
                @click="handleActivate(getExisting(currentZapperHit.handle)!)"
              >
                <span
                  v-if="actionBusy === `activate:${getExisting(currentZapperHit.handle)?.id}`"
                  class="spinner"
                  aria-hidden="true"
                ></span>
                <span>⚡ Jetzt aktivieren</span>
              </button>
            </template>
            <template v-else>
              <span class="btn btn-sm btn-disabled" aria-disabled="true">
                ✓ Aktiv
              </span>
            </template>

            <!-- In Queue -->
            <button
              type="button"
              class="btn btn-sm btn-outline"
              :disabled="Boolean(actionBusy)"
              @click="handleQueue(currentZapperHit)"
            >
              <span v-if="actionBusy === `queue:${currentZapperHit.handle}`" class="spinner" aria-hidden="true"></span>
              <span>⏭ In Queue</span>
            </button>

            <!-- Sofort auf YouTube schalten -->
            <button
              type="button"
              class="btn btn-sm btn-primary"
              :disabled="Boolean(actionBusy)"
              @click="handleSwitch(currentZapperHit)"
            >
              <span v-if="actionBusy === `switch:${currentZapperHit.handle}`" class="spinner" aria-hidden="true"></span>
              <span>▶ Jetzt auf YouTube schalten</span>
            </button>
          </div>
        </div>
      </div>

      <!-- RIGHT SIDE TIKTOK ARROW NAVIGATION RAIL -->
      <aside class="zapper-nav-rail" aria-label="Streamer weiter- und zurückschalten">
        <button
          type="button"
          class="zapper-arrow-btn"
          :disabled="zapperIndex <= 0"
          title="Vorheriger Streamer (Pfeil hoch)"
          aria-label="Vorheriger Streamer"
          @click="prevZapperStreamer"
        >
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="m18 15-6-6-6 6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>

        <div class="zapper-rail-counter mono">
          <span>{{ zapperIndex + 1 }}</span>
          <span class="rail-divider">/</span>
          <span>{{ zapperHits.length }}</span>
          <span v-if="loadingMore" class="spinner rail-spinner" title="Lade weitere Live-Streamer…"></span>
        </div>

        <button
          type="button"
          class="zapper-arrow-btn"
          :disabled="zapperIndex >= zapperHits.length - 1 && !hasMorePages && !loadingMore"
          title="Nächster Streamer (Pfeil runter)"
          aria-label="Nächster Streamer"
          @click="nextZapperStreamer"
        >
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>

        <p class="zapper-rail-hint mono">▲ / ▼ Tasten</p>
      </aside>
    </section>

    <!-- CARDS GRID VIEW -->
    <div v-else class="cards-grid" role="list" aria-label="Gefundene Streamer">
      <article
        v-for="hit in displayedHits"
        :key="hit.handle"
        class="card hit-card"
        :class="{ 'is-live': hit.live, 'is-busy': actionBusy?.includes(hit.handle) }"
        role="listitem"
      >
        <div class="hit-header">
          <div class="avatar-wrap">
            <img
              v-if="avatarSrcFor(hit)"
              :src="avatarSrcFor(hit)!"
              :alt="`Avatar von ${hit.display_name}`"
              class="avatar-img"
              :class="{ 'is-fallback-avatar': isUsingFallbackAvatar(hit) }"
              loading="lazy"
              referrerpolicy="no-referrer"
              @error="onAvatarError(hit.handle, $event)"
            />
            <div v-else class="avatar-fallback" aria-hidden="true">
              {{ (hit.display_name || hit.handle).slice(0, 2).toUpperCase() }}
            </div>
            <span
              class="status-indicator"
              :class="hit.live ? 'status-live' : 'status-offline'"
              :title="hit.live ? 'Live' : 'Offline'"
            ></span>
          </div>

          <div class="hit-meta">
            <div class="name-row">
              <h2 class="hit-name" :title="hit.display_name">{{ hit.display_name }}</h2>
              <span class="source-tag">{{ hit.source }}</span>
            </div>
            <a
              :href="`https://www.tiktok.com/@${hit.handle}`"
              target="_blank"
              rel="noopener noreferrer"
              class="hit-handle mono"
              :title="`TikTok-Profil öffnen: @${hit.handle}`"
            >
              @{{ hit.handle }}
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
              </svg>
            </a>
          </div>
        </div>

        <div class="hit-body">
          <p v-if="hit.title" class="hit-title" :title="hit.title">
            {{ hit.title }}
          </p>
          <p v-else-if="hit.bio" class="hit-bio">
            {{ hit.bio }}
          </p>
          <p v-else class="hit-title muted italic">
            Kein Raumtitel
          </p>

          <div class="hit-stats mono">
            <span class="badge" :class="hit.live ? 'badge-success' : 'badge-muted'">
              {{ hit.live ? 'LIVE' : 'OFFLINE' }}
            </span>
            <span v-if="hit.viewers !== null" class="viewers-count">
              👥 {{ hit.viewers.toLocaleString('de-DE') }}
            </span>
            <button
              v-if="hit.live"
              type="button"
              class="btn-preview-inline mono"
              title="Im Live-Zapper anschauen und durchzappen"
              @click="openZapperAt(hit.handle)"
            >
              👁 Vorschau
            </button>
            <span
              v-if="getExisting(hit.handle)"
              class="badge"
              :class="getExisting(hit.handle)?.enabled ? 'badge-info' : 'badge-warning'"
            >
              {{ getExisting(hit.handle)?.enabled ? 'IN LISTE (AKTIV)' : 'IN LISTE (AUS)' }}
            </span>
          </div>
        </div>

        <div class="hit-actions">
          <!-- Button 1: Als Streamer speichern / aktivieren -->
          <template v-if="!getExisting(hit.handle)">
            <button
              type="button"
              class="btn btn-sm btn-outline"
              :disabled="Boolean(actionBusy)"
              @click="handleAdd(hit)"
            >
              <span v-if="actionBusy === `add:${hit.handle}`" class="spinner" aria-hidden="true"></span>
              <span>💾 Speichern</span>
            </button>
          </template>
          <template v-else-if="!getExisting(hit.handle)?.enabled">
            <button
              type="button"
              class="btn btn-sm btn-warning"
              :disabled="Boolean(actionBusy)"
              @click="handleActivate(getExisting(hit.handle)!)"
            >
              <span v-if="actionBusy === `activate:${getExisting(hit.handle)?.id}`" class="spinner" aria-hidden="true"></span>
              <span>⚡ Jetzt aktivieren</span>
            </button>
          </template>
          <template v-else>
            <span class="btn btn-sm btn-disabled" aria-disabled="true">
              ✓ Aktiv
            </span>
          </template>

          <!-- Button 2: In Queue -->
          <button
            type="button"
            class="btn btn-sm btn-outline"
            :disabled="Boolean(actionBusy) || !hit.live"
            :title="!hit.live ? 'Nur für aktive Live-Streams verfügbar' : 'Als nächstes Ziel in die Regie-Queue einreihen'"
            @click="handleQueue(hit)"
          >
            <span v-if="actionBusy === `queue:${hit.handle}`" class="spinner" aria-hidden="true"></span>
            <span>⏭ In Queue</span>
          </button>

          <!-- Button 3: Jetzt umschalten -->
          <button
            type="button"
            class="btn btn-sm btn-primary"
            :disabled="Boolean(actionBusy) || !hit.live"
            :title="!hit.live ? 'Nur für aktive Live-Streams verfügbar' : 'Sofort auf diesen Streamer umschalten'"
            @click="handleSwitch(hit)"
          >
            <span v-if="actionBusy === `switch:${hit.handle}`" class="spinner" aria-hidden="true"></span>
            <span>▶ Umschalten</span>
          </button>
        </div>
      </article>
    </div>

    <!-- TikTok Account Management Modal -->
    <ModalDialog
      :open="accountModalOpen"
      title="TikTok Accounts verwalten"
      size="md"
      @close="accountModalOpen = false"
    >
      <div class="account-manager-content">
        <p class="small muted">
          Hier hinterlegte TikTok-Accounts versorgen den Tab <strong>„Gefolgt“</strong> und ermöglichen den Wechsel zwischen mehreren Profilen.
        </p>

        <div v-if="accounts.length > 0" class="account-list">
          <div
            v-for="acc in accounts"
            :key="acc.id"
            class="account-row"
            :class="{ 'account-active': acc.active }"
          >
            <div class="account-info">
              <span class="account-name">
                {{ acc.label }}
                <span v-if="acc.username" class="mono small muted">(@{{ acc.username }})</span>
              </span>
              <span v-if="acc.active" class="badge tone-success badge-xs">Aktiv</span>
              <span v-else class="badge tone-neutral badge-xs">Inaktiv</span>
            </div>
            <div class="account-actions">
              <button
                v-if="!acc.active"
                type="button"
                class="btn btn-sm btn-ghost"
                @click="activateAccount(acc.id)"
              >
                Aktivieren
              </button>
              <button
                type="button"
                class="btn btn-sm btn-danger btn-icon-only"
                title="Account entfernen"
                @click="removeAccount(acc.id)"
              >
                ✕
              </button>
            </div>
          </div>
        </div>

        <form class="account-form card" @submit.prevent="saveAccount">
          <h4 class="form-title">Account hinzufügen</h4>
          <div class="field">
            <label for="acc-label">Bezeichnung / Label *</label>
            <input
              id="acc-label"
              v-model="accountForm.label"
              type="text"
              placeholder="z. B. Hauptaccount, Zweitprofil…"
              required
            />
          </div>
          <div class="field">
            <label for="acc-sessionid">TikTok SessionId Cookie *</label>
            <input
              id="acc-sessionid"
              v-model="accountForm.sessionId"
              type="password"
              placeholder="sessionid aus dem TikTok-Web-Cookie"
              required
            />
          </div>
          <div class="field">
            <label for="acc-targetidc">Target IDC (optional)</label>
            <input
              id="acc-targetidc"
              v-model="accountForm.targetIdc"
              type="text"
              placeholder="z. B. useast2a"
            />
          </div>
          <button type="submit" class="btn btn-primary" :disabled="accountSaving">
            <span v-if="accountSaving" class="spinner" aria-hidden="true"></span>
            Speichern & Hinzufügen
          </button>
        </form>
      </div>
    </ModalDialog>
  </div>
</template>

<style scoped>
.account-pill-wrapper {
  display: inline-flex;
  align-items: center;
}

.account-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid var(--border-color, #333);
  background: var(--bg-surface, #1e1e1e);
  padding: 0.25rem 0.6rem;
  border-radius: 9999px;
  font-size: 0.8rem;
}

.account-manager-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.account-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.account-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
  border-radius: 4px;
  background: var(--bg-surface-elevated, rgba(255, 255, 255, 0.04));
}

.account-row.account-active {
  border-color: var(--primary-color, #38bdf8);
}

.account-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.account-actions {
  display: flex;
  gap: 0.35rem;
}

.account-form {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
}

.form-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
}

.discovery-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-4, 1rem);
}

.page-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-3, 0.75rem);
}

.providers-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  align-items: center;
}

.provider-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-family: var(--font-mono, monospace);
  font-size: 0.7rem;
  padding: 0.2rem 0.5rem;
  border-radius: 2px;
  border: 1px solid var(--border-color, #333);
  background: var(--bg-surface, #1e1e1e);
  color: var(--text-muted, #888);
}

.provider-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.provider-online {
  border-color: rgba(34, 197, 94, 0.4);
  color: var(--color-success, #22c55e);
}

.provider-limited {
  border-color: rgba(234, 179, 8, 0.4);
  color: var(--color-warning, #eab308);
}

.provider-offline {
  border-color: rgba(239, 68, 68, 0.3);
  color: var(--color-danger, #ef4444);
}

.provider-state {
  text-transform: uppercase;
  font-weight: 600;
  opacity: 0.8;
}

.discovery-toolbar {
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 0.75rem);
}

.search-form {
  display: flex;
  gap: var(--space-2, 0.5rem);
  width: 100%;
}

.search-form .field-search {
  flex: 1;
  position: relative;
}

.search-icon {
  position: absolute;
  left: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted, #888);
  pointer-events: none;
}

.search-form input[type="search"] {
  width: 100%;
  padding-left: 2.25rem;
  font-size: 16px; /* Prevents iOS auto-zoom */
}

.filter-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3, 0.75rem);
}

.mode-toggles {
  display: inline-flex;
  border: 1px solid var(--border-color, #333);
  border-radius: 2px;
  overflow: hidden;
}

.region-filter {
  display: inline-flex;
  align-items: center;
}

.region-select {
  height: 32px;
  padding: 0 1.75rem 0 0.6rem;
  font-size: 0.82rem;
  border-radius: 2px;
  border: 1px solid var(--border-color, #333);
  background-color: var(--bg-surface, #1e1e1e);
  color: var(--text-primary, #f0f0f0);
  cursor: pointer;
}

.region-select:focus-visible {
  outline: 2px solid var(--color-accent, #38bdf8);
  outline-offset: 1px;
}

.topic-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.topic-chip {
  border: 1px solid var(--border-color, #2b2b2b);
  font-size: 0.78rem;
}

.toggle-label {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  cursor: pointer;
  user-select: none;
}

.refresh-btn {
  margin-left: auto;
}

.spin-icon {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* TIKTOK LIVE-ZAPPER STYLES */
.zapper-container {
  display: flex;
  align-items: stretch;
  justify-content: center;
  gap: 1rem;
  min-height: 620px;
  max-height: 78vh;
}

.zapper-stage {
  position: relative;
  flex: 1;
  max-width: 920px;
  background: #08080a;
  border: 1px solid var(--border-color, #2a2a2a);
  border-radius: 4px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.zapper-backdrop {
  position: absolute;
  inset: -24px;
  background-size: cover;
  background-position: center;
  filter: blur(28px) brightness(0.32);
  transform: scale(1.08);
  pointer-events: none;
}

.zapper-video {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  max-height: 76vh;
  object-fit: contain;
}

.zapper-top-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.78) 0%, rgba(0, 0, 0, 0) 100%);
}

.zapper-badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.78rem;
}

.badge-live-pulse {
  background: #ef4444;
  color: #fff;
  font-weight: 700;
  padding: 0.2rem 0.55rem;
  border-radius: 2px;
}

.zapper-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background: rgba(15, 15, 20, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #f3f4f6;
  padding: 0.2rem 0.55rem;
  border-radius: 2px;
  backdrop-filter: blur(6px);
}

.zapper-top-actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.zapper-ctrl-btn {
  background: rgba(15, 15, 20, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #fff;
  backdrop-filter: blur(6px);
}

.zapper-ctrl-btn:hover {
  background: rgba(35, 35, 45, 0.9);
}

.zapper-error-overlay {
  position: absolute;
  z-index: 3;
  background: rgba(14, 14, 18, 0.9);
  border: 1px solid rgba(239, 68, 68, 0.4);
  padding: 1.25rem 1.5rem;
  border-radius: 4px;
  text-align: center;
  max-width: 85%;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.zapper-error-actions {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
}

.zapper-bottom-hud {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 3;
  padding: 1.25rem 1rem 0.9rem;
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.88) 0%, rgba(0, 0, 0, 0.55) 68%, rgba(0, 0, 0, 0) 100%);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.zapper-streamer-info {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.zapper-text {
  flex: 1;
  min-width: 0;
}

.zapper-name-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.zapper-title-name {
  font-size: 1.05rem;
  font-weight: 700;
  color: #fff;
  margin: 0;
}

.zapper-handle {
  font-size: 0.82rem;
  color: #38bdf8;
  text-decoration: none;
}

.zapper-handle:hover {
  text-decoration: underline;
}

.zapper-room-title {
  margin: 0.25rem 0 0;
  font-size: 0.9rem;
  color: #f3f4f6;
}

.zapper-room-bio {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  color: #9ca3af;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.zapper-regie-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.zapper-regie-actions .btn {
  min-height: 38px;
}

/* RIGHT ARROW RAIL */
.zapper-nav-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.85rem;
  padding: 0.75rem;
  background: var(--bg-card, #141414);
  border: 1px solid var(--border-color, #2a2a2a);
  border-radius: 4px;
  min-width: 78px;
}

.zapper-arrow-btn {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 1px solid var(--border-color, #383838);
  background: var(--bg-surface, #1f1f23);
  color: var(--text-primary, #fff);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.12s ease, background-color 0.15s ease, border-color 0.15s ease;
}

.zapper-arrow-btn:hover:not(:disabled) {
  background: var(--color-accent, #38bdf8);
  border-color: var(--color-accent, #38bdf8);
  color: #000;
  transform: scale(1.06);
}

.zapper-arrow-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.zapper-rail-counter {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 0.82rem;
  color: var(--text-muted, #aaa);
  line-height: 1.2;
}

.rail-divider {
  opacity: 0.45;
  font-size: 0.7rem;
}

.rail-spinner {
  margin-top: 0.35rem;
}

.zapper-rail-hint {
  font-size: 0.68rem;
  color: var(--text-muted, #777);
  margin: 0.25rem 0 0;
  text-align: center;
}

@media (max-width: 680px) {
  .zapper-container {
    flex-direction: column;
    max-height: none;
  }
  .zapper-nav-rail {
    flex-direction: row;
    min-width: 0;
    justify-content: space-around;
  }
  .zapper-rail-counter {
    flex-direction: row;
    gap: 0.35rem;
  }
}

.btn-preview-inline {
  background: rgba(56, 189, 248, 0.12);
  border: 1px solid rgba(56, 189, 248, 0.35);
  color: #38bdf8;
  font-size: 0.72rem;
  padding: 0.12rem 0.45rem;
  border-radius: 2px;
  cursor: pointer;
}

.btn-preview-inline:hover {
  background: rgba(56, 189, 248, 0.24);
}

/* CARDS GRID */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--space-3, 0.75rem);
}

.hit-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: var(--space-3, 0.75rem);
  border: 1px solid var(--border-color, #2a2a2a);
  border-radius: 2px;
  background: var(--bg-card, #141414);
  transition: border-color 0.15s ease;
}

.hit-card.is-live {
  border-left: 3px solid var(--color-success, #22c55e);
}

.hit-card:hover {
  border-color: var(--border-hover, #444);
}

.hit-header {
  display: flex;
  gap: var(--space-3, 0.75rem);
  align-items: center;
}

.avatar-wrap {
  position: relative;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
}

.avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 2px;
  object-fit: cover;
  background: var(--bg-surface, #222);
}

.avatar-fallback {
  width: 100%;
  height: 100%;
  border-radius: 2px;
  background: var(--bg-surface, #222);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono, monospace);
  font-weight: 700;
  font-size: 0.85rem;
  color: var(--text-muted, #aaa);
}

.status-indicator {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--bg-card, #141414);
}

.status-live {
  background: var(--color-success, #22c55e);
}

.status-offline {
  background: var(--text-muted, #666);
}

.hit-meta {
  flex: 1;
  min-width: 0;
}

.name-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.hit-name {
  font-size: 0.95rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
}

.source-tag {
  font-family: var(--font-mono, monospace);
  font-size: 0.65rem;
  color: var(--text-muted, #777);
  background: rgba(255, 255, 255, 0.05);
  padding: 0.1rem 0.35rem;
  border-radius: 2px;
}

.hit-handle {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.8rem;
  color: var(--text-muted, #888);
  text-decoration: none;
}

.hit-handle:hover {
  color: var(--color-accent, #38bdf8);
}

.hit-body {
  margin: 0.75rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.hit-title {
  font-size: 0.85rem;
  line-height: 1.35;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.hit-bio {
  font-size: 0.8rem;
  color: var(--text-muted, #888);
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.hit-stats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
}

.hit-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  border-top: 1px solid var(--border-color, #222);
  padding-top: 0.75rem;
}

.hit-actions .btn {
  flex: 1;
  min-width: 80px;
  justify-content: center;
  min-height: 38px; /* Touch target >= 38px */
}

.btn-disabled {
  opacity: 0.6;
  cursor: default;
  pointer-events: none;
  background: transparent;
  color: var(--color-success, #22c55e);
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2, 0.5rem);
  padding: 3rem 1rem;
  color: var(--text-muted, #777);
  text-align: center;
}

.empty-hint {
  font-size: 0.75rem;
  color: var(--color-warning, #eab308);
  margin-top: 0.25rem;
}
</style>
