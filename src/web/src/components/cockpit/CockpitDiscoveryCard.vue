<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import type { DiscoveryHit } from '@/src/api/types';
import { QUICK_TOPICS, useDiscoveryFeed } from '@/src/composables/useDiscoveryFeed';
import { openDiscoveryPanel } from '@/src/composables/useDiscoveryPanel';

type Mpegts = typeof import('mpegts.js').default;
type Player = ReturnType<Mpegts['createPlayer']>;

const feed = useDiscoveryFeed();

const previewIndex = ref<number | null>(null);
const videoEl = ref<HTMLVideoElement | null>(null);
const previewStatus = ref<'idle' | 'connecting' | 'playing' | 'error'>('idle');
const player = shallowRef<Player | null>(null);
let mpegtsLib: Mpegts | null = null;

const hits = computed(() => feed.liveHits.value);
const currentHit = computed<DiscoveryHit | null>(() =>
  previewIndex.value !== null ? (hits.value[previewIndex.value] ?? null) : null,
);

const searchModel = computed({
  get: () => feed.query.value,
  set: (v: string) => feed.setQuery(v),
});

function destroyPlayer(): void {
  if (player.value) {
    try {
      player.value.pause();
      player.value.unload();
      player.value.detachMediaElement();
      player.value.destroy();
    } catch {
      /* ignore */
    }
    player.value = null;
  }
  previewStatus.value = 'idle';
}

async function startPlayer(hit: DiscoveryHit): Promise<void> {
  destroyPlayer();
  previewStatus.value = 'connecting';
  try {
    if (!mpegtsLib) {
      const mod = await import('mpegts.js');
      mpegtsLib = mod.default;
    }
    const el = videoEl.value;
    if (!el || !mpegtsLib?.isSupported()) {
      previewStatus.value = 'error';
      return;
    }
    const url = `/api/discovery/preview/${encodeURIComponent(hit.handle)}`;
    const inst = mpegtsLib.createPlayer(
      { type: 'flv', isLive: true, url },
      { enableWorker: false, liveBufferLatencyChasing: true },
    );
    inst.attachMediaElement(el);
    inst.on(mpegtsLib.Events.ERROR, () => {
      previewStatus.value = 'error';
    });
    inst.load();
    await inst.play();
    player.value = inst;
    previewStatus.value = 'playing';
  } catch {
    previewStatus.value = 'error';
  }
}

function openPreview(index: number): void {
  const hit = hits.value[index];
  if (!hit) return;
  previewIndex.value = index;
  void startPlayer(hit);
}

function closePreview(): void {
  previewIndex.value = null;
  destroyPlayer();
}

function zapPreview(delta: number): void {
  if (hits.value.length === 0 || previewIndex.value === null) return;
  const next = (previewIndex.value + delta + hits.value.length) % hits.value.length;
  openPreview(next);
}

function openFullZapper(): void {
  if (currentHit.value) {
    feed.openZapperAt(currentHit.value.handle);
  }
  openDiscoveryPanel();
}

watch(hits, (list) => {
  if (previewIndex.value !== null && !list[previewIndex.value]) {
    closePreview();
  }
});

onBeforeUnmount(() => {
  destroyPlayer();
});
</script>

<template>
  <div class="cockpit-discovery">
    <!-- Inline Vorhör-Player -->
    <div v-if="currentHit" class="disc-inline-player">
      <div class="disc-inline-head">
        <div class="disc-inline-title">
          <span class="badge badge-xs tone-danger">VORHÖREN</span>
          <strong>@{{ currentHit.handle }}</strong>
          <span class="mono muted">{{ currentHit.viewers ?? 0 }}</span>
        </div>
        <div class="disc-inline-tools">
          <button type="button" class="btn btn-ghost btn-xs" title="Vorheriger" @click="zapPreview(-1)">▲</button>
          <button type="button" class="btn btn-ghost btn-xs" title="Nächster" @click="zapPreview(1)">▼</button>
          <button type="button" class="btn btn-ghost btn-xs" title="Großer Zapper" @click="openFullZapper">⤢</button>
          <button type="button" class="btn btn-ghost btn-xs" title="Schließen" @click="closePreview">✕</button>
        </div>
      </div>

      <div class="disc-inline-stage">
        <video ref="videoEl" autoplay playsinline controls class="disc-inline-video"></video>
        <div v-if="previewStatus === 'connecting'" class="disc-inline-overlay">Verbinde…</div>
        <div v-else-if="previewStatus === 'error'" class="disc-inline-overlay">Stream nicht abspielbar</div>
      </div>

      <div class="disc-inline-actions">
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          :disabled="feed.actionBusy.value !== null"
          @click="feed.handleQueue(currentHit)"
        >
          + In Queue
        </button>
        <button
          type="button"
          class="btn btn-primary btn-xs"
          :disabled="feed.actionBusy.value !== null"
          @click="feed.handleSwitch(currentHit)"
        >
          Live schalten
        </button>
      </div>
    </div>

    <!-- Suche & Themen-Chips -->
    <form class="disc-search-row" @submit.prevent="feed.runSearch()">
      <input
        v-model="searchModel"
        type="search"
        placeholder="TikTok Live suchen…"
        aria-label="Discovery-Suche"
      />
      <button type="submit" class="btn btn-ghost btn-xs">Suchen</button>
    </form>

    <div class="disc-topics">
      <button
        v-for="topic in QUICK_TOPICS.slice(0, 5)"
        :key="topic.keyword"
        type="button"
        class="disc-topic-chip"
        :class="{ active: feed.query.value.toLowerCase() === topic.keyword.toLowerCase() }"
        @click="feed.setQuery(topic.keyword); void feed.runSearch(topic.keyword)"
      >
        {{ topic.label }}
      </button>
    </div>

    <!-- Ergebnisliste -->
    <ul v-if="hits.length > 0" class="disc-list">
      <li
        v-for="(hit, idx) in hits"
        :key="hit.handle"
        class="disc-row"
        :class="{ active: previewIndex === idx }"
      >
        <span class="online-indicator is-online"><span class="dot"></span></span>
        <div class="disc-row-meta">
          <strong class="disc-row-name">{{ hit.display_name || hit.handle }}</strong>
          <span class="disc-row-sub">@{{ hit.handle }} · {{ hit.title || 'Live' }}</span>
        </div>
        <span class="mono muted disc-row-viewers">{{ hit.viewers ?? '–' }}</span>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          title="In Karte vorhören"
          @click="openPreview(idx)"
        >
          ▶
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          title="In Queue"
          :disabled="feed.actionBusy.value !== null"
          @click="feed.handleQueue(hit)"
        >
          + Q
        </button>
      </li>
    </ul>
    <p v-else class="muted disc-empty">Keine Live-Treffer geladen.</p>
  </div>
</template>

<style scoped>
.cockpit-discovery { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; }
.disc-inline-player {
  border: 1px solid color-mix(in srgb, var(--accent, #22d3ee) 45%, transparent);
  border-radius: 10px;
  padding: 8px;
  background: var(--surface-2, rgba(0, 0, 0, 0.25));
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.disc-inline-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 12px; }
.disc-inline-title { display: flex; align-items: center; gap: 6px; min-width: 0; }
.disc-inline-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.disc-inline-tools { display: flex; gap: 3px; flex-shrink: 0; }
.disc-inline-stage { position: relative; aspect-ratio: 16 / 9; background: #000; border-radius: 8px; overflow: hidden; }
.disc-inline-video { width: 100%; height: 100%; object-fit: contain; }
.disc-inline-overlay { position: absolute; inset: 0; display: grid; place-items: center; font-size: 12px; color: var(--text-muted); background: rgba(0,0,0,0.55); }
.disc-inline-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.disc-search-row { display: flex; gap: 6px; }
.disc-search-row input { flex: 1; min-width: 0; }
.disc-topics { display: flex; flex-wrap: wrap; gap: 4px; }
.disc-topic-chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-2, transparent);
  color: var(--text-muted);
  cursor: pointer;
}
.disc-topic-chip.active {
  background: var(--accent, #22d3ee);
  color: #061018;
  border-color: transparent;
  font-weight: 600;
}
.disc-list { list-style: none; padding: 0; margin: 0; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; min-height: 0; }
.disc-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2, rgba(255, 255, 255, 0.02));
  font-size: 12px;
}
.disc-row.active { border-color: var(--accent, #22d3ee); }
.disc-row-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.disc-row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.disc-row-sub { font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.disc-row-viewers { font-size: 11px; flex-shrink: 0; }
.disc-empty { font-size: 12px; padding: 12px 0; text-align: center; }
</style>
