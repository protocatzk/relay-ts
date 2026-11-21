<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, errorMessage } from '@/src/api/client';
import type { OverlayScene, Streamer } from '@/src/api/types';
import { refreshStatus, refreshStreamers, useStore } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';
import { useWakeLock } from '@/src/composables/useWakeLock';
import { formatUptime, stateLabel, stateTone } from '@/src/utils/format';
import { sortStreamersByLive, sortStreamersByPriority } from '@/src/utils/sort-streamers';
import {
  DECK_ACTION_LABELS,
  DEFAULT_DECK_ACTIONS,
  loadDeckLayout,
  openStreamDeckWindow,
  saveDeckLayout,
  type DeckActionConfig,
  type DeckActionId,
} from '@/src/utils/stream-deck';

const router = useRouter();
const { store } = useStore();
const { pushToast } = useToast();
const { active: wakeLockActive, requestWakeLock } = useWakeLock();

const busy = ref<string | null>(null);
const isFullscreen = ref(false);
const customizing = ref(false);
const layout = ref<DeckActionConfig[]>(loadDeckLayout());
const scenes = ref<OverlayScene[]>([]);

const visibleActions = computed(() => layout.value.filter((item) => item.visible));

function persistLayout(): void {
  saveDeckLayout(layout.value);
}

function toggleActionVisibility(id: DeckActionId): void {
  const item = layout.value.find((entry) => entry.id === id);
  if (!item) return;
  if (item.visible && visibleActions.value.length <= 1) {
    pushToast('Mindestens eine Aktion muss sichtbar bleiben.', 'info');
    return;
  }
  item.visible = !item.visible;
  persistLayout();
}

function moveAction(index: number, delta: number): void {
  const target = index + delta;
  if (target < 0 || target >= layout.value.length) return;
  const [moved] = layout.value.splice(index, 1);
  if (moved) layout.value.splice(target, 0, moved);
  persistLayout();
}

function resetLayout(): void {
  layout.value = DEFAULT_DECK_ACTIONS.map((entry) => ({ ...entry }));
  persistLayout();
}

function openInNewWindow(): void {
  const opened = openStreamDeckWindow(router);
  if (!opened) {
    pushToast('Popup blockiert – Stream-Deck bleibt im aktuellen Tab.', 'info');
  }
}

const status = computed(() => store.status);
const state = computed(() => status.value?.state ?? null);
const tone = computed(() => stateTone(state.value));
const activeId = computed(() => status.value?.active_streamer_id ?? null);
const manualScreen = computed(() => status.value?.manual_screen ?? null);
const isPaused = computed(() => state.value === 'paused');

const activeName = computed(() => {
  if (status.value?.active_streamer_name) return status.value.active_streamer_name;
  if (manualScreen.value === 'startup') return 'Startbildschirm';
  if (manualScreen.value === 'pause') return 'Pausenscreen';
  return 'Kein aktiver Stream';
});

const canStart = computed(
  () =>
    state.value !== 'starting' &&
    state.value !== 'live' &&
    state.value !== 'reconnecting' &&
    state.value !== 'stopping',
);

const canStop = computed(() => {
  if (state.value === 'stopping') return false;
  return (
    Boolean(activeId.value) ||
    manualScreen.value !== null ||
    state.value === 'starting' ||
    state.value === 'reconnecting'
  );
});

const canPause = computed(() =>
  ['live', 'paused', 'reconnecting', 'idle', 'error'].includes(state.value ?? ''),
);

const startCandidate = computed<Streamer | null>(() => {
  const enabled = sortStreamersByPriority(store.streamers.filter((streamer) => streamer.enabled));
  return (
    enabled.find((streamer) => streamer.preferred && streamer.status.online === true) ??
    enabled.find((streamer) => streamer.status.online === true) ??
    enabled.find((streamer) => streamer.preferred) ??
    enabled[0] ??
    null
  );
});

const liveStreamers = computed<Streamer[]>(() =>
  sortStreamersByLive(
    store.streamers.filter((streamer) => streamer.enabled && streamer.status.online === true),
  ),
);

const activePlaylist = computed(() => status.value?.active_playlist ?? null);

async function run(key: string, action: () => Promise<unknown>, message: string): Promise<void> {
  busy.value = key;
  try {
    await action();
    await Promise.allSettled([refreshStatus(), refreshStreamers()]);
    pushToast(message, 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
    await Promise.allSettled([refreshStatus(), refreshStreamers()]);
  } finally {
    busy.value = null;
  }
}

async function startGlobal(): Promise<void> {
  if (!canStart.value) return;
  const candidate = startCandidate.value;
  if (!candidate) {
    pushToast('Kein aktivierter Streamer vorhanden.', 'error');
    return;
  }
  await run('start', () => api.streamers.start(candidate.id), `${candidate.name} wird gestartet.`);
}

async function stopGlobal(): Promise<void> {
  const id = activeId.value;
  if (id) {
    await run('stop', () => api.streamers.stop(id), 'Stream wird gestoppt.');
    return;
  }
  if (manualScreen.value) {
    await run('screen-stop', () => api.screens.stop(), 'Screen beendet.');
    return;
  }
  pushToast('Es läuft aktuell kein Stream.', 'error');
}

async function togglePause(): Promise<void> {
  const shouldStop = isPaused.value && manualScreen.value !== 'startup';
  await run(
    shouldStop ? 'screen-stop' : 'pause',
    () => (shouldStop ? api.screens.stop() : api.screens.show('pause')),
    shouldStop ? 'Pausenscreen beendet.' : 'Pausenscreen aktiviert.',
  );
}

async function toggleStartup(): Promise<void> {
  const shouldStop = manualScreen.value === 'startup';
  await run(
    shouldStop ? 'screen-stop' : 'startup',
    () => (shouldStop ? api.screens.stop() : api.screens.show('startup')),
    shouldStop ? 'Startbildschirm beendet.' : 'Startbildschirm aktiviert.',
  );
}

async function switchTo(streamer: Streamer): Promise<void> {
  const switching = Boolean(activeId.value);
  await run(
    `switch:${streamer.id}`,
    () => (switching ? api.streamers.switchTo(streamer.id) : api.streamers.start(streamer.id)),
    switching ? `Wechsel zu ${streamer.name}.` : `${streamer.name} wird gestartet.`,
  );
}

async function playlistNext(): Promise<void> {
  await run('next', () => api.playlists.next(), 'Nächster Kanal.');
}

async function playlistPrevious(): Promise<void> {
  await run('previous', () => api.playlists.previous(), 'Vorheriger Kanal.');
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } catch {
    pushToast('Vollbild nicht verfügbar.', 'error');
  }
}

function onFullscreenChange(): void {
  isFullscreen.value = Boolean(document.fullscreenElement);
}

function exit(): void {
  void router.push('/');
}

async function activateScene(scene: OverlayScene): Promise<void> {
  await run(
    `scene:${scene.id}`,
    () => api.scenes.activate(scene.id),
    `Szene „${scene.name}“ aktiviert.`,
  );
}

onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreenChange);
  isFullscreen.value = Boolean(document.fullscreenElement);
  void api.scenes
    .list()
    .then((res) => {
      scenes.value = res.scenes;
    })
    .catch(() => undefined);
});

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
});
</script>

<template>
  <div class="deck">
    <header class="deck-top">
      <div class="deck-brand">
        <img class="header-logo" src="/logo.svg" alt="" width="26" height="26" aria-hidden="true" />
        <span class="deck-title">Stream-Deck</span>
      </div>
      <div class="deck-tools">
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :aria-pressed="customizing"
          @click="customizing = !customizing"
        >
          Anpassen
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          title="In neuem maximiertem Fenster öffnen"
          @click="openInNewWindow"
        >
          Neues Fenster
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :aria-pressed="isFullscreen"
          :aria-label="isFullscreen ? 'Vollbild beenden' : 'Vollbild'"
          @click="toggleFullscreen"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
            <path
              :d="
                isFullscreen
                  ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5'
                  : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'
              "
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span class="hide-xs">{{ isFullscreen ? 'Fenster' : 'Vollbild' }}</span>
        </button>
        <button type="button" class="btn btn-ghost btn-sm" aria-label="Stream-Deck schließen" @click="exit">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
          <span class="hide-xs">Beenden</span>
        </button>
      </div>
    </header>

    <section v-if="customizing" class="deck-section deck-config" aria-label="Aktionen anpassen">
      <div class="deck-section-head">
        <h2>Aktionen anpassen</h2>
        <button type="button" class="btn btn-ghost btn-xs" @click="resetLayout">Zurücksetzen</button>
      </div>
      <ol class="deck-config-list">
        <li v-for="(item, index) in layout" :key="item.id" class="deck-config-item">
          <label class="checkbox">
            <input
              type="checkbox"
              :checked="item.visible"
              @change="toggleActionVisibility(item.id)"
            />
            <span>{{ DECK_ACTION_LABELS[item.id] }}</span>
          </label>
          <div class="quick-actions">
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              :disabled="index === 0"
              :aria-label="`${DECK_ACTION_LABELS[item.id]} nach oben`"
              @click="moveAction(index, -1)"
            >
              ↑
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              :disabled="index === layout.length - 1"
              :aria-label="`${DECK_ACTION_LABELS[item.id]} nach unten`"
              @click="moveAction(index, 1)"
            >
              ↓
            </button>
          </div>
        </li>
      </ol>
    </section>

    <section class="deck-state" :class="`tone-${tone}`" aria-live="polite">
      <span class="deck-state-label mono">{{ stateLabel(state) }}</span>
      <span class="deck-state-name">{{ activeName }}</span>
      <span v-if="status?.uptime_seconds" class="deck-state-uptime mono">
        {{ formatUptime(status.uptime_seconds) }}
      </span>
    </section>

    <section class="deck-actions" aria-label="Stream-Steuerung">
      <template v-for="action in visibleActions" :key="action.id">
        <button
          v-if="action.id === 'start'"
          type="button"
          class="deck-btn deck-btn-start"
          :disabled="!canStart || busy !== null"
          @click="startGlobal"
        >
          <span v-if="busy === 'start'" class="spinner spinner-lg" aria-hidden="true"></span>
          <svg v-else viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden="true">
            <path d="m8 5 11 7-11 7V5Z" fill="currentColor" />
          </svg>
          Start
        </button>
        <button
          v-else-if="action.id === 'stop'"
          type="button"
          class="deck-btn deck-btn-stop"
          :disabled="!canStop || busy !== null"
          @click="stopGlobal"
        >
          <span v-if="busy === 'stop' || busy === 'screen-stop'" class="spinner spinner-lg" aria-hidden="true"></span>
          <svg v-else viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
          </svg>
          Stop
        </button>
        <button
          v-else-if="action.id === 'pause'"
          type="button"
          class="deck-btn deck-btn-pause"
          :disabled="!canPause || busy !== null"
          @click="togglePause"
        >
          <span v-if="busy === 'pause' || busy === 'screen-stop'" class="spinner spinner-lg" aria-hidden="true"></span>
          <svg v-else viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden="true">
            <path
              :d="
                manualScreen === 'pause' || (isPaused && manualScreen !== 'startup')
                  ? 'm8 5 11 7-11 7V5Z'
                  : 'M8 5v14M16 5v14'
              "
              :fill="manualScreen === 'pause' || (isPaused && manualScreen !== 'startup') ? 'currentColor' : 'none'"
              :stroke="manualScreen === 'pause' || (isPaused && manualScreen !== 'startup') ? 'none' : 'currentColor'"
              stroke-width="2.6"
              stroke-linecap="round"
            />
          </svg>
          {{ manualScreen === 'pause' || (isPaused && manualScreen !== 'startup') ? 'Resume' : 'Pause' }}
        </button>
        <button
          v-else-if="action.id === 'startup'"
          type="button"
          class="deck-btn deck-btn-startup"
          :disabled="!canPause || busy !== null"
          @click="toggleStartup"
        >
          <span v-if="busy === 'startup' || busy === 'screen-stop'" class="spinner spinner-lg" aria-hidden="true"></span>
          <svg v-else viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden="true">
            <rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" stroke-width="1.8" />
            <path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
          {{ manualScreen === 'startup' ? 'Startbildschirm aus' : 'Startbildschirm' }}
        </button>
      </template>
    </section>

    <section class="deck-section" aria-labelledby="deck-live-title">
      <div class="deck-section-head">
        <h2 id="deck-live-title">Live-Streamer</h2>
        <span class="badge tone-neutral">{{ liveStreamers.length }}</span>
      </div>
      <div v-if="liveStreamers.length > 0" class="deck-streamers">
        <button
          v-for="streamer in liveStreamers"
          :key="streamer.id"
          type="button"
          class="deck-streamer"
          :class="{ 'is-active': streamer.id === activeId }"
          :disabled="busy !== null"
          @click="switchTo(streamer)"
        >
          <span class="online-indicator is-online" aria-hidden="true">
            <span class="dot"></span>
          </span>
          <span class="deck-streamer-name">{{ streamer.name }}</span>
          <span v-if="streamer.id === activeId" class="badge tone-success">Aktiv</span>
          <span v-else class="deck-streamer-action">{{ activeId ? 'Wechseln' : 'Starten' }}</span>
        </button>
      </div>
      <p v-else class="empty compact">Kein Streamer ist gerade live.</p>
    </section>

    <section v-if="scenes.length > 0" class="deck-section" aria-labelledby="deck-scenes-title">
      <div class="deck-section-head">
        <h2 id="deck-scenes-title">Szenen</h2>
        <span class="badge tone-neutral">{{ scenes.length }}</span>
      </div>
      <div class="deck-streamers">
        <button
          v-for="scene in scenes"
          :key="scene.id"
          type="button"
          class="deck-streamer"
          :class="{ 'is-active': scene.id === status?.active_scene_id }"
          :disabled="busy !== null"
          @click="activateScene(scene)"
        >
          <span class="deck-streamer-name">{{ scene.name }}</span>
          <span v-if="scene.id === status?.active_scene_id" class="badge tone-success">Aktiv</span>
          <span v-else class="deck-streamer-action">Wechseln</span>
        </button>
      </div>
    </section>

    <section v-if="activePlaylist" class="deck-section" aria-labelledby="deck-playlist-title">
      <div class="deck-section-head">
        <h2 id="deck-playlist-title">Playlist</h2>
        <span class="mono muted">{{ activePlaylist.index + 1 }}/{{ activePlaylist.total }}</span>
      </div>
      <p class="deck-playlist-name">{{ activePlaylist.name }}</p>
      <div class="deck-playlist-actions">
        <button
          type="button"
          class="btn btn-ghost"
          :disabled="busy !== null"
          @click="playlistPrevious"
        >
          Vorheriger
        </button>
        <button type="button" class="btn btn-secondary" :disabled="busy !== null" @click="playlistNext">
          Nächster
        </button>
      </div>
    </section>

    <footer class="deck-foot">
      <span class="conn-mini" :class="`conn-${store.connectionMode}`">
        <span class="conn-dot" aria-hidden="true"></span>
        {{ store.connectionMode === 'live' ? 'Verbunden' : 'Verbindung…' }}
      </span>
      <span class="mono muted">
        Wake Lock {{ wakeLockActive ? 'aktiv' : 'aus' }}
        <button
          v-if="!wakeLockActive"
          type="button"
          class="btn btn-ghost btn-xs"
          @click="requestWakeLock"
        >
          aktivieren
        </button>
      </span>
    </footer>
  </div>
</template>
