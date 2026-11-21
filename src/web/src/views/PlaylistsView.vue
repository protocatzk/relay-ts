<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { MediaFile, Playlist, PlaylistInput } from '@/src/api/types';
import ModalDialog from '@/src/components/ModalDialog.vue';
import ToggleField from '@/src/components/ToggleField.vue';
import { useStore } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';
import { useUnsavedChanges } from '@/src/composables/useUnsavedChanges';
import { formatNumber } from '@/src/utils/format';

const { store, refreshPlaylists, refreshStatus } = useStore();
const { pushToast } = useToast();

const busy = ref<string | null>(null);
const editorOpen = ref(false);
const editingPlaylist = ref<Playlist | null>(null);
const saving = ref(false);
const deleteTarget = ref<Playlist | null>(null);
const deleting = ref(false);
const form = reactive({
  id: '',
  name: '',
  channels: [] as string[],
  auto_advance: true,
  wrap: false,
  advance_delay_seconds: 5,
  end_after_minutes: null as number | null,
  end_time: '',
  youtube_key: '',
});

const newChannelInput = ref('');
const selectedStreamer = ref('');
const dragIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);

const activePlaylist = computed(() => store.status?.active_playlist ?? null);
const mediaFiles = ref<MediaFile[]>([]);
const selectedMedia = ref('');
const mediaLoading = ref(false);
let mediaTimer: number | null = null;

function isMediaChannel(channel: string): boolean {
  return channel.startsWith('file:');
}

function channelLabel(channel: string): string {
  return isMediaChannel(channel) ? channel.slice('file:'.length) : channel;
}

function isDuplicateChannel(channel: string, index: number): boolean {
  const normalized = channel.trim().toLowerCase();
  return form.channels.findIndex((entry) => entry.trim().toLowerCase() === normalized) !== index;
}

function addChannelInput(): void {
  const parts = newChannelInput.value
    .split(/[\n,]+/)
    .map((item) => item.trim().replace(/^@+/, ''))
    .filter(Boolean);
  if (parts.length === 0) return;
  for (const part of parts) {
    form.channels.push(part);
  }
  newChannelInput.value = '';
}

function addStreamerEntry(): void {
  if (!selectedStreamer.value) return;
  form.channels.push(selectedStreamer.value);
  selectedStreamer.value = '';
}

function addMediaEntry(): void {
  if (!selectedMedia.value) return;
  form.channels.push(`file:${selectedMedia.value}`);
  selectedMedia.value = '';
}

function moveChannel(index: number, delta: number): void {
  const target = index + delta;
  if (target < 0 || target >= form.channels.length) return;
  const [item] = form.channels.splice(index, 1);
  if (item !== undefined) form.channels.splice(target, 0, item);
}

function removeChannel(index: number): void {
  form.channels.splice(index, 1);
}

function onChannelDragStart(index: number, event: DragEvent): void {
  dragIndex.value = index;
  event.dataTransfer?.setData('text/plain', String(index));
}

function onChannelDragOver(index: number): void {
  dragOverIndex.value = index;
}

function onChannelDrop(targetIndex: number): void {
  const from = dragIndex.value;
  dragIndex.value = null;
  dragOverIndex.value = null;
  if (from === null || from === targetIndex || from < 0 || from >= form.channels.length) return;
  const [item] = form.channels.splice(from, 1);
  if (item !== undefined) form.channels.splice(targetIndex, 0, item);
}

function onChannelDragEnd(): void {
  dragIndex.value = null;
  dragOverIndex.value = null;
}

async function loadMediaFiles(notify = false): Promise<void> {
  mediaLoading.value = true;
  try {
    const response = await api.media.list();
    mediaFiles.value = response.files;
    if (
      selectedMedia.value &&
      !response.files.some((file) => file.filename === selectedMedia.value)
    ) {
      selectedMedia.value = '';
    }
  } catch (error) {
    if (notify) pushToast(errorMessage(error), 'error');
  } finally {
    mediaLoading.value = false;
  }
}

function isActive(playlist: Playlist): boolean {
  return activePlaylist.value?.id === playlist.id;
}

function isCurrentChannel(playlist: Playlist, index: number): boolean {
  return isActive(playlist) && activePlaylist.value?.index === index;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function resetForm(): void {
  form.id = '';
  form.name = '';
  form.channels = [];
  form.auto_advance = true;
  form.wrap = false;
  form.advance_delay_seconds = 5;
  form.end_after_minutes = null;
  form.end_time = '';
  form.youtube_key = '';
  newChannelInput.value = '';
  selectedStreamer.value = '';
  selectedMedia.value = '';
}

const editorInitialSnapshot = ref('');

function formSnapshot(): string {
  return JSON.stringify({
    id: form.id,
    name: form.name,
    channels: form.channels,
    auto_advance: form.auto_advance,
    wrap: form.wrap,
    advance_delay_seconds: form.advance_delay_seconds,
    end_after_minutes: form.end_after_minutes,
    end_time: form.end_time,
    youtube_key: form.youtube_key,
  });
}

const editorDirty = computed(() => editorOpen.value && formSnapshot() !== editorInitialSnapshot.value);

const { confirmDiscard } = useUnsavedChanges(editorDirty, {
  message: 'Du hast ungespeicherte Änderungen an dieser Playlist. Möchtest du sie verwerfen?',
});

function openCreate(): void {
  editingPlaylist.value = null;
  resetForm();
  editorInitialSnapshot.value = formSnapshot();
  editorOpen.value = true;
  void loadMediaFiles();
}

function openEdit(playlist: Playlist): void {
  editingPlaylist.value = playlist;
  form.id = playlist.id;
  form.name = playlist.name;
  form.channels = [...playlist.channels];
  form.auto_advance = playlist.auto_advance;
  form.wrap = playlist.wrap;
  form.advance_delay_seconds = playlist.advance_delay_seconds;
  form.end_after_minutes = playlist.end_after_minutes ?? null;
  form.end_time = playlist.end_time ?? '';
  form.youtube_key = '';
  newChannelInput.value = '';
  selectedStreamer.value = '';
  selectedMedia.value = '';
  editorInitialSnapshot.value = formSnapshot();
  editorOpen.value = true;
  void loadMediaFiles();
}

async function closeEditor(): Promise<void> {
  if (saving.value) return;
  if (!(await confirmDiscard())) return;
  editorOpen.value = false;
}

async function savePlaylist(): Promise<void> {
  if (newChannelInput.value.trim()) addChannelInput();
  const channels = form.channels
    .map((channel) => channel.trim().replace(/^@+/, ''))
    .filter(Boolean);
  if (!form.name.trim() || channels.length === 0) {
    pushToast('Name und mindestens ein Kanal sind erforderlich.', 'error');
    return;
  }
  const id = form.id.trim() || slugify(form.name);
  const endTime = form.end_time.trim();
  const payload: PlaylistInput = {
    name: form.name.trim(),
    channels,
    auto_advance: form.auto_advance,
    wrap: form.wrap,
    advance_delay_seconds: Math.max(0, Number(form.advance_delay_seconds) || 0),
    end_after_minutes: endTime
      ? null
      : form.end_after_minutes
        ? Number(form.end_after_minutes)
        : null,
    end_time: endTime || null,
    ...(form.youtube_key.trim() ? { youtube_key: form.youtube_key.trim() } : {}),
  };
  saving.value = true;
  try {
    if (editingPlaylist.value) {
      await api.playlists.update(editingPlaylist.value.id, payload);
      pushToast(`Playlist „${payload.name}“ gespeichert.`, 'success');
    } else {
      await api.playlists.create({ ...payload, id });
      pushToast(`Playlist „${payload.name}“ angelegt.`, 'success');
    }
    await refreshPlaylists();
    editorOpen.value = false;
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    saving.value = false;
  }
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value;
  if (!target) return;
  deleting.value = true;
  try {
    await api.playlists.remove(target.id);
    await Promise.allSettled([refreshPlaylists(), refreshStatus()]);
    pushToast(`Playlist „${target.name}“ gelöscht.`, 'success');
    deleteTarget.value = null;
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    deleting.value = false;
  }
}

async function run(
  key: string,
  action: () => Promise<unknown>,
  successMessage: string,
): Promise<void> {
  busy.value = key;
  try {
    await action();
    await Promise.allSettled([refreshPlaylists(), refreshStatus()]);
    pushToast(successMessage, 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    busy.value = null;
  }
}

async function play(playlist: Playlist): Promise<void> {
  await run(`play:${playlist.id}`, () => api.playlists.play(playlist.id), `Playlist „${playlist.name}“ wird abgespielt.`);
}

async function next(): Promise<void> {
  await run('next', () => api.playlists.next(), 'Nächster Kanal wird angesteuert.');
}

async function previous(): Promise<void> {
  await run('previous', () => api.playlists.previous(), 'Vorheriger Kanal wird angesteuert.');
}

async function tune(playlist: Playlist, channel: string): Promise<void> {
  await run(
    `tune:${playlist.id}:${channel}`,
    () => api.playlists.tune(playlist.id, channel),
    `Kanal „${channel}“ wird angesteuert.`,
  );
}

async function stop(): Promise<void> {
  await run('stop', () => api.playlists.stop(), 'Playlist gestoppt.');
}

function refreshMediaList(): void {
  void loadMediaFiles(true);
}

function onVisibilityChange(): void {
  if (document.hidden) {
    if (mediaTimer !== null) {
      window.clearInterval(mediaTimer);
      mediaTimer = null;
    }
  } else {
    void loadMediaFiles();
    if (mediaTimer === null) {
      mediaTimer = window.setInterval(() => void loadMediaFiles(), 5000);
    }
  }
}

onMounted(() => {
  refreshPlaylists().catch((error) => pushToast(errorMessage(error), 'error'));
  refreshStatus().catch(() => undefined);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('focus', refreshMediaList);
  if (!document.hidden) {
    void loadMediaFiles();
    // data/media can be filled from outside the dashboard (scp, mounts, scripts).
    mediaTimer = window.setInterval(() => void loadMediaFiles(), 5000);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange);
  if (mediaTimer !== null) window.clearInterval(mediaTimer);
  window.removeEventListener('focus', refreshMediaList);
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Playlists</h1>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-primary" :disabled="busy !== null" @click="openCreate">
          Neue Playlist
        </button>
        <button type="button" class="btn btn-ghost" :disabled="busy !== null || !activePlaylist" @click="previous">
          <span v-if="busy === 'previous'" class="spinner" aria-hidden="true"></span>
          <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
            <path d="M19 5l-9 7 9 7V5ZM5 5v14" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round" />
          </svg>
          Vorheriger
        </button>
        <button type="button" class="btn btn-ghost" :disabled="busy !== null || !activePlaylist" @click="next">
          <span v-if="busy === 'next'" class="spinner" aria-hidden="true"></span>
          <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
            <path d="M5 5l9 7-9 7V5ZM19 5v14" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round" />
          </svg>
          Nächster
        </button>
        <button type="button" class="btn btn-secondary" :disabled="busy !== null" @click="stop">
          <span v-if="busy === 'stop'" class="spinner" aria-hidden="true"></span>
          <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
          </svg>
          Stop
        </button>
      </div>
    </div>

    <div v-if="store.loading.playlists && store.playlists.length === 0" class="card empty">
      <span class="spinner spinner-lg" aria-hidden="true"></span>
      <p>Playlists werden geladen…</p>
    </div>

    <div v-else-if="store.playlists.length === 0" class="card empty">
      <svg viewBox="0 0 24 24" width="34" height="34" fill="none" aria-hidden="true">
        <path d="M4 6h16M4 12h10M4 18h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        <path d="m16 14 5 3-5 3v-6Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
      </svg>
      <p>Noch keine Playlists konfiguriert.</p>
    </div>

    <div v-else class="playlist-grid">
      <article v-for="playlist in store.playlists" :key="playlist.id" class="card playlist-card" :class="{ 'is-active': isActive(playlist) }">
        <div class="card-head">
          <div>
            <h2 class="card-title">{{ playlist.name }}</h2>
            <p class="card-sub mono">{{ playlist.id }}</p>
          </div>
          <div class="card-badges">
            <span v-if="isActive(playlist)" class="badge tone-success">
              <span class="dot dot-pulse" aria-hidden="true"></span>
              Aktiv
            </span>
            <span v-if="playlist.youtube_key_set" class="badge tone-success">Key gesetzt</span>
            <span v-else class="badge tone-danger">Key fehlt</span>
          </div>
        </div>

        <div class="playlist-meta">
          <span class="badge tone-neutral">
            Auto-Advance: {{ playlist.auto_advance ? 'An' : 'Aus' }}
          </span>
          <span class="badge tone-neutral">Wrap: {{ playlist.wrap ? 'An' : 'Aus' }}</span>
          <span class="badge tone-neutral">
            Pause {{ formatNumber(playlist.advance_delay_seconds) }} s
          </span>
          <span v-if="playlist.end_time" class="badge tone-neutral">
            Täglich bis {{ playlist.end_time }}
          </span>
          <span v-else-if="playlist.end_after_minutes" class="badge tone-neutral">
            Ende nach {{ formatNumber(playlist.end_after_minutes) }} Min.
          </span>
        </div>

        <div class="playlist-channels">
          <p class="field-label">Kanäle ({{ playlist.channels.length }})</p>
          <ol v-if="playlist.channels.length > 0" class="channel-list">
            <li v-for="(channel, index) in playlist.channels" :key="`${playlist.id}-${index}`" class="channel-item" :class="{ 'is-current': isCurrentChannel(playlist, index) }">
              <span class="channel-index mono">{{ index + 1 }}</span>
              <span class="channel-name">
                <span v-if="isMediaChannel(channel)" class="badge tone-info badge-xs">VIDEO</span>
                {{ channelLabel(channel) }}
              </span>
              <span v-if="isCurrentChannel(playlist, index)" class="badge tone-success">Live</span>
              <button
                v-else-if="isActive(playlist)"
                type="button"
                class="btn btn-ghost btn-sm"
                :disabled="busy !== null"
                @click="tune(playlist, channel)"
              >
                <span v-if="busy === `tune:${playlist.id}:${channel}`" class="spinner" aria-hidden="true"></span>
                Ansteuern
              </button>
            </li>
          </ol>
          <p v-else class="muted small">Keine Kanäle eingetragen.</p>
        </div>

        <div class="playlist-actions">
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="busy !== null"
            @click="play(playlist)"
          >
            <span v-if="busy === `play:${playlist.id}`" class="spinner" aria-hidden="true"></span>
            <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
              <path d="m8 5 11 7-11 7V5Z" fill="currentColor" />
            </svg>
            Play
          </button>
          <button type="button" class="btn btn-ghost btn-sm" :disabled="busy !== null" @click="previous">
            Vorheriger
          </button>
          <button type="button" class="btn btn-ghost btn-sm" :disabled="busy !== null" @click="next">
            Nächster
          </button>
          <button type="button" class="btn btn-ghost btn-sm" :disabled="busy !== null" @click="stop">
            Stop
          </button>
          <button type="button" class="btn btn-ghost btn-sm" :disabled="busy !== null" @click="openEdit(playlist)">
            Bearbeiten
          </button>
          <button type="button" class="btn btn-ghost btn-sm" :disabled="busy !== null" @click="deleteTarget = playlist">
            Löschen
          </button>
        </div>
      </article>
    </div>

    <p v-if="activePlaylist" class="muted small">
      Aktive Playlist: <strong>{{ activePlaylist.name }}</strong> · Kanal
      {{ activePlaylist.index + 1 }} von {{ activePlaylist.total }}
    </p>

    <ModalDialog
      :open="editorOpen"
      :title="editingPlaylist ? 'Playlist bearbeiten' : 'Neue Playlist'"
      size="md"
      @close="closeEditor"
    >
      <form id="playlist-form" class="stack" @submit.prevent="savePlaylist">
        <div class="form-grid">
          <div class="field">
            <label for="playlist-id">ID</label>
            <input
              id="playlist-id"
              v-model="form.id"
              type="text"
              :disabled="Boolean(editingPlaylist)"
              placeholder="abend"
              spellcheck="false"
            />
          </div>
          <div class="field">
            <label for="playlist-name">Name</label>
            <input id="playlist-name" v-model="form.name" type="text" placeholder="Abendprogramm" />
          </div>
        </div>
        <div class="field">
          <span class="field-label">Kanäle &amp; Videos ({{ form.channels.length }})</span>
          <ol v-if="form.channels.length > 0" class="playlist-editor-list" aria-label="Playlist-Reihenfolge">
            <li
              v-for="(channel, index) in form.channels"
              :key="`${index}-${channel}`"
              class="playlist-editor-item"
              :class="{ 'is-drag-over': dragOverIndex === index }"
              draggable="true"
              @dragstart="onChannelDragStart(index, $event)"
              @dragover.prevent="onChannelDragOver(index)"
              @drop.prevent="onChannelDrop(index)"
              @dragend="onChannelDragEnd"
            >
              <span class="drag-handle mono" aria-hidden="true">⋮⋮</span>
              <span class="channel-index mono">{{ index + 1 }}</span>
              <span class="channel-name">
                <span v-if="isMediaChannel(channel)" class="badge tone-info badge-xs">VIDEO</span>
                {{ channelLabel(channel) }}
                <span v-if="isDuplicateChannel(channel, index)" class="badge tone-warning badge-xs">
                  Duplikat
                </span>
              </span>
              <div class="playlist-editor-controls">
                <button
                  type="button"
                  class="btn btn-ghost btn-touch"
                  :disabled="index === 0"
                  :aria-label="`${channelLabel(channel)} nach oben`"
                  @click="moveChannel(index, -1)"
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-touch"
                  :disabled="index === form.channels.length - 1"
                  :aria-label="`${channelLabel(channel)} nach unten`"
                  @click="moveChannel(index, 1)"
                >
                  ↓
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-touch"
                  :aria-label="`${channelLabel(channel)} entfernen`"
                  @click="removeChannel(index)"
                >
                  ✕
                </button>
              </div>
            </li>
          </ol>
          <p v-else class="field-hint">Noch keine Einträge. Unten Handle, Streamer oder Video hinzufügen.</p>
        </div>

        <div class="field">
          <label for="playlist-channel-input">TikTok-Handle oder Streamer hinzufügen</label>
          <div class="pause-upload-row">
            <input
              id="playlist-channel-input"
              v-model="newChannelInput"
              type="text"
              placeholder="@handle oder file:video.mp4"
              spellcheck="false"
              @keydown.enter.prevent="addChannelInput"
            />
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="!newChannelInput.trim()"
              @click="addChannelInput"
            >
              Hinzufügen
            </button>
          </div>
          <div v-if="store.streamers.length > 0" class="pause-upload-row">
            <label class="sr-only" for="playlist-streamer-pick">Vorhandenen Streamer wählen</label>
            <select id="playlist-streamer-pick" v-model="selectedStreamer">
              <option value="">Streamer auswählen…</option>
              <option v-for="streamer in store.streamers" :key="streamer.id" :value="streamer.id">
                {{ streamer.name }} (@{{ streamer.tiktok.replace(/^@/, '') }})
              </option>
            </select>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="!selectedStreamer"
              @click="addStreamerEntry"
            >
              + Streamer
            </button>
          </div>
        </div>

        <div class="field">
          <label for="playlist-media">Lokales Video hinzufügen</label>
          <div class="pause-upload-row">
            <select id="playlist-media" v-model="selectedMedia">
              <option value="">Video aus data/media wählen…</option>
              <option v-for="file in mediaFiles" :key="file.filename" :value="file.filename">
                {{ file.filename }}
              </option>
            </select>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="!selectedMedia"
              @click="addMediaEntry"
            >
              + Video
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="mediaLoading"
              @click="refreshMediaList"
            >
              <span v-if="mediaLoading" class="spinner" aria-hidden="true"></span>
              Aktualisieren
            </button>
          </div>
          <p v-if="mediaFiles.length === 0" class="field-hint">
            Keine Videos gefunden. Dateien unter <code>data/media/</code> ablegen.
          </p>
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="playlist-delay">Wechselverzögerung (s)</label>
            <input id="playlist-delay" v-model.number="form.advance_delay_seconds" type="number" min="0" max="600" />
          </div>
          <div class="field">
            <label for="playlist-end">Ende nach (Minuten, optional)</label>
            <input id="playlist-end" v-model.number="form.end_after_minutes" type="number" min="1" max="1440" placeholder="z. B. 120" />
          </div>
          <div class="field">
            <label for="playlist-end-time">Tägliches Ende (Uhrzeit, optional)</label>
            <input id="playlist-end-time" v-model="form.end_time" type="time" />
            <p class="field-hint">Hat Vorrang vor „Ende nach“. Leer = kein tägliches Ende.</p>
          </div>
        </div>
        <ToggleField v-model="form.auto_advance" label="Auto-Advance" description="Bei Offline-Quelle automatisch zum nächsten Kanal." />
        <ToggleField v-model="form.wrap" label="Wrap" description="Am Ende wieder zum ersten Kanal springen." />
        <div class="field">
          <label for="playlist-key">YouTube-Key (optional, leer = bestehenden behalten)</label>
          <input id="playlist-key" v-model="form.youtube_key" type="password" autocomplete="new-password" />
        </div>
      </form>
      <template #footer>
        <button type="button" class="btn btn-ghost" :disabled="saving" @click="closeEditor">Abbrechen</button>
        <button type="submit" form="playlist-form" class="btn btn-primary" :disabled="saving">
          <span v-if="saving" class="spinner" aria-hidden="true"></span>
          Speichern
        </button>
      </template>
    </ModalDialog>

    <ModalDialog
      :open="deleteTarget !== null"
      title="Playlist löschen"
      size="sm"
      @close="deleteTarget = null"
    >
      <p>Soll die Playlist <strong>{{ deleteTarget?.name }}</strong> wirklich gelöscht werden?</p>
      <template #footer>
        <button type="button" class="btn btn-ghost" :disabled="deleting" @click="deleteTarget = null">Abbrechen</button>
        <button type="button" class="btn btn-danger" :disabled="deleting" @click="confirmDelete">
          <span v-if="deleting" class="spinner" aria-hidden="true"></span>
          Löschen
        </button>
      </template>
    </ModalDialog>
  </div>
</template>
