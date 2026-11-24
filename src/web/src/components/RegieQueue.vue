<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { MediaFile, QueueEntryKind, QueueSnapshot, QueueViewEntry } from '@/src/api/types';
import AppSkeleton from '@/src/components/ui/AppSkeleton.vue';
import { confirmAction } from '@/src/composables/useConfirm';
import { useStore } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';

const { store, applyQueue } = useStore();
const { pushToast } = useToast();

const media = ref<MediaFile[]>([]);
const selectedMedia = ref('');
const selectedStreamer = ref('');
const selectedScreen = ref<'pause' | 'startup'>('pause');
const busy = ref(false);
const editingDurationId = ref<string | null>(null);
const editingDurationValue = ref('');
const draggingId = ref<string | null>(null);
const dragOverIndex = ref<number | null>(null);
const listEl = ref<HTMLElement | null>(null);

const queue = computed(() => store.queue);
const entries = computed(() => queue.value?.entries ?? []);
const activeIndex = computed(() => queue.value?.index ?? null);
const loopEnabled = computed(() => Boolean(queue.value?.loop));
const enabledStreamers = computed(() => store.streamers.filter((streamer) => streamer.enabled));
const activeMedia = computed(() => store.status?.media ?? null);
const seekValue = ref(0);
const seeking = ref(false);

const mediaDurations = computed(() => {
  const map = new Map<string, number>();
  for (const file of media.value) {
    if (file.duration && file.duration > 0) map.set(`file:${file.filename}`, file.duration);
  }
  return map;
});

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

function entryDuration(entry: QueueViewEntry): { seconds: number | null; overridden: boolean } {
  if (entry.duration_seconds != null && entry.duration_seconds > 0) {
    return { seconds: entry.duration_seconds, overridden: true };
  }
  const probed = mediaDurations.value.get(entry.channel) ?? null;
  return { seconds: probed, overridden: false };
}

function startDurationEdit(entry: QueueViewEntry): void {
  editingDurationId.value = entry.id;
  const info = entryDuration(entry);
  editingDurationValue.value = info.seconds ? String(Math.round(info.seconds)) : '';
}

function cancelDurationEdit(): void {
  editingDurationId.value = null;
  editingDurationValue.value = '';
}

async function saveDurationEdit(id: string): Promise<void> {
  const raw = editingDurationValue.value.trim();
  const value = raw === '' ? null : Math.max(1, Math.round(Number(raw)));
  if (raw !== '' && !Number.isFinite(Number(raw))) {
    pushToast('Bitte eine gültige Dauer in Sekunden eingeben.', 'error');
    return;
  }
  editingDurationId.value = null;
  await run(() => api.queue.updateEntry(id, value));
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

function duplicate(id: string): void {
  void run(() => api.queue.duplicate(id));
}

function toggleLoop(): void {
  void run(() => api.queue.setLoop(!loopEnabled.value));
}

function move(id: string, direction: number): void {
  const index = entries.value.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  void run(() => api.queue.move(id, index + direction));
}

function onDragStart(id: string, event: DragEvent): void {
  draggingId.value = id;
  event.dataTransfer?.setData('text/plain', id);
}

function onDragOver(index: number): void {
  dragOverIndex.value = index;
}

function onDrop(targetIndex: number): void {
  const id = draggingId.value;
  draggingId.value = null;
  dragOverIndex.value = null;
  if (!id) return;
  const from = entries.value.findIndex((entry) => entry.id === id);
  if (from < 0 || from === targetIndex) return;
  void run(() => api.queue.move(id, targetIndex));
}

function onDragEnd(): void {
  draggingId.value = null;
  dragOverIndex.value = null;
}

function onPointerDragStart(id: string, event: PointerEvent): void {
  if (event.pointerType === 'mouse' || busy.value) return;
  const target = event.currentTarget as HTMLElement | null;
  target?.setPointerCapture?.(event.pointerId);
  draggingId.value = id;
  const from = entries.value.findIndex((entry) => entry.id === id);
  dragOverIndex.value = from;
}

function onPointerDragMove(event: PointerEvent): void {
  if (!draggingId.value || !listEl.value) return;
  const items = Array.from(listEl.value.querySelectorAll<HTMLElement>('.regie-item'));
  for (let i = 0; i < items.length; i += 1) {
    const rect = items[i]!.getBoundingClientRect();
    if (event.clientY >= rect.top && event.clientY <= rect.bottom) {
      dragOverIndex.value = i;
      break;
    }
  }
}

function onPointerDragEnd(): void {
  if (!draggingId.value) return;
  const id = draggingId.value;
  const targetIndex = dragOverIndex.value;
  draggingId.value = null;
  dragOverIndex.value = null;
  if (targetIndex === null) return;
  const from = entries.value.findIndex((entry) => entry.id === id);
  if (from >= 0 && from !== targetIndex) {
    void run(() => api.queue.move(id, targetIndex));
  }
}

function play(index: number): void {
  void run(() => api.queue.play(index));
}

/* ------------------------------------------------------------ touch swipe (#88) */

const swipe = ref<{ id: string; startX: number; startY: number; dx: number } | null>(null);
/** Horizontal distance in px that counts as a swipe instead of a tap. */
const SWIPE_THRESHOLD = 72;

function onSwipeStart(entry: QueueViewEntry & { id: string }, event: PointerEvent): void {
  if (event.pointerType === 'mouse') return;
  swipe.value = { id: entry.id, startX: event.clientX, startY: event.clientY, dx: 0 };
}

function onSwipeMove(event: PointerEvent): void {
  const state = swipe.value;
  if (!state) return;
  const dx = event.clientX - state.startX;
  const dy = event.clientY - state.startY;
  // Vertical movement means the operator is scrolling the list, not swiping.
  if (Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx)) {
    swipe.value = null;
    return;
  }
  state.dx = dx;
}

function swipeOffset(id: string): string {
  const state = swipe.value;
  if (!state || state.id !== id || Math.abs(state.dx) < 8) return 'none';
  const clamped = Math.max(-120, Math.min(120, state.dx));
  return `translateX(${clamped}px)`;
}

function onSwipeEnd(entry: QueueViewEntry & { id: string }, index: number): void {
  const state = swipe.value;
  swipe.value = null;
  if (!state || state.id !== entry.id) return;
  if (state.dx <= -SWIPE_THRESHOLD) {
    remove(entry.id);
    return;
  }
  if (state.dx >= SWIPE_THRESHOLD) {
    play(index);
  }
}

function next(): void {
  void run(() => api.queue.next());
}

function stop(): void {
  void run(() => api.queue.stop());
}

async function clear(): Promise<void> {
  if (
    !(await confirmAction('Regie-Queue leeren?', {
      title: 'Regie-Queue leeren',
      confirmLabel: 'Leeren',
    }))
  ) {
    return;
  }
  await run(() => api.queue.clear());
}

onMounted(() => void loadMedia());
</script>

<template>
  <section class="card regie-queue" aria-labelledby="regie-title">
    <div class="card-head">
      <div>
        <h2 id="regie-title" class="card-title">Regie-Queue</h2>
        <p class="card-sub">Videos, Streamer und Screens per Drag sortieren.</p>
      </div>
      <div class="card-badges">
        <button
          type="button"
          class="chip"
          :class="{ 'is-active': loopEnabled }"
          :aria-pressed="loopEnabled"
          :disabled="busy"
          title="Queue am Ende wieder von vorn starten"
          @click="toggleLoop"
        >
          Loop {{ loopEnabled ? 'An' : 'Aus' }}
        </button>
        <span v-if="queue?.playing" class="badge tone-success">Läuft</span>
        <span v-else class="badge tone-muted">Gestoppt</span>
        <span v-if="entries.length > 0" class="badge tone-neutral mono">
          {{ activeIndex != null ? activeIndex + 1 : '–' }}/{{ entries.length }}
        </span>
      </div>
    </div>

    <details class="regie-add-details">
      <summary>Eintrag hinzufügen</summary>
      <div class="regie-add">
      <div class="regie-add-row">
        <select v-model="selectedMedia" aria-label="Video auswählen">
          <option value="" disabled>Video wählen …</option>
          <option v-for="file in media" :key="file.filename" :value="file.filename">
            {{ file.filename }}{{ file.duration ? ` (${formatClock(file.duration)})` : '' }}
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
    </details>

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

    <div v-if="!queue" class="regie-skeleton">
      <AppSkeleton :lines="3" height="40px" radius="8px" width="100%" />
      <span class="sr-only">Regie-Queue wird geladen</span>
    </div>
    <ol v-else-if="entries.length > 0" ref="listEl" class="regie-list">
      <li
        v-for="(entry, index) in entries"
        :key="entry.id"
        class="regie-item"
        :class="{
          'is-active': activeIndex === index,
          'is-drag-over': dragOverIndex === index && draggingId !== entry.id,
          'is-swiping': swipe?.id === entry.id && Math.abs(swipe.dx) > 8,
        }"
        :style="{ transform: swipeOffset(entry.id) }"
        @pointerdown="onSwipeStart(entry, $event)"
        @pointermove="onSwipeMove"
        @pointerup="onSwipeEnd(entry, index)"
        @pointercancel="swipe = null"
        draggable="true"
        @dragstart="onDragStart(entry.id, $event)"
        @dragover.prevent="onDragOver(index)"
        @drop.prevent="onDrop(index)"
        @dragend="onDragEnd"
      >
        <span
          class="drag-handle mono"
          title="Ziehen zum Verschieben"
          @pointerdown="onPointerDragStart(entry.id, $event)"
          @pointermove="onPointerDragMove"
          @pointerup="onPointerDragEnd"
          @pointercancel="onPointerDragEnd"
        >
          ⋮⋮
        </span>
        <span class="regie-index mono">{{ index + 1 }}</span>
        <span class="regie-kind" :class="`is-${entry.kind}`">{{ kindLabel(entry.kind) }}</span>
        <span class="regie-label" :title="entry.channel">
          {{ entry.label }}
          <template v-if="editingDurationId === entry.id">
            <span class="regie-duration-edit">
              <input
                v-model="editingDurationValue"
                type="number"
                min="1"
                max="86400"
                class="regie-duration-input"
                placeholder="Sek."
                aria-label="Dauer in Sekunden"
                @keydown.enter.prevent="saveDurationEdit(entry.id)"
                @keydown.escape.prevent="cancelDurationEdit"
              />
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                @click="saveDurationEdit(entry.id)"
              >
                OK
              </button>
              <button type="button" class="btn btn-ghost btn-xs" @click="cancelDurationEdit">
                ✕
              </button>
            </span>
          </template>
          <button
            v-else-if="entry.kind === 'file' || entryDuration(entry).seconds !== null"
            type="button"
            class="regie-duration-pill mono"
            :class="{ 'is-overridden': entryDuration(entry).overridden }"
            title="Dauer anpassen (leer = automatisch)"
            @click="startDurationEdit(entry)"
          >
            {{
              entryDuration(entry).seconds !== null
                ? formatClock(entryDuration(entry).seconds!)
                : 'Dauer'
            }}
          </button>
        </span>
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
            aria-label="Eintrag duplizieren"
            title="Duplizieren"
            @click="duplicate(entry.id)"
          >
            ⧉
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
      <p>Noch keine Einträge.</p>
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
