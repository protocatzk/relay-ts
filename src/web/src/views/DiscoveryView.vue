<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { DiscoveryHit, DiscoveryProviderStatus, Streamer } from '@/src/api/types';
import { useStore } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';
import { useTikTokAccounts } from '@/src/composables/useTikTokAccounts';
import DiscoveryCardItem from '@/src/components/discovery/DiscoveryCardItem.vue';
import TikTokAccountSwitcher from '@/src/components/TikTokAccountSwitcher.vue';

// Async component for DiscoveryZapperPlayer to lazy-load video playback assets
const DiscoveryZapperPlayer = defineAsyncComponent(
  () => import('@/src/components/discovery/DiscoveryZapperPlayer.vue'),
);

const { store, refreshStreamers, refreshStatus } = useStore();
const { pushToast } = useToast();
const { accounts, activeAccount, refreshAccounts, activateAccount } = useTikTokAccounts();

const accountSwitcherRef = ref<{ openDialog: () => void } | null>(null);
const selectedAccountId = ref<string>('');

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

const hits = ref<DiscoveryHit[]>([]);
const providers = ref<DiscoveryProviderStatus[]>([]);
const lastFetchedAt = ref<number>(0);
const actionBusy = ref<string | null>(null);
const justAdded = ref<Map<string, Streamer>>(new Map());
const failedAvatars = ref<Set<string>>(new Set());

// Live-Zapper state
const zapperIndex = ref(0);

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

function onAvatarError(handle: string): void {
  if (!failedAvatars.value.has(handle)) {
    const next = new Set(failedAvatars.value);
    next.add(handle);
    failedAvatars.value = next;
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
        ? await api.discovery.following({
            page: nextPage,
            limit: 20,
            account_id: selectedAccountId.value || undefined,
          })
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
  if (zapperIndex.value >= zapperHits.value.length - 2) {
    void loadMoreHits();
  }
}

function switchViewMode(target: 'grid' | 'zapper'): void {
  if (target === 'grid') {
    viewMode.value = 'grid';
  } else {
    openZapperAt();
  }
}

async function loadTrending(): Promise<void> {
  mode.value = 'trending';
  loading.value = true;
  error.value = null;
  currentPage.value = 0;
  hasMorePages.value = true;
  try {
    const res = await api.discovery.trending({
      region: selectedRegion.value,
      limit: 30,
      page: 0,
    });
    hits.value = res.hits;
    providers.value = res.providers;
    lastFetchedAt.value = Date.now();
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
  loading.value = true;
  error.value = null;
  currentPage.value = 0;
  hasMorePages.value = true;
  try {
    const res = await api.discovery.search(trimmed, {
      region: selectedRegion.value,
      limit: 20,
      page: 0,
    });
    hits.value = res.hits;
    providers.value = res.providers;
    lastFetchedAt.value = Date.now();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

async function loadFollowing(opts?: { accountId?: string }): Promise<void> {
  mode.value = 'following';
  loading.value = true;
  error.value = null;
  currentPage.value = 0;
  hasMorePages.value = true;
  const targetAccId = opts?.accountId ?? selectedAccountId.value;
  try {
    const res = await api.discovery.following({
      limit: 20,
      page: 0,
      account_id: targetAccId || undefined,
    });
    hits.value = res.hits;
    providers.value = res.providers;
    lastFetchedAt.value = Date.now();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

async function handleAccountChange(): Promise<void> {
  if (selectedAccountId.value) {
    await activateAccount(selectedAccountId.value);
  }
  await loadFollowing({ accountId: selectedAccountId.value });
}

function handleRegionChange(): void {
  if (mode.value === 'following') {
    void loadFollowing();
  } else if (mode.value === 'search' && query.value.trim()) {
    void runSearch();
  } else {
    void loadTrending();
  }
}

function selectTopic(keyword: string): void {
  query.value = keyword;
  mode.value = 'search';
  void runSearch();
  void nextTick(() => {
    searchInputRef.value?.focus();
  });
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
  if (mode.value === newMode) return;
  if (newMode === 'trending') {
    query.value = '';
    void loadTrending();
  } else if (newMode === 'following') {
    query.value = '';
    if (!selectedAccountId.value && activeAccount.value?.id) {
      selectedAccountId.value = activeAccount.value.id;
    }
    void loadFollowing();
  } else {
    mode.value = 'search';
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

function onVisibilityChange(): void {
  if (document.hidden) return;
  if (viewMode.value !== 'zapper' && Date.now() - lastFetchedAt.value > 60_000) {
    if (mode.value === 'trending') void loadTrending();
    else if (mode.value === 'following') void loadFollowing();
    else if (query.value.trim()) void runSearch();
  }
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange);
  void refreshAccounts().then(() => {
    if (activeAccount.value?.id) {
      selectedAccountId.value = activeAccount.value.id;
    }
  });
  if (hits.value.length === 0) {
    void loadTrending();
  }
});

onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange);
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

        <!-- Quick Topic Chips -->
        <div v-if="mode !== 'following'" class="topic-chips" role="group" aria-label="Themen-Schnellwahl">
          <button
            v-for="topic in quickTopics"
            :key="topic.keyword"
            type="button"
            class="btn btn-sm btn-ghost topic-chip"
            :class="{ active: query.toLowerCase() === topic.keyword }"
            @click="selectTopic(topic.keyword)"
          >
            {{ topic.label }}
          </button>
        </div>

        <!-- Account Selector (Following mode) -->
        <div v-if="mode === 'following'" class="account-selector-group">
          <label class="sr-only" for="following-account-select">TikTok-Account</label>
          <select
            id="following-account-select"
            v-model="selectedAccountId"
            class="account-select"
            title="TikTok-Konto für gefolgte Livestreams wählen"
            @change="handleAccountChange"
          >
            <option value="">(Aktives Konto / Fallback)</option>
            <option v-for="acc in accounts" :key="acc.id" :value="acc.id">
              {{ acc.label }} {{ acc.username ? `(@${acc.username})` : '' }} {{ acc.active ? '★' : '' }}
            </option>
          </select>
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            title="TikTok-Konten verwalten"
            @click="accountSwitcherRef?.openDialog()"
          >
            ⚙️ Konten
          </button>
        </div>

        <div v-if="mode !== 'following'" class="region-filter">
          <label class="sr-only" for="region-select">Region / Land</label>
          <select
            id="region-select"
            v-model="selectedRegion"
            class="region-select"
            title="TikTok Live-Region / Land wählen"
            @change="handleRegionChange"
          >
            <option v-for="opt in regionOptions" :key="opt.code" :value="opt.code">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <!-- View Mode: Grid vs. Zapper -->
        <div class="mode-toggles" role="group" aria-label="Ansicht wählen">
          <button
            type="button"
            class="btn btn-sm"
            :class="viewMode === 'grid' ? 'btn-primary' : 'btn-ghost'"
            title="Karten-Übersicht"
            @click="switchViewMode('grid')"
          >
            ▦ Raster
          </button>
          <button
            type="button"
            class="btn btn-sm"
            :class="viewMode === 'zapper' ? 'btn-primary' : 'btn-ghost'"
            :disabled="zapperHits.length === 0"
            :title="zapperHits.length === 0 ? 'Keine Live-Streamer zum Zappen verfügbar' : 'TikTok Live-Zapper öffnen'"
            @click="switchViewMode('zapper')"
          >
            ⚡ Zapper ({{ zapperHits.length }})
          </button>
        </div>

        <label class="toggle-label">
          <input v-model="onlyLive" type="checkbox" />
          <span>Nur Live ({{ zapperHits.length }})</span>
        </label>

        <button
          type="button"
          class="btn btn-sm btn-ghost refresh-btn"
          :disabled="loading"
          title="Aktualisieren"
          @click="mode === 'following' ? loadFollowing() : (mode === 'search' && query.trim() ? runSearch() : loadTrending())"
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            :class="{ 'spin-icon': loading }"
            aria-hidden="true"
          >
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
      <p v-if="mode === 'following'">
        <span v-if="accounts.length === 0">Kein TikTok-Konto hinterlegt. Füge einen Session-Cookie hinzu, um gefolgte Livestreams anzuzeigen.</span>
        <span v-else>Aktuell ist kein gefolgter Kanal live oder der Session-Cookie ist abgelaufen.</span>
      </p>
      <p v-else-if="query.trim()">Keine passenden Streamer für „{{ query }}“ gefunden.</p>
      <p v-else>Aktuell sind keine Live-Streams verfügbar.</p>
      <div v-if="mode === 'following'" class="empty-actions">
        <button type="button" class="btn btn-sm btn-primary" @click="accountSwitcherRef?.openDialog()">
          {{ accounts.length === 0 ? '+ TikTok-Konto hinzufügen' : 'Konten & Session verwalten' }}
        </button>
      </div>
      <p v-if="providerErrors.length > 0" class="empty-hint mono">
        Provider-Hinweis: {{ providerErrors.map((p) => `${p.name} (${p.last_error})`).join(', ') }}
      </p>
    </div>

    <!-- TIKTOK LIVE-ZAPPER VIEW (LAZY COMPONENT) -->
    <DiscoveryZapperPlayer
      v-else-if="viewMode === 'zapper' && currentZapperHit"
      v-model:index="zapperIndex"
      :hits="zapperHits"
      :initial-index="zapperIndex"
      :has-more-pages="hasMorePages"
      :loading-more="loadingMore"
      :action-busy="actionBusy"
      :get-existing="getExisting"
      :failed-avatars="failedAvatars"
      @close="switchViewMode('grid')"
      @load-more="loadMoreHits"
      @add="handleAdd"
      @activate="handleActivate"
      @queue="handleQueue"
      @switch="handleSwitch"
      @avatar-error="onAvatarError"
    />

    <!-- CARDS GRID VIEW -->
    <div v-else class="cards-grid" role="list" aria-label="Gefundene Streamer">
      <DiscoveryCardItem
        v-for="hit in displayedHits"
        :key="hit.handle"
        :hit="hit"
        :action-busy="actionBusy"
        :existing-streamer="getExisting(hit.handle)"
        :failed-avatars="failedAvatars"
        @preview="openZapperAt"
        @add="handleAdd"
        @activate="handleActivate"
        @queue="handleQueue"
        @switch="handleSwitch"
        @avatar-error="onAvatarError"
      />
    </div>

    <!-- Hidden TikTokAccountSwitcher dialog component for modal trigger -->
    <TikTokAccountSwitcher ref="accountSwitcherRef" style="display: none;" />
  </div>
</template>

<style scoped>
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

.account-selector-group {
  display: flex;
  align-items: center;
  gap: var(--space-2, 0.5rem);
}

.account-select {
  height: 32px;
  padding: 0 0.5rem;
  background: var(--bg-surface, #1e1e1e);
  color: var(--text-color, #e0e0e0);
  border: 1px solid var(--border-color, #333);
  border-radius: 4px;
  font-size: 0.82rem;
}

.account-select:focus {
  outline: none;
  border-color: var(--color-primary, #6366f1);
}

.empty-actions {
  margin-top: var(--space-2, 0.5rem);
}

.spin-icon {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* CARDS GRID */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--space-3, 0.75rem);
}

@media (max-width: 720px) {
  .cards-grid > * {
    content-visibility: auto;
    contain-intrinsic-size: 0 160px;
  }
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
