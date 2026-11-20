<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { MediaFile, QueueEntryKind, QueueSnapshot } from '@/src/api/types';
import { useStore } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';

const { store, applyQueue } = useStore();
const { pushToast } = useToast();

const media = ref<MediaFile[]>([]);
const selectedMedia = ref('');
const selectedStreamer = ref('');
const selectedScreen = ref<'pause' | 'startup'>('pause');
const busy = ref(false);

const queue = computed(() => store.queue);
const entries = computed(() => queue.value?.entries ?? []);
const activeIndex = computed(() => queue.value?.index ?? null);
const enabledStreamers = computed(() => store.streamers.filter((streamer) => streamer.enabled));
const activeMedia = computed(() => store.status?.media ?? null);
const seekValue = ref(0);
const seeking = ref(false);

watch(
  activeMedia,
  (next) => {
    if (next && !seeking.value) seekValue.value = Math.round(next.position_seconds);
  },
  { immediate: true },
);

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

function seekTo(seconds: number): void {
  seeking.value = false;
  void run(() => api.queue.seek(Math.max(0, Math.round(seconds))));
}

function nudge(delta: number): void {
  const duration = activeMedia.value?.duration_seconds ?? 0;
  const target = Math.max(0, Math.min(Math.max(0, duration - 0.5), seekValue.value + delta));
  seekValue.value = Math.max(0, Math.round(target));
  seekTo(target);
}

const KIND_LABELS: Record<QueueEntryKind, string> = {
  file: 'Video',
  streamer: 'Stream',
  screen: 'Screen',
};

function kindLabel(kind: QueueEntryKind): string {
  return KIND_LABELS[kind] ?? kind;
}

async function loadMedia(): Promise<void> {
  try {
    media.value = (await api.media.list()).files;
  } catch {
    media.value = [];
  }
}

async function run(action: () => Promise<{ queue: QueueSnapshot }>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    applyQueue((await action()).queue);
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    busy.value = false;
  }
}

function addMedia(): void {
  if (selectedMedia.value) void run(() => api.queue.add(`file:${selectedMedia.value}`));
}

function playNowMedia(): void {
  if (selectedMedia.value) void run(() => api.queue.now(`file:${selectedMedia.value}`));
}

function addStreamer(): void {
  if (selectedStreamer.value) void run(() => api.queue.add(selectedStreamer.value));
}

function addScreen(): void {
  void run(() => api.queue.add(`screen:${selectedScreen.value}`));
}

function remove(id: string): void {
  void run(() => api.queue.remove(id));
}

function move(id: string, direction: number): void {
  const index = entries.value.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  void run(() => api.queue.move(id, index + direction));
}

function play(index: number): void {
  void run(() => api.queue.play(index));
}

function next(): void {
  void run(() => api.queue.next());
}

function stop(): void {
  void run(() => api.queue.stop());
}

function clear(): void {
  if (!window.confirm('Regie-Queue leeren?')) return;
  void run(() => api.queue.clear());
}

onMounted(() => void loadMedia());
</script>

<template>
  <section class="card regie-queue" aria-labelledby="regie-title">
    <div class="card-head">
      <div>
        <h2 id="regie-title" class="card-title">Regie-Queue</h2>
        <p class="card-sub">Videos, Streamer und Screens spontan zusammenstellen.</p>
      </div>
      <div class="card-badges">
        <span v-if="queue?.playing" class="badge tone-success">Läuft</span>
        <span v-else class="badge tone-muted">Gestoppt</span>
        <span v-if="entries.length > 0" class="badge tone-neutral mono">
          {{ activeIndex != null ? activeIndex + 1 : '–' }}/{{ entries.length }}
        </span>
      </div>
    </div>

    <div class="regie-add">
      <div class="regie-add-row">
        <select v-model="selectedMedia" aria-label="Video auswählen">
          <option value="" disabled>Video wählen …</option>
          <option v-for="file in media" :key="file.filename" :value="file.filename">
            {{ file.filename }}
          </option>
        </select>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="busy || !selectedMedia"
          @click="addMedia"
        >
          + Video
        </button>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="busy || !selectedMedia"
          title="Video sofort abspielen (als Nächstes einschieben)"
          @click="playNowMedia"
        >
          ▶ Sofort
        </button>
      </div>
      <div class="regie-add-row">
        <select v-model="selectedStreamer" aria-label="Streamer auswählen">
          <option value="" disabled>Streamer wählen …</option>
          <option v-for="streamer in enabledStreamers" :key="streamer.id" :value="streamer.id">
            {{ streamer.name }}
          </option>
        </select>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="busy || !selectedStreamer"
          @click="addStreamer"
        >
          + Streamer
        </button>
      </div>
      <div class="regie-add-row">
        <select v-model="selectedScreen" aria-label="Screen auswählen">
          <option value="pause">Pausenscreen</option>
          <option value="startup">Startbildschirm</option>
        </select>
        <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="addScreen">
          + Screen
        </button>
      </div>
    </div>

    <div v-if="activeMedia" class="regie-seek">
      <div class="regie-seek-head">
        <span class="mono">Video · {{ activeMedia.file }}</span>
        <span class="mono"
          >{{ formatClock(seekValue) }} / {{ formatClock(activeMedia.duration_seconds) }}</span
        >
      </div>
      <input
        class="regie-seek-range"
        type="range"
        min="0"
        :max="Math.max(0, Math.floor(activeMedia.duration_seconds))"
        step="1"
        v-model.number="seekValue"
        :disabled="busy"
        aria-label="Videoposition"
        @input="seeking = true"
        @change="seekTo(seekValue)"
      />
      <div class="regie-seek-actions">
        <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="nudge(-10)">
          −10 s
        </button>
        <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="nudge(10)">
          +10 s
        </button>
      </div>
    </div>

    <ol v-if="entries.length > 0" class="regie-list">
      <li
        v-for="(entry, index) in entries"
        :key="entry.id"
        class="regie-item"
        :class="{ 'is-active': activeIndex === index }"
      >
        <span class="regie-index mono">{{ index + 1 }}</span>
        <span class="regie-kind" :class="`is-${entry.kind}`">{{ kindLabel(entry.kind) }}</span>
        <span class="regie-label" :title="entry.channel">{{ entry.label }}</span>
        <span class="regie-item-actions">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="busy || index === 0"
            aria-label="Nach oben"
            @click="move(entry.id, -1)"
          >
            ↑
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="busy || index === entries.length - 1"
            aria-label="Nach unten"
            @click="move(entry.id, 1)"
          >
            ↓
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="busy"
            aria-label="Ab dieser Stelle abspielen"
            @click="play(index)"
          >
            ▶
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="busy"
            aria-label="Eintrag entfernen"
            @click="remove(entry.id)"
          >
            ✕
          </button>
        </span>
      </li>
    </ol>
    <div v-else class="empty compact">
      <p>Noch keine Einträge. Videos, Streamer oder Screens hinzufügen.</p>
    </div>

    <div class="regie-footer">
      <button
        type="button"
        class="btn btn-primary"
        :disabled="busy || entries.length === 0"
        @click="play(0)"
      >
        Abspielen
      </button>
      <button type="button" class="btn btn-ghost" :disabled="busy || !queue?.playing" @click="next">
        Überspringen
      </button>
      <button type="button" class="btn btn-ghost" :disabled="busy || !queue?.playing" @click="stop">
        Stopp
      </button>
      <button
        type="button"
        class="btn btn-ghost"
        :disabled="busy || entries.length === 0"
        @click="clear"
      >
        Leeren
      </button>
      <RouterLink to="/media" class="btn btn-ghost btn-sm">Videos verwalten</RouterLink>
    </div>
  </section>
</template>
