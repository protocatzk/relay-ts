<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { DiscoveryHit, DiscoveryProviderStatus, Streamer } from '@/src/api/types';
import { useStore } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';

const { store, refreshStreamers, refreshStatus } = useStore();
const { pushToast } = useToast();

const query = ref('');
const mode = ref<'trending' | 'search'>('trending');
const onlyLive = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);

const hits = ref<DiscoveryHit[]>([]);
const providers = ref<DiscoveryProviderStatus[]>([]);
const lastFetchedAt = ref<number>(0);
const actionBusy = ref<string | null>(null);
const justAdded = ref<Map<string, Streamer>>(new Map());

const quickTopics = [
  { label: '🇩🇪 Deutsch', keyword: 'deutsch' },
  { label: '🎮 Gaming', keyword: 'gaming' },
  { label: '🎵 Musik', keyword: 'musik' },
  { label: '💬 Talk', keyword: 'talk' },
  { label: ' Fortnite', keyword: 'fortnite' },
  { label: '🍳 Lifestyle', keyword: 'kochen' },
];

// Keep in sync with store.discovery if SSE pushes updates
watch(
  () => store.discovery,
  (val) => {
    if (val && mode.value === 'trending' && !query.value.trim()) {
      hits.value = val.hits;
      providers.value = val.providers;
      lastFetchedAt.value = Date.now();
    }
  },
  { immediate: true },
);

async function loadTrending(): Promise<void> {
  mode.value = 'trending';
  loading.value = true;
  error.value = null;
  try {
    const res = await api.discovery.trending();
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
  try {
    const res = await api.discovery.search(trimmed);
    hits.value = res.hits;
    providers.value = res.providers;
    lastFetchedAt.value = Date.now();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
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

function switchMode(newMode: 'trending' | 'search'): void {
  mode.value = newMode;
  if (newMode === 'trending') {
    query.value = '';
    void loadTrending();
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

function onVisibilityChange(): void {
  if (!document.hidden && Date.now() - lastFetchedAt.value > 60_000) {
    if (mode.value === 'trending') void loadTrending();
    else if (query.value.trim()) void runSearch();
  }
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange);
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
          Neue TikTok-Live-Streamer nach Themen, Begriffen oder @Handle durchsuchen und per Klick übernehmen.
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
        <div class="mode-toggles" role="group" aria-label="Ansicht wählen">
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
            :class="mode === 'search' ? 'btn-primary' : 'btn-ghost'"
            @click="switchMode('search')"
          >
            🔍 Suche
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

        <label class="toggle-label" for="filter-only-live">
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

    <!-- Cards Grid -->
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
              v-if="hit.avatar_url"
              :src="hit.avatar_url"
              :alt="`Avatar von ${hit.display_name}`"
              class="avatar-img"
              loading="lazy"
              referrerpolicy="no-referrer"
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
