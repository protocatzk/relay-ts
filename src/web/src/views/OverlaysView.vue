<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type {
  ChatOverlay,
  ClockOverlay,
  OverlayPosition,
  Settings,
  StreamerOverlays,
  StreamerOverlaysInput,
  TextOverlay,
} from '@/src/api/types';
import ColorInput from '@/src/components/ColorInput.vue';
import ToggleField from '@/src/components/ToggleField.vue';
import { useStore } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';

type Section = 'chat' | 'clock' | 'text' | 'earnings';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'clock', label: 'Uhrzeit' },
  { id: 'text', label: 'Text' },
  { id: 'earnings', label: 'Einnahmen' },
];

const POSITIONS: { value: OverlayPosition; label: string }[] = [
  { value: 'top-left', label: 'Oben links' },
  { value: 'top-right', label: 'Oben rechts' },
  { value: 'bottom-left', label: 'Unten links' },
  { value: 'bottom-right', label: 'Unten rechts' },
];

const { store, refreshStatus } = useStore();
const { pushToast } = useToast();

const loading = ref(true);
const loadError = ref('');
const saving = ref(false);
const draft = ref<StreamerOverlays | null>(null);
const settings = ref<Settings | null>(null);
const activeSection = ref<Section>('chat');
const sample = ref(true);
const previewUrl = ref('');
const previewError = ref('');
const previewLoading = ref(false);
const sendingTest = ref(false);
const chatTest = reactive({ username: 'Testuser', text: 'Das Overlay sieht gut aus! 🔥' });
let initialSnapshot = '';
let previewTimer: number | null = null;
let previewController: AbortController | null = null;
let previewObjectUrl = '';

const chatStatus = computed(() => store.status?.chat ?? null);
const chat = computed(() => draft.value?.chat ?? null);
const clock = computed(() => draft.value?.clock ?? null);
const text = computed(() => draft.value?.text ?? null);
const earnings = computed(() => settings.value?.earnings ?? null);
const resolution = computed(() => settings.value?.video.resolution ?? '720x1280');
const dirty = computed(
  () => Boolean(draft.value) && JSON.stringify(draft.value) !== initialSnapshot,
);

const activeConfig = computed<ChatOverlay | ClockOverlay | TextOverlay | null>(() => {
  if (activeSection.value === 'chat') return chat.value;
  if (activeSection.value === 'clock') return clock.value;
  if (activeSection.value === 'text') return text.value;
  return null;
});
const activePosition = computed(() => activeConfig.value?.position ?? null);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function overlaysInput(): StreamerOverlaysInput {
  const current = draft.value!;
  const chatClone = clone(current.chat);
  delete (chatClone as Partial<ChatOverlay>).api_key_set;
  return {
    chat: chatClone,
    clock: clone(current.clock),
    text: clone(current.text),
  };
}

async function renderPreview(): Promise<void> {
  if (!draft.value) return;
  previewController?.abort();
  const controller = new AbortController();
  previewController = controller;
  previewLoading.value = true;
  try {
    const blob = await api.overlays.studioPreview(
      {
        overlays: overlaysInput(),
        sample: sample.value,
        max_dimension: 720,
      },
      controller.signal,
    );
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(blob);
    previewUrl.value = previewObjectUrl;
    previewError.value = '';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    previewError.value = errorMessage(error);
  } finally {
    if (previewController === controller) previewLoading.value = false;
  }
}

function schedulePreview(immediate = false): void {
  if (previewTimer !== null) window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    previewTimer = null;
    void renderPreview();
  }, immediate ? 0 : 220);
}

function resetDraft(): void {
  const current = settings.value;
  if (!current) return;
  draft.value = clone(current.overlays);
  initialSnapshot = JSON.stringify(draft.value);
  pushToast('Änderungen verworfen.', 'info');
  schedulePreview(true);
}

function setPosition(position: OverlayPosition): void {
  const config = activeConfig.value;
  if (config) config.position = position;
}

async function save(): Promise<void> {
  if (!draft.value) return;
  saving.value = true;
  try {
    const saved = await api.overlays.save(overlaysInput());
    settings.value = saved;
    draft.value = clone(saved.overlays);
    initialSnapshot = JSON.stringify(draft.value);
    await refreshStatus();
    pushToast('Globale Overlay-Einstellungen gespeichert.', 'success');
    schedulePreview(true);
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    saving.value = false;
  }
}

async function sendTest(): Promise<void> {
  if (!chatTest.text.trim()) return;
  sendingTest.value = true;
  try {
    await api.chat.test(chatTest.username.trim() || 'Testuser', chatTest.text.trim());
    await refreshStatus();
    schedulePreview(true);
    pushToast('Testnachricht an den aktiven Stream gesendet.', 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    sendingTest.value = false;
  }
}

watch(draft, () => schedulePreview(), { deep: true });
watch(sample, () => schedulePreview(true));

onMounted(async () => {
  loading.value = true;
  try {
    await refreshStatus().catch(() => undefined);
    settings.value = await api.settings.get();
    draft.value = clone(settings.value.overlays);
    initialSnapshot = JSON.stringify(draft.value);
    schedulePreview(true);
  } catch (error) {
    loadError.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  if (previewTimer !== null) window.clearTimeout(previewTimer);
  previewController?.abort();
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Overlay-Studio</h1>
        <p class="page-sub">Globale Overlays für alle Streamer gestalten, prüfen und speichern.</p>
      </div>
      <div class="page-actions">
        <span class="badge tone-info">Global</span>
        <span v-if="dirty" class="badge tone-warning">Ungespeichert</span>
        <button type="button" class="btn btn-ghost" :disabled="!dirty || saving" @click="resetDraft">
          Verwerfen
        </button>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="!draft || !dirty || saving"
          @click="save"
        >
          <span v-if="saving" class="spinner" aria-hidden="true"></span>
          Speichern
        </button>
      </div>
    </div>

    <div v-if="loading" class="card empty">
      <span class="spinner spinner-lg" aria-hidden="true"></span>
      <p>Overlay-Studio wird geladen…</p>
    </div>

    <div v-else-if="loadError" class="alert alert-error" role="alert">{{ loadError }}</div>

    <div v-else-if="draft" class="overlay-studio-layout">
      <section class="card overlay-preview-card">
        <div class="card-head">
          <div>
            <h2 class="card-title">Live-Vorschau</h2>
            <p class="card-sub">Gilt für alle Streamer · {{ resolution }}</p>
          </div>
          <div class="studio-preview-tools">
            <label class="checkbox">
              <input v-model="sample" type="checkbox" />
              Beispielnachrichten
            </label>
            <span v-if="previewLoading" class="badge tone-info">Rendert…</span>
          </div>
        </div>

        <div class="overlay-preview-stage studio-stage">
          <img v-if="previewUrl" :src="previewUrl" alt="Overlay-Vorschau" />
          <div v-else class="studio-preview-empty">
            <span class="spinner" aria-hidden="true"></span>
            Vorschau wird gerendert…
          </div>
          <div v-if="activeConfig" class="studio-hotzones" aria-label="Overlay-Position">
            <button
              v-for="position in POSITIONS"
              :key="position.value"
              type="button"
              class="studio-hotzone"
              :class="[`is-${position.value}`, { 'is-active': activePosition === position.value }]"
              :aria-label="position.label"
              @click="setPosition(position.value)"
            >
              <span>{{ position.label }}</span>
            </button>
          </div>
          <p v-if="previewError" class="studio-preview-error">{{ previewError }}</p>
        </div>

        <div class="studio-preview-foot">
          <p class="muted small">
            Klick auf eine Ecke setzt die Position des aktiven Overlays. Die Vorschau wird aus den
            ungespeicherten Einstellungen serverseitig mit TypeScript-Canvas gerendert.
          </p>
          <span v-if="chatStatus?.canvas_active" class="badge tone-success">Canvas live</span>
          <span v-else class="badge tone-neutral">Canvas inaktiv</span>
        </div>
      </section>

      <section class="card overlay-settings-card">
        <div class="studio-tabs" role="tablist" aria-label="Overlay-Bereich">
          <button
            v-for="section in SECTIONS"
            :key="section.id"
            type="button"
            role="tab"
            class="studio-tab"
            :class="{ 'is-active': activeSection === section.id }"
            :aria-selected="activeSection === section.id"
            @click="activeSection = section.id"
          >
            {{ section.label }}
            <span
              v-if="
                (section.id === 'chat' && chat?.enabled) ||
                (section.id === 'clock' && clock?.enabled) ||
                (section.id === 'text' && text?.enabled) ||
                (section.id === 'earnings' && earnings?.overlay_enabled)
              "
              class="studio-tab-dot"
              aria-hidden="true"
            ></span>
          </button>
        </div>

        <div v-if="activeSection === 'chat' && chat" class="studio-body">
          <ToggleField
            v-model="chat.enabled"
            label="Chat-Overlay"
            description="TikTok-Chat als Bubbles oder Panel im Stream."
          />
          <div class="studio-grid">
            <div class="field">
              <label for="studio-chat-engine">Engine</label>
              <select id="studio-chat-engine" v-model="chat.engine">
                <option value="canvas">Canvas (Bubbles, Emoji, Stats)</option>
                <option value="drawtext">drawtext (leichtgewichtig)</option>
              </select>
            </div>
            <div class="field">
              <label for="studio-chat-style">Stil</label>
              <select id="studio-chat-style" v-model="chat.style">
                <option value="bubbles">Bubbles</option>
                <option value="panel">Panel</option>
                <option value="minimal">Minimal</option>
              </select>
            </div>
            <div class="field">
              <label for="studio-chat-position">Position</label>
              <select id="studio-chat-position" v-model="chat.position">
                <option v-for="position in POSITIONS" :key="position.value" :value="position.value">
                  {{ position.label }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="studio-chat-font-size">Schriftgröße (px)</label>
              <input id="studio-chat-font-size" v-model.number="chat.font_size" type="number" min="8" max="96" />
            </div>
          </div>

          <div class="studio-subhead">Layout</div>
          <div class="studio-grid">
            <div class="field">
              <label for="studio-chat-lines">Sichtbare Nachrichten</label>
              <input id="studio-chat-lines" v-model.number="chat.max_lines" type="number" min="1" max="30" />
            </div>
            <div class="field">
              <label for="studio-chat-messages">Max. Nachrichten im Puffer</label>
              <input id="studio-chat-messages" v-model.number="chat.max_messages" type="number" min="1" max="100" />
            </div>
            <div class="field">
              <label for="studio-chat-age">Max. Alter (Sekunden, 0 = aus)</label>
              <input id="studio-chat-age" v-model.number="chat.max_age_seconds" type="number" min="0" max="3600" />
            </div>
            <div class="field">
              <label for="studio-chat-panel-width">Panelbreite (0 = auto)</label>
              <input id="studio-chat-panel-width" v-model.number="chat.panel_width" type="number" min="0" max="1920" />
            </div>
            <div class="field">
              <label for="studio-chat-panel-height">Panelhöhe (0 = auto)</label>
              <input id="studio-chat-panel-height" v-model.number="chat.panel_height" type="number" min="0" max="1920" />
            </div>
            <div class="field">
              <label for="studio-chat-fps">Render-FPS</label>
              <input id="studio-chat-fps" v-model.number="chat.render_fps" type="number" min="1" max="30" />
            </div>
            <div class="field">
              <label for="studio-chat-opacity">Deckkraft ({{ Math.round(chat.bubble_opacity * 100) }} %)</label>
              <input
                id="studio-chat-opacity"
                v-model.number="chat.bubble_opacity"
                type="range"
                min="0"
                max="1"
                step="0.05"
              />
            </div>
          </div>

          <div class="studio-subhead">Darstellung</div>
          <div class="studio-grid">
            <div class="field">
              <label for="studio-chat-font-color">Schriftfarbe</label>
              <ColorInput id="studio-chat-font-color" v-model="chat.font_color" />
            </div>
            <div class="field">
              <label for="studio-chat-box-color">Boxfarbe</label>
              <ColorInput id="studio-chat-box-color" v-model="chat.box_color" alpha />
            </div>
          </div>
          <div class="checkbox-grid studio-checks">
            <label class="checkbox"><input v-model="chat.show_timestamps" type="checkbox" /> Zeitstempel</label>
            <label class="checkbox"><input v-model="chat.show_badges" type="checkbox" /> Badges</label>
            <label class="checkbox"><input v-model="chat.show_tiers" type="checkbox" /> Tier-Badges</label>
            <label class="checkbox"><input v-model="chat.show_stats" type="checkbox" /> Chat-Statistik</label>
            <label class="checkbox"><input v-model="chat.name_colors" type="checkbox" /> Namensfarben</label>
          </div>

          <div class="studio-subhead">Quelle</div>
          <div class="studio-grid">
            <div class="field">
              <label for="studio-chat-api">Chat-API-URL</label>
              <input id="studio-chat-api" v-model="chat.api_url" type="url" spellcheck="false" placeholder="https://…/chat-logs" />
            </div>
            <div class="field">
              <label for="studio-chat-poll">Poll-Intervall (s)</label>
              <input id="studio-chat-poll" v-model.number="chat.poll_interval" type="number" min="1" max="60" />
            </div>
            <div class="field">
              <label for="studio-chat-delay">Verzögerung (s)</label>
              <input id="studio-chat-delay" v-model.number="chat.delay" type="number" min="0" max="300" />
            </div>
          </div>
          <p class="field-hint">
            Der API-Key wird aus Sicherheitsgründen im Streamer-Editor oder in den Einstellungen gepflegt.
            <RouterLink to="/settings">Zu den Einstellungen</RouterLink>
          </p>

          <div class="studio-subhead">Testnachricht</div>
          <form class="studio-test-form" @submit.prevent="sendTest">
            <div class="field">
              <label for="studio-test-user">Benutzername</label>
              <input id="studio-test-user" v-model="chatTest.username" type="text" maxlength="40" />
            </div>
            <div class="field">
              <label for="studio-test-text">Nachricht</label>
              <input id="studio-test-text" v-model="chatTest.text" type="text" maxlength="300" />
            </div>
            <button type="submit" class="btn btn-secondary" :disabled="sendingTest || !chatTest.text.trim()">
              <span v-if="sendingTest" class="spinner" aria-hidden="true"></span>
              Senden
            </button>
          </form>
          <p class="field-hint">Sendet an den aktiven Stream, nicht an die Studio-Vorschau.</p>
        </div>

        <div v-else-if="activeSection === 'clock' && clock" class="studio-body">
          <ToggleField
            v-model="clock.enabled"
            label="Uhr-Overlay"
            description="Aktuelle Uhrzeit direkt von ffmpeg gerendert."
          />
          <div class="studio-grid">
            <div class="field">
              <label for="studio-clock-format">Format</label>
              <select id="studio-clock-format" v-model="clock.format">
                <option value="%H:%M">HH:MM</option>
                <option value="%H:%M:%S">HH:MM:SS</option>
              </select>
            </div>
            <div class="field">
              <label for="studio-clock-position">Position</label>
              <select id="studio-clock-position" v-model="clock.position">
                <option v-for="position in POSITIONS" :key="position.value" :value="position.value">
                  {{ position.label }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="studio-clock-size">Schriftgröße (px)</label>
              <input id="studio-clock-size" v-model.number="clock.font_size" type="number" min="8" max="96" />
            </div>
            <div class="field">
              <label for="studio-clock-margin">Rand (px)</label>
              <input id="studio-clock-margin" v-model.number="clock.margin" type="number" min="0" max="200" />
            </div>
            <div class="field">
              <label for="studio-clock-font-color">Schriftfarbe</label>
              <ColorInput id="studio-clock-font-color" v-model="clock.font_color" />
            </div>
            <div class="field">
              <label for="studio-clock-box-color">Boxfarbe</label>
              <ColorInput id="studio-clock-box-color" v-model="clock.box_color" alpha />
            </div>
          </div>
          <label class="checkbox studio-checks">
            <input v-model="clock.show_box" type="checkbox" /> Hintergrundbox anzeigen
          </label>
        </div>

        <div v-else-if="activeSection === 'text' && text" class="studio-body">
          <ToggleField
            v-model="text.enabled"
            label="Text-Overlay"
            description="Freier Text oder automatische Laufschrift."
          />
          <div class="field">
            <label for="studio-text-content">Text</label>
            <input id="studio-text-content" v-model="text.text" type="text" maxlength="500" />
          </div>
          <div class="studio-grid">
            <div class="field">
              <label for="studio-text-position">Position</label>
              <select id="studio-text-position" v-model="text.position">
                <option v-for="position in POSITIONS" :key="position.value" :value="position.value">
                  {{ position.label }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="studio-text-size">Schriftgröße (px)</label>
              <input id="studio-text-size" v-model.number="text.font_size" type="number" min="8" max="96" />
            </div>
            <div class="field">
              <label for="studio-text-margin">Rand (px)</label>
              <input id="studio-text-margin" v-model.number="text.margin" type="number" min="0" max="200" />
            </div>
            <div class="field">
              <label for="studio-text-speed">Geschwindigkeit (px/s)</label>
              <input id="studio-text-speed" v-model.number="text.speed" type="number" min="10" max="1000" :disabled="!text.marquee" />
            </div>
            <div class="field">
              <label for="studio-text-font-color">Schriftfarbe</label>
              <ColorInput id="studio-text-font-color" v-model="text.font_color" />
            </div>
            <div class="field">
              <label for="studio-text-box-color">Boxfarbe</label>
              <ColorInput id="studio-text-box-color" v-model="text.box_color" alpha />
            </div>
          </div>
          <div class="checkbox-grid studio-checks">
            <label class="checkbox"><input v-model="text.marquee" type="checkbox" /> Laufschrift</label>
            <label class="checkbox"><input v-model="text.show_box" type="checkbox" /> Hintergrundbox anzeigen</label>
          </div>
        </div>

        <div v-else-if="activeSection === 'earnings' && earnings" class="studio-body">
          <div class="alert alert-info">
            Einnahmen-Overlays gelten global und werden in den Einstellungen persistiert.
          </div>
          <dl class="settings-summary">
            <div><dt>Status</dt><dd>{{ earnings.enabled ? 'Aktiv' : 'Aus' }}</dd></div>
            <div><dt>Im Stream</dt><dd>{{ earnings.overlay_enabled ? 'An' : 'Aus' }}</dd></div>
            <div><dt>Position</dt><dd>{{ earnings.overlay_position }}</dd></div>
            <div><dt>Template</dt><dd class="mono">{{ earnings.overlay_template }}</dd></div>
            <div><dt>Schriftgröße</dt><dd>{{ earnings.overlay_font_size }} px</dd></div>
          </dl>
          <RouterLink to="/settings" class="btn btn-secondary">Einnahmen bearbeiten</RouterLink>
        </div>
      </section>
    </div>
  </div>
</template>
