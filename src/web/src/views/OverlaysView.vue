<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type {
  ChatOverlay,
  ClockOverlay,
  OverlayPosition,
  OverlayScene,
  Settings,
  SettingsUpdate,
  StreamerOverlays,
  StreamerOverlaysInput,
  TextOverlay,
  VersionOverlay,
  VideoLayout,
} from '@/src/api/types';
import OverlayStudioPreview from '@/src/components/OverlayStudioPreview.vue';
import StudioChatTab from '@/src/components/studio/StudioChatTab.vue';
import StudioClockTab from '@/src/components/studio/StudioClockTab.vue';
import StudioEarningsTab from '@/src/components/studio/StudioEarningsTab.vue';
import StudioLogoTab from '@/src/components/studio/StudioLogoTab.vue';
import StudioTextTab from '@/src/components/studio/StudioTextTab.vue';
import StudioVersionTab from '@/src/components/studio/StudioVersionTab.vue';
import StudioVideoTab from '@/src/components/studio/StudioVideoTab.vue';
import { confirmAction } from '@/src/composables/useConfirm';
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
const scenes = ref<OverlayScene[]>([]);
const activeSceneId = ref<string | null>(null);
const selectedSceneId = ref('');
const newSceneName = ref('');
const sceneBusy = ref(false);
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
const versionOverlay = computed(() => draft.value?.version ?? null);
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

const activeConfig = computed<ChatOverlay | ClockOverlay | TextOverlay | VersionOverlay | null>(() => {
  if (activeSection.value === 'chat') return chat.value;
  if (activeSection.value === 'clock') return clock.value;
  if (activeSection.value === 'text') return text.value;
  if (activeSection.value === 'version') return versionOverlay.value;
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

function overlayMargin(config: ChatOverlay | ClockOverlay | TextOverlay | VersionOverlay): number {
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
    const isBroadcast =
      chatConfig.layout_mode === 'glass_minimal' || chatConfig.layout_mode === 'ultra_clean';
    boxWidth =
      chatConfig.panel_width > 0
        ? chatConfig.panel_width
        : isBroadcast && width >= height
          ? Math.max(200, Math.round((width - (height * 9) / 16) / 2 - 40))
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
  if (patch.width !== undefined && 'panel_width' in config) {
    config.panel_width = patch.width;
  }
}

function isBroadcastConfig(
  overlays: StreamerOverlays | null | undefined,
): boolean {
  const c = overlays?.chat;
  return Boolean(
    c?.enabled &&
      c.engine === 'canvas' &&
      (c.layout_mode === 'glass_minimal' || c.layout_mode === 'ultra_clean'),
  );
}

const isLiveCanvasSave = computed(() => {
  if (!settingsBaseline.value || !draft.value || !settings.value) return false;
  return (
    isBroadcastConfig(settingsBaseline.value.overlays) &&
    isBroadcastConfig(draft.value) &&
    settingsBaseline.value.overlays.chat.render_fps === draft.value.chat.render_fps &&
    JSON.stringify(settingsBaseline.value.overlays.logo) === JSON.stringify(draft.value.logo) &&
    JSON.stringify(settingsBaseline.value.video.layout) ===
      JSON.stringify(settings.value.video.layout)
  );
});

function applyQuickMode(mode: 'glass_minimal' | 'ultra_clean' | 'standard'): void {
  if (!draft.value) return;
  draft.value.chat.enabled = true;
  draft.value.chat.engine = 'canvas';
  draft.value.chat.layout_mode = mode;
  pushHistory();
  schedulePreview(true);
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

function defaultVersion(): NonNullable<StreamerOverlays['version']> {
  return (
    settings.value?.overlays.version ?? {
      enabled: false,
      position: 'bottom-right',
      prefix: 'RELAY v',
      show_update_hint: false,
      update_hint: 'Update verfügbar',
      font_size: 16,
      font_color: 'white@0.75',
      box_color: 'black@0.35',
      show_box: true,
      margin: 24,
      offset_x: 0,
      offset_y: 0,
    }
  );
}

function normalizeOverlays(value: StreamerOverlays): StreamerOverlays {
  const result = clone(value);
  result.logo ??= clone(defaultLogo());
  result.version ??= clone(defaultVersion());
  for (const key of ['chat', 'clock', 'text', 'logo', 'version'] as const) {
    result[key]!.offset_x ??= 0;
    result[key]!.offset_y ??= 0;
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
    version: clone(current.version ?? defaultVersion()),
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

async function loadScenes(): Promise<void> {
  try {
    const res = await api.scenes.list();
    scenes.value = res.scenes;
    activeSceneId.value = res.active_scene_id;
    if (!selectedSceneId.value || !res.scenes.some((s) => s.id === selectedSceneId.value)) {
      selectedSceneId.value = res.active_scene_id ?? res.scenes[0]?.id ?? '';
    }
  } catch {
    /* scene list is optional if endpoint unavailable */
  }
}

async function createScene(): Promise<void> {
  const name = newSceneName.value.trim();
  if (!name) return;
  sceneBusy.value = true;
  try {
    if (dirty.value) await save();
    const res = await api.scenes.create({ name });
    newSceneName.value = '';
    await loadScenes();
    selectedSceneId.value = res.scene.id;
    pushToast(`Szene „${res.scene.name}“ gespeichert.`, 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    sceneBusy.value = false;
  }
}

async function activateScene(id: string): Promise<void> {
  if (!id) return;
  sceneBusy.value = true;
  try {
    const res = await api.scenes.activate(id);
    activeSceneId.value = res.scene.id;
    selectedSceneId.value = res.scene.id;
    settings.value = await api.settings.get();
    settingsBaseline.value = clone(settings.value);
    draft.value = normalizeOverlays(settings.value.overlays);
    initialSnapshot = JSON.stringify(draft.value);
    initialEarningsSnapshot = JSON.stringify(settings.value.earnings);
    initialLayoutSnapshot = JSON.stringify(settings.value.video.layout);
    resetHistory();
    await refreshStatus();
    schedulePreview(true);
    pushToast(`Szene „${res.scene.name}“ aktiviert.`, 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    sceneBusy.value = false;
  }
}

async function overwriteSelectedScene(): Promise<void> {
  const id = selectedSceneId.value;
  if (!id) return;
  sceneBusy.value = true;
  try {
    if (dirty.value) await save();
    await api.scenes.update(id, { capture_current: true });
    await loadScenes();
    pushToast('Szene mit aktuellem Stand überschrieben.', 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    sceneBusy.value = false;
  }
}

async function removeSelectedScene(): Promise<void> {
  const scene = scenes.value.find((s) => s.id === selectedSceneId.value);
  if (!scene) return;
  const ok = await confirmAction(`Szene „${scene.name}“ löschen?`, {
    title: 'Szene löschen',
    confirmLabel: 'Löschen',
    tone: 'danger',
  });
  if (!ok) return;
  sceneBusy.value = true;
  try {
    await api.scenes.remove(scene.id);
    selectedSceneId.value = '';
    await loadScenes();
    pushToast(`Szene „${scene.name}“ gelöscht.`, 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    sceneBusy.value = false;
  }
}

onMounted(async () => {
  loading.value = true;
  try {
    await refreshStatus().catch(() => undefined);
    const [, loadedSettings] = await Promise.all([loadScenes(), api.settings.get()]);
    settings.value = loadedSettings;
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
        <span
          v-if="dirty"
          class="badge"
          :class="isLiveCanvasSave ? 'tone-success' : 'tone-info'"
        >
          {{ isLiveCanvasSave ? 'Live ohne Sink-Neustart' : 'Speichern: kurzer Sink-Neustart' }}
        </span>
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

    <template v-else-if="draft">
      <section class="card" style="padding: 12px 14px; margin-bottom: 12px">
        <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end">
          <div class="field" style="flex: 1 1 180px; margin: 0">
            <label for="studio-scene-select">Gespeicherte Szene</label>
            <select id="studio-scene-select" v-model="selectedSceneId" :disabled="sceneBusy || scenes.length === 0">
              <option value="" disabled>{{ scenes.length ? 'Szene wählen…' : 'Noch keine Szenen' }}</option>
              <option v-for="scene in scenes" :key="scene.id" :value="scene.id">
                {{ scene.name }}{{ scene.id === activeSceneId ? ' (aktiv)' : '' }}
              </option>
            </select>
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center">
            <span class="muted small">Design:</span>
            <button
              type="button"
              class="btn btn-sm"
              :class="draft.chat.layout_mode === 'glass_minimal' ? 'btn-primary' : 'btn-ghost'"
              @click="applyQuickMode('glass_minimal')"
            >
              Glass Minimal
            </button>
            <button
              type="button"
              class="btn btn-sm"
              :class="draft.chat.layout_mode === 'ultra_clean' ? 'btn-primary' : 'btn-ghost'"
              @click="applyQuickMode('ultra_clean')"
            >
              Ultra Clean
            </button>
            <button
              type="button"
              class="btn btn-sm"
              :class="draft.chat.layout_mode === 'standard' ? 'btn-primary' : 'btn-ghost'"
              @click="applyQuickMode('standard')"
            >
              Standard
            </button>
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 6px">
            <button
              type="button"
              class="btn btn-primary btn-sm"
              :disabled="sceneBusy || !selectedSceneId"
              @click="activateScene(selectedSceneId)"
            >
              Aktivieren
            </button>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              :disabled="sceneBusy || !selectedSceneId"
              @click="overwriteSelectedScene"
            >
              Überschreiben
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="sceneBusy || !selectedSceneId"
              @click="removeSelectedScene"
            >
              Löschen
            </button>
          </div>
          <form style="display: flex; flex: 1 1 220px; gap: 6px; align-items: flex-end" @submit.prevent="createScene">
            <div class="field" style="flex: 1; margin: 0">
              <label for="studio-scene-name">Neue Szene</label>
              <input
                id="studio-scene-name"
                v-model="newSceneName"
                type="text"
                maxlength="80"
                placeholder="z. B. Gaming 16:9"
              />
            </div>
            <button type="submit" class="btn btn-secondary btn-sm" :disabled="sceneBusy || !newSceneName.trim()">
              Als Szene speichern
            </button>
          </form>
        </div>
      </section>

      <div class="overlay-studio-layout">
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

        <StudioVideoTab
          v-if="activeSection === 'video' && videoLayout"
          :video-layout="videoLayout"
          :preview-aspect="previewAspect"
          :preview-aspects="PREVIEW_ASPECTS"
          :panel-id="studioPanelId('video')"
          :tab-id="studioTabId('video')"
          @update:preview-aspect="previewAspect = $event"
          @reset="resetVideoLayout"
        />

        <StudioChatTab
          v-else-if="activeSection === 'chat' && chat"
          :chat="chat"
          :chat-test="chatTest"
          :positions="POSITIONS"
          :sending-test="sendingTest"
          :panel-id="studioPanelId('chat')"
          :tab-id="studioTabId('chat')"
          :group-open="groupOpen"
          @set-group-open="setGroupOpen"
          @send-test="sendTest"
        />

        <StudioClockTab
          v-else-if="activeSection === 'clock' && clock"
          :clock="clock"
          :positions="POSITIONS"
          :panel-id="studioPanelId('clock')"
          :tab-id="studioTabId('clock')"
        />

        <StudioTextTab
          v-else-if="activeSection === 'text' && text"
          :text="text"
          :positions="POSITIONS"
          :panel-id="studioPanelId('text')"
          :tab-id="studioTabId('text')"
          :group-open="groupOpen"
          @set-group-open="setGroupOpen"
        />

        <StudioLogoTab
          v-else-if="activeSection === 'logo' && logo"
          :logo="logo"
          :positions="POSITIONS"
          :panel-id="studioPanelId('logo')"
          :tab-id="studioTabId('logo')"
        />

        <StudioEarningsTab
          v-else-if="activeSection === 'earnings' && earnings"
          :earnings="earnings"
          :positions="POSITIONS"
          :panel-id="studioPanelId('earnings')"
          :tab-id="studioTabId('earnings')"
          :group-open="groupOpen"
          @set-group-open="setGroupOpen"
        />

        <StudioVersionTab
          v-else-if="activeSection === 'version' && versionOverlay"
          :version-overlay="versionOverlay"
          :positions="POSITIONS"
          :panel-id="studioPanelId('version')"
          :tab-id="studioTabId('version')"
        />
      </section>
    </div>
    </template>

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
