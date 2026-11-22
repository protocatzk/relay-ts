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
  VideoTuneSetting,
  WebhookEventType,
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
import TotpSection from '@/src/components/TotpSection.vue';
import SettingsDelayCard from '@/src/components/settings/SettingsDelayCard.vue';
import SettingsVideoCard from '@/src/components/settings/SettingsVideoCard.vue';
import SettingsAudioCard from '@/src/components/settings/SettingsAudioCard.vue';
import SettingsWatchdogCard from '@/src/components/settings/SettingsWatchdogCard.vue';
import SettingsRefreshCard from '@/src/components/settings/SettingsRefreshCard.vue';
import SettingsStartupCard from '@/src/components/settings/SettingsStartupCard.vue';
import SettingsPauseCard from '@/src/components/settings/SettingsPauseCard.vue';
import SettingsMonitorCard from '@/src/components/settings/SettingsMonitorCard.vue';
import SettingsEarningsCard from '@/src/components/settings/SettingsEarningsCard.vue';
import SettingsChatCard from '@/src/components/settings/SettingsChatCard.vue';
import SettingsTitleCard from '@/src/components/settings/SettingsTitleCard.vue';
import SettingsWebhooksCard from '@/src/components/settings/SettingsWebhooksCard.vue';
import SettingsMcpCard from '@/src/components/settings/SettingsMcpCard.vue';
import SettingsAppearanceCard from '@/src/components/settings/SettingsAppearanceCard.vue';
import SettingsTikTokAccountsCard from '@/src/components/settings/SettingsTikTokAccountsCard.vue';
import SettingsSessionsCard from '@/src/components/settings/SettingsSessionsCard.vue';
import { confirmAction } from '@/src/composables/useConfirm';
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

const TUNES: { value: VideoTuneSetting; label: string }[] = [
  { value: 'zerolatency', label: 'Zero-Latency (Standard)' },
  { value: 'film', label: 'Film (für reale Videos)' },
  { value: 'animation', label: 'Animation (für Anime/Cartoons)' },
  { value: 'off', label: 'Aus (B-Frames & Lookahead aktiv)' },
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
const globalYoutubeKey = ref('');
const clearGlobalYoutubeKey = ref(false);
const webhookUrl = ref('');
const webhookSecret = ref('');
const testingWebhook = ref(false);

const WEBHOOK_EVENT_OPTIONS: { value: WebhookEventType; label: string }[] = [
  { value: 'stream_error', label: 'Stream-/Sink-Fehler' },
  { value: 'pause_limit', label: 'Pausen-Limit erreicht' },
  { value: 'reconnect_failed', label: 'Reconnect fehlgeschlagen' },
  { value: 'youtube_auth_required', label: 'YouTube-Auth abgelaufen' },
  { value: 'disk_warning', label: 'Speicher-Warnung' },
  { value: 'audio_silence', label: 'Audio-Stille' },
];
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
  globalYoutubeKey: globalYoutubeKey.value,
  clearGlobalYoutubeKey: clearGlobalYoutubeKey.value,
  webhookUrl: webhookUrl.value,
  webhookSecret: webhookSecret.value,
}));

function sectionDirty(section: EditableSettingsSectionId): boolean {
  if (!form.value || !baseline.value) return false;
  return isSectionDirty(section, form.value, baseline.value, secretsDraft.value);
}

const restartRequired = computed(
  () => sectionDirty('delay') || sectionDirty('video') || sectionDirty('audio'),
);

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
  if (
    !(await confirmAction('Datei wirklich löschen?', {
      title: 'Datei löschen',
      confirmLabel: 'Löschen',
    }))
  ) {
    return;
  }
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
  if (
    !(await confirmAction(`Sitzung von ${session.user} abmelden?`, {
      title: 'Sitzung abmelden',
      confirmLabel: 'Abmelden',
    }))
  ) {
    return;
  }
  try {
    await api.auth.revokeSession(session.id);
    await loadSessions();
    pushToast('Sitzung abgemeldet.', 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  }
}

async function revokeAllSessions(): Promise<void> {
  if (
    !(await confirmAction('Alle Sessions abmelden? Du musst dich danach neu anmelden.', {
      title: 'Alle Sessions abmelden',
      confirmLabel: 'Alle abmelden',
    }))
  ) {
    return;
  }
  try {
    await api.auth.revokeAllSessions();
    window.location.assign('/login');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  }
}

function normalizeSettingsDefaults(settings: Settings): Settings {
  settings.delay_buffer.catchup_rate ??= 1.01;
  settings.audio ??= {
    normalize: 'off',
    target_lufs: -16,
    gain_db: 0,
    silence_detect: false,
    silence_threshold_db: -50,
    silence_seconds: 15,
  };
  settings.webhooks ??= {
    enabled: false,
    url_set: false,
    url_host: '',
    format: 'generic',
    secret_set: false,
    cooldown_seconds: 60,
    events: ['stream_error', 'pause_limit', 'reconnect_failed', 'youtube_auth_required', 'disk_warning'],
  };
  settings.streaming.global_key_enabled ??= false;
  settings.streaming.global_youtube_key_set ??= false;
  return settings;
}

async function loadSettings(silent = false): Promise<void> {
  if (!silent) loading.value = true;
  loadError.value = '';
  try {
    const settings = normalizeSettingsDefaults(await api.settings.get());
    form.value = clone(settings);
    baseline.value = clone(settings);
    apiKey.value = '';
    chatApiKey.value = '';
    earningsApiKey.value = '';
    globalYoutubeKey.value = '';
    clearGlobalYoutubeKey.value = false;
    webhookUrl.value = '';
    webhookSecret.value = '';
  } catch (error) {
    loadError.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
}

function toggleWebhookEvent(event: WebhookEventType): void {
  const hooks = form.value?.webhooks;
  if (!hooks) return;
  const idx = hooks.events.indexOf(event);
  if (idx >= 0) hooks.events.splice(idx, 1);
  else hooks.events.push(event);
}

async function sendTestWebhook(): Promise<void> {
  testingWebhook.value = true;
  try {
    const result = await api.webhooks.test();
    pushToast(`Test-Webhook gesendet (HTTP ${result.status}).`, 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    testingWebhook.value = false;
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
    if (section === 'title') {
      globalYoutubeKey.value = '';
      clearGlobalYoutubeKey.value = false;
    }
    if (section === 'webhooks') {
      webhookUrl.value = '';
      webhookSecret.value = '';
    }
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
    const saved = normalizeSettingsDefaults(await api.settings.update(payload));
    form.value = clone(saved);
    baseline.value = clone(saved);
    apiKey.value = '';
    chatApiKey.value = '';
    earningsApiKey.value = '';
    globalYoutubeKey.value = '';
    clearGlobalYoutubeKey.value = false;
    webhookUrl.value = '';
    webhookSecret.value = '';
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

      <SettingsDelayCard
        :model="form.delay_buffer"
        :dirty="sectionDirty('delay')"
        :saving="savingSection === 'delay'"
        :busy-saving="busySaving"
        @save="saveSection('delay')"
      />

      <SettingsVideoCard
        :video="form.video"
        :source="form.source"
        :resolutions="RESOLUTIONS"
        :presets="PRESETS"
        :tunes="TUNES"
        :encoders="ENCODERS"
        :dirty="sectionDirty('video')"
        :saving="savingSection === 'video'"
        :busy-saving="busySaving"
        @save="saveSection('video')"
      />

      <SettingsAudioCard
        v-if="form.audio"
        :audio="form.audio"
        :dirty="sectionDirty('audio')"
        :saving="savingSection === 'audio'"
        :busy-saving="busySaving"
        @save="saveSection('audio')"
      />

      <SettingsWatchdogCard
        :watchdog="form.watchdog"
        :dirty="sectionDirty('watchdog')"
        :saving="savingSection === 'watchdog'"
        :busy-saving="busySaving"
        @save="saveSection('watchdog')"
      />

      <SettingsRefreshCard
        :refresh="form.auto_refresh"
        :dirty="sectionDirty('refresh')"
        :saving="savingSection === 'refresh'"
        :busy-saving="busySaving"
        @save="saveSection('refresh')"
      />

      <SettingsStartupCard
        :startup="form.startup"
        :dirty="sectionDirty('startup')"
        :saving="savingSection === 'startup'"
        :busy-saving="busySaving"
        :pause-uploading="pauseUploading"
        :startup-asset="startupAsset"
        :startup-preview-source="startupPreviewSource"
        :startup-preview-is-video="startupPreviewIsVideo"
        :startup-asset-metadata="startupAssetMetadata"
        :startup-composed-url="startupComposedUrl"
        @save="saveSection('startup')"
        @upload-asset="uploadPauseAsset"
        @remove-asset="removePauseAsset"
      />

      <SettingsPauseCard
        :pause="form.pause"
        :dirty="sectionDirty('pause')"
        :saving="savingSection === 'pause'"
        :busy-saving="busySaving"
        :pause-uploading="pauseUploading"
        :pause-asset="pauseAsset"
        :pause-preview-source="pausePreviewSource"
        :pause-preview-is-video="pausePreviewIsVideo"
        :pause-asset-metadata="pauseAssetMetadata"
        :pause-composed-url="pauseComposedUrl"
        :composed-preview-error="composedPreviewError"
        @save="saveSection('pause')"
        @upload-asset="uploadPauseAsset"
        @remove-asset="removePauseAsset"
      />

      <SettingsMonitorCard
        :online="form.online"
        :api-key="apiKey"
        :checking-online="checkingOnline"
        :dirty="sectionDirty('monitor')"
        :saving="savingSection === 'monitor'"
        :busy-saving="busySaving"
        @update:api-key="apiKey = $event"
        @check-online="checkOnline"
        @save="saveSection('monitor')"
      />

      <SettingsEarningsCard
        :earnings="form.earnings"
        :earnings-api-key="earningsApiKey"
        :dirty="sectionDirty('earnings')"
        :saving="savingSection === 'earnings'"
        :busy-saving="busySaving"
        @update:earnings-api-key="earningsApiKey = $event"
        @save="saveSection('earnings')"
      />

      <SettingsChatCard
        :chat="form.chat"
        :chat-api-key="chatApiKey"
        :dirty="sectionDirty('chat')"
        :saving="savingSection === 'chat'"
        :busy-saving="busySaving"
        @update:chat-api-key="chatApiKey = $event"
        @save="saveSection('chat')"
      />

      <SettingsTitleCard
        :streaming="form.streaming"
        :global-youtube-key="globalYoutubeKey"
        :clear-global-youtube-key="clearGlobalYoutubeKey"
        :dirty="sectionDirty('title')"
        :saving="savingSection === 'title'"
        :busy-saving="busySaving"
        @update:global-youtube-key="globalYoutubeKey = $event"
        @update:clear-global-youtube-key="clearGlobalYoutubeKey = $event"
        @save="saveSection('title')"
      />

      <SettingsWebhooksCard
        v-if="form.webhooks"
        :webhooks="form.webhooks"
        :webhook-url="webhookUrl"
        :webhook-secret="webhookSecret"
        :testing-webhook="testingWebhook"
        :event-options="WEBHOOK_EVENT_OPTIONS"
        :dirty="sectionDirty('webhooks')"
        :saving="savingSection === 'webhooks'"
        :busy-saving="busySaving"
        @update:webhook-url="webhookUrl = $event"
        @update:webhook-secret="webhookSecret = $event"
        @test="sendTestWebhook"
        @toggle-event="toggleWebhookEvent"
        @save="saveSection('webhooks')"
      />

      <SettingsMcpCard
        v-if="form.mcp"
        :mcp="form.mcp"
        :dirty="sectionDirty('mcp')"
        :saving="savingSection === 'mcp'"
        :busy-saving="busySaving"
        @save="saveSection('mcp')"
      />

      <SettingsTikTokAccountsCard />

      <SettingsAppearanceCard />

      <TotpSection />

      <SettingsSessionsCard
        :sessions="sessions"
        :sessions-loading="sessionsLoading"
        :sessions-error="sessionsError"
        @revoke="revokeSession"
        @revoke-all="revokeAllSessions"
      />

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
