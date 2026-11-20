<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { RecordingFile, RecordingsListResponse } from '@/src/api/types';
import ToggleField from '@/src/components/ToggleField.vue';
import { confirmAction } from '@/src/composables/useConfirm';
import { useStore } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';
import { formatBitrate, formatBytes, formatDateTime, formatFps } from '@/src/utils/format';

const { store, refreshStatus } = useStore();
const { pushToast } = useToast();

const PROVIDER_URLS: Record<'twitch' | 'kick' | 'custom', string> = {
  twitch: 'rtmp://live.twitch.tv/app',
  kick: 'rtmps://fa723fc1b171.global-contribute.live-video.net/app',
  custom: '',
};

const loading = ref(true);
const savingSecondary = ref(false);
const savingRecording = ref(false);
const recordingsLoading = ref(false);
const deletingFile = ref<string | null>(null);

const secondary = reactive({
  enabled: false,
  provider: 'twitch' as 'twitch' | 'kick' | 'custom',
  rtmp_url: PROVIDER_URLS.twitch,
  stream_key: '',
  stream_key_set: false,
  mode: 'reencode' as 'copy' | 'reencode',
});

const recording = reactive({
  enabled: false,
  max_total_mb: 10240,
  min_free_mb: 1024,
  auto_delete: false,
});

const recordings = ref<RecordingsListResponse | null>(null);

const secondaryStatus = computed(() => store.status?.secondary_sink ?? null);
const recordingStatus = computed(() => store.status?.recording ?? null);

function onProviderChange(): void {
  const preset = PROVIDER_URLS[secondary.provider];
  if (preset) secondary.rtmp_url = preset;
}

async function loadSettings(): Promise<void> {
  loading.value = true;
  try {
    const settings = await api.settings.get();
    if (settings.secondary_sink) {
      secondary.enabled = settings.secondary_sink.enabled;
      secondary.provider = settings.secondary_sink.provider;
      secondary.rtmp_url = settings.secondary_sink.rtmp_url;
      secondary.stream_key_set = settings.secondary_sink.stream_key_set;
      secondary.mode = settings.secondary_sink.mode;
      secondary.stream_key = '';
    }
    if (settings.recording) {
      recording.enabled = settings.recording.enabled;
      recording.max_total_mb = settings.recording.max_total_mb;
      recording.min_free_mb = settings.recording.min_free_mb;
      recording.auto_delete = settings.recording.auto_delete;
    }
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    loading.value = false;
  }
}

async function loadRecordings(): Promise<void> {
  recordingsLoading.value = true;
  try {
    recordings.value = await api.recordings.list();
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    recordingsLoading.value = false;
  }
}

async function saveSecondary(): Promise<void> {
  savingSecondary.value = true;
  try {
    const saved = await api.settings.update({
      secondary_sink: {
        enabled: secondary.enabled,
        provider: secondary.provider,
        rtmp_url: secondary.rtmp_url.trim(),
        mode: secondary.mode,
        ...(secondary.stream_key.trim() ? { stream_key: secondary.stream_key.trim() } : {}),
      },
    });
    if (saved.secondary_sink) {
      secondary.stream_key_set = saved.secondary_sink.stream_key_set;
    }
    secondary.stream_key = '';
    await refreshStatus().catch(() => undefined);
    pushToast('Zweitausgabe gespeichert.', 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    savingSecondary.value = false;
  }
}

async function saveRecording(): Promise<void> {
  savingRecording.value = true;
  try {
    await api.settings.update({
      recording: {
        enabled: recording.enabled,
        max_total_mb: Math.max(0, Number(recording.max_total_mb) || 0),
        min_free_mb: Math.max(0, Number(recording.min_free_mb) || 0),
        auto_delete: recording.auto_delete,
      },
    });
    await Promise.allSettled([refreshStatus(), loadRecordings()]);
    pushToast('Aufzeichnungs-Einstellungen gespeichert.', 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    savingRecording.value = false;
  }
}

async function deleteRecording(file: RecordingFile): Promise<void> {
  if (
    !(await confirmAction(`Aufzeichnung „${file.filename}“ wirklich löschen?`, {
      title: 'Aufzeichnung löschen',
      confirmLabel: 'Löschen',
    }))
  ) {
    return;
  }
  deletingFile.value = file.filename;
  try {
    await api.recordings.remove(file.filename);
    pushToast(`„${file.filename}“ gelöscht.`, 'success');
    await loadRecordings();
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    deletingFile.value = null;
  }
}

onMounted(() => {
  void loadSettings();
  void loadRecordings();
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Ausgabe</h1>
      </div>
      <div class="page-actions">
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="loading || recordingsLoading"
          @click="loadSettings(); loadRecordings();"
        >
          Aktualisieren
        </button>
      </div>
    </div>

    <div class="stack">
      <section class="card settings-section" aria-labelledby="output-secondary-title">
        <div class="card-head">
          <div>
            <h2 id="output-secondary-title" class="card-title">Multi-Destination (Twitch / Kick)</h2>
            <p class="card-sub">
              Fehlerisoliertes Zweitziel am MPEG-TS-Relay – Ausfälle beeinflussen YouTube nicht.
            </p>
          </div>
          <div class="settings-section-actions">
            <span
              v-if="secondaryStatus?.running"
              class="badge tone-success"
            >
              Läuft · {{ formatBitrate(secondaryStatus.bitrate_kbps) }} · {{ formatFps(secondaryStatus.fps) }}
            </span>
            <span v-else-if="secondary.enabled" class="badge tone-neutral">Bereit</span>
            <span v-else class="badge tone-muted">Aus</span>
            <span v-if="secondary.stream_key_set" class="badge tone-success">Key gesetzt</span>
          </div>
        </div>

        <div class="settings-body">
          <p v-if="secondaryStatus?.last_error" class="alert alert-warn" role="alert">
            {{ secondaryStatus.last_error }}
          </p>

          <ToggleField
            v-model="secondary.enabled"
            label="Zweitziel aktivieren"
            description="Startet und stoppt automatisch mit dem Haupt-Stream inklusive Pausen und Quellenwechseln."
          />

          <div class="settings-grid">
            <div class="field">
              <label for="secondary-provider">Plattform</label>
              <select id="secondary-provider" v-model="secondary.provider" @change="onProviderChange">
                <option value="twitch">Twitch</option>
                <option value="kick">Kick</option>
                <option value="custom">Benutzerdefiniert (RTMP/RTMPS)</option>
              </select>
            </div>
            <div class="field">
              <label for="secondary-mode">Encoding-Modus</label>
              <select id="secondary-mode" v-model="secondary.mode">
                <option value="reencode">Re-Encode (gleicher Encoder/Bitrate)</option>
                <option value="copy">Copy (minimale CPU-Last)</option>
              </select>
            </div>
            <div class="field field-span-2">
              <label for="secondary-url">RTMP-Ingest-URL</label>
              <input
                id="secondary-url"
                v-model="secondary.rtmp_url"
                type="url"
                spellcheck="false"
                placeholder="rtmp://live.twitch.tv/app"
              />
            </div>
            <div class="field field-span-2">
              <label for="secondary-key">Stream-Key</label>
              <input
                id="secondary-key"
                v-model="secondary.stream_key"
                type="password"
                autocomplete="new-password"
                :placeholder="secondary.stream_key_set ? '•••••••• (gesetzt – leer lassen zum Behalten)' : 'Stream-Key eingeben'"
              />
              <p class="field-hint">Der Key wird nie in Logs oder API-Antworten ausgegeben.</p>
            </div>
          </div>

          <div class="quick-actions">
            <button
              type="button"
              class="btn btn-primary btn-sm"
              :disabled="savingSecondary || loading"
              @click="saveSecondary"
            >
              <span v-if="savingSecondary" class="spinner" aria-hidden="true"></span>
              Zweitausgabe speichern
            </button>
          </div>
        </div>
      </section>

      <section class="card settings-section" aria-labelledby="output-recording-title">
        <div class="card-head">
          <div>
            <h2 id="output-recording-title" class="card-title">Aufzeichnung (MKV, Copy)</h2>
            <p class="card-sub">
              Zeichnet den Relay-Stream ohne Re-Encoding unter <code>data/recordings/</code> auf.
            </p>
          </div>
          <div class="settings-section-actions">
            <span v-if="recordingStatus?.active" class="badge tone-danger">
              <span class="dot dot-pulse" aria-hidden="true"></span>
              REC · {{ formatBytes(recordingStatus.bytes) }}
            </span>
            <span v-else-if="recording.enabled" class="badge tone-neutral">Bereit</span>
            <span v-else class="badge tone-muted">Aus</span>
          </div>
        </div>

        <div class="settings-body">
          <p
            v-if="recordingStatus?.disk_warning || recordings?.storage.disk_warning"
            class="alert alert-warn"
            role="alert"
          >
            {{ recordingStatus?.disk_warning || recordings?.storage.disk_warning }}
          </p>
          <p v-if="recordingStatus?.last_error" class="alert alert-error" role="alert">
            {{ recordingStatus.last_error }}
          </p>

          <ToggleField
            v-model="recording.enabled"
            label="Automatisch mit der Session aufzeichnen"
          />
          <ToggleField
            v-model="recording.auto_delete"
            label="Älteste Aufzeichnungen bei Limit automatisch löschen"
          />

          <div class="settings-grid">
            <div class="field">
              <label for="rec-max-mb">Max. Speicher für Aufzeichnungen (MB, 0 = unbegrenzt)</label>
              <input id="rec-max-mb" v-model.number="recording.max_total_mb" type="number" min="0" max="1000000" />
            </div>
            <div class="field">
              <label for="rec-min-free">Mindest-Freispeicher auf der Platte (MB)</label>
              <input id="rec-min-free" v-model.number="recording.min_free_mb" type="number" min="0" max="500000" />
            </div>
          </div>

          <div class="quick-actions">
            <button
              type="button"
              class="btn btn-primary btn-sm"
              :disabled="savingRecording || loading"
              @click="saveRecording"
            >
              <span v-if="savingRecording" class="spinner" aria-hidden="true"></span>
              Aufzeichnung speichern
            </button>
          </div>
        </div>
      </section>

      <section class="card settings-section" aria-labelledby="output-recordings-list-title">
        <div class="card-head">
          <div>
            <h2 id="output-recordings-list-title" class="card-title">Gespeicherte Aufzeichnungen</h2>
            <p v-if="recordings" class="card-sub">
              {{ recordings.storage.file_count }} Dateien ·
              {{ formatBytes(recordings.storage.total_bytes) }}
              <template v-if="recordings.storage.filesystem">
                · {{ formatBytes(recordings.storage.filesystem.available_bytes) }} frei
              </template>
            </p>
          </div>
          <span v-if="recordingsLoading" class="badge tone-neutral">Lädt…</span>
        </div>

        <div v-if="!recordings || recordings.files.length === 0" class="empty compact">
          <p>Noch keine Aufzeichnungen vorhanden.</p>
        </div>

        <div v-else class="table-wrap">
          <table class="data-table" role="table">
            <caption class="sr-only">Gespeicherte MKV-Aufzeichnungen</caption>
            <thead>
              <tr role="row">
                <th scope="col" role="columnheader">Datei</th>
                <th scope="col" role="columnheader">Größe</th>
                <th scope="col" role="columnheader">Geändert</th>
                <th scope="col" role="columnheader">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="file in recordings.files" :key="file.filename" role="row">
                <td data-label="Datei" role="cell">
                  <span class="mono">{{ file.filename }}</span>
                  <span v-if="file.active" class="badge tone-danger badge-xs">REC</span>
                </td>
                <td data-label="Größe" role="cell" class="mono">{{ formatBytes(file.size) }}</td>
                <td data-label="Geändert" role="cell">{{ formatDateTime(file.modified_at) }}</td>
                <td data-label="Aktionen" role="cell">
                  <div class="row-actions">
                    <a
                      :href="api.recordings.downloadUrl(file.filename)"
                      class="btn btn-ghost btn-xs"
                      download
                    >
                      Download
                    </a>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      :disabled="file.active || deletingFile !== null"
                      @click="deleteRecording(file)"
                    >
                      <span v-if="deletingFile === file.filename" class="spinner" aria-hidden="true"></span>
                      Löschen
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>
