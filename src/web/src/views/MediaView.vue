<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { MediaFile, MediaStorageSummary } from '@/src/api/types';
import { confirmAction } from '@/src/composables/useConfirm';
import { useToast } from '@/src/composables/useToast';
import { formatBytes, formatDateTime, formatUptime } from '@/src/utils/format';

const { pushToast } = useToast();

const files = ref<MediaFile[]>([]);
const storage = ref<MediaStorageSummary | null>(null);
const loading = ref(false);
const uploading = ref(false);
const progress = ref(0);
const dragging = ref(false);
const deleting = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const failedThumbs = reactive<Record<string, boolean>>({});

const hasFiles = computed(() => files.value.length > 0);
const totalBytes = computed(
  () => storage.value?.total_bytes ?? files.value.reduce((sum, file) => sum + file.size, 0),
);

const ACCEPT = '.mp4,.webm,.mov,.mkv,.m4v,video/mp4,video/webm,video/quicktime,video/x-matroska,video/x-m4v';

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '–';
  return formatUptime(seconds);
}

function formatResolution(file: MediaFile): string {
  if (file.width && file.height) return `${file.width}×${file.height}`;
  if (file.height) return `${file.height}p`;
  return '–';
}

function codecLabel(file: MediaFile): string {
  if (file.is_h264 === true) return 'H.264';
  if (file.codec) return file.codec.toUpperCase();
  if (file.is_h264 === false) return 'Nicht H.264';
  return '–';
}

function thumbSrc(file: MediaFile): string {
  const base = file.thumbnail_url ?? api.media.thumbnailUrl(file.filename);
  return `${base}?v=${encodeURIComponent(file.modified_at)}`;
}

function markThumbFailed(filename: string): void {
  failedThumbs[filename] = true;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const response = await api.media.list();
    files.value = response.files;
    storage.value = response.storage ?? null;
    for (const key of Object.keys(failedThumbs)) delete failedThumbs[key];
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    loading.value = false;
  }
}

function openPicker(): void {
  fileInput.value?.click();
}

function onFileSelect(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) void upload(file);
}

function onDrop(event: DragEvent): void {
  dragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) void upload(file);
}

async function upload(file: File): Promise<void> {
  if (uploading.value) return;
  uploading.value = true;
  progress.value = 0;
  try {
    const result = await api.media.upload(file, (percent) => {
      progress.value = percent;
    });
    const meta = result.file;
    const detail = meta.is_h264
      ? `${meta.height ? `${meta.height}p, ` : ''}H.264`
      : 'Codec wird beim Abspielen neu kodiert';
    pushToast(`„${meta.filename}“ hochgeladen (${formatBytes(meta.size)}) · ${detail}`, 'success');
    await load();
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    uploading.value = false;
    progress.value = 0;
  }
}

async function remove(file: MediaFile): Promise<void> {
  if (
    !(await confirmAction(
      `Video „${file.filename}“ löschen?\n\nWird auch von Playlists verwendet.`,
      { title: 'Video löschen', confirmLabel: 'Löschen' },
    ))
  ) {
    return;
  }
  deleting.value = file.filename;
  try {
    await api.media.remove(file.filename);
    pushToast(`„${file.filename}“ gelöscht.`, 'success');
    await load();
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    deleting.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Medien</h1>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-ghost" :disabled="loading" @click="load">
          Aktualisieren
        </button>
      </div>
    </div>

    <section class="card" aria-labelledby="media-upload-title">
      <div class="card-head">
        <div>
          <h2 id="media-upload-title" class="card-title">Video hochladen</h2>
          <p class="card-sub">Max. 2 GB · .mp4 .webm .mov .mkv .m4v</p>
        </div>
        <span v-if="uploading" class="badge tone-info">Lädt hoch…</span>
      </div>

      <div
        class="media-dropzone"
        :class="{ 'is-dragging': dragging, 'is-busy': uploading }"
        role="button"
        tabindex="0"
        :aria-disabled="uploading"
        @click="openPicker"
        @keydown.enter.prevent="openPicker"
        @keydown.space.prevent="openPicker"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <input
          ref="fileInput"
          class="sr-only"
          type="file"
          :accept="ACCEPT"
          :disabled="uploading"
          @change="onFileSelect"
        />
        <p v-if="!uploading">
          Video hierher ziehen oder <span class="link">klicken zum Auswählen</span>.
        </p>
        <p v-else>„{{ progress }} %“ hochgeladen…</p>
        <div v-if="uploading" class="progress-track" aria-hidden="true">
          <div class="progress-fill" :style="{ width: `${progress}%` }"></div>
        </div>
      </div>
    </section>

    <section class="card" aria-labelledby="media-list-title">
      <div class="card-head">
        <div>
          <h2 id="media-list-title" class="card-title">Vorhandene Videos</h2>
          <p class="card-sub">
            {{ files.length }} Dateien · {{ formatBytes(totalBytes) }} in <code>data/media/</code>
            <template v-if="storage?.filesystem">
              · {{ formatBytes(storage.filesystem.available_bytes) }} frei
            </template>
          </p>
        </div>
        <span v-if="loading" class="badge tone-neutral">Lädt…</span>
      </div>

      <div v-if="!hasFiles && !loading" class="empty">
        <p>Noch keine Videos hochgeladen.</p>
      </div>

      <div v-else class="table-wrap">
        <table class="data-table" role="table">
          <caption class="sr-only">Lokale Playlist-Videos</caption>
          <thead>
            <tr role="row">
              <th scope="col" role="columnheader">Datei</th>
              <th scope="col" role="columnheader">Dauer</th>
              <th scope="col" role="columnheader">Auflösung</th>
              <th scope="col" role="columnheader">Codec</th>
              <th scope="col" role="columnheader">Größe</th>
              <th scope="col" role="columnheader">Geändert</th>
              <th scope="col" role="columnheader">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="file in files" :key="file.filename" role="row">
              <td data-label="Datei" role="cell">
                <div class="media-file-cell">
                  <div class="media-thumb-box" aria-hidden="true">
                    <img
                      v-if="!failedThumbs[file.filename]"
                      :src="thumbSrc(file)"
                      alt=""
                      class="media-thumb"
                      loading="lazy"
                      decoding="async"
                      width="80"
                      height="45"
                      @error="markThumbFailed(file.filename)"
                    />
                    <span v-else class="media-thumb-fallback mono">MP4</span>
                  </div>
                  <span class="mono">{{ file.filename }}</span>
                </div>
              </td>
              <td data-label="Dauer" role="cell" class="mono">{{ formatDuration(file.duration) }}</td>
              <td data-label="Auflösung" role="cell" class="mono">{{ formatResolution(file) }}</td>
              <td data-label="Codec" role="cell">
                <span
                  v-if="file.is_h264 === true"
                  class="badge tone-success badge-xs"
                >
                  H.264
                </span>
                <span
                  v-else-if="file.is_h264 === false"
                  class="badge tone-warning badge-xs"
                  title="Wird beim Abspielen neu kodiert"
                >
                  {{ codecLabel(file) }}
                </span>
                <span v-else class="muted">–</span>
              </td>
              <td data-label="Größe" role="cell" class="mono">{{ formatBytes(file.size) }}</td>
              <td data-label="Geändert" role="cell">{{ formatDateTime(file.modified_at) }}</td>
              <td data-label="Aktionen" role="cell">
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  :disabled="deleting !== null || uploading"
                  @click="remove(file)"
                >
                  <span v-if="deleting === file.filename" class="spinner" aria-hidden="true"></span>
                  Löschen
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
