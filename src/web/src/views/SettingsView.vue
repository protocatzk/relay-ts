<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { PauseAsset, Settings, SettingsUpdate, VideoPreset } from '@/src/api/types';
import ToggleField from '@/src/components/ToggleField.vue';
import { useToast } from '@/src/composables/useToast';

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

const form = ref<Settings | null>(null);
const loading = ref(true);
const saving = ref(false);
const loadError = ref('');
const apiKey = ref('');
const chatApiKey = ref('');
const earningsApiKey = ref('');
const checkingOnline = ref(false);
const initialSnapshot = ref('');
const baselineRestart = ref('');
const pauseUploading = ref<'background' | 'font' | null>(null);
const pauseAsset = ref<PauseAsset | null>(null);
const pausePreviewUrl = ref('');
const pausePreviewKind = ref<'image' | 'video' | null>(null);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function restartSnapshot(settings: Settings): string {
  return JSON.stringify({ delay_buffer: settings.delay_buffer, video: settings.video });
}

const restartRequired = computed(
  () => form.value !== null && restartSnapshot(form.value) !== baselineRestart.value,
);

const dirty = computed(() => {
  if (!form.value) return false;
  return `${JSON.stringify(form.value)}|${apiKey.value}|${chatApiKey.value}|${earningsApiKey.value}` !== initialSnapshot.value;
});

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

const pauseAssetMetadata = computed(() => {
  const asset = pauseAsset.value;
  if (!asset) return '';
  const parts = [asset.kind.toUpperCase(), `${Math.round(asset.size / 1024)} KB`];
  if (asset.width && asset.height) parts.push(`${asset.width}×${asset.height}`);
  if (asset.duration) parts.push(`${asset.duration.toFixed(1)} s`);
  if (asset.loopable) parts.push('loop');
  return parts.join(' · ');
});

async function uploadPauseAsset(kind: 'background' | 'font', event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !form.value) return;
  pauseUploading.value = kind;
  try {
    const asset = await api.pause.upload(file);
    if (kind === 'background') {
      form.value.pause.background = asset.path;
      if (pausePreviewUrl.value) URL.revokeObjectURL(pausePreviewUrl.value);
      pausePreviewUrl.value = URL.createObjectURL(file);
      pausePreviewKind.value = asset.kind === 'video' ? 'video' : 'image';
    } else {
      form.value.pause.font = asset.path;
    }
    pauseAsset.value = asset;
    pushToast(asset.warning ?? 'Datei hochgeladen.', asset.warning ? 'info' : 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    pauseUploading.value = null;
  }
}

async function removePauseAsset(kind: 'background' | 'font'): Promise<void> {
  if (!form.value) return;
  const path =
    kind === 'background' ? form.value.pause.background : form.value.pause.font;
  if (!path) return;
  const filename = pauseFileName(path);
  const localAsset = path.startsWith('/app/data/pause/') || path.startsWith('data/pause/');
  if (!filename || !localAsset) {
    if (kind === 'background') form.value.pause.background = '';
    else form.value.pause.font = '';
    return;
  }
  if (!window.confirm('Datei wirklich löschen?')) return;
  try {
    await api.pause.remove(filename);
    if (kind === 'background') {
      form.value.pause.background = '';
      if (pausePreviewUrl.value) URL.revokeObjectURL(pausePreviewUrl.value);
      pausePreviewUrl.value = '';
      pausePreviewKind.value = null;
    } else {
      form.value.pause.font = '';
    }
    pauseAsset.value = null;
    pushToast('Datei gelöscht.', 'success');
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
    apiKey.value = '';
    chatApiKey.value = '';
    earningsApiKey.value = '';
    baselineRestart.value = restartSnapshot(settings);
    initialSnapshot.value = `${JSON.stringify(settings)}|||`;
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

async function save(): Promise<void> {
  const current = form.value;
  if (!current) return;
  const payload: SettingsUpdate = {
    delay_buffer: {
      enabled: current.delay_buffer.enabled,
      size: toNumber(current.delay_buffer.size, 30),
    },
    video: {
      resolution: current.video.resolution,
      fps: toNumber(current.video.fps, 30),
      video_bitrate: toNumber(current.video.video_bitrate, 4000),
      audio_bitrate: toNumber(current.video.audio_bitrate, 128),
      preset: current.video.preset,
    },
    watchdog: {
      stall_timeout: toNumber(current.watchdog.stall_timeout, 30),
      min_bitrate: toNumber(current.watchdog.min_bitrate, 500),
      min_source_rate_percent: toNumber(current.watchdog.min_source_rate_percent, 85),
      interval: toNumber(current.watchdog.interval, 5),
      auto_reconnect: current.watchdog.auto_reconnect,
    },
    auto_refresh: {
      enabled: current.auto_refresh.enabled,
      interval: toNumber(current.auto_refresh.interval, 20),
    },
    pause: {
      enabled: current.pause.enabled,
      text: current.pause.text,
      subtext: current.pause.subtext,
      max_minutes: toNumber(current.pause.max_minutes, 15),
      grace_seconds: toNumber(current.pause.grace_seconds, 2),
      background: current.pause.background.trim(),
      font: current.pause.font.trim(),
      text_color: current.pause.text_color.trim() || 'white',
      fit: current.pause.fit,
    },
    online: {
      enabled: current.online.enabled,
      source_url: current.online.source_url.trim(),
      interval: toNumber(current.online.interval, 30),
      auto_switch_preferred: current.online.auto_switch_preferred,
      ...(apiKey.value.trim() ? { api_key: apiKey.value.trim() } : {}),
    },
    chat: {
      api_url: current.chat.api_url.trim(),
      ...(chatApiKey.value.trim() ? { api_key: chatApiKey.value.trim() } : {}),
    },
    streaming: {
      title_template: current.streaming.title_template,
    },
    earnings: {
      enabled: current.earnings.enabled,
      source_url: current.earnings.source_url.trim(),
      interval: toNumber(current.earnings.interval, 300),
      period: current.earnings.period,
      view: current.earnings.view,
      overlay_enabled: current.earnings.overlay_enabled,
      overlay_position: current.earnings.overlay_position,
      overlay_template: current.earnings.overlay_template,
      overlay_font_size: toNumber(current.earnings.overlay_font_size, 22),
      ...(earningsApiKey.value.trim() ? { api_key: earningsApiKey.value.trim() } : {}),
    },
  };

  saving.value = true;
  try {
    await api.settings.update(payload);
    pushToast('Einstellungen gespeichert.', 'success');
    await loadSettings(true);
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void loadSettings();
});

onBeforeUnmount(() => {
  if (pausePreviewUrl.value) URL.revokeObjectURL(pausePreviewUrl.value);
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Einstellungen</h1>
        <p class="page-sub">Restream-Parameter, Watchdog und Überwachung konfigurieren.</p>
      </div>
      <div class="page-actions">
        <span v-if="dirty" class="badge tone-warning">Ungespeicherte Änderungen</span>
        <RouterLink to="/overlays" class="btn btn-ghost">Overlay-Studio</RouterLink>
        <button type="button" class="btn btn-ghost" :disabled="loading || saving" @click="loadSettings()">
          Zurücksetzen
        </button>
        <button type="button" class="btn btn-primary" :disabled="!form || saving" @click="save">
          <span v-if="saving" class="spinner" aria-hidden="true"></span>
          Speichern
        </button>
      </div>
    </div>

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

      <section class="card settings-section">
        <div class="card-head">
          <div>
            <h2 class="card-title">Verzögerung</h2>
            <p class="card-sub">Delay-Buffer zwischen TikTok-Quelle und YouTube-Ausgang.</p>
          </div>
        </div>
        <div class="settings-body">
          <ToggleField
            v-model="form.delay_buffer.enabled"
            label="Delay-Buffer aktiviert"
            description="Glättet Verbindungsabbrüche und puffert den Stream."
          />
          <div class="settings-grid">
            <div class="field">
              <label for="delay-size">Puffergröße (Sekunden)</label>
              <input id="delay-size" v-model.number="form.delay_buffer.size" type="number" min="0" max="300" />
              <p class="field-hint">Empfohlen: 20–40 Sekunden. Änderungen erfordern einen Stream-Neustart.</p>
            </div>
          </div>
        </div>
      </section>

      <section class="card settings-section">
        <div class="card-head">
          <div>
            <h2 class="card-title">Video</h2>
            <p class="card-sub">Auflösung, Bitrate und Encoder-Preset für den YouTube-Ausgang.</p>
          </div>
          <span class="badge tone-warning">Neustart erforderlich</span>
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
          </div>
        </div>
      </section>

      <section class="card settings-section">
        <div class="card-head">
          <div>
            <h2 class="card-title">Watchdog</h2>
            <p class="card-sub">Erkennt Stalls und startet die Quelle bei Bedarf neu.</p>
          </div>
        </div>
        <div class="settings-body">
          <ToggleField
            v-model="form.watchdog.auto_reconnect"
            label="Automatisch neu verbinden"
            description="Quelle nach einem erkannten Stall automatisch neu starten."
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

      <section class="card settings-section">
        <div class="card-head">
          <div>
            <h2 class="card-title">Auto-Refresh</h2>
            <p class="card-sub">TikTok-URL regelmäßig neu auflösen, um die Verbindung zu stabilisieren.</p>
          </div>
        </div>
        <div class="settings-body">
          <ToggleField
            v-model="form.auto_refresh.enabled"
            label="Auto-Refresh aktiviert"
            description="Stream-URL in festen Abständen neu auflösen."
          />
          <div class="settings-grid">
            <div class="field">
              <label for="refresh-interval">Intervall (Minuten)</label>
              <input id="refresh-interval" v-model.number="form.auto_refresh.interval" type="number" min="1" max="720" />
            </div>
          </div>
        </div>
      </section>

      <section class="card settings-section">
        <div class="card-head">
          <div>
            <h2 class="card-title">Pause</h2>
            <p class="card-sub">Pausenscreen anzeigen, wenn der Stream pausiert ist.</p>
          </div>
        </div>
        <div class="settings-body">
          <ToggleField
            v-model="form.pause.enabled"
            label="Pause-Funktion aktiviert"
            description="Ermöglicht das Umschalten auf einen Pausenscreen."
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
                Unterstützt PNG/JPG/WebP/GIF/MP4/WebM (loop) sowie statisches SVG.
                Animiertes SVG wird nicht nativ von ffmpeg dekodiert – dafür WebM/GIF verwenden.
                Leer = Hintergrundfarbe.
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

      <section class="card settings-section">
        <div class="card-head">
          <div>
            <h2 class="card-title">Online-Monitor</h2>
            <p class="card-sub">Prüft, ob der TikTok-Kanal live ist.</p>
          </div>
          <span v-if="form.online.api_key_set" class="badge tone-success">API-Key gesetzt</span>
          <span v-else class="badge tone-muted">Kein API-Key</span>
          <button type="button" class="btn btn-ghost btn-sm" :disabled="checkingOnline" @click="checkOnline">
            <span v-if="checkingOnline" class="spinner" aria-hidden="true"></span>
            Jetzt prüfen
          </button>
        </div>
        <div class="settings-body">
          <ToggleField
            v-model="form.online.enabled"
            label="Online-Monitor aktiviert"
            description="Live-Status des Kanals über eine externe API abfragen."
          />
          <ToggleField
            v-model="form.online.auto_switch_preferred"
            label="Bevorzugte Streamer automatisch übernehmen"
            description="Wenn ein als bevorzugt markierter Streamer online geht, automatisch dorthin wechseln."
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

      <section class="card settings-section">
        <div class="card-head">
          <div>
            <h2 class="card-title">Einnahmen</h2>
            <p class="card-sub">TokTracker-kompatible Einnahmen-Anzeige und Overlay.</p>
          </div>
          <span v-if="form.earnings.api_key_set" class="badge tone-success">API-Key gesetzt</span>
          <span v-else class="badge tone-muted">Kein API-Key</span>
        </div>
        <div class="settings-body">
          <ToggleField
            v-model="form.earnings.enabled"
            label="Einnahmen-Monitor aktiviert"
            description="Einnahmen des aktiven Streamers regelmäßig abrufen."
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
          <ToggleField
            v-model="form.earnings.overlay_enabled"
            label="Einnahmen im Stream anzeigen"
            description="Werte als Text-Overlay in den Stream einblenden."
          />
          <div v-if="form.earnings.overlay_enabled" class="settings-grid">
            <div class="field">
              <label for="earnings-position">Overlay-Position</label>
              <select id="earnings-position" v-model="form.earnings.overlay_position">
                <option value="top-left">Oben links</option>
                <option value="top-right">Oben rechts</option>
                <option value="bottom-left">Unten links</option>
                <option value="bottom-right">Unten rechts</option>
              </select>
            </div>
            <div class="field">
              <label for="earnings-template">Overlay-Template</label>
              <input id="earnings-template" v-model="form.earnings.overlay_template" type="text" maxlength="200" />
              <p class="field-hint">
                Platzhalter: {period}, {net}, {gross}, {coins}, {gifts}, {gifters},
                {session_net}, {session_gross}, {session_coins}, {viewers}, {followers},
                {live}, {top_gift}, {top_gifter}, {display_name}, {last_seen}, {name},
                {username}, {currency}.
              </p>
            </div>
            <div class="field">
              <label for="earnings-font-size">Overlay-Schriftgröße (px)</label>
              <input id="earnings-font-size" v-model.number="form.earnings.overlay_font_size" type="number" min="8" max="96" />
            </div>
          </div>
        </div>
      </section>

      <section class="card settings-section">
        <div class="card-head">
          <div>
            <h2 class="card-title">Chat-Overlay</h2>
            <p class="card-sub">Globale Chat-API und Live-Vorschau.</p>
          </div>
          <RouterLink to="/overlays" class="btn btn-ghost btn-sm">Overlay-Studio</RouterLink>
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
              <p class="field-hint">Der Streamer kann in seinen Overlay-Einstellungen eine eigene URL setzen.</p>
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

      <section class="card settings-section">
        <div class="card-head">
          <div>
            <h2 class="card-title">YouTube-Titel</h2>
            <p class="card-sub">Lokale Vorschau des Stream-Titels.</p>
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
              <code>{date}</code>, <code>{time}</code>. Es wird nur lokal angezeigt, nicht per
              YouTube-API gesetzt.
            </p>
          </div>
        </div>
      </section>

      <div class="form-actions">
        <span v-if="dirty" class="muted small">Ungespeicherte Änderungen</span>
        <button type="button" class="btn btn-ghost" :disabled="saving" @click="loadSettings()">
          Verwerfen
        </button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          <span v-if="saving" class="spinner" aria-hidden="true"></span>
          Einstellungen speichern
        </button>
      </div>
    </form>
  </div>
</template>
