<script setup lang="ts">
/**
 * Discovery workspace (#92).
 *
 * Contains search, filters, result list and zapper. It deliberately knows
 * nothing about where it is mounted: the cockpit panel, the full-page view and
 * a future floating window can all host it.
 */
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue';
import DiscoveryResultRow from '@/src/components/discovery/DiscoveryResultRow.vue';
import AppSkeleton from '@/src/components/ui/AppSkeleton.vue';
import {
  QUICK_TOPICS,
  REGION_OPTIONS,
  SORT_OPTIONS,
  useDiscoveryFeed,
} from '@/src/composables/useDiscoveryFeed';
import { useDiscoveryPanel } from '@/src/composables/useDiscoveryPanel';
import { useRouter } from 'vue-router';

const DiscoveryZapperPlayer = defineAsyncComponent(
  () => import('@/src/components/discovery/DiscoveryZapperPlayer.vue'),
);

const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });

const router = useRouter();
const feed = useDiscoveryFeed();
const { closeDiscoveryPanel } = useDiscoveryPanel();

const searchInput = ref<HTMLInputElement | null>(null);
const showHistory = ref(false);
const searchModel = computed({
  get: () => feed.query.value,
  set: (value: string) => feed.setQuery(value),
});

const liveLabel = computed(() => `${feed.totalLive.value} live`);

const emptyHint = computed(() => {
  if (feed.onlyLive.value) return 'Keine Live-Treffer mit diesen Filtern.';
  return 'Keine Treffer – anderen Begriff oder Modus probieren.';
});

function submitSearch(): void {
  showHistory.value = false;
  void feed.runSearch();
}

function pickHistory(term: string): void {
  showHistory.value = false;
  feed.setQuery(term);
  void feed.runSearch(term);
}

function focusSearch(): void {
  void nextTick(() => searchInput.value?.focus());
}

function addHitToQueue(hit: Parameters<typeof feed.handleQueue>[0]): void {
  void feed.handleQueue(hit);
}

function switchToHit(hit: Parameters<typeof feed.handleSwitch>[0]): void {
  void feed.handleSwitch(hit);
}

function addStreamer(hit: Parameters<typeof feed.handleAdd>[0]): void {
  void feed.handleAdd(hit);
}

function activateStreamer(streamer: Parameters<typeof feed.handleActivate>[0]): void {
  void feed.handleActivate(streamer);
}

function openFullView(): void {
  closeDiscoveryPanel();
  void router.push('/discovery');
}

watch(
  () => feed.mode.value,
  (mode) => {
    if (mode === 'search') focusSearch();
  },
);

defineExpose({ focusSearch });
void props;
</script>

<template>
  <div class="discovery-workspace">
    <header class="dw-head">
      <div class="dw-title">
        <h2>Discovery</h2>
        <span class="dw-count mono">{{ liveLabel }}</span>
      </div>
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        title="Discovery schließen (Esc)"
        aria-label="Discovery schließen"
        @click="closeDiscoveryPanel"
      >
        ✕
      </button>
    </header>

    <form class="dw-search" role="search" @submit.prevent="submitSearch">
      <input
        id="discovery-panel-search"
        ref="searchInput"
        v-model="searchModel"
        type="search"
        placeholder="Begriff oder @handle…"
        autocomplete="off"
        spellcheck="false"
        aria-label="TikTok-Live-Streamer suchen"
        @focus="showHistory = feed.history.value.length > 0"
        @input="feed.setQuery(searchModel)"
      />
      <button type="submit" class="btn btn-primary btn-sm" :disabled="feed.loading.value">
        <span v-if="feed.loading.value" class="spinner" aria-hidden="true"></span>
        Suchen
      </button>
    </form>

    <div v-if="showHistory && feed.history.value.length > 0" class="dw-history">
      <span class="dw-history-label">Zuletzt</span>
      <button
        v-for="term in feed.history.value"
        :key="term"
        type="button"
        class="dw-history-chip"
        @click="pickHistory(term)"
      >
        {{ term }}
      </button>
      <button type="button" class="dw-history-clear" @click="feed.clearSearchHistory()">
        Verlauf löschen
      </button>
    </div>

    <div class="dw-modes" role="group" aria-label="Quelle wählen">
      <button
        type="button"
        class="btn btn-xs"
        :class="feed.mode.value === 'trending' ? 'btn-primary' : 'btn-ghost'"
        @click="feed.setMode('trending')"
      >
        Trending
      </button>
      <button
        type="button"
        class="btn btn-xs"
        :class="feed.mode.value === 'following' ? 'btn-primary' : 'btn-ghost'"
        @click="feed.setMode('following')"
      >
        Gefolgt
      </button>
      <button
        type="button"
        class="btn btn-xs"
        :class="feed.mode.value === 'search' ? 'btn-primary' : 'btn-ghost'"
        @click="feed.setMode('search')"
      >
        Suche
      </button>
    </div>

    <div class="dw-topics">
      <button
        v-for="topic in QUICK_TOPICS"
        :key="topic.keyword"
        type="button"
        class="dw-topic"
        :class="{ 'is-active': feed.query.value.toLowerCase() === topic.keyword }"
        @click="feed.selectTopic(topic.keyword)"
      >
        {{ topic.label }}
      </button>
    </div>

    <div class="dw-filters">
      <label class="dw-toggle">
        <input v-model="feed.onlyLive.value" type="checkbox" />
        <span>Nur live</span>
      </label>
      <select v-model="feed.region.value" aria-label="Region" @change="feed.setRegion(feed.region.value)">
        <option v-for="option in REGION_OPTIONS" :key="option.code" :value="option.code">
          {{ option.label }}
        </option>
      </select>
      <select v-model="feed.sort.value" aria-label="Sortierung">
        <option v-for="option in SORT_OPTIONS" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <label class="dw-min-viewers">
        <span class="sr-only">Mindestzuschauer</span>
        <input
          v-model.number="feed.minViewers.value"
          type="number"
          min="0"
          step="50"
          placeholder="min. ▲"
          aria-label="Mindestzuschauer"
        />
      </label>
    </div>

    <p v-if="feed.providerErrors.value.length > 0" class="dw-provider-warning" role="status">
      Provider gestört:
      {{ feed.providerErrors.value.map((provider) => provider.name).join(', ') }}
      <button type="button" class="btn btn-ghost btn-xs" @click="feed.refresh()">Erneut</button>
    </p>

    <div v-if="feed.pane.value === 'zapper' && feed.currentZapperHit.value" class="dw-zapper">
      <DiscoveryZapperPlayer
        v-model:index="feed.zapperIndex.value"
        :hits="feed.liveHits.value"
        :initial-index="feed.zapperIndex.value"
        :has-more-pages="feed.hasMore.value"
        :loading-more="feed.loadingMore.value"
        :action-busy="feed.actionBusy.value"
        :get-existing="feed.getExisting"
        :failed-avatars="feed.failedAvatars.value"
        @close="feed.showGrid()"
        @load-more="feed.loadMore()"
        @add="addStreamer"
        @activate="activateStreamer"
        @queue="addHitToQueue"
        @switch="switchToHit"
        @avatar-error="feed.markAvatarFailed"
      />
    </div>

    <div v-else class="dw-body">
      <div v-if="feed.loading.value" class="dw-list" aria-busy="true">
        <AppSkeleton v-for="index in 5" :key="index" :lines="1" height="42px" radius="8px" width="100%" />
        <span class="sr-only">Discovery wird geladen</span>
      </div>

      <div v-else-if="feed.error.value" class="dw-error" role="alert">
        <p>{{ feed.error.value }}</p>
        <button type="button" class="btn btn-ghost btn-sm" @click="feed.refresh()">Erneut versuchen</button>
      </div>

      <ul v-else-if="feed.visibleHits.value.length > 0" class="dw-list" aria-label="Discovery-Treffer">
        <DiscoveryResultRow
          v-for="hit in feed.visibleHits.value"
          :key="hit.handle"
          :hit="hit"
          :existing="feed.getExisting(hit.handle)"
          :busy="feed.actionBusy.value?.endsWith(hit.handle)"
          :failed-avatar="feed.failedAvatars.value.has(hit.handle)"
          @queue="addHitToQueue"
          @switch="switchToHit"
          @add="addStreamer"
          @activate="activateStreamer"
          @preview="feed.openZapperAt(hit.handle)"
          @avatar-error="feed.markAvatarFailed"
        />
      </ul>

      <div v-else class="dw-empty">
        <p>{{ emptyHint }}</p>
        <button v-if="feed.hasActiveFilter.value" type="button" class="btn btn-ghost btn-sm" @click="feed.onlyLive.value = false; feed.minViewers.value = 0">
          Filter löschen
        </button>
      </div>

      <button
        v-if="feed.hasMore.value && feed.visibleHits.value.length > 0"
        type="button"
        class="btn btn-ghost btn-sm dw-more"
        :disabled="feed.loadingMore.value"
        @click="feed.loadMore()"
      >
        <span v-if="feed.loadingMore.value" class="spinner" aria-hidden="true"></span>
        Mehr laden
      </button>
    </div>

    <footer class="dw-foot">
      <span class="mono">{{ feed.totalLive.value }} live · {{ feed.refreshedLabel.value }}</span>
      <div class="dw-foot-actions">
        <button type="button" class="btn btn-ghost btn-xs" :disabled="feed.loading.value" @click="feed.refresh()">
          ↻
        </button>
        <button type="button" class="btn btn-ghost btn-xs" :disabled="feed.liveHits.value.length === 0" @click="feed.openZapperAt()">
          ⚡ Zapper
        </button>
        <button v-if="compact" type="button" class="btn btn-ghost btn-xs" @click="openFullView">
          Vollansicht
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.discovery-workspace {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  gap: 8px;
}

.dw-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.dw-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.dw-title h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--text-strong);
}

.dw-count {
  color: var(--text-dim);
  font-size: 9.5px;
}

.dw-search {
  display: flex;
  gap: 6px;
}

.dw-search input {
  min-height: 32px;
  font-size: 13px;
}

.dw-history {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.dw-history-label {
  color: var(--text-dim);
  font-size: 9.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.dw-history-chip,
.dw-history-clear {
  padding: 2px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 10px;
  cursor: pointer;
}

.dw-history-clear {
  border-color: transparent;
  background: none;
  color: var(--text-dim);
}

.dw-modes,
.dw-topics,
.dw-filters {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.dw-topic {
  padding: 2px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 10px;
  cursor: pointer;
}

.dw-topic.is-active {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: var(--accent-text);
}

.dw-filters select,
.dw-filters input[type='number'] {
  min-height: 28px;
  padding: 0 8px;
  font-size: 11px;
}

.dw-filters select {
  width: auto;
  max-width: 150px;
}

.dw-min-viewers input {
  width: 86px;
}

.dw-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.dw-provider-warning {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin: 0;
  padding: 5px 8px;
  border: 1px solid var(--warning-border);
  border-radius: var(--radius-control);
  background: var(--warning-soft);
  color: var(--warning);
  font-size: 10.5px;
}

.dw-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  gap: 6px;
}

.dw-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.dw-error,
.dw-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 12px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

.dw-more {
  align-self: center;
}

.dw-zapper {
  flex: 1;
  min-height: 0;
  display: flex;
}

.dw-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--border-subtle);
  color: var(--text-dim);
  font-size: 9.5px;
}

.dw-foot-actions {
  display: flex;
  gap: 2px;
}
</style>
