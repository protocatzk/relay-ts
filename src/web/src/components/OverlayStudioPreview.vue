<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { VideoLayout } from '@/src/api/types';
import { POSITIONS } from '@/src/overlay-studio';
import type {
  OverlayGeometry,
  OverlayPosition,
  PreviewAspect,
  Section,
  StudioPreviewItem,
} from '@/src/overlay-studio';
import { useMediaQuery } from '@/src/composables/useMediaQuery';

const props = defineProps<{
  imageUrl: string;
  error: string;
  resolution: string;
  section: Section;
  geometry: OverlayGeometry | null;
  overlayLabel: string;
  overlayStyle: Record<string, string>;
  items?: StudioPreviewItem[];
  videoLayout: VideoLayout | null;
  previewAspect: PreviewAspect;
  sample: boolean;
  messages: number;
  canvasActive: boolean;
  canUndo: boolean;
  canRedo: boolean;
  positioning: boolean;
  compact: boolean;
  collapsed: boolean;
}>();

const emit = defineEmits<{
  'update:sample': [value: boolean];
  'update:positioning': [value: boolean];
  'update:collapsed': [value: boolean];
  'select-section': [section: Section];
  'overlay-patch': [patch: Partial<OverlayGeometry>];
  'video-patch': [patch: Partial<VideoLayout>];
  position: [position: OverlayPosition];
  undo: [];
  redo: [];
  export: [];
  import: [file: File];
  commit: [];
}>();

const stageRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLDivElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const showGuides = ref(true);
const canvasWidth = ref(0);
const canvasHeight = ref(0);
const coarsePointer = useMediaQuery('(pointer: coarse)');

let observer: ResizeObserver | null = null;

interface DragState {
  target: 'overlay' | 'video';
  mode: 'move' | 'resize';
  pointerId: number;
  startX: number;
  startY: number;
  baseX: number;
  baseY: number;
  baseSize: number;
  baseWidth: number;
  baseHeight: number;
  canvasWidth: number;
  canvasHeight: number;
}

let drag: DragState | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolutionSize(): [number, number] {
  return props.resolution.split('x').map(Number) as [number, number];
}

function fitCanvas(availableWidth: number, availableHeight: number): void {
  const [width, height] = resolutionSize();
  if (!width || !height || availableWidth <= 0) return;
  const ratio = width / height;
  let canvasW = availableWidth;
  let canvasH = canvasW / ratio;
  if (availableHeight > 0 && canvasH > availableHeight) {
    canvasH = availableHeight;
    canvasW = canvasH * ratio;
  }
  canvasWidth.value = Math.max(1, Math.floor(canvasW));
  canvasHeight.value = Math.max(1, Math.floor(canvasH));
}

function measureStage(): void {
  const stage = stageRef.value;
  if (!stage) return;
  const style = getComputedStyle(stage);
  const width = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const height = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  fitCanvas(width, height);
}

const videoRect = computed(() => {
  const layout = props.videoLayout;
  if (!layout) return null;
  const [width, height] = resolutionSize();
  const [aspectWidth, aspectHeight] = props.previewAspect.split(':').map(Number) as [
    number,
    number,
  ];
  const ratio = aspectWidth / aspectHeight;
  const baseWidth = width / height > ratio ? height * ratio : width;
  const baseHeight = width / height > ratio ? height : width / ratio;
  const scale = (layout.enabled ? layout.scale : 100) / 100;
  const positionX = layout.enabled ? layout.position_x : 50;
  const positionY = layout.enabled ? layout.position_y : 50;
  const videoWidth = baseWidth * scale;
  const videoHeight = baseHeight * scale;
  return {
    x: ((width - videoWidth) * positionX) / 100,
    y: ((height - videoHeight) * positionY) / 100,
    width: videoWidth,
    height: videoHeight,
  };
});

const videoBoxStyle = computed<Record<string, string>>((): Record<string, string> => {
  const rect = videoRect.value;
  if (!rect) return {};
  const [width, height] = resolutionSize();
  return {
    left: `${(Math.max(0, rect.x) / width) * 100}%`,
    top: `${(Math.max(0, rect.y) / height) * 100}%`,
    right: `${(Math.max(0, width - (rect.x + rect.width)) / width) * 100}%`,
    bottom: `${(Math.max(0, height - (rect.y + rect.height)) / height) * 100}%`,
  };
});

function onDragMove(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const dx = ((event.clientX - drag.startX) / drag.canvasWidth) * resolutionSize()[0];
  const dy = ((event.clientY - drag.startY) / drag.canvasHeight) * resolutionSize()[1];

  if (drag.target === 'video') {
    if (drag.mode === 'resize') {
      emit('video-patch', {
        scale: Math.round(clamp(drag.baseSize + dy * 0.25, 50, 400)),
      });
      return;
    }
    const video = videoRect.value;
    if (!video) return;
    const [width, height] = resolutionSize();
    const rangeX = width - video.width;
    const rangeY = height - video.height;
    let nextX =
      Math.abs(rangeX) < 1
        ? drag.baseX
        : Math.round(clamp(drag.baseX + (dx * 100) / rangeX, 0, 100));
    let nextY =
      Math.abs(rangeY) < 1
        ? drag.baseY
        : Math.round(clamp(drag.baseY + (dy * 100) / rangeY, 0, 100));
    if (showGuides.value) {
      if (Math.abs(nextX - 50) <= 3) nextX = 50;
      if (Math.abs(nextY - 50) <= 3) nextY = 50;
    }
    emit('video-patch', {
      position_x: nextX,
      position_y: nextY,
    });
    return;
  }

  if (drag.mode === 'move') {
    let nextX = Math.round(clamp(drag.baseX + dx, -1920, 1920));
    let nextY = Math.round(clamp(drag.baseY + dy, -1080, 1080));
    if (showGuides.value) {
      if (Math.abs(nextX) <= 12) nextX = 0;
      if (Math.abs(nextY) <= 12) nextY = 0;
    }
    emit('overlay-patch', {
      offset_x: nextX,
      offset_y: nextY,
    });
    return;
  }

  const isLogo = props.section === 'logo';
  if (props.section === 'chat' && drag.baseWidth > 0 && drag.baseHeight > 0) {
    emit('overlay-patch', {
      width: Math.round(clamp(drag.baseWidth + dx, 180, 1400)),
      height: Math.round(clamp(drag.baseHeight + dy, 120, 1600)),
    });
    return;
  }
  const patch: Partial<OverlayGeometry> = {
    font_size: Math.round(
      clamp(drag.baseSize + dy * (isLogo ? 0.6 : 0.15), isLogo ? 32 : 8, isLogo ? 1024 : 96),
    ),
  };
  if (props.section === 'queue' && drag.baseWidth > 0 && Math.abs(dx) >= Math.abs(dy)) {
    patch.width = Math.round(clamp(drag.baseWidth + dx, 160, 1400));
  }
  emit('overlay-patch', patch);
}

function endDrag(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const wasOverlay = drag.target === 'overlay';
  drag = null;
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', endDrag);
  window.removeEventListener('pointercancel', endDrag);
  if (wasOverlay) emit('commit');
}

function startDrag(
  event: PointerEvent,
  mode: 'move' | 'resize',
  target: 'overlay' | 'video' = 'overlay',
  item?: StudioPreviewItem,
): void {
  const canvas = canvasRef.value;
  if (!canvas || canvasWidth.value === 0) return;
  if (target === 'video' && !props.videoLayout?.enabled) return;
  if (item && item.section !== props.section) {
    emit('select-section', item.section);
  }
  const activeGeo = item?.geometry ?? props.geometry;
  if (target === 'overlay' && !activeGeo) return;

  event.preventDefault();
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);

  const baseX = target === 'video' ? (props.videoLayout?.position_x ?? 50) : activeGeo!.offset_x;
  const baseY = target === 'video' ? (props.videoLayout?.position_y ?? 50) : activeGeo!.offset_y;
  const baseSize =
    target === 'video' ? (props.videoLayout?.scale ?? 100) : activeGeo!.font_size;

  drag = {
    target,
    mode,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    baseX,
    baseY,
    baseSize,
    baseWidth: target === 'overlay' ? (activeGeo?.width ?? 0) : 0,
    baseHeight: target === 'overlay' ? (activeGeo?.height ?? 0) : 0,
    canvasWidth: canvasWidth.value,
    canvasHeight: canvasHeight.value,
  };

  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
}

function nudgeOverlay(dx: number, dy: number): void {
  const geometry = props.geometry;
  if (!geometry) return;
  emit('overlay-patch', {
    offset_x: clamp(geometry.offset_x + dx, -1920, 1920),
    offset_y: clamp(geometry.offset_y + dy, -1080, 1080),
  });
  emit('commit');
}

function nudgeVideo(dx: number, dy: number): void {
  const layout = props.videoLayout;
  if (!layout || !layout.enabled) return;
  emit('video-patch', {
    position_x: Math.round(clamp(layout.position_x + dx, 0, 100)),
    position_y: Math.round(clamp(layout.position_y + dy, 0, 100)),
  });
}

function pickFile(): void {
  fileInput.value?.click();
}

function onFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) emit('import', file);
}

onMounted(() => {
  const stage = stageRef.value;
  if (!stage) return;
  observer = new ResizeObserver(() => measureStage());
  observer.observe(stage);
  measureStage();
});

onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', endDrag);
  window.removeEventListener('pointercancel', endDrag);
});
</script>

<template>
  <section
    class="card overlay-preview-card"
    :class="{ 'is-positioning': positioning, 'is-collapsed': collapsed && !positioning }"
  >
    <div class="card-head">
      <div>
        <h2 class="card-title">Live-Vorschau</h2>
        <p class="card-sub mono">{{ resolution }}</p>
      </div>
      <div class="studio-preview-tools">
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="!canUndo"
          aria-label="Rückgängig"
          @click="emit('undo')"
        >
          ↶
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="!canRedo"
          aria-label="Wiederholen"
          @click="emit('redo')"
        >
          ↷
        </button>

        <div class="studio-tools-inline">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :class="{ 'is-active': showGuides }"
            :aria-pressed="showGuides"
            @click="showGuides = !showGuides"
          >
            Hilfslinien
          </button>
          <button type="button" class="btn btn-ghost btn-sm" @click="emit('export')">
            Export
          </button>
          <button type="button" class="btn btn-ghost btn-sm" @click="pickFile">Import</button>
          <label class="checkbox">
            <input
              :checked="sample"
              type="checkbox"
              @change="emit('update:sample', ($event.target as HTMLInputElement).checked)"
            />
            Beispielnachrichten
          </label>
        </div>

        <details class="studio-tools-menu">
          <summary class="btn btn-ghost btn-sm studio-tools-trigger" aria-label="Werkzeuge">⋯</summary>
          <div class="studio-tools-panel">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              :class="{ 'is-active': showGuides }"
              :aria-pressed="showGuides"
              @click="showGuides = !showGuides"
            >
              Hilfslinien
            </button>
            <button type="button" class="btn btn-ghost btn-sm" @click="emit('export')">
              Export
            </button>
            <button type="button" class="btn btn-ghost btn-sm" @click="pickFile">Import</button>
            <label class="checkbox">
              <input
                :checked="sample"
                type="checkbox"
                @change="emit('update:sample', ($event.target as HTMLInputElement).checked)"
              />
              Beispielnachrichten
            </label>
          </div>
        </details>

        <button
          v-if="compact && !positioning"
          type="button"
          class="btn btn-ghost btn-sm studio-collapse-btn"
          :aria-expanded="!collapsed"
          :aria-label="collapsed ? 'Vorschau ausklappen' : 'Vorschau einklappen'"
          @click="emit('update:collapsed', !collapsed)"
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            aria-hidden="true"
            :style="{ transform: collapsed ? 'rotate(180deg)' : 'none' }"
          >
            <path d="m6 15 6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <span v-if="!imageUrl" class="badge tone-info">Rendert…</span>
      </div>
    </div>

    <input
      ref="fileInput"
      class="sr-only"
      type="file"
      accept="application/json,.json"
      @change="onFile"
    />

    <div ref="stageRef" class="studio-stage">
      <div
        v-if="canvasWidth > 0"
        ref="canvasRef"
        class="studio-canvas"
        :style="{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }"
      >
        <img v-if="imageUrl" :src="imageUrl" alt="Overlay-Vorschau" />

        <div v-if="geometry && (!coarsePointer || positioning)" class="studio-hotzones">
          <button
            v-for="position in POSITIONS"
            :key="position.value"
            type="button"
            class="studio-hotzone"
            :class="[`is-${position.value}`, { 'is-active': geometry.position === position.value }]"
            :aria-label="position.label"
            :aria-pressed="geometry.position === position.value"
            @click="emit('position', position.value)"
          >
            <span>{{ position.label }}</span>
          </button>
        </div>

        <div v-if="showGuides" class="studio-guides" aria-hidden="true">
          <span class="studio-guide-safe"></span>
          <span class="studio-guide-v1"></span>
          <span class="studio-guide-v2"></span>
          <span class="studio-guide-h1"></span>
          <span class="studio-guide-h2"></span>
        </div>

        <div
          v-if="section === 'video' && videoLayout"
          class="studio-drag-box studio-video-box"
          :class="{ 'is-disabled': !videoLayout.enabled }"
          :style="videoBoxStyle"
          role="group"
          tabindex="0"
          aria-label="Video positionieren"
          @pointerdown="startDrag($event, 'move', 'video')"
          @keydown.left.prevent="nudgeVideo(-2, 0)"
          @keydown.right.prevent="nudgeVideo(2, 0)"
          @keydown.up.prevent="nudgeVideo(0, -2)"
          @keydown.down.prevent="nudgeVideo(0, 2)"
        >
          <span class="studio-drag-label">
            Video · {{ videoLayout.enabled ? `${videoLayout.scale} %` : 'Vollbild' }}
          </span>
          <button
            v-if="videoLayout.enabled"
            type="button"
            class="studio-resize-handle"
            aria-label="Video skalieren"
            @pointerdown.stop="startDrag($event, 'resize', 'video')"
          ></button>
        </div>

        <template v-if="items && items.length > 0">
          <div
            v-for="item in items"
            :key="item.section"
            class="studio-drag-box"
            :class="{ 'is-inactive-layer': item.section !== section }"
            :style="item.style"
            role="group"
            tabindex="0"
            :aria-label="`${item.label} positionieren`"
            @pointerdown="startDrag($event, 'move', 'overlay', item)"
            @keydown.left.prevent="item.section === section && nudgeOverlay(-5, 0)"
            @keydown.right.prevent="item.section === section && nudgeOverlay(5, 0)"
            @keydown.up.prevent="item.section === section && nudgeOverlay(0, -5)"
            @keydown.down.prevent="item.section === section && nudgeOverlay(0, 5)"
          >
            <span class="studio-drag-label">{{ item.label }}</span>
            <button
              v-if="item.section === section"
              type="button"
              class="studio-resize-handle"
              aria-label="Größe ändern"
              @pointerdown.stop="startDrag($event, 'resize', 'overlay', item)"
            ></button>
          </div>
        </template>
        <div
          v-else-if="geometry"
          class="studio-drag-box"
          :style="overlayStyle"
          role="group"
          tabindex="0"
          :aria-label="`${overlayLabel} positionieren`"
          @pointerdown="startDrag($event, 'move')"
          @keydown.left.prevent="nudgeOverlay(-5, 0)"
          @keydown.right.prevent="nudgeOverlay(5, 0)"
          @keydown.up.prevent="nudgeOverlay(0, -5)"
          @keydown.down.prevent="nudgeOverlay(0, 5)"
        >
          <span class="studio-drag-label">{{ overlayLabel }}</span>
          <button
            type="button"
            class="studio-resize-handle"
            aria-label="Schriftgröße ändern"
            @pointerdown.stop="startDrag($event, 'resize')"
          ></button>
        </div>
      </div>

      <div v-if="canvasWidth === 0 || !imageUrl" class="studio-preview-empty">
        <span v-if="!imageUrl" class="spinner" aria-hidden="true"></span>
        {{ imageUrl ? 'Vorschau wird vorbereitet…' : 'Vorschau wird gerendert…' }}
      </div>

      <p v-if="error" class="studio-preview-error">{{ error }}</p>
    </div>

    <div class="studio-preview-foot">
      <div v-if="geometry" class="studio-anchors" role="group" aria-label="Overlay-Position">
        <button
          v-for="position in POSITIONS"
          :key="position.value"
          type="button"
          class="studio-anchor"
          :class="{ 'is-active': geometry.position === position.value }"
          :aria-label="position.label"
          :aria-pressed="geometry.position === position.value"
          :title="position.label"
          @click="emit('position', position.value)"
        >
          <span aria-hidden="true">{{ position.glyph }}</span>
        </button>
      </div>
      <p class="studio-preview-hint muted small">
        Ziehen oder Pfeiltasten; die Ecken rasten ein.
      </p>
      <button
        v-if="compact"
        type="button"
        class="btn btn-sm studio-position-btn"
        :class="positioning ? 'btn-primary' : 'btn-ghost'"
        :aria-pressed="positioning"
        @click="emit('update:positioning', !positioning)"
      >
        {{ positioning ? 'Fertig' : 'Positionieren' }}
      </button>
      <span class="badge tone-neutral">
        {{ sample ? 'Beispieldaten' : `${messages} Live-Nachrichten` }}
      </span>
      <span v-if="canvasActive" class="badge tone-success">Canvas live</span>
      <span v-else class="badge tone-neutral">Canvas inaktiv</span>
    </div>
  </section>
</template>
