<script setup lang="ts">
/**
 * Cockpit transport (#94).
 *
 * One control surface for whatever is on air: queue, playlist, single streamer
 * or a screen. Reads the unified `PlaybackState` from the store and calls the
 * `/api/playback/*` transport, which delegates to the existing controllers.
 */
import { computed, ref, watch } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import { useStore } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';
import { formatSeconds } from '@/src/utils/format';
import type { PlaybackSource } from '@/src/api/types';

const { store, refreshPlayback } = useStore();
const { pushToast } = useToast();

const busy = ref<string | null>(null);
const seekValue = ref(0);
const seeking = ref(false);

const playback = computed(() => store.playback);
const source = computed<PlaybackSource>(() => playback.value?.source ?? 'idle');
const currentLabel = computed(() => playback.value?.current?.label ?? null);
const nextLabel = computed(() => playback.value?.next?.label ?? null);
const isPaused = computed(() => Boolean(playback.value?.paused));
const isPlaying = computed(() => Boolean(playback.value?.playing));
const hasDuration = computed(() => (playback.value?.duration_seconds ?? 0) > 0);
const canStep = computed(() => source.value === 'queue' || source.value === 'playlist');
const canLoop = computed(() => source.value === 'queue');
const loopLabel = computed(() => {
  switch (playback.value?.loop) {
    case 'all':
      return 'Loop alle';
    case 'one':
      return 'Loop eins';
    default:
      return 'Loop aus';
  }
});

const sourceLabel = computed(() => {
  switch (source.value) {
    case 'queue':
      return 'Queue';
    case 'playlist':
      return 'Playlist';
    case 'streamer':
      return 'Streamer';
    case 'screen':
      return 'Screen';
    default:
      return 'Bereit';
  }
});

watch(
  () => playback.value?.position_seconds,
  (position) => {
    if (position !== null && position !== undefined && !seeking.value) {
      seekValue.value = Math.round(position);
    }
  },
  { immediate: true },
);

async function run(key: string, action: () => Promise<unknown>, message?: string): Promise<void> {
  busy.value = key;
  try {
    await action();
    await refreshPlayback();
    if (message) pushToast(message, 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    busy.value = null;
  }
}

function togglePlay(): void {
  if (isPaused.value) {
    void run('resume', () => api.playback.resume(), 'Wiedergabe fortgesetzt.');
    return;
  }
  if (isPlaying.value) {
    void run('pause', () => api.playback.pause(), 'Wiedergabe pausiert.');
    return;
  }
  void run('play', () => api.playback.play(), 'Wiedergabe gestartet.');
}

function step(direction: 'next' | 'previous'): void {
  void run(
    direction,
    () => (direction === 'next' ? api.playback.next() : api.playback.previous()),
    direction === 'next' ? 'Nächster Eintrag.' : 'Vorheriger Eintrag.',
  );
}

function stopPlayback(): void {
  void run('stop', () => api.playback.stop(), 'Wiedergabe gestoppt.');
}

/** Cycles off → all → one → off (#94). */
function cycleLoop(): void {
  const next =
    playback.value?.loop === 'off' ? 'all' : playback.value?.loop === 'all' ? 'one' : 'off';
  const message =
    next === 'all'
      ? 'Loop über alle Einträge.'
      : next === 'one'
        ? 'Aktueller Eintrag wird wiederholt.'
        : 'Loop deaktiviert.';
  void run('loop', () => api.playback.loop(next), message);
}

function commitSeek(): void {
  seeking.value = false;
  void run('seek', () => api.playback.seek(seekValue.value));
}
</script>

<template>
  <section class="playback-bar" aria-label="Wiedergabe-Steuerung">
    <div class="pb-now">
      <span class="pb-source mono">{{ sourceLabel }}</span>
      <strong class="pb-title">{{ currentLabel ?? 'Nichts auf Sendung' }}</strong>
      <span v-if="nextLabel" class="pb-next mono" :title="`Als Nächstes: ${nextLabel}`">
        → {{ nextLabel }}
      </span>
    </div>

    <div class="pb-controls" role="group" aria-label="Transport">
      <button
        type="button"
        class="btn btn-ghost btn-sm pb-btn"
        :disabled="!canStep || busy !== null"
        title="Vorheriger Eintrag"
        aria-label="Vorheriger Eintrag"
        @click="step('previous')"
      >
        <span v-if="busy === 'previous'" class="spinner" aria-hidden="true"></span>
        <span v-else aria-hidden="true">⏮</span>
      </button>
      <button
        type="button"
        class="btn btn-primary btn-sm pb-btn pb-play"
        :disabled="source === 'idle' || busy !== null"
        :title="isPaused ? 'Wiedergabe fortsetzen' : isPlaying ? 'Pausieren' : 'Abspielen'"
        :aria-label="isPaused ? 'Wiedergabe fortsetzen' : isPlaying ? 'Pausieren' : 'Abspielen'"
        @click="togglePlay"
      >
        <span v-if="busy === 'play' || busy === 'pause' || busy === 'resume'" class="spinner" aria-hidden="true"></span>
        <span v-else aria-hidden="true">{{ isPaused || !isPlaying ? '▶' : '❚❚' }}</span>
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-sm pb-btn"
        :disabled="!canStep || busy !== null"
        title="Nächster Eintrag"
        aria-label="Nächster Eintrag"
        @click="step('next')"
      >
        <span v-if="busy === 'next'" class="spinner" aria-hidden="true"></span>
        <span v-else aria-hidden="true">⏭</span>
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-sm pb-btn"
        :disabled="source === 'idle' || busy !== null"
        title="Wiedergabe stoppen"
        aria-label="Wiedergabe stoppen"
        @click="stopPlayback"
      >
        <span v-if="busy === 'stop'" class="spinner" aria-hidden="true"></span>
        <span v-else aria-hidden="true">⏹</span>
      </button>
      <button
        v-if="canLoop"
        type="button"
        class="btn btn-ghost btn-xs"
        :class="{ 'is-active': playback?.loop !== 'off' }"
        :aria-pressed="playback?.loop !== 'off'"
        :disabled="busy !== null"
        @click="cycleLoop"
      >
        {{ loopLabel }}
      </button>
    </div>

    <div v-if="hasDuration" class="pb-seek">
      <span class="mono">{{ formatSeconds(seekValue) }}</span>
      <input
        v-model.number="seekValue"
        type="range"
        min="0"
        :max="Math.floor(playback?.duration_seconds ?? 0)"
        step="1"
        :disabled="busy !== null"
        aria-label="Wiedergabeposition"
        @input="seeking = true"
        @change="commitSeek"
      />
      <span class="mono">{{ formatSeconds(playback?.duration_seconds ?? 0) }}</span>
    </div>
  </section>
</template>

<style scoped>
.playback-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--surface-1);
  box-shadow: var(--elev-1);
}

.pb-now {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  flex: 1 1 240px;
}

.pb-source {
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-dim);
  font-size: 9px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.pb-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pb-next {
  color: var(--text-dim);
  font-size: 9.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pb-controls {
  display: flex;
  align-items: center;
  gap: 4px;
}

.pb-btn {
  min-width: 34px;
  justify-content: center;
}

.pb-play {
  min-width: 42px;
}

.pb-seek {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 240px;
  min-width: 0;
}

.pb-seek input {
  flex: 1;
  min-width: 80px;
  accent-color: var(--accent);
}

.pb-seek .mono {
  color: var(--text-dim);
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 640px) {
  .pb-now {
    flex-basis: 100%;
  }

  .pb-controls {
    flex: 1 1 100%;
    justify-content: space-between;
  }

  .pb-seek {
    flex-basis: 100%;
  }
}
</style>
