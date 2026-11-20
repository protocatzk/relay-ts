<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type {
  ChatOverlay,
  ClockOverlay,
  OverlayPosition,
  Settings,
  SettingsUpdate,
  StreamerOverlays,
  StreamerOverlaysInput,
  TextOverlay,
  VideoLayout,
} from '@/src/api/types';
import ColorInput from '@/src/components/ColorInput.vue';
import OverlayStudioPreview from '@/src/components/OverlayStudioPreview.vue';
import StudioGroup from '@/src/components/StudioGroup.vue';
import ToggleField from '@/src/components/ToggleField.vue';
import { useMediaQuery } from '@/src/composables/useMediaQuery';
import { useStore } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';
import { useUnsavedChanges } from '@/src/composables/useUnsavedChanges';
import { POSITIONS, PREVIEW_ASPECTS, SECTIONS } from '@/src/overlay-studio';
import type { OverlayGeometry, PreviewAspect, Section } from '@/src/overlay-studio';


const { store, refreshStatus } = useStore();
const { pushToast } = useToast();

const loading = ref(true);
const loadError = ref('');
const saving = ref(false);
const draft = ref<StreamerOverlays | null>(null);
const settings = ref<Settings | null>(null);
const settingsBaseline = ref<Settings | null>(null);
const activeSection = ref<Section>('chat');
const previewAspect = ref<PreviewAspect>('9:16');
const sample = ref(true);
const previewUrl = ref('');
const previewError = ref('');
const sendingTest = ref(false);
const positioning = ref(false);
const compact = useMediaQuery('(max-width: 1100px)');
const previewCollapsed = ref(false);
const history = ref<string[]>([]);
const historyIndex = ref(-1);
const canUndo = computed(() => historyIndex.value > 0);
const canRedo = computed(() => historyIndex.value < history.value.length - 1);
const groupState = reactive<Record<string, boolean>>({});
let historyTimer: number | null = null;
const chatTest = reactive({ username: 'Testuser', text: 'Das Overlay sieht gut aus! 🔥' });
let initialSnapshot = '';
let initialEarningsSnapshot = '';
let initialLayoutSnapshot = '';
let previewTimer: number | null = null;
let previewController: AbortController | null = null;
let previewObjectUrl = '';

const chatStatus = computed(() => store.status?.chat ?? null);
const chat = computed(() => draft.value?.chat ?? null);
const clock = computed(() => draft.value?.clock ?? null);
const text = computed(() => draft.value?.text ?? null);
const logo = computed(() => draft.value?.logo ?? null);
const earnings = computed(() => settings.value?.earnings ?? null);
const videoLayout = computed<VideoLayout | null>(() => settings.value?.video.layout ?? null);
const resolution = computed(() => settings.value?.video.resolution ?? '720x1280');
const dirty = computed(
  () =>
    Boolean(draft.value) &&
    (JSON.stringify(draft.value) !== initialSnapshot ||
      JSON.stringify(settings.value?.earnings) !== initialEarningsSnapshot ||
      JSON.stringify(settings.value?.video.layout) !== initialLayoutSnapshot),
);

useUnsavedChanges(dirty, {
  message:
    'Du hast ungespeicherte Änderungen im Overlay-Studio. Möchtest du sie verwerfen und die Seite verlassen?',
});

const tabRefs = ref<Partial<Record<Section, HTMLButtonElement | null>>>({});
const activeTabAnnouncement = ref('');

function setTabRef(id: Section, el: unknown): void {
  tabRefs.value[id] = el instanceof HTMLButtonElement ? el : null;
}

function studioTabId(id: Section): string {
  return `studio-tab-${id}`;
}

function studioPanelId(id: Section): string {
  return `studio-panel-${id}`;
}

function selectSection(id: Section, options: { focus?: boolean; announce?: boolean } = {}): void {
  activeSection.value = id;
  if (options.announce !== false) {
    const label = SECTIONS.find((entry) => entry.id === id)?.label ?? id;
    activeTabAnnouncement.value = `Bereich ${label} ausgewählt`;
  }
  if (options.focus) {
    const target = tabRefs.value[id];
    target?.focus();
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function onTabKeydown(event: KeyboardEvent): void {
  const currentIndex = SECTIONS.findIndex((entry) => entry.id === activeSection.value);
  if (currentIndex === -1) return;
  let nextIndex: number | null = null;
  if (event.key === 'ArrowRight') {
    nextIndex = (currentIndex + 1) % SECTIONS.length;
  } else if (event.key === 'ArrowLeft') {
    nextIndex = (currentIndex - 1 + SECTIONS.length) % SECTIONS.length;
  } else if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = SECTIONS.length - 1;
  }
  if (nextIndex === null) return;
  event.preventDefault();
  const target = SECTIONS[nextIndex];
  if (target) selectSection(target.id, { focus: true, announce: true });
}

const activeConfig = computed<ChatOverlay | ClockOverlay | TextOverlay | null>(() => {
  if (activeSection.value === 'chat') return chat.value;
  if (activeSection.value === 'clock') return clock.value;
  if (activeSection.value === 'text') return text.value;
  return null;
});

const activeGeometry = computed<OverlayGeometry | null>(() => {
  if (activeSection.value === 'earnings') {
    const config = earnings.value;
    if (!config) return null;
    return {
      position: config.overlay_position,
      font_size: config.overlay_font_size,
      offset_x: config.overlay_offset_x,
      offset_y: config.overlay_offset_y,
      margin: config.overlay_margin,
    };
  }
  if (activeSection.value === 'logo') {
    const config = logo.value;
    if (!config) return null;
    return {
      position: config.position,
      font_size: config.width,
      offset_x: config.offset_x,
      offset_y: config.offset_y,
      margin: config.margin,
      width: config.width,
    };
  }
  const config = activeConfig.value as ChatOverlay | ClockOverlay | TextOverlay | null;
  if (!config) return null;
  return {
    position: config.position,
    font_size: config.font_size,
    offset_x: config.offset_x,
    offset_y: config.offset_y,
    margin: overlayMargin(config),
  };
});

const overlayLabel = computed(() => {
  const section = activeSection.value;
  if (section === 'logo') return `Logo · ${logo.value?.width ?? 0} px`;
  if (section === 'earnings') return `Einnahmen · ${earnings.value?.overlay_font_size ?? 0} px`;
  const config = activeConfig.value;
  if (!config) return 'Overlay';
  const label = SECTIONS.find((entry) => entry.id === section)?.label ?? 'Overlay';
  return `${label} · ${config.font_size} px`;
});

function groupOpen(section: Section, id: string, index: number): boolean {
  const value = groupState[`${section}:${id}`];
  return value === undefined ? !compact.value || index === 0 : value;
}

function setGroupOpen(section: Section, id: string, open: boolean): void {
  groupState[`${section}:${id}`] = open;
}

function commitDrag(): void {
  pushHistory();
}

function togglePreviewCollapsed(value: boolean): void {
  previewCollapsed.value = value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function overlayMargin(config: ChatOverlay | ClockOverlay | TextOverlay): number {
  return 'margin' in config ? config.margin : 32;
}

const stageBoxStyle = computed<Record<string, string>>((): Record<string, string> => {
  const geometry = activeGeometry.value;
  if (!geometry) return {};
  const [width, height] = resolution.value.split('x').map(Number) as [number, number];
  const chatConfig = activeSection.value === 'chat' ? chat.value : null;
  const earningsConfig = activeSection.value === 'earnings' ? earnings.value : null;
  const logoConfig = activeSection.value === 'logo' ? logo.value : null;
  let boxWidth: number;
  if (logoConfig) {
    boxWidth = logoConfig.width;
  } else if (chatConfig) {
    boxWidth =
      chatConfig.panel_width > 0
        ? chatConfig.panel_width
        : Math.round(width * (width >= height ? 0.6 : 0.92));
  } else if (earningsConfig) {
    boxWidth = Math.round(width * 0.45);
  } else {
    boxWidth = Math.round(width * 0.5);
  }
  const earningsLines = earningsConfig
    ? Math.max(1, earningsConfig.overlay_template.replace(/\r\n?/g, '\n').split('\n').length)
    : 1;
  let boxHeight: number;
  if (logoConfig) {
    boxHeight = logoConfig.width;
  } else if (chatConfig) {
    boxHeight =
      chatConfig.panel_height > 0 ? chatConfig.panel_height : Math.round(height * 0.34);
  } else {
    boxHeight = Math.round(geometry.font_size * 1.8 * earningsLines);
  }
  const baseX = geometry.position.endsWith('left')
    ? geometry.margin
    : width - boxWidth - geometry.margin;
  const baseY = geometry.position.startsWith('top')
    ? geometry.margin
    : height - boxHeight - geometry.margin;
  const x = baseX + geometry.offset_x;
  const y = baseY + geometry.offset_y;
  return {
    left: `${(x / width) * 100}%`,
    top: `${(y / height) * 100}%`,
    width: `${(boxWidth / width) * 100}%`,
    height: `${(boxHeight / height) * 100}%`,
  };
});

function setVideoLayout(patch: Partial<VideoLayout>): void {
  const layout = videoLayout.value;
  if (!layout) return;
  Object.assign(layout, patch);
}

function resetVideoLayout(): void {
  setVideoLayout({ enabled: true, scale: 100, position_x: 50, position_y: 50 });
}

function setGeometry(patch: Partial<OverlayGeometry>): void {
  if (activeSection.value === 'earnings') {
    const config = earnings.value;
    if (!config) return;
    if (patch.position !== undefined) config.overlay_position = patch.position;
    if (patch.font_size !== undefined) config.overlay_font_size = patch.font_size;
    if (patch.offset_x !== undefined) config.overlay_offset_x = patch.offset_x;
    if (patch.offset_y !== undefined) config.overlay_offset_y = patch.offset_y;
    if (patch.margin !== undefined) config.overlay_margin = patch.margin;
    return;
  }
  if (activeSection.value === 'logo') {
    const config = logo.value;
    if (!config) return;
    if (patch.position !== undefined) config.position = patch.position;
    if (patch.offset_x !== undefined) config.offset_x = patch.offset_x;
    if (patch.offset_y !== undefined) config.offset_y = patch.offset_y;
    if (patch.font_size !== undefined) {
      config.width = Math.round(clamp(patch.font_size, 32, 1024));
    }
    return;
  }
  const config = activeConfig.value as ChatOverlay | ClockOverlay | TextOverlay | null;
  if (!config) return;
  if (patch.position !== undefined) config.position = patch.position;
  if (patch.font_size !== undefined) config.font_size = patch.font_size;
  if (patch.offset_x !== undefined) config.offset_x = patch.offset_x;
  if (patch.offset_y !== undefined) config.offset_y = patch.offset_y;
  if (patch.margin !== undefined && 'margin' in config) config.margin = patch.margin;
}

function resetHistory(): void {
  const snapshot = draft.value ? JSON.stringify(draft.value) : '';
  history.value = snapshot ? [snapshot] : [];
  historyIndex.value = snapshot ? 0 : -1;
}

function pushHistory(): void {
  if (!draft.value) return;
  const snapshot = JSON.stringify(draft.value);
  if (history.value[historyIndex.value] === snapshot) return;
  history.value = [...history.value.slice(0, historyIndex.value + 1), snapshot].slice(-60);
  historyIndex.value = history.value.length - 1;
}

function scheduleHistory(): void {
  if (historyTimer !== null) window.clearTimeout(historyTimer);
  historyTimer = window.setTimeout(() => {
    historyTimer = null;
    pushHistory();
  }, 450);
}

function undo(): void {
  if (!canUndo.value) return;
  historyIndex.value -= 1;
  draft.value = clone(JSON.parse(history.value[historyIndex.value]!) as StreamerOverlays);
  schedulePreview(true);
}

function redo(): void {
  if (!canRedo.value) return;
  historyIndex.value += 1;
  draft.value = clone(JSON.parse(history.value[historyIndex.value]!) as StreamerOverlays);
  schedulePreview(true);
}

function exportPreset(): void {
  if (!draft.value) return;
  const blob = new Blob([JSON.stringify(draft.value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `relay-overlays-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importFile(file: File): Promise<void> {
  try {
    const parsed = JSON.parse(await file.text()) as Partial<StreamerOverlays>;
    if (!parsed || typeof parsed !== 'object' || !parsed.chat || !parsed.clock || !parsed.text) {
      throw new Error('Das JSON enthält keine vollständige Overlay-Konfiguration.');
    }
    draft.value = normalizeOverlays(parsed as StreamerOverlays);
    pushHistory();
    schedulePreview(true);
    pushToast('Preset geladen – noch nicht gespeichert.', 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function defaultLogo(): StreamerOverlays['logo'] {
  return (
    settings.value?.overlays.logo ?? {
      enabled: false,
      position: 'top-left',
      width: 160,
      opacity: 1,
      margin: 32,
      offset_x: 0,
      offset_y: 0,
    }
  );
}

function normalizeOverlays(value: StreamerOverlays): StreamerOverlays {
  const result = clone(value);
  result.logo ??= clone(defaultLogo());
  for (const key of ['chat', 'clock', 'text', 'logo'] as const) {
    result[key].offset_x ??= 0;
    result[key].offset_y ??= 0;
  }
  return result;
}

function overlaysInput(): StreamerOverlaysInput {
  const current = draft.value!;
  const chatClone = clone(current.chat);
  delete (chatClone as Partial<ChatOverlay>).api_key_set;
  return {
    chat: chatClone,
    clock: clone(current.clock),
    text: clone(current.text),
    logo: clone(current.logo),
  };
}

function earningsInput(): SettingsUpdate['earnings'] {
  const current = clone(settings.value!.earnings);
  delete (current as Partial<typeof current>).api_key_set;
  return current as SettingsUpdate['earnings'];
}

function videoInput(): SettingsUpdate['video'] {
  return clone(settings.value!.video);
}

async function renderPreview(): Promise<void> {
  if (!draft.value) return;
  previewController?.abort();
  const controller = new AbortController();
  previewController = controller;
  try {
    const blob = await api.overlays.studioPreview(
      {
        overlays: overlaysInput(),
        earnings: earningsInput(),
        video_layout: videoLayout.value ?? undefined,
        video_aspect: previewAspect.value,
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
  const baseline = settingsBaseline.value;
  if (!baseline) return;
  settings.value = clone(baseline);
  draft.value = normalizeOverlays(baseline.overlays);
  initialSnapshot = JSON.stringify(draft.value);
  initialEarningsSnapshot = JSON.stringify(baseline.earnings);
  initialLayoutSnapshot = JSON.stringify(baseline.video.layout);
  resetHistory();
  pushToast('Änderungen verworfen.', 'info');
  schedulePreview(true);
}

function setPosition(position: OverlayPosition): void {
  if (!activeGeometry.value) return;
  setGeometry({ position, offset_x: 0, offset_y: 0 });
}

async function save(): Promise<void> {
  if (!draft.value) return;
  saving.value = true;
  try {
    const saved = await api.settings.update({
      overlays: overlaysInput(),
      earnings: earningsInput(),
      video: videoInput(),
    });
    settings.value = saved;
    settingsBaseline.value = clone(saved);
    draft.value = normalizeOverlays(saved.overlays);
    initialSnapshot = JSON.stringify(draft.value);
    initialEarningsSnapshot = JSON.stringify(saved.earnings);
    initialLayoutSnapshot = JSON.stringify(saved.video.layout);
    resetHistory();
    await refreshStatus();
    pushToast('Globale Overlay- und Video-Einstellungen gespeichert.', 'success');
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

watch(
  draft,
  () => {
    schedulePreview();
    scheduleHistory();
  },
  { deep: true },
);
watch(
  () => settings.value?.earnings,
  () => schedulePreview(),
  { deep: true },
);
watch(
  () => settings.value?.video.layout,
  () => schedulePreview(),
  { deep: true },
);
watch(previewAspect, () => schedulePreview(true));
watch(sample, () => schedulePreview(true));

watch(compact, (isCompact) => {
  if (!isCompact) positioning.value = false;
});

watch(
  positioning,
  (active) => {
    document.body.classList.toggle('studio-positioning', active);
  },
  { immediate: true },
);

onMounted(async () => {
  loading.value = true;
  try {
    await refreshStatus().catch(() => undefined);
    settings.value = await api.settings.get();
    settingsBaseline.value = clone(settings.value);
    draft.value = normalizeOverlays(settings.value.overlays);
    initialSnapshot = JSON.stringify(draft.value);
    initialEarningsSnapshot = JSON.stringify(settings.value.earnings);
    initialLayoutSnapshot = JSON.stringify(settings.value.video.layout);
    resetHistory();
    schedulePreview(true);
  } catch (error) {
    loadError.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  if (previewTimer !== null) window.clearTimeout(previewTimer);
  if (historyTimer !== null) window.clearTimeout(historyTimer);
  document.body.classList.remove('studio-positioning');
  previewController?.abort();
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
});
</script>

<template>
  <div class="page overlay-studio-page" :class="{ 'is-positioning': positioning }">
    <div class="page-head">
      <div>
        <h1>Overlay-Studio</h1>
      </div>
      <div class="page-actions studio-page-actions">
        <span class="badge tone-info">Global</span>
        <span v-if="dirty" class="badge tone-warning">Ungespeichert</span>
        <span v-if="dirty" class="badge tone-info">Speichern: kurzer Sink-Neustart</span>
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
      <OverlayStudioPreview
        :image-url="previewUrl"
        :error="previewError"
        :resolution="resolution"
        :section="activeSection"
        :geometry="activeGeometry"
        :overlay-label="overlayLabel"
        :overlay-style="stageBoxStyle"
        :video-layout="videoLayout"
        :preview-aspect="previewAspect"
        :messages="chatStatus?.messages ?? 0"
        :canvas-active="chatStatus?.canvas_active ?? false"
        :can-undo="canUndo"
        :can-redo="canRedo"
        :compact="compact"
        :collapsed="previewCollapsed"
        @update:collapsed="togglePreviewCollapsed"
        v-model:sample="sample"
        v-model:positioning="positioning"
        @overlay-patch="setGeometry"
        @video-patch="setVideoLayout"
        @position="setPosition"
        @undo="undo"
        @redo="redo"
        @export="exportPreset"
        @import="importFile"
        @commit="commitDrag"
      />

      <section class="card overlay-settings-card">
        <div
          class="studio-tabs"
          role="tablist"
          aria-label="Overlay-Bereich"
          @keydown="onTabKeydown"
        >
          <button
            v-for="section in SECTIONS"
            :id="studioTabId(section.id)"
            :key="section.id"
            :ref="(el) => setTabRef(section.id, el)"
            type="button"
            role="tab"
            class="studio-tab"
            :class="{ 'is-active': activeSection === section.id }"
            :aria-selected="activeSection === section.id"
            :aria-controls="studioPanelId(section.id)"
            :tabindex="activeSection === section.id ? 0 : -1"
            @click="selectSection(section.id, { focus: false, announce: true })"
          >
            {{ section.label }}
            <span
              v-if="
                (section.id === 'video' && videoLayout?.enabled) ||
                (section.id === 'chat' && chat?.enabled) ||
                (section.id === 'clock' && clock?.enabled) ||
                (section.id === 'text' && text?.enabled) ||
                (section.id === 'logo' && logo?.enabled) ||
                (section.id === 'earnings' && earnings?.overlay_enabled)
              "
              class="studio-tab-dot"
              aria-hidden="true"
            ></span>
          </button>
        </div>
        <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {{ activeTabAnnouncement }}
        </span>

        <div
          v-if="activeSection === 'video' && videoLayout"
          :id="studioPanelId('video')"
          role="tabpanel"
          :aria-labelledby="studioTabId('video')"
          tabindex="0"
          class="studio-body"
        >
          <ToggleField
            v-model="videoLayout.enabled"
            label="Video-Layout"
          />
          <p class="field-hint">
            Gilt für Quelle, Screens und lokale Videos.
          </p>
          <div class="studio-grid">
            <div class="field">
              <label for="studio-video-scale">Größe (%)</label>
              <input
                id="studio-video-scale"
                v-model.number="videoLayout.scale"
                type="range"
                min="50"
                max="400"
                step="1"
              />
              <p class="field-hint mono">{{ videoLayout.scale }} %</p>
            </div>
            <div class="field">
              <label for="studio-video-position-x">Position X (%)</label>
              <input
                id="studio-video-position-x"
                v-model.number="videoLayout.position_x"
                type="range"
                min="0"
                max="100"
                step="1"
              />
              <p class="field-hint mono">{{ videoLayout.position_x }} %</p>
            </div>
            <div class="field">
              <label for="studio-video-position-y">Position Y (%)</label>
              <input
                id="studio-video-position-y"
                v-model.number="videoLayout.position_y"
                type="range"
                min="0"
                max="100"
                step="1"
              />
              <p class="field-hint mono">{{ videoLayout.position_y }} %</p>
            </div>
            <div class="field">
              <label for="studio-video-aspect">Quellformat (Vorschau)</label>
              <select id="studio-video-aspect" v-model="previewAspect">
                <option v-for="aspect in PREVIEW_ASPECTS" :key="aspect.value" :value="aspect.value">
                  {{ aspect.label }}
                </option>
              </select>
            </div>
          </div>
          <p class="field-hint">
            100 % entspricht dem eingepassten Bild; über 100 % wird gezoomt und an den
            Rändern beschnitten.
          </p>
          <div class="quick-actions">
            <button type="button" class="btn btn-ghost btn-sm" @click="resetVideoLayout">
              Vollbild / Mitte
            </button>
          </div>
        </div>

        <div
          v-else-if="activeSection === 'chat' && chat"
          :id="studioPanelId('chat')"
          role="tabpanel"
          :aria-labelledby="studioTabId('chat')"
          tabindex="0"
          class="studio-body"
        >
          <ToggleField v-model="chat.enabled" label="Chat-Overlay" />
          <StudioGroup
            title="Darstellung"
            :open="groupOpen('chat', 'look', 0)"
            @update:open="setGroupOpen('chat', 'look', $event)"
          >
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
          </StudioGroup>

          <StudioGroup
            title="Layout"
            :open="groupOpen('chat', 'layout', 1)"
            @update:open="setGroupOpen('chat', 'layout', $event)"
          >
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
          </StudioGroup>

          <StudioGroup
            title="Farben & Extras"
            :open="groupOpen('chat', 'colors', 2)"
            @update:open="setGroupOpen('chat', 'colors', $event)"
          >
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
          </StudioGroup>

          <StudioGroup
            title="Quelle"
            :open="groupOpen('chat', 'source', 3)"
            @update:open="setGroupOpen('chat', 'source', $event)"
          >
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
          </StudioGroup>

          <StudioGroup
            title="Testnachricht"
            :open="groupOpen('chat', 'test', 4)"
            @update:open="setGroupOpen('chat', 'test', $event)"
          >
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
          </StudioGroup>
        </div>

        <div
          v-else-if="activeSection === 'clock' && clock"
          :id="studioPanelId('clock')"
          role="tabpanel"
          :aria-labelledby="studioTabId('clock')"
          tabindex="0"
          class="studio-body"
        >
          <ToggleField
            v-model="clock.enabled"
            label="Uhr-Overlay"
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

        <div
          v-else-if="activeSection === 'text' && text"
          :id="studioPanelId('text')"
          role="tabpanel"
          :aria-labelledby="studioTabId('text')"
          tabindex="0"
          class="studio-body"
        >
          <ToggleField
            v-model="text.enabled"
            label="Text-Overlay"
          />
          <StudioGroup
            title="Inhalt & Position"
            :open="groupOpen('text', 'content', 0)"
            @update:open="setGroupOpen('text', 'content', $event)"
          >
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
          </div>
          </StudioGroup>

          <StudioGroup
            title="Darstellung"
            :open="groupOpen('text', 'look', 1)"
            @update:open="setGroupOpen('text', 'look', $event)"
          >
          <div class="studio-grid">
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
          </StudioGroup>
        </div>

        <div
          v-else-if="activeSection === 'logo' && logo"
          :id="studioPanelId('logo')"
          role="tabpanel"
          :aria-labelledby="studioTabId('logo')"
          tabindex="0"
          class="studio-body"
        >
          <ToggleField
            v-model="logo.enabled"
            label="Logo-Overlay"
          />
          <div class="studio-grid">
            <div class="field">
              <label for="studio-logo-position">Position</label>
              <select id="studio-logo-position" v-model="logo.position">
                <option v-for="position in POSITIONS" :key="position.value" :value="position.value">
                  {{ position.label }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="studio-logo-width">Breite (px)</label>
              <input
                id="studio-logo-width"
                v-model.number="logo.width"
                type="number"
                min="32"
                max="1024"
              />
            </div>
            <div class="field">
              <label for="studio-logo-opacity">Deckkraft (0–1)</label>
              <input
                id="studio-logo-opacity"
                v-model.number="logo.opacity"
                type="number"
                min="0"
                max="1"
                step="0.05"
              />
            </div>
            <div class="field">
              <label for="studio-logo-margin">Rand (px)</label>
              <input
                id="studio-logo-margin"
                v-model.number="logo.margin"
                type="number"
                min="0"
                max="200"
              />
            </div>
          </div>
        </div>

        <div
          v-else-if="activeSection === 'earnings' && earnings"
          :id="studioPanelId('earnings')"
          role="tabpanel"
          :aria-labelledby="studioTabId('earnings')"
          tabindex="0"
          class="studio-body"
        >
          <ToggleField
            v-model="earnings.overlay_enabled"
            label="Einnahmen-Overlay"
          />
          <StudioGroup
            title="Template & Stil"
            :open="groupOpen('earnings', 'all', 0)"
            @update:open="setGroupOpen('earnings', 'all', $event)"
          >
          <div class="field">
            <label for="studio-earnings-template">Template</label>
            <textarea
              id="studio-earnings-template"
              v-model="earnings.overlay_template"
              rows="4"
              maxlength="2000"
              spellcheck="false"
            ></textarea>
            <p class="field-hint">
              Zeilenumbrüche bleiben erhalten.
            </p>
            <p class="field-hint">
              Platzhalter: {period}, {net}, {gross}, {coins}, {gifts}, {gifters},
              {session_net}, {session_gross}, {session_coins}, {viewers}, {followers},
              {live}, {top_gift}, {top_gifter}, {display_name}, {last_seen}, {name},
              {username}, {currency}, {goal}, {goal_label}, {goal_percent}, {goal_remaining}, {goal_bar}.
            </p>
          </div>
          <div class="studio-grid">
            <div class="field">
              <label for="studio-earnings-goal">Einnahmen-Ziel (0 = aus)</label>
              <input
                id="studio-earnings-goal"
                v-model.number="earnings.goal_amount"
                type="number"
                min="0"
                max="1000000"
                step="10"
              />
            </div>
            <div class="field">
              <label for="studio-earnings-goal-label">Ziel-Bezeichnung</label>
              <input
                id="studio-earnings-goal-label"
                v-model="earnings.goal_label"
                type="text"
                maxlength="80"
                placeholder="Tagesziel"
              />
            </div>
          </div>
          <label class="checkbox studio-checks">
            <input v-model="earnings.goal_bar_enabled" type="checkbox" />
            Fortschrittsbalken automatisch anhängen (wenn Ziel &gt; 0)
          </label>
          <div class="studio-grid">
            <div class="field">
              <label for="studio-earnings-position">Position</label>
              <select id="studio-earnings-position" v-model="earnings.overlay_position">
                <option v-for="position in POSITIONS" :key="position.value" :value="position.value">
                  {{ position.label }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="studio-earnings-size">Schriftgröße (px)</label>
              <input id="studio-earnings-size" v-model.number="earnings.overlay_font_size" type="number" min="8" max="96" />
            </div>
            <div class="field">
              <label for="studio-earnings-margin">Rand (px)</label>
              <input id="studio-earnings-margin" v-model.number="earnings.overlay_margin" type="number" min="0" max="200" />
            </div>
            <div class="field">
              <label for="studio-earnings-offset-x">Offset X (px)</label>
              <input id="studio-earnings-offset-x" v-model.number="earnings.overlay_offset_x" type="number" min="-1920" max="1920" />
            </div>
            <div class="field">
              <label for="studio-earnings-offset-y">Offset Y (px)</label>
              <input id="studio-earnings-offset-y" v-model.number="earnings.overlay_offset_y" type="number" min="-1080" max="1080" />
            </div>
            <div class="field">
              <label for="studio-earnings-font-color">Schriftfarbe</label>
              <ColorInput id="studio-earnings-font-color" v-model="earnings.overlay_font_color" />
            </div>
            <div class="field">
              <label for="studio-earnings-box-color">Boxfarbe</label>
              <ColorInput id="studio-earnings-box-color" v-model="earnings.overlay_box_color" alpha />
            </div>
          </div>
          <label class="checkbox studio-checks">
            <input v-model="earnings.overlay_show_box" type="checkbox" />
            Hintergrundbox anzeigen
          </label>
          <p class="field-hint">
            Quelle, Zeitraum und Anzeige-Ansicht werden unter
            <RouterLink to="/settings">Einstellungen → Einnahmen</RouterLink> gepflegt.
          </p>
          </StudioGroup>
        </div>
      </section>
    </div>

    <div v-if="draft && dirty" class="studio-savebar" role="region" aria-label="Ungespeicherte Änderungen">
      <span class="studio-savebar-label"><span class="dot" aria-hidden="true"></span>Ungespeichert</span>
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        :disabled="saving"
        @click="resetDraft"
      >
        Verwerfen
      </button>
      <button type="button" class="btn btn-primary btn-sm" :disabled="saving" @click="save">
        <span v-if="saving" class="spinner" aria-hidden="true"></span>
        Speichern
      </button>
    </div>
  </div>
</template>
