<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type {
  AuthSessionInfo,
  PauseAsset,
  PausePreviewInput,
  Settings,
  VideoEncoderSetting,
  VideoPreset,
} from '@/src/api/types';
import { formatDateTime } from '@/src/utils/format';
import {
  EDITABLE_SETTINGS_SECTIONS,
  SETTINGS_SECTIONS,
  applySavedSection,
  buildAllSectionsPayload,
  buildSectionPayload,
  isSectionDirty,
  type EditableSettingsSectionId,
  type SettingsSecretsDraft,
} from '@/src/utils/settings-sections';
import ToggleField from '@/src/components/ToggleField.vue';
import { useToast } from '@/src/composables/useToast';
import { useUnsavedChanges } from '@/src/composables/useUnsavedChanges';

const { pushToast } = useToast();

const RESOLUTIONS = [
  '720x1280',
  '1280x720',
  '1080x1920',
  '1920x1080',
  '1600x900',
];

const PRESETS: { value: VideoPreset; label: string }[] = [
  { value: 'ultrafast', label: 'Ultrafast' },
  { value: 'veryfast', label: 'Very Fast' },
  { value: 'faster', label: 'Faster' },
  { value: 'fast', label: 'Fast' },
  { value: 'medium', label: 'Medium' },
];

const ENCODERS: { value: VideoEncoderSetting; label: string }[] = [
  { value: 'auto', label: 'Auto (empfohlen)' },
  { value: 'libx264', label: 'libx264 (CPU)' },
  { value: 'h264_qsv', label: 'Intel Quick Sync (iGPU)' },
  { value: 'h264_nvenc', label: 'NVIDIA NVENC' },
  { value: 'h264_amf', label: 'AMD AMF' },
];

function jumpToSettings(id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  target.focus({ preventScroll: true });
}

const form = ref<Settings | null>(null);
const baseline = ref<Settings | null>(null);
const loading = ref(true);
const saving = ref(false);
const savingSection = ref<EditableSettingsSectionId | null>(null);
const loadError = ref('');
const apiKey = ref('');
const chatApiKey = ref('');
const earningsApiKey = ref('');
const checkingOnline = ref(false);
const pauseUploading = ref<'background' | 'font' | null>(null);
const pauseAsset = ref<PauseAsset | null>(null);
const pausePreviewUrl = ref('');
const pausePreviewKind = ref<'image' | 'video' | null>(null);
const startupAsset = ref<PauseAsset | null>(null);
const startupPreviewUrl = ref('');
const startupPreviewKind = ref<'image' | 'video' | null>(null);
const pauseComposedUrl = ref('');
const startupComposedUrl = ref('');
const composedPreviewError = ref('');
const sessions = ref<AuthSessionInfo[]>([]);
const sessionsError = ref('');
const sessionsLoading = ref(false);
let composedTimer: number | null = null;
let composedAbort: AbortController | null = null;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const secretsDraft = computed<SettingsSecretsDraft>(() => ({
  onlineApiKey: apiKey.value,
  chatApiKey: chatApiKey.value,
  earningsApiKey: earningsApiKey.value,
}));

function sectionDirty(section: EditableSettingsSectionId): boolean {
  if (!form.value || !baseline.value) return false;
  return isSectionDirty(section, form.value, baseline.value, secretsDraft.value);
}

const restartRequired = computed(() => sectionDirty('delay') || sectionDirty('video'));

const dirty = computed(() => EDITABLE_SETTINGS_SECTIONS.some((section) => sectionDirty(section)));

const busySaving = computed(() => saving.value || savingSection.value !== null);

useUnsavedChanges(dirty, {
  message: 'Du hast ungespeicherte Einstellungen. Möchtest du sie verwerfen und die Seite verlassen?',
});

function sectionLabel(section: EditableSettingsSectionId): string {
  return SETTINGS_SECTIONS.find((entry) => entry.id === section)?.label ?? section;
}

function pauseFileName(path: string): string | null {
  const normalized = path.split('?')[0] ?? path;
  const filename = normalized.split('/').pop();
  return filename && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(filename) ? filename : null;
}

const pausePreviewSource = computed(() => {
  if (pausePreviewUrl.value) return pausePreviewUrl.value;
  const path = form.value?.pause.background ?? '';
  if (!path.startsWith('/app/data/pause/') && !path.startsWith('data/pause/')) return '';
  const filename = pauseFileName(path);
  return filename ? api.pause.assetUrl(filename) : '';
});

const pausePreviewIsVideo = computed(() => {
  if (pausePreviewUrl.value && pausePreviewKind.value) return pausePreviewKind.value === 'video';
  const path = form.value?.pause.background ?? '';
  return /\.(mp4|webm|mov|mkv|m4v)$/i.test(path.split('?')[0] ?? path);
});

const startupPreviewSource = computed(() => {
  if (startupPreviewUrl.value) return startupPreviewUrl.value;
  const path = form.value?.startup.background ?? '';
  if (!path.startsWith('/app/data/pause/') && !path.startsWith('data/pause/')) return '';
  const filename = pauseFileName(path);
  return filename ? api.pause.assetUrl(filename) : '';
});

const startupPreviewIsVideo = computed(() => {
  if (startupPreviewUrl.value && startupPreviewKind.value) return startupPreviewKind.value === 'video';
  const path = form.value?.startup.background ?? '';
  return /\.(mp4|webm|mov|mkv|m4v)$/i.test(path.split('?')[0] ?? path);
});

function assetMetadata(asset: PauseAsset | null): string {
  if (!asset) return '';
  const parts = [asset.kind.toUpperCase(), `${Math.round(asset.size / 1024)} KB`];
  if (asset.width && asset.height) parts.push(`${asset.width}×${asset.height}`);
  if (asset.duration) parts.push(`${asset.duration.toFixed(1)} s`);
  if (asset.loopable) parts.push('loop');
  return parts.join(' · ');
}

const pauseAssetMetadata = computed(() => assetMetadata(pauseAsset.value));
const startupAssetMetadata = computed(() => assetMetadata(startupAsset.value));

function slateSignature(screen: 'pause' | 'startup'): string {
  const section = form.value?.[screen];
  if (!section) return '';
  return JSON.stringify([
    section.text,
    section.subtext,
    section.color,
    section.background,
    section.font,
    section.text_color,
    section.fit,
  ]);
}

const pauseComposedSignature = computed(() => slateSignature('pause'));
const startupComposedSignature = computed(() => slateSignature('startup'));

function slateDraft(screen: 'pause' | 'startup'): PausePreviewInput {
  const section = form.value![screen];
  return {
    screen,
    text: section.text,
    subtext: section.subtext,
    color: section.color,
    background: section.background.trim(),
    font: section.font.trim(),
    text_color: section.text_color.trim() || 'white',
    fit: section.fit,
  };
}

function setComposedUrl(screen: 'pause' | 'startup', blob: Blob): void {
  const target = screen === 'startup' ? startupComposedUrl : pauseComposedUrl;
  if (target.value) URL.revokeObjectURL(target.value);
  target.value = URL.createObjectURL(blob);
}

async function refreshComposedPreviews(): Promise<void> {
  if (!form.value) return;
  composedAbort?.abort();
  const controller = new AbortController();
  composedAbort = controller;
  try {
    const [pause, startup] = await Promise.all([
      api.pause.preview(slateDraft('pause'), controller.signal),
      api.pause.preview(slateDraft('startup'), controller.signal),
    ]);
    if (controller.signal.aborted) return;
    setComposedUrl('pause', pause);
    setComposedUrl('startup', startup);
    composedPreviewError.value = '';
  } catch (error) {
    if (controller.signal.aborted) return;
    composedPreviewError.value = errorMessage(error);
  }
}

function scheduleComposedPreviews(): void {
  if (composedTimer !== null) window.clearTimeout(composedTimer);
  composedTimer = window.setTimeout(() => {
    composedTimer = null;
    void refreshComposedPreviews();
  }, 350);
}

watch([pauseComposedSignature, startupComposedSignature], scheduleComposedPreviews, {
  immediate: true,
});

async function uploadPauseAsset(
  kind: 'background' | 'font',
  event: Event,
  target: 'pause' | 'startup' = 'pause',
): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !form.value) return;
  pauseUploading.value = kind;
  try {
    const asset = await api.pause.upload(file);
    const section = target === 'startup' ? form.value.startup : form.value.pause;
    if (kind === 'background') {
      section.background = asset.path;
      const urlRef = target === 'startup' ? startupPreviewUrl : pausePreviewUrl;
      const kindRef = target === 'startup' ? startupPreviewKind : pausePreviewKind;
      if (urlRef.value) URL.revokeObjectURL(urlRef.value);
      urlRef.value = URL.createObjectURL(file);
      kindRef.value = asset.kind === 'video' ? 'video' : 'image';
    } else {
      section.font = asset.path;
    }
    if (target === 'startup') startupAsset.value = asset;
    else pauseAsset.value = asset;
    pushToast(asset.warning ?? 'Datei hochgeladen.', asset.warning ? 'info' : 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    pauseUploading.value = null;
  }
}

async function removePauseAsset(
  kind: 'background' | 'font',
  target: 'pause' | 'startup' = 'pause',
): Promise<void> {
  if (!form.value) return;
  const section = target === 'startup' ? form.value.startup : form.value.pause;
  const path = kind === 'background' ? section.background : section.font;
  if (!path) return;
  const filename = pauseFileName(path);
  const localAsset = path.startsWith('/app/data/pause/') || path.startsWith('data/pause/');
  if (!filename || !localAsset) {
    if (kind === 'background') section.background = '';
    else section.font = '';
    return;
  }
  if (!window.confirm('Datei wirklich löschen?')) return;
  try {
    await api.pause.remove(filename);
    if (kind === 'background') {
      section.background = '';
      const urlRef = target === 'startup' ? startupPreviewUrl : pausePreviewUrl;
      const kindRef = target === 'startup' ? startupPreviewKind : pausePreviewKind;
      if (urlRef.value) URL.revokeObjectURL(urlRef.value);
      urlRef.value = '';
      kindRef.value = null;
    } else {
      section.font = '';
    }
    if (target === 'startup') startupAsset.value = null;
    else pauseAsset.value = null;
    pushToast('Datei gelöscht.', 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  }
}

async function loadSessions(): Promise<void> {
  sessionsLoading.value = true;
  try {
    const response = await api.auth.sessions();
    sessions.value = response.sessions;
    sessionsError.value = '';
  } catch (error) {
    sessionsError.value = errorMessage(error);
  } finally {
    sessionsLoading.value = false;
  }
}

async function revokeSession(session: AuthSessionInfo): Promise<void> {
  if (!window.confirm(`Sitzung von ${session.user} abmelden?`)) return;
  try {
    await api.auth.revokeSession(session.id);
    await loadSessions();
    pushToast('Sitzung abgemeldet.', 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  }
}

async function revokeAllSessions(): Promise<void> {
  if (!window.confirm('Alle Sessions abmelden? Du musst dich danach neu anmelden.')) return;
  try {
    await api.auth.revokeAllSessions();
    window.location.assign('/login');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  }
}

async function loadSettings(silent = false): Promise<void> {
  if (!silent) loading.value = true;
  loadError.value = '';
  try {
    const settings = await api.settings.get();
    form.value = clone(settings);
    baseline.value = clone(settings);
    apiKey.value = '';
    chatApiKey.value = '';
    earningsApiKey.value = '';
  } catch (error) {
    loadError.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
}

async function checkOnline(): Promise<void> {
  checkingOnline.value = true;
  try {
    await api.system.checkOnline();
    pushToast('Online-Status aktualisiert.', 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    checkingOnline.value = false;
  }
}

async function saveSection(section: EditableSettingsSectionId): Promise<void> {
  const current = form.value;
  if (!current || !baseline.value || busySaving.value) return;
  const payload = buildSectionPayload(section, current, secretsDraft.value);
  savingSection.value = section;
  try {
    const saved = await api.settings.update(payload);
    if (form.value && baseline.value) {
      applySavedSection(section, form.value, saved);
      applySavedSection(section, baseline.value, saved);
    }
    if (section === 'monitor') apiKey.value = '';
    if (section === 'chat') chatApiKey.value = '';
    if (section === 'earnings') earningsApiKey.value = '';
    pushToast(`Bereich „${sectionLabel(section)}“ gespeichert.`, 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    savingSection.value = null;
  }
}

async function save(): Promise<void> {
  const current = form.value;
  if (!current || busySaving.value) return;
  const payload = buildAllSectionsPayload(current, secretsDraft.value);

  saving.value = true;
  try {
    const saved = await api.settings.update(payload);
    form.value = clone(saved);
    baseline.value = clone(saved);
    apiKey.value = '';
    chatApiKey.value = '';
    earningsApiKey.value = '';
    pushToast('Einstellungen gespeichert.', 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void loadSettings();
  void loadSessions();
});

onBeforeUnmount(() => {
  if (pausePreviewUrl.value) URL.revokeObjectURL(pausePreviewUrl.value);
  if (startupPreviewUrl.value) URL.revokeObjectURL(startupPreviewUrl.value);
  if (pauseComposedUrl.value) URL.revokeObjectURL(pauseComposedUrl.value);
  if (startupComposedUrl.value) URL.revokeObjectURL(startupComposedUrl.value);
  if (composedTimer !== null) window.clearTimeout(composedTimer);
  composedAbort?.abort();
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Einstellungen</h1>
      </div>
      <div class="page-actions">
        <span v-if="dirty" class="badge tone-warning">Ungespeicherte Änderungen</span>
        <RouterLink to="/overlays" class="btn btn-ghost">Overlay-Studio</RouterLink>
        <button type="button" class="btn btn-ghost" :disabled="loading || busySaving" @click="loadSettings()">
          Zurücksetzen
        </button>
        <button type="button" class="btn btn-primary" :disabled="!form || !dirty || busySaving" @click="save">
          <span v-if="saving" class="spinner" aria-hidden="true"></span>
          Alles speichern
        </button>
      </div>
    </div>

    <nav v-if="form" class="settings-jump" aria-label="Einstellungen: Bereiche">
      <button
        v-for="section in SETTINGS_SECTIONS"
        :key="section.domId"
        type="button"
        class="settings-jump-btn"
        :class="{ 'is-dirty': section.editable && sectionDirty(section.id as EditableSettingsSectionId) }"
        @click="jumpToSettings(section.domId)"
      >
        {{ section.label }}
        <span
          v-if="section.editable && sectionDirty(section.id as EditableSettingsSectionId)"
          class="settings-jump-dot"
          aria-hidden="true"
        ></span>
      </button>
    </nav>

    <div v-if="loadError" class="alert alert-error" role="alert">
      <span>{{ loadError }}</span>
      <button type="button" class="btn btn-ghost btn-sm" @click="loadSettings()">Erneut versuchen</button>
    </div>

    <div v-if="loading && !form" class="card empty">
      <span class="spinner spinner-lg" aria-hidden="true"></span>
      <p>Einstellungen werden geladen…</p>
    </div>

    <form v-else-if="form" class="stack" @submit.prevent="save">
      <div v-if="restartRequired" class="alert alert-warn">
        <strong>Neustart erforderlich:</strong> Änderungen an Video- oder Verzögerungseinstellungen werden erst
        nach einem Neustart des Streams wirksam.
      </div>

      <section id="settings-delay" class="card settings-section" tabindex="-1">
        <div class="card-head">
          <div>
            <h2 class="card-title">Verzögerung</h2>
          </div>
          <div class="settings-section-actions">
            <span v-if="sectionDirty('delay')" class="badge tone-warning">Ungespeichert</span>
            <span class="badge tone-warning">Neustart erforderlich</span>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              aria-label="Verzögerung speichern"
              :disabled="!sectionDirty('delay') || busySaving"
              @click="saveSection('delay')"
            >
              <span v-if="savingSection === 'delay'" class="spinner" aria-hidden="true"></span>
              Speichern
            </button>
          </div>
        </div>
        <div class="settings-body">
          <ToggleField
            v-model="form.delay_buffer.enabled"
            label="Delay-Buffer aktiviert"
            description="Puffert die Quelle gegen kurze Aussetzer."
          />
          <div class="settings-grid">
            <div class="field">
              <label for="delay-size">Puffergröße (Sekunden)</label>
              <input id="delay-size" v-model.number="form.delay_buffer.size" type="number" min="0" max="300" />
              <p class="field-hint">20–40 s empfohlen; Neustart erforderlich.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="settings-video" class="card settings-section" tabindex="-1">
        <div class="card-head">
          <div>
            <h2 class="card-title">Video</h2>
          </div>
          <div class="settings-section-actions">
            <span v-if="sectionDirty('video')" class="badge tone-warning">Ungespeichert</span>
            <span class="badge tone-warning">Neustart erforderlich</span>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              aria-label="Video speichern"
              :disabled="!sectionDirty('video') || busySaving"
              @click="saveSection('video')"
            >
              <span v-if="savingSection === 'video'" class="spinner" aria-hidden="true"></span>
              Speichern
            </button>
          </div>
        </div>
        <div class="settings-body">
          <div class="settings-grid">
            <div class="field">
              <label for="video-resolution">Auflösung</label>
              <select id="video-resolution" v-model="form.video.resolution">
                <option v-for="resolution in RESOLUTIONS" :key="resolution" :value="resolution">
                  {{ resolution }}
                </option>
              </select>
              <p class="field-hint">Hochkant: 720x1280 oder 1080x1920 · Querformat: 1280x720 oder 1920x1080</p>
            </div>
            <div class="field">
              <label for="video-fps">FPS</label>
              <input id="video-fps" v-model.number="form.video.fps" type="number" min="1" max="60" />
            </div>
            <div class="field">
              <label for="video-bitrate">Video-Bitrate (kbit/s)</label>
              <input id="video-bitrate" v-model.number="form.video.video_bitrate" type="number" min="500" max="50000" />
            </div>
            <div class="field">
              <label for="audio-bitrate">Audio-Bitrate (kbit/s)</label>
              <input id="audio-bitrate" v-model.number="form.video.audio_bitrate" type="number" min="32" max="320" />
            </div>
            <div class="field">
              <label for="video-preset">Encoder-Preset</label>
              <select id="video-preset" v-model="form.video.preset">
                <option v-for="preset in PRESETS" :key="preset.value" :value="preset.value">
                  {{ preset.label }}
                </option>
              </select>
              <p class="field-hint">Schnellere Presets reduzieren die CPU-Last.</p>
            </div>
            <div class="field">
              <label for="video-encoder">Video-Encoder</label>
              <select id="video-encoder" v-model="form.video.encoder">
                <option v-for="encoder in ENCODERS" :key="encoder.value" :value="encoder.value">
                  {{ encoder.label }}
                </option>
              </select>
              <p class="field-hint">
                Auto nutzt die GPU, wenn der Encoder beim Start verfügbar ist; sonst libx264.
                Ein nicht verfügbarer Encoder fällt automatisch auf libx264 zurück (siehe Logs).
              </p>
            </div>
            <div class="field">
              <label for="source-reencode">Quellen-Re-Encoding</label>
              <select id="source-reencode" v-model="form.source.reencode">
                <option value="on_reconnect">Nur bei Reconnect (empfohlen)</option>
                <option value="always">Immer</option>
                <option value="off">Nie (Copy)</option>
              </select>
              <p class="field-hint">Verhindert Mid-GOP-Ruckler beim Neustart der TikTok-Quelle.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="settings-watchdog" class="card settings-section" tabindex="-1">
        <div class="card-head">
          <div>
            <h2 class="card-title">Watchdog</h2>
          </div>
          <div class="settings-section-actions">
            <span v-if="sectionDirty('watchdog')" class="badge tone-warning">Ungespeichert</span>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              aria-label="Watchdog speichern"
              :disabled="!sectionDirty('watchdog') || busySaving"
              @click="saveSection('watchdog')"
            >
              <span v-if="savingSection === 'watchdog'" class="spinner" aria-hidden="true"></span>
              Speichern
            </button>
          </div>
        </div>
        <div class="settings-body">
          <ToggleField
            v-model="form.watchdog.auto_reconnect"
            label="Automatisch neu verbinden"
          />
          <div class="settings-grid">
            <div class="field">
              <label for="watchdog-stall">Stall-Timeout (Sekunden)</label>
              <input id="watchdog-stall" v-model.number="form.watchdog.stall_timeout" type="number" min="5" max="600" />
            </div>
            <div class="field">
              <label for="watchdog-bitrate">Minimale Bitrate (kbit/s)</label>
              <input id="watchdog-bitrate" v-model.number="form.watchdog.min_bitrate" type="number" min="0" max="50000" />
            </div>
            <div class="field">
              <label for="watchdog-rate">Mindest-Quellrate (% Echtzeit, 0 = aus)</label>
              <input id="watchdog-rate" v-model.number="form.watchdog.min_source_rate_percent" type="number" min="0" max="200" />
            </div>
            <div class="field">
              <label for="watchdog-interval">Prüfintervall (Sekunden)</label>
              <input id="watchdog-interval" v-model.number="form.watchdog.interval" type="number" min="1" max="60" />
            </div>
          </div>
        </div>
      </section>

      <section id="settings-refresh" class="card settings-section" tabindex="-1">
        <div class="card-head">
          <div>
            <h2 class="card-title">Auto-Refresh</h2>
          </div>
          <div class="settings-section-actions">
            <span v-if="sectionDirty('refresh')" class="badge tone-warning">Ungespeichert</span>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              aria-label="Auto-Refresh speichern"
              :disabled="!sectionDirty('refresh') || busySaving"
              @click="saveSection('refresh')"
            >
              <span v-if="savingSection === 'refresh'" class="spinner" aria-hidden="true"></span>
              Speichern
            </button>
          </div>
        </div>
        <div class="settings-body">
          <ToggleField
            v-model="form.auto_refresh.enabled"
            label="Auto-Refresh aktiviert"
          />
          <div class="settings-grid">
            <div class="field">
              <label for="refresh-interval">Intervall (Minuten)</label>
              <input id="refresh-interval" v-model.number="form.auto_refresh.interval" type="number" min="1" max="720" />
            </div>
          </div>
        </div>
      </section>

      <section id="settings-startup" class="card settings-section" tabindex="-1">
        <div class="card-head">
          <div>
            <h2 class="card-title">Startbildschirm</h2>
            <p class="card-sub">Vor dem ersten Live-Bild nach dem Start.</p>
          </div>
          <div class="settings-section-actions">
            <span v-if="sectionDirty('startup')" class="badge tone-warning">Ungespeichert</span>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              aria-label="Startbildschirm speichern"
              :disabled="!sectionDirty('startup') || busySaving"
              @click="saveSection('startup')"
            >
              <span v-if="savingSection === 'startup'" class="spinner" aria-hidden="true"></span>
              Speichern
            </button>
          </div>
        </div>
        <div class="settings-body">
          <ToggleField
            v-model="form.startup.enabled"
            label="Startbildschirm aktiviert"
          />
          <div class="settings-grid">
            <div class="field">
              <label for="startup-duration">Dauer (Sekunden, 0 = aus)</label>
              <input id="startup-duration" v-model.number="form.startup.duration_seconds" type="number" min="0" max="300" />
            </div>
            <div class="field">
              <label for="startup-text">Haupttext</label>
              <input id="startup-text" v-model="form.startup.text" type="text" maxlength="200" />
            </div>
            <div class="field">
              <label for="startup-subtext">Untertext</label>
              <input id="startup-subtext" v-model="form.startup.subtext" type="text" maxlength="200" />
            </div>
            <div class="field">
              <label for="startup-color">Hintergrundfarbe (Fallback)</label>
              <input id="startup-color" v-model="form.startup.color" type="text" spellcheck="false" placeholder="0x101820" />
            </div>
            <div class="field">
              <label for="startup-text-color">Textfarbe</label>
              <input id="startup-text-color" v-model="form.startup.text_color" type="text" spellcheck="false" placeholder="white" />
            </div>
            <div class="field">
              <label for="startup-fit">Bildanpassung</label>
              <select id="startup-fit" v-model="form.startup.fit">
                <option value="cover">Ausfüllen (cover, beschneidet)</option>
                <option value="contain">Einpassen (contain, Ränder)</option>
                <option value="stretch">Strecken (exakt füllen)</option>
              </select>
            </div>
            <div class="field field-span-2">
              <label for="startup-background">Hintergrundbild oder -video</label>
              <input
                id="startup-background"
                v-model="form.startup.background"
                type="text"
                spellcheck="false"
                placeholder="/app/data/pause/starting-soon.mp4"
              />
              <div class="pause-upload-row">
                <label class="btn btn-ghost btn-sm">
                  <input
                    class="sr-only"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,video/mp4,video/webm,video/quicktime,video/x-matroska"
                    @change="uploadPauseAsset('background', $event, 'startup')"
                  />
                  Hintergrund hochladen
                </label>
                <button
                  v-if="form.startup.background"
                  type="button"
                  class="btn btn-ghost btn-sm"
                  :disabled="pauseUploading !== null"
                  @click="removePauseAsset('background', 'startup')"
                >
                  Entfernen
                </button>
                <span v-if="pauseUploading === 'background'" class="muted small">Lädt hoch…</span>
              </div>
              <div v-if="startupPreviewSource" class="pause-preview">
                <video
                  v-if="startupPreviewIsVideo"
                  :src="startupPreviewSource"
                  controls
                  muted
                  loop
                  playsinline
                  preload="metadata"
                ></video>
                <img v-else :src="startupPreviewSource" alt="Startbildschirm-Vorschau" />
              </div>
              <p v-if="startupAssetMetadata && startupAsset?.kind !== 'font'" class="field-hint mono">
                {{ startupAssetMetadata }}
              </p>
              <p v-if="startupComposedUrl" class="field-hint">Vorschau mit Text (noch nicht gespeichert):</p>
              <div v-if="startupComposedUrl" class="pause-preview">
                <img :src="startupComposedUrl" alt="Startbildschirm-Vorschau mit Text" />
              </div>
            </div>
            <div class="field">
              <label for="startup-font">Schriftdatei (TTF/OTF)</label>
              <input
                id="startup-font"
                v-model="form.startup.font"
                type="text"
                spellcheck="false"
                placeholder="/app/data/pause/font.ttf"
              />
              <div class="pause-upload-row">
                <label class="btn btn-ghost btn-sm">
                  <input
                    class="sr-only"
                    type="file"
                    accept=".ttf,.otf,font/ttf,font/otf"
                    @change="uploadPauseAsset('font', $event, 'startup')"
                  />
                  Schrift hochladen
                </label>
                <button
                  v-if="form.startup.font"
                  type="button"
                  class="btn btn-ghost btn-sm"
                  :disabled="pauseUploading !== null"
                  @click="removePauseAsset('font', 'startup')"
                >
                  Entfernen
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="settings-pause" class="card settings-section" tabindex="-1">
        <div class="card-head">
          <div>
            <h2 class="card-title">Pause</h2>
          </div>
          <div class="settings-section-actions">
            <span v-if="sectionDirty('pause')" class="badge tone-warning">Ungespeichert</span>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              aria-label="Pause speichern"
              :disabled="!sectionDirty('pause') || busySaving"
              @click="saveSection('pause')"
            >
              <span v-if="savingSection === 'pause'" class="spinner" aria-hidden="true"></span>
              Speichern
            </button>
          </div>
        </div>
        <div class="settings-body">
          <ToggleField
            v-model="form.pause.enabled"
            label="Pause-Funktion aktiviert"
          />
          <div class="settings-grid">
            <div class="field">
              <label for="pause-text">Haupttext</label>
              <input id="pause-text" v-model="form.pause.text" type="text" placeholder="Stream pausiert" maxlength="200" />
            </div>
            <div class="field">
              <label for="pause-subtext">Untertext</label>
              <input id="pause-subtext" v-model="form.pause.subtext" type="text" placeholder="Wir sind gleich zurück." maxlength="200" />
            </div>
            <div class="field">
              <label for="pause-max">Maximale Pausendauer (Minuten, 0 = unbegrenzt)</label>
              <input id="pause-max" v-model.number="form.pause.max_minutes" type="number" min="0" max="1440" />
            </div>
            <div class="field">
              <label for="pause-grace">Pausenscreen-Verzögerung (Sekunden)</label>
              <input id="pause-grace" v-model.number="form.pause.grace_seconds" type="number" min="0" max="60" />
              <p class="field-hint">Kurze Unterbrechungen werden überbrückt, bevor der Pausenscreen übernimmt.</p>
            </div>
            <div class="field field-span-2">
              <label for="pause-background">Hintergrundbild oder -video</label>
              <input
                id="pause-background"
                v-model="form.pause.background"
                type="text"
                spellcheck="false"
                placeholder="z. B. /app/data/pause/background.webm oder https://…/loop.webm"
              />
              <p class="field-hint">
                PNG/JPG/WebP/GIF/MP4/WebM; SVG nur statisch. Leer = Hintergrundfarbe.
              </p>
              <div class="pause-upload-row">
                <label class="btn btn-ghost btn-sm">
                  <input
                    class="sr-only"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,video/mp4,video/webm,video/quicktime,video/x-matroska"
                    @change="uploadPauseAsset('background', $event)"
                  />
                  Hintergrund hochladen
                </label>
                <button
                  v-if="form.pause.background"
                  type="button"
                  class="btn btn-ghost btn-sm"
                  :disabled="pauseUploading !== null"
                  @click="removePauseAsset('background')"
                >
                  Entfernen
                </button>
                <span v-if="pauseUploading === 'background'" class="muted small">Lädt hoch…</span>
              </div>
              <div v-if="pausePreviewSource" class="pause-preview">
                <video
                  v-if="pausePreviewIsVideo"
                  :src="pausePreviewSource"
                  controls
                  muted
                  loop
                  playsinline
                  preload="metadata"
                ></video>
                <img v-else :src="pausePreviewSource" alt="Pausen-Hintergrund-Vorschau" />
              </div>
              <p v-if="pauseAssetMetadata && pauseAsset?.kind !== 'font'" class="field-hint mono">
                {{ pauseAssetMetadata }}
              </p>
              <p v-if="pauseAsset?.warning" class="alert alert-warn">{{ pauseAsset.warning }}</p>
              <p v-if="pauseComposedUrl" class="field-hint">Vorschau mit Text (noch nicht gespeichert):</p>
              <div v-if="pauseComposedUrl" class="pause-preview">
                <img :src="pauseComposedUrl" alt="Pausenscreen-Vorschau mit Text" />
              </div>
              <p v-if="composedPreviewError" class="field-hint mono">{{ composedPreviewError }}</p>
            </div>
            <div class="field">
              <label for="pause-font">Schriftdatei (TTF/OTF)</label>
              <input
                id="pause-font"
                v-model="form.pause.font"
                type="text"
                spellcheck="false"
                placeholder="/app/data/pause/font.ttf"
              />
              <div class="pause-upload-row">
                <label class="btn btn-ghost btn-sm">
                  <input
                    class="sr-only"
                    type="file"
                    accept=".ttf,.otf,font/ttf,font/otf"
                    @change="uploadPauseAsset('font', $event)"
                  />
                  Schrift hochladen
                </label>
                <button
                  v-if="form.pause.font"
                  type="button"
                  class="btn btn-ghost btn-sm"
                  :disabled="pauseUploading !== null"
                  @click="removePauseAsset('font')"
                >
                  Entfernen
                </button>
                <span v-if="pauseUploading === 'font'" class="muted small">Lädt hoch…</span>
              </div>
              <p v-if="pauseAsset?.kind === 'font'" class="field-hint mono">
                {{ pauseAsset.filename }} · {{ Math.round(pauseAsset.size / 1024) }} KB
              </p>
            </div>
            <div class="field">
              <label for="pause-text-color">Textfarbe</label>
              <input id="pause-text-color" v-model="form.pause.text_color" type="text" placeholder="white" spellcheck="false" />
            </div>
            <div class="field">
              <label for="pause-color">Hintergrundfarbe (Fallback)</label>
              <input id="pause-color" v-model="form.pause.color" type="text" spellcheck="false" placeholder="0x101820" />
            </div>
            <div class="field">
              <label for="pause-fit">Bildanpassung</label>
              <select id="pause-fit" v-model="form.pause.fit">
                <option value="cover">Ausfüllen (cover, beschneidet)</option>
                <option value="contain">Einpassen (contain, Ränder)</option>
                <option value="stretch">Strecken (exakt füllen)</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      <section id="settings-monitor" class="card settings-section" tabindex="-1">
        <div class="card-head">
          <div>
            <h2 class="card-title">Online-Monitor</h2>
          </div>
          <div class="settings-section-actions">
            <span v-if="sectionDirty('monitor')" class="badge tone-warning">Ungespeichert</span>
            <span v-if="form.online.api_key_set" class="badge tone-success">API-Key gesetzt</span>
            <span v-else class="badge tone-muted">Kein API-Key</span>
            <button type="button" class="btn btn-ghost btn-sm" :disabled="checkingOnline" @click="checkOnline">
              <span v-if="checkingOnline" class="spinner" aria-hidden="true"></span>
              Jetzt prüfen
            </button>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              aria-label="Online-Monitor speichern"
              :disabled="!sectionDirty('monitor') || busySaving"
              @click="saveSection('monitor')"
            >
              <span v-if="savingSection === 'monitor'" class="spinner" aria-hidden="true"></span>
              Speichern
            </button>
          </div>
        </div>
        <div class="settings-body">
          <ToggleField
            v-model="form.online.enabled"
            label="Online-Monitor aktiviert"
          />
          <ToggleField
            v-model="form.online.auto_switch_preferred"
            label="Bevorzugte Streamer automatisch übernehmen"
            description="Wechselt, sobald der Streamer live ist; danach zurück zum vorherigen Ziel."
          />
          <div class="settings-grid">
            <div class="field">
              <label for="online-url">Quell-URL</label>
              <input
                id="online-url"
                v-model="form.online.source_url"
                type="url"
                placeholder="https://api.example.com/check"
                spellcheck="false"
              />
            </div>
            <div class="field">
              <label for="online-key">API-Key</label>
              <input
                id="online-key"
                v-model="apiKey"
                type="password"
                :placeholder="form.online.api_key_set ? '•••••••• (gesetzt – leer lassen zum Behalten)' : 'API-Key eingeben'"
                autocomplete="new-password"
              />
              <p class="field-hint">Der Key wird nur beim Speichern übertragen und nie im Klartext angezeigt.</p>
            </div>
            <div class="field">
              <label for="online-interval">Prüfintervall (Sekunden)</label>
              <input id="online-interval" v-model.number="form.online.interval" type="number" min="10" max="3600" />
            </div>
          </div>
        </div>
      </section>

      <section id="settings-earnings" class="card settings-section" tabindex="-1">
        <div class="card-head">
          <div>
            <h2 class="card-title">Einnahmen</h2>
            <p class="card-sub">TokTracker-Format.</p>
          </div>
          <div class="settings-section-actions">
            <span v-if="sectionDirty('earnings')" class="badge tone-warning">Ungespeichert</span>
            <span v-if="form.earnings.api_key_set" class="badge tone-success">API-Key gesetzt</span>
            <span v-else class="badge tone-muted">Kein API-Key</span>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              aria-label="Einnahmen speichern"
              :disabled="!sectionDirty('earnings') || busySaving"
              @click="saveSection('earnings')"
            >
              <span v-if="savingSection === 'earnings'" class="spinner" aria-hidden="true"></span>
              Speichern
            </button>
          </div>
        </div>
        <div class="settings-body">
          <ToggleField
            v-model="form.earnings.enabled"
            label="Einnahmen-Monitor aktiviert"
          />
          <div class="settings-grid">
            <div class="field">
              <label for="earnings-url">Quell-URL</label>
              <input id="earnings-url" v-model="form.earnings.source_url" type="url" spellcheck="false" />
            </div>
            <div class="field">
              <label for="earnings-key">API-Key</label>
              <input
                id="earnings-key"
                v-model="earningsApiKey"
                type="password"
                :placeholder="form.earnings.api_key_set ? '•••••••• (gesetzt – leer lassen zum Behalten)' : 'API-Key eingeben'"
                autocomplete="new-password"
              />
            </div>
            <div class="field">
              <label for="earnings-interval">Aktualisierungsintervall (Sekunden)</label>
              <input id="earnings-interval" v-model.number="form.earnings.interval" type="number" min="30" max="3600" />
            </div>
            <div class="field">
              <label for="earnings-period">Zeitraum</label>
              <select id="earnings-period" v-model="form.earnings.period">
                <option value="today">Heute</option>
                <option value="24h">Letzte 24 h</option>
                <option value="7d">Letzte 7 Tage</option>
                <option value="30d">Letzte 30 Tage</option>
                <option value="all">Gesamt</option>
              </select>
            </div>
            <div class="field">
              <label for="earnings-view">Dashboard-Anzeige</label>
              <select id="earnings-view" v-model="form.earnings.view">
                <option value="compact">Kompakt</option>
                <option value="standard">Standard</option>
                <option value="detailed">Ausführlich</option>
              </select>
            </div>
          </div>
          <div class="alert alert-info">
            Overlay-Text und Position:
            <RouterLink to="/overlays">Overlay-Studio</RouterLink>
          </div>
        </div>
      </section>

      <section id="settings-chat" class="card settings-section" tabindex="-1">
        <div class="card-head">
          <div>
            <h2 class="card-title">Chat-Overlay</h2>
          </div>
          <div class="settings-section-actions">
            <span v-if="sectionDirty('chat')" class="badge tone-warning">Ungespeichert</span>
            <RouterLink to="/overlays" class="btn btn-ghost btn-sm">Overlay-Studio</RouterLink>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              aria-label="Chat-Overlay speichern"
              :disabled="!sectionDirty('chat') || busySaving"
              @click="saveSection('chat')"
            >
              <span v-if="savingSection === 'chat'" class="spinner" aria-hidden="true"></span>
              Speichern
            </button>
          </div>
        </div>
        <div class="settings-body">
          <div class="settings-grid">
            <div class="field">
              <label for="chat-url">Chat-API-URL</label>
              <input
                id="chat-url"
                v-model="form.chat.api_url"
                type="url"
                placeholder="https://toktracker.example/api/chat-logs"
                spellcheck="false"
              />
              <p class="field-hint">Gilt global für alle Streamer.</p>
            </div>
            <div class="field">
              <label for="chat-key">Chat-API-Key</label>
              <input
                id="chat-key"
                v-model="chatApiKey"
                type="password"
                :placeholder="form.chat.api_key_set ? '•••••••• (gesetzt – leer lassen zum Behalten)' : 'API-Key eingeben'"
                autocomplete="new-password"
              />
            </div>
          </div>
        </div>
      </section>

      <section id="settings-title" class="card settings-section" tabindex="-1">
        <div class="card-head">
          <div>
            <h2 class="card-title">YouTube-Titel</h2>
          </div>
          <div class="settings-section-actions">
            <span v-if="sectionDirty('title')" class="badge tone-warning">Ungespeichert</span>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              aria-label="YouTube-Titel speichern"
              :disabled="!sectionDirty('title') || busySaving"
              @click="saveSection('title')"
            >
              <span v-if="savingSection === 'title'" class="spinner" aria-hidden="true"></span>
              Speichern
            </button>
          </div>
        </div>
        <div class="settings-body">
          <div class="field">
            <label for="title-template">Titel-Template</label>
            <input
              id="title-template"
              v-model="form.streaming.title_template"
              type="text"
              maxlength="200"
              spellcheck="false"
            />
            <p class="field-hint">
              Platzhalter: <code>{name}</code>, <code>{tiktok}</code>, <code>{title}</code>,
              <code>{date}</code>, <code>{time}</code>. Nur lokal, wird nicht an YouTube gesendet.
            </p>
          </div>
        </div>
      </section>

      <section id="settings-sessions" class="card settings-section" tabindex="-1">
        <div class="card-head">
          <div>
            <h2 class="card-title">Sessions</h2>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="sessionsLoading || sessions.length === 0"
            @click="revokeAllSessions"
          >
            Alle abmelden
          </button>
        </div>
        <div class="settings-body">
          <p v-if="sessionsError" class="alert alert-error" role="alert">{{ sessionsError }}</p>
          <p v-else-if="sessionsLoading" class="muted small">Sessions werden geladen…</p>
          <p v-else-if="sessions.length === 0" class="muted small">Keine aktiven Sessions.</p>
          <ul v-else class="session-list">
            <li v-for="session in sessions" :key="session.id" class="session-item">
              <div class="session-main">
                <strong>{{ session.user }}</strong>
                <span class="badge tone-info">
                  {{ session.provider === 'telegram' ? 'Telegram' : 'Passwort' }}
                </span>
                <span v-if="session.current" class="badge tone-success">Diese Sitzung</span>
              </div>
              <p class="session-meta">
                Erstellt {{ formatDateTime(session.created_at) }} · Zuletzt
                {{ formatDateTime(session.last_seen_at) }}
              </p>
              <button
                v-if="!session.current"
                type="button"
                class="btn btn-ghost btn-sm"
                @click="revokeSession(session)"
              >
                Abmelden
              </button>
            </li>
          </ul>
        </div>
      </section>

      <div class="form-actions">
        <span v-if="dirty" class="muted small">Ungespeicherte Änderungen</span>
        <button type="button" class="btn btn-ghost" :disabled="!dirty || busySaving" @click="loadSettings()">
          Verwerfen
        </button>
        <button type="submit" class="btn btn-primary" :disabled="!dirty || busySaving">
          <span v-if="saving" class="spinner" aria-hidden="true"></span>
          Alles speichern
        </button>
      </div>
    </form>
  </div>
</template>
