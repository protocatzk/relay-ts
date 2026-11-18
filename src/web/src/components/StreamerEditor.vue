<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type {
  ChatOverlay,
  OverlayPosition,
  StreamQuality,
  Streamer,
  StreamerInput,
  StreamerOverlays,
  StreamerOverlaysInput,
} from '@/src/api/types';
import ModalDialog from './ModalDialog.vue';
import ToggleField from './ToggleField.vue';

const props = defineProps<{
  open: boolean;
  streamer: Streamer | null;
  saving: boolean;
  error: string;
}>();

const emit = defineEmits<{
  close: [];
  save: [payload: { id: string; body: StreamerInput }];
}>();

const QUALITY_OPTIONS: { value: StreamQuality; label: string }[] = [
  { value: 'best', label: 'Beste verfügbare' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: '480p', label: '480p' },
  { value: '360p', label: '360p' },
];

const POSITIONS: { value: OverlayPosition; label: string }[] = [
  { value: 'top-left', label: 'Oben links' },
  { value: 'top-right', label: 'Oben rechts' },
  { value: 'bottom-left', label: 'Unten links' },
  { value: 'bottom-right', label: 'Unten rechts' },
];

interface StreamerForm {
  id: string;
  name: string;
  tiktok: string;
  youtube_key: string;
  quality: StreamQuality;
  auto_start: boolean;
  preferred: boolean;
  enabled: boolean;
  own_stream: boolean;
  overlays: StreamerOverlays;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function defaultOverlays(): StreamerOverlays {
  return {
    chat: {
      enabled: false,
      engine: 'canvas',
      position: 'bottom-left',
      style: 'bubbles',
      max_lines: 8,
      max_messages: 30,
      max_age_seconds: 0,
      panel_height: 0,
      font_size: 24,
      font_color: '#ffffff',
      box_color: '#000000@0.45',
      bubble_opacity: 1,
      panel_width: 0,
      render_fps: 10,
      show_timestamps: false,
      show_badges: true,
      show_tiers: true,
      show_stats: false,
      name_colors: true,
      api_url: '',
      api_key_set: false,
      poll_interval: 3,
      delay: 0,
    },
    clock: {
      enabled: false,
      position: 'top-right',
      format: '%H:%M',
      font_size: 28,
      font_color: '#ffffff',
      box_color: '#000000@0.45',
      show_box: true,
      margin: 32,
    },
    text: {
      enabled: false,
      position: 'bottom-right',
      text: '',
      font_size: 24,
      font_color: '#ffffff',
      box_color: '#000000@0.45',
      marquee: false,
      speed: 60,
      show_box: true,
      margin: 32,
    },
  };
}

const source = props.streamer;

const form = reactive<StreamerForm>({
  id: source?.id ?? '',
  name: source?.name ?? '',
  tiktok: source?.tiktok ?? '',
  youtube_key: '',
  quality: source?.quality ?? 'best',
  auto_start: source?.auto_start ?? false,
  preferred: source?.preferred ?? false,
  enabled: source?.enabled ?? true,
  own_stream: source?.own_stream ?? false,
  overlays: source ? clone(source.overlays) : defaultOverlays(),
});

const chatApiKey = ref('');
const idTouched = ref(source !== null);
const validationError = ref('');

const isCreate = computed(() => source === null);
const modalTitle = computed(() =>
  isCreate.value ? 'Neuer Streamer' : `Streamer bearbeiten · ${source?.name ?? ''}`,
);

const keySourceLabel = computed(() => {
  if (!source) return 'Optional';
  switch (source.youtube_key_source) {
    case 'streamer':
      return 'Im Streamer gesetzt';
    case 'env':
      return 'Aus Umgebung';
    default:
      return 'Nicht gesetzt';
  }
});

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function onNameInput(): void {
  if (isCreate.value && !idTouched.value) form.id = slugify(form.name);
}

function markIdTouched(): void {
  idTouched.value = true;
}

function buildBody(): StreamerInput {
  const chatClone = clone(form.overlays.chat);
  delete (chatClone as Partial<ChatOverlay>).api_key_set;

  const chatInput: StreamerOverlaysInput['chat'] = { ...chatClone };
  const key = chatApiKey.value.trim();
  if (key) chatInput.api_key = key;

  const overlays: StreamerOverlaysInput = {
    chat: chatInput,
    clock: clone(form.overlays.clock),
    text: clone(form.overlays.text),
  };

  const body: StreamerInput = {
    name: form.name.trim(),
    tiktok: form.tiktok.trim(),
    quality: form.quality,
    auto_start: form.auto_start,
    preferred: form.preferred,
    enabled: form.enabled,
    own_stream: form.own_stream,
    overlays,
  };

  const youtubeKey = form.youtube_key.trim();
  if (youtubeKey) body.youtube_key = youtubeKey;

  return body;
}

function submit(): void {
  validationError.value = '';
  if (!form.name.trim()) {
    validationError.value = 'Bitte einen Namen für den Streamer angeben.';
    return;
  }
  if (!form.tiktok.trim()) {
    validationError.value = 'Bitte ein TikTok-Handle oder eine URL angeben.';
    return;
  }
  if (isCreate.value) {
    const id = form.id.trim();
    if (!id) {
      validationError.value = 'Bitte eine Streamer-ID (Slug) angeben.';
      return;
    }
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
      validationError.value =
        'Die Streamer-ID darf nur Kleinbuchstaben, Zahlen, Bindestriche und Unterstriche enthalten.';
      return;
    }
  }
  emit('save', { id: form.id.trim(), body: buildBody() });
}
</script>

<template>
  <ModalDialog :open="open" :title="modalTitle" size="lg" @close="emit('close')">
    <form id="streamer-form" class="stack" @submit.prevent="submit">
      <div v-if="error || validationError" class="alert alert-error" role="alert">
        {{ validationError || error }}
      </div>

      <div class="form-grid">
        <div class="field">
          <label for="streamer-id">ID / Slug <span v-if="isCreate" class="req">*</span></label>
          <input
            id="streamer-id"
            v-model="form.id"
            type="text"
            :readonly="!isCreate"
            :disabled="!isCreate"
            placeholder="z. B. main-channel"
            spellcheck="false"
            autocomplete="off"
            @input="markIdTouched"
          />
          <p class="field-hint">
            {{ isCreate ? 'Kleinbuchstaben, Zahlen, - und _. Wird als eindeutige ID verwendet.' : 'Die ID kann nach dem Anlegen nicht geändert werden.' }}
          </p>
        </div>

        <div class="field">
          <label for="streamer-name">Name <span class="req">*</span></label>
          <input
            id="streamer-name"
            v-model="form.name"
            type="text"
            placeholder="Anzeigename"
            autocomplete="off"
            @input="onNameInput"
          />
        </div>

        <div class="field">
          <label for="streamer-tiktok">TikTok-Handle oder URL <span class="req">*</span></label>
          <input
            id="streamer-tiktok"
            v-model="form.tiktok"
            type="text"
            placeholder="@username oder https://tiktok.com/@username/live"
            spellcheck="false"
            autocomplete="off"
          />
        </div>

        <div class="field">
          <label for="streamer-key">YouTube-Stream-Key</label>
          <div class="input-badge-row">
            <input
              id="streamer-key"
              v-model="form.youtube_key"
              type="password"
              placeholder="Leer lassen = bestehenden Key behalten"
              autocomplete="new-password"
            />
            <span v-if="streamer?.youtube_key_set" class="badge tone-success">Key gesetzt</span>
          </div>
          <p class="field-hint">
            {{ keySourceLabel }}
            <template v-if="!isCreate && streamer?.youtube_key_set">
              · Leer lassen, um den bestehenden Key zu behalten.
            </template>
          </p>
        </div>

        <div class="field">
          <label for="streamer-quality">Qualität</label>
          <select id="streamer-quality" v-model="form.quality">
            <option v-for="option in QUALITY_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <div class="field field-span-2">
          <span class="field-label">Optionen</span>
          <div class="checkbox-grid">
            <label class="checkbox">
              <input v-model="form.enabled" type="checkbox" />
              <span>Aktiviert</span>
            </label>
            <label class="checkbox">
              <input v-model="form.auto_start" type="checkbox" />
              <span>Automatisch starten</span>
            </label>
            <label class="checkbox">
              <input v-model="form.preferred" type="checkbox" />
              <span>Bevorzugt</span>
            </label>
            <label class="checkbox">
              <input v-model="form.own_stream" type="checkbox" />
              <span>Eigener Stream</span>
            </label>
          </div>
        </div>
      </div>

      <section class="editor-section">
        <h3 class="editor-title">Overlays</h3>
        <p class="editor-desc">Overlays werden in den YouTube-Stream eingebettet.</p>

        <div class="overlay-editor">
          <div class="overlay-head">
            <ToggleField v-model="form.overlays.chat.enabled" label="Chat-Overlay" description="TikTok-Chat als eingeblendete Nachrichten" />
            <span v-if="streamer?.overlays.chat.api_key_set" class="badge tone-neutral">API-Key gesetzt</span>
          </div>
          <div v-if="form.overlays.chat.enabled" class="overlay-body">
            <div class="form-grid">
              <div class="field">
                <label for="chat-api-url">Chat-API-URL</label>
                <input
                  id="chat-api-url"
                  v-model="form.overlays.chat.api_url"
                  type="url"
                  placeholder="https://api.example.com/chat"
                  spellcheck="false"
                />
              </div>
              <div class="field">
                <label for="chat-max-lines">Maximale Nachrichten</label>
                <input id="chat-max-lines" v-model.number="form.overlays.chat.max_lines" type="number" min="1" max="30" />
              </div>
              <div class="field">
                <label for="chat-engine">Chat-Engine</label>
                <select id="chat-engine" v-model="form.overlays.chat.engine">
                  <option value="canvas">Canvas (Bubbles, Emoji)</option>
                  <option value="drawtext">drawtext (leichtgewichtig)</option>
                </select>
              </div>
              <div class="field">
                <label for="chat-style">Stil</label>
                <select id="chat-style" v-model="form.overlays.chat.style">
                  <option value="bubbles">Bubbles</option>
                  <option value="minimal">Minimal</option>
                </select>
              </div>
            </div>
            <details class="advanced">
              <summary>Erweitert</summary>
              <div class="form-grid">
                <div class="field">
                  <label for="chat-position">Position</label>
                  <select id="chat-position" v-model="form.overlays.chat.position">
                    <option v-for="position in POSITIONS" :key="position.value" :value="position.value">
                      {{ position.label }}
                    </option>
                  </select>
                </div>
                <div class="field">
                  <label for="chat-render-fps">Render-FPS (Canvas)</label>
                  <input id="chat-render-fps" v-model.number="form.overlays.chat.render_fps" type="number" min="1" max="30" />
                </div>
                <div class="field">
                  <label for="chat-panel-width">Panelbreite (0 = automatisch)</label>
                  <input id="chat-panel-width" v-model.number="form.overlays.chat.panel_width" type="number" min="0" max="1920" />
                </div>
                <div class="field">
                  <label for="chat-opacity">Bubble-Deckkraft</label>
                  <input id="chat-opacity" v-model.number="form.overlays.chat.bubble_opacity" type="number" min="0" max="1" step="0.05" />
                </div>
                <div class="field checkbox-grid">
                  <label class="checkbox">
                    <input v-model="form.overlays.chat.show_timestamps" type="checkbox" />
                    Zeit anzeigen
                  </label>
                  <label class="checkbox">
                    <input v-model="form.overlays.chat.show_badges" type="checkbox" />
                    Badges anzeigen
                  </label>
                </div>
                <div class="field">
                  <label for="chat-key">API-Key</label>
                  <input
                    id="chat-key"
                    v-model="chatApiKey"
                    type="password"
                    :placeholder="streamer?.overlays.chat.api_key_set ? 'Leer lassen = behalten' : 'Optional'"
                    autocomplete="new-password"
                  />
                </div>
                <div class="field">
                  <label for="chat-poll">Poll-Intervall (s)</label>
                  <input id="chat-poll" v-model.number="form.overlays.chat.poll_interval" type="number" min="1" max="60" />
                </div>
                <div class="field">
                  <label for="chat-delay">Verzögerung (s)</label>
                  <input id="chat-delay" v-model.number="form.overlays.chat.delay" type="number" min="0" max="300" />
                </div>
                <div class="field">
                  <label for="chat-font-size">Schriftgröße (px)</label>
                  <input id="chat-font-size" v-model.number="form.overlays.chat.font_size" type="number" min="8" max="96" />
                </div>
                <div class="field field-inline-colors">
                  <div class="field">
                    <label for="chat-font-color">Schriftfarbe</label>
                    <input
                      id="chat-font-color"
                      v-model="form.overlays.chat.font_color"
                      type="text"
                      placeholder="#ffffff oder white"
                      spellcheck="false"
                    />
                  </div>
                  <div class="field">
                    <label for="chat-box-color">Boxfarbe</label>
                    <input
                      id="chat-box-color"
                      v-model="form.overlays.chat.box_color"
                      type="text"
                      placeholder="#000000@0.45"
                      spellcheck="false"
                    />
                  </div>
                </div>
              </div>
            </details>
          </div>
        </div>

        <div class="overlay-editor">
          <div class="overlay-head">
            <ToggleField v-model="form.overlays.clock.enabled" label="Uhr-Overlay" description="Aktuelle Uhrzeit im Stream anzeigen" />
          </div>
          <div v-if="form.overlays.clock.enabled" class="overlay-body">
            <div class="form-grid">
              <div class="field">
                <label for="clock-format">Format</label>
                <input id="clock-format" v-model="form.overlays.clock.format" type="text" placeholder="%H:%M" />
                <p class="field-hint">FFmpeg localtime, z. B. %H:%M oder %H:%M:%S</p>
              </div>
              <div class="field">
                <label for="clock-position">Position</label>
                <select id="clock-position" v-model="form.overlays.clock.position">
                  <option v-for="position in POSITIONS" :key="position.value" :value="position.value">
                    {{ position.label }}
                  </option>
                </select>
              </div>
            </div>
            <details class="advanced">
              <summary>Darstellung</summary>
              <div class="form-grid">
                <div class="field">
                  <label for="clock-font-size">Schriftgröße (px)</label>
                  <input id="clock-font-size" v-model.number="form.overlays.clock.font_size" type="number" min="8" max="96" />
                </div>
                <div class="field field-inline-colors">
                  <div class="field">
                    <label for="clock-font-color">Schriftfarbe</label>
                    <input
                      id="clock-font-color"
                      v-model="form.overlays.clock.font_color"
                      type="text"
                      placeholder="#ffffff oder white"
                      spellcheck="false"
                    />
                  </div>
                  <div class="field">
                    <label for="clock-box-color">Boxfarbe</label>
                    <input
                      id="clock-box-color"
                      v-model="form.overlays.clock.box_color"
                      type="text"
                      placeholder="#000000@0.45"
                      spellcheck="false"
                    />
                  </div>
                </div>
              </div>
            </details>
          </div>
        </div>

        <div class="overlay-editor">
          <div class="overlay-head">
            <ToggleField v-model="form.overlays.text.enabled" label="Text-Overlay" description="Freier Text oder Laufschrift" />
          </div>
          <div v-if="form.overlays.text.enabled" class="overlay-body">
            <div class="field">
              <label for="text-content">Text</label>
              <input id="text-content" v-model="form.overlays.text.text" type="text" placeholder="Mein Overlay-Text" />
            </div>
            <div class="form-grid">
              <div class="field">
                <label for="text-position">Position</label>
                <select id="text-position" v-model="form.overlays.text.position">
                  <option v-for="position in POSITIONS" :key="position.value" :value="position.value">
                    {{ position.label }}
                  </option>
                </select>
              </div>
              <div class="field">
                <span class="field-label">Laufschrift</span>
                <label class="checkbox checkbox-tall">
                  <input v-model="form.overlays.text.marquee" type="checkbox" />
                  <span>Text horizontal durchlaufen lassen</span>
                </label>
              </div>
              <div v-if="form.overlays.text.marquee" class="field">
                <label for="text-speed">Geschwindigkeit (px/s)</label>
                <input id="text-speed" v-model.number="form.overlays.text.speed" type="number" min="10" max="1000" />
              </div>
            </div>
            <details class="advanced">
              <summary>Darstellung</summary>
              <div class="form-grid">
                <div class="field">
                  <label for="text-font-size">Schriftgröße (px)</label>
                  <input id="text-font-size" v-model.number="form.overlays.text.font_size" type="number" min="8" max="96" />
                </div>
                <div class="field field-inline-colors">
                  <div class="field">
                    <label for="text-font-color">Schriftfarbe</label>
                    <input
                      id="text-font-color"
                      v-model="form.overlays.text.font_color"
                      type="text"
                      placeholder="#ffffff oder white"
                      spellcheck="false"
                    />
                  </div>
                  <div class="field">
                    <label for="text-box-color">Boxfarbe</label>
                    <input
                      id="text-box-color"
                      v-model="form.overlays.text.box_color"
                      type="text"
                      placeholder="#000000@0.45"
                      spellcheck="false"
                    />
                  </div>
                </div>
              </div>
            </details>
          </div>
        </div>
      </section>
    </form>

    <template #footer>
      <button type="button" class="btn btn-ghost" :disabled="saving" @click="emit('close')">
        Abbrechen
      </button>
      <button type="submit" form="streamer-form" class="btn btn-primary" :disabled="saving">
        <span v-if="saving" class="spinner" aria-hidden="true"></span>
        {{ saving ? 'Speichern…' : isCreate ? 'Streamer anlegen' : 'Änderungen speichern' }}
      </button>
    </template>
  </ModalDialog>
</template>
