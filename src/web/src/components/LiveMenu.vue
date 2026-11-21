<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { OverlayScene, Streamer } from '@/src/api/types';
import { refreshStatus, refreshStreamers, useStore } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';
import { formatUptime, stateLabel, stateTone } from '@/src/utils/format';
import { sortStreamersByLive } from '@/src/utils/sort-streamers';

const { store } = useStore();
const { pushToast } = useToast();

const open = ref(false);
const busy = ref<string | null>(null);
const scenes = ref<OverlayScene[]>([]);
const activeSceneId = ref<string | null>(null);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);

const state = computed(() => store.status?.state ?? null);
const tone = computed(() => stateTone(state.value));
const activeId = computed(() => store.status?.active_streamer_id ?? null);
const manualScreen = computed(() => store.status?.manual_screen ?? null);

const activeStreamer = computed<Streamer | null>(
  () => store.streamers.find((streamer) => streamer.id === activeId.value) ?? null,
);

const liveStreamers = computed<Streamer[]>(() =>
  sortStreamersByLive(
    store.streamers.filter(
      (streamer) => streamer.enabled && (streamer.status.online === true || streamer.status.active),
    ),
  ),
);

const connectionLabel = computed(() => {
  if (store.connectionMode === 'live') return 'Live';
  if (store.connectionMode === 'connecting') return 'Verbinde…';
  return 'Offline';
});

const connectionTitle = computed(() =>
  store.sseConnected
    ? 'Echtzeit-Verbindung aktiv'
    : 'Keine Echtzeit-Verbindung – Status wird per Polling geladen',
);

const triggerLabel = computed(
  () =>
    `Live-Steuerung öffnen – Status: ${stateLabel(state.value)}, Verbindung: ${connectionLabel.value}`,
);

const activeLabel = computed(() => {
  if (activeStreamer.value) return activeStreamer.value.name;
  if (manualScreen.value === 'startup') return 'Startbildschirm';
  if (manualScreen.value === 'pause') return 'Pausenscreen';
  return 'Kein aktiver Stream';
});

const activeDetail = computed(() => {
  if (activeStreamer.value) {
    const uptime = formatUptime(store.status?.uptime_seconds);
    if (store.status?.active_playlist) {
      const playlist = store.status.active_playlist;
      return `${stateLabel(state.value)} · ${uptime} · Playlist „${playlist.name}“ ${playlist.index + 1}/${playlist.total}`;
    }
    return `${stateLabel(state.value)} · ${uptime}`;
  }
  if (manualScreen.value) return 'Manuell eingespielter Screen';
  return 'Bereit';
});

function tiktokHandle(streamer: Streamer): string {
  return `@${streamer.tiktok.replace(/^@/, '')}`;
}

async function loadScenes(): Promise<void> {
  try {
    const res = await api.scenes.list();
    scenes.value = res.scenes;
    activeSceneId.value = res.active_scene_id;
  } catch {
    /* scenes optional */
  }
}

async function activateScene(scene: OverlayScene): Promise<void> {
  await run(
    `scene:${scene.id}`,
    () => api.scenes.activate(scene.id),
    `Szene „${scene.name}“ aktiviert.`,
  );
  activeSceneId.value = scene.id;
}

async function openMenu(): Promise<void> {
  open.value = true;
  void loadScenes();
  await nextTick();
  panel.value?.querySelector<HTMLElement>('button, a[href]')?.focus();
}

function closeMenu(restoreFocus = false): void {
  if (!open.value) return;
  open.value = false;
  if (restoreFocus) trigger.value?.focus();
}

function toggleMenu(): void {
  if (open.value) closeMenu(true);
  else void openMenu();
}

function onDocumentPointerDown(event: MouseEvent): void {
  if (!open.value) return;
  if (root.value && !root.value.contains(event.target as Node)) closeMenu();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && open.value) {
    event.stopPropagation();
    closeMenu(true);
  }
}

function onFocusOut(event: FocusEvent): void {
  if (!open.value) return;
  const next = event.relatedTarget as Node | null;
  if (next && root.value?.contains(next)) return;
  closeMenu();
}

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('mousedown', onDocumentPointerDown);
    document.addEventListener('keydown', onKeydown);
  } else {
    document.removeEventListener('mousedown', onDocumentPointerDown);
    document.removeEventListener('keydown', onKeydown);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentPointerDown);
  document.removeEventListener('keydown', onKeydown);
});

async function run(key: string, action: () => Promise<unknown>, message: string): Promise<void> {
  busy.value = key;
  try {
    await action();
    await Promise.allSettled([refreshStatus(), refreshStreamers()]);
    pushToast(message, 'success');
    closeMenu();
  } catch (error) {
    pushToast(errorMessage(error), 'error');
    await Promise.allSettled([refreshStatus(), refreshStreamers()]);
  } finally {
    busy.value = null;
  }
}

async function stopActive(): Promise<void> {
  if (activeId.value) {
    await run(
      'stop',
      () => api.streamers.stop(activeId.value!),
      `${activeLabel.value} wird beendet.`,
    );
    return;
  }
  if (manualScreen.value) {
    await run('screen-stop', () => api.screens.stop(), 'Screen beendet.');
  }
}

function startResultMessage(streamer: Streamer, switching: boolean): string {
  return switching ? `Wechsel zu ${streamer.name}.` : `${streamer.name} wird gestartet.`;
}

async function activate(streamer: Streamer): Promise<void> {
  const switching = Boolean(activeId.value);
  await run(
    `start:${streamer.id}`,
    () => (switching ? api.streamers.switchTo(streamer.id) : api.streamers.start(streamer.id)),
    startResultMessage(streamer, switching),
  );
}
</script>

<template>
  <div ref="root" class="live-menu" @focusout="onFocusOut">
    <button
      ref="trigger"
      type="button"
      class="live-menu-trigger"
      :class="{ 'is-open': open }"
      aria-haspopup="dialog"
      :aria-expanded="open"
      aria-controls="live-menu-panel"
      :aria-label="triggerLabel"
      @click="toggleMenu"
    >
      <span class="status-inline" :class="`tone-${tone}`">
        <span class="dot" aria-hidden="true"></span>
        <span class="status-text">{{ stateLabel(state) }}</span>
      </span>
      <span class="conn" :class="`conn-${store.connectionMode}`" :title="connectionTitle">
        <span class="conn-dot" aria-hidden="true"></span>
        {{ connectionLabel }}
      </span>
      <svg
        class="live-menu-chevron"
        :class="{ 'is-open': open }"
        viewBox="0 0 24 24"
        width="12"
        height="12"
        fill="none"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    </button>
    <span class="sr-only" role="status" aria-live="polite">
      Status: {{ stateLabel(state) }}, Verbindung: {{ connectionLabel }}
    </span>

    <div
      v-if="open"
      id="live-menu-panel"
      ref="panel"
      class="live-menu-panel"
      role="dialog"
      aria-labelledby="live-menu-title"
    >
      <header class="live-menu-head">
        <div>
          <h2 id="live-menu-title" class="live-menu-title">Live-Steuerung</h2>
          <p class="live-menu-sub">{{ activeLabel }}</p>
        </div>
        <button
          type="button"
          class="btn-icon"
          aria-label="Live-Menü schließen"
          @click="closeMenu(true)"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
            <path
              d="m6 6 12 12M18 6 6 18"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </header>

      <section class="live-menu-section" aria-labelledby="live-menu-active-title">
        <h3 id="live-menu-active-title" class="live-menu-label">Aktiver Stream</h3>
        <div v-if="activeStreamer || manualScreen" class="live-menu-active">
          <div class="live-menu-active-main">
            <strong>{{ activeLabel }}</strong>
            <span class="live-menu-meta mono">
              <template v-if="activeStreamer">{{ tiktokHandle(activeStreamer) }} · </template>
              {{ activeDetail }}
            </span>
          </div>
          <button
            type="button"
            class="btn btn-danger btn-sm"
            :disabled="busy !== null"
            @click="stopActive"
          >
            <span
              v-if="busy === 'stop' || busy === 'screen-stop'"
              class="spinner"
              aria-hidden="true"
            ></span>
            {{ manualScreen && !activeStreamer ? 'Screen beenden' : 'Beenden' }}
          </button>
        </div>
        <p v-else class="live-menu-empty">Kein aktiver Stream.</p>
      </section>

      <section class="live-menu-section" aria-labelledby="live-menu-streams-title">
        <div class="live-menu-label-row">
          <h3 id="live-menu-streams-title" class="live-menu-label">Live-Streamer</h3>
          <span class="badge tone-neutral">{{ liveStreamers.length }}</span>
        </div>
        <ul v-if="liveStreamers.length > 0" class="live-menu-list">
          <li v-for="streamer in liveStreamers" :key="streamer.id" class="live-menu-item">
            <span class="online-indicator is-online" :title="`${streamer.name} ist live`">
              <span class="dot" aria-hidden="true"></span>
            </span>
            <div class="live-menu-item-main">
              <strong>{{ streamer.name }}</strong>
              <span class="live-menu-meta mono">{{ tiktokHandle(streamer) }}</span>
            </div>
            <span v-if="streamer.id === activeId" class="badge tone-success">Aktiv</span>
            <button
              v-else
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="busy !== null"
              @click="activate(streamer)"
            >
              <span
                v-if="busy === `start:${streamer.id}`"
                class="spinner"
                aria-hidden="true"
              ></span>
              {{ activeId ? 'Wechseln' : 'Starten' }}
            </button>
          </li>
        </ul>
        <p v-else class="live-menu-empty">Kein Streamer ist live.</p>
      </section>

      <section v-if="scenes.length > 0" class="live-menu-section" aria-labelledby="live-menu-scenes-title">
        <div class="live-menu-label-row">
          <h3 id="live-menu-scenes-title" class="live-menu-label">Overlay-Szenen</h3>
          <span class="badge tone-neutral">{{ scenes.length }}</span>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 6px">
          <button
            v-for="scene in scenes"
            :key="scene.id"
            type="button"
            class="btn btn-sm"
            :class="scene.id === (store.status?.active_scene_id ?? activeSceneId) ? 'btn-primary' : 'btn-ghost'"
            :disabled="busy !== null"
            @click="activateScene(scene)"
          >
            {{ scene.name }}
          </button>
        </div>
      </section>

      <footer class="live-menu-foot">
        <span
          class="live-menu-conn mono"
          :class="`conn-${store.connectionMode}`"
          :title="connectionTitle"
        >
          <span class="conn-dot" aria-hidden="true"></span>
          {{ connectionLabel }}
        </span>
        <RouterLink to="/streamers" class="btn btn-ghost btn-sm" @click="closeMenu()">
          Streamer verwalten
        </RouterLink>
      </footer>
    </div>
  </div>
</template>
