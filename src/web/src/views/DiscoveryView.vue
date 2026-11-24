<script setup lang="ts">
import { defineAsyncComponent, nextTick, onMounted, ref } from 'vue';
import type { DiscoveryProviderStatus } from '@/src/api/types';
import {
  QUICK_TOPICS,
  REGION_OPTIONS,
  useDiscoveryFeed,
} from '@/src/composables/useDiscoveryFeed';
import { useTikTokAccounts } from '@/src/composables/useTikTokAccounts';
import DiscoveryCardItem from '@/src/components/discovery/DiscoveryCardItem.vue';
import TikTokAccountSwitcher from '@/src/components/TikTokAccountSwitcher.vue';

// Async component for DiscoveryZapperPlayer to lazy-load video playback assets
const DiscoveryZapperPlayer = defineAsyncComponent(
  () => import('@/src/components/discovery/DiscoveryZapperPlayer.vue'),
);

const { accounts, activeAccount, refreshAccounts, activateAccount } = useTikTokAccounts();
const feed = useDiscoveryFeed();

// Feed state, exposed under the names the template already uses.
const query = feed.query;
const mode = feed.mode;
const viewMode = feed.pane;
const selectedRegion = feed.region;
const onlyLive = feed.onlyLive;
const loading = feed.loading;
const loadingMore = feed.loadingMore;
const hasMorePages = feed.hasMore;
const error = feed.error;
const hits = feed.hits;
const providers = feed.providers;
const actionBusy = feed.actionBusy;
const failedAvatars = feed.failedAvatars;
const zapperIndex = feed.zapperIndex;
const selectedAccountId = feed.selectedAccountId;
const displayedHits = feed.visibleHits;
const zapperHits = feed.liveHits;
const currentZapperHit = feed.currentZapperHit;
const providerErrors = feed.providerErrors;
const getExisting = feed.getExisting;

const loadTrending = feed.loadTrending;
const runSearch = feed.runSearch;
const loadFollowing = feed.loadFollowing;
const loadMoreHits = feed.loadMore;
const handleAdd = feed.handleAdd;
const handleActivate = feed.handleActivate;
const handleQueue = feed.handleQueue;
const handleSwitch = feed.handleSwitch;

const regionOptions = REGION_OPTIONS;
const quickTopics = QUICK_TOPICS;

const accountSwitcherRef = ref<{ openDialog: () => void } | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);

function onAvatarError(handle: string): void {
  feed.markAvatarFailed(handle);
}

function providerClass(status: DiscoveryProviderStatus): string {
  return `provider-${feed.providerTone(status)}`;
}

function openZapperAt(handle?: string): void {
  feed.openZapperAt(handle);
}

function switchViewMode(target: 'grid' | 'zapper'): void {
  if (target === 'grid') feed.showGrid();
  else feed.openZapperAt();
}

function handleAccountChange(): void {
  const target = selectedAccountId.value;
  void (async () => {
    if (target) await activateAccount(target);
    await feed.loadFollowing({ accountId: target });
  })();
}

function handleRegionChange(): void {
  feed.setRegion(selectedRegion.value);
}

function selectTopic(keyword: string): void {
  feed.selectTopic(keyword);
  void nextTick(() => searchInputRef.value?.focus());
}

function handleSearchSubmit(event: Event): void {
  event.preventDefault();
  void feed.runSearch();
}

function handleSearchInput(): void {
  feed.setQuery(query.value);
  if (!query.value.trim() && mode.value === 'search') void feed.loadTrending();
}

function switchMode(newMode: 'trending' | 'search' | 'following'): void {
  if (mode.value === newMode) return;
  feed.setMode(newMode);
  if (newMode === 'search') void nextTick(() => searchInputRef.value?.focus());
}

onMounted(() => {
  feed.start();
  void refreshAccounts().then(() => {
    if (activeAccount.value?.id && !selectedAccountId.value) {
      selectedAccountId.value = activeAccount.value.id;
    }
  });
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
            title="TikTok-Konto für Discovery und Following; Streamer können im Streamer-Editor ein eigenes Konto erhalten"
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
  /* min() keeps the track inside a 320 px viewport instead of forcing 320 px
     plus page padding (#88). */
  grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr));
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
