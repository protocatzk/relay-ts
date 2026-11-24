<script setup lang="ts">
/**
 * Cockpit discovery panel (#92).
 *
 * A right-side rail that pushes the cockpit at ≥1280 px, overlays the widget
 * column between 960–1279 px and becomes a bottom sheet on phones. The content
 * lives in `DiscoveryWorkspace.vue` so a floating window can host it later.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import DiscoveryWorkspace from '@/src/components/discovery/DiscoveryWorkspace.vue';
import { useDiscoveryFeed } from '@/src/composables/useDiscoveryFeed';
import {
  useDiscoveryPanel,
  setDiscoveryPanelWidth,
  closeDiscoveryPanel,
  toggleDiscoveryPanel,
} from '@/src/composables/useDiscoveryPanel';
import { isOmniSearchOpen } from '@/src/composables/useOmniSearch';
import { useMediaQuery } from '@/src/composables/useMediaQuery';

const route = useRoute();
const feed = useDiscoveryFeed();
const { open, width } = useDiscoveryPanel();
const isSheet = useMediaQuery('(max-width: 959px)');
const panel = ref<HTMLElement | null>(null);

const widthStyle = computed(() => ({ '--discovery-w': `${width.value}px` }));

/* ------------------------------------------------------------------ resize */

let resizeStart: { x: number; from: number } | null = null;
let resizeFrame = 0;

function onResizeMove(event: PointerEvent): void {
  if (!resizeStart) return;
  const next = resizeStart.from - (event.clientX - resizeStart.x);
  if (resizeFrame) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => setDiscoveryPanelWidth(next));
}

function onResizeEnd(): void {
  resizeStart = null;
  window.removeEventListener('pointermove', onResizeMove);
  window.removeEventListener('pointerup', onResizeEnd);
}

function startResize(event: PointerEvent): void {
  if (isSheet.value) return;
  event.preventDefault();
  resizeStart = { x: event.clientX, from: width.value };
  window.addEventListener('pointermove', onResizeMove);
  window.addEventListener('pointerup', onResizeEnd);
}

/* ---------------------------------------------------------------- keyboard */

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

function hasOpenDialog(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  // "D" toggles the panel; ignored while typing or when a dialog owns the focus.
  if ((event.key === 'd' || event.key === 'D') && !isTypingTarget(event.target) && !hasOpenDialog() && !isOmniSearchOpen.value) {
    event.preventDefault();
    toggleDiscoveryPanel();
    return;
  }

  if (event.key !== 'Escape' || !open.value) return;
  // The zapper handles its own Escape first (back to the list).
  if (feed.pane.value === 'zapper') return;
  if (isTypingTarget(event.target) && event.target instanceof HTMLInputElement && event.target.value) {
    // First Escape clears the field, second one closes the panel.
    feed.setQuery('');
    return;
  }
  event.stopPropagation();
  closeDiscoveryPanel();
}

/* ------------------------------------------------------------- focus trap */

function trapFocus(event: KeyboardEvent): void {
  if (!open.value || !isSheet.value || event.key !== 'Tab' || !panel.value) return;
  const focusable = panel.value.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  if (focusable.length === 0) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* ------------------------------------------------------------- lifecycle */

// The panel only makes sense over the cockpit; leaving the route closes it.
watch(
  () => route.path,
  (path) => {
    if (path !== '/' && open.value) closeDiscoveryPanel();
  },
);

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('keydown', trapFocus);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('keydown', trapFocus);
  onResizeEnd();
});
</script>

<template>
  <div
    v-if="open && isSheet"
    class="discovery-scrim"
    aria-hidden="true"
    @click="closeDiscoveryPanel"
  ></div>

  <Transition name="discovery-panel">
    <aside
      v-if="open"
      ref="panel"
      class="discovery-panel"
      :class="{ 'is-sheet': isSheet }"
      :style="widthStyle"
      :role="isSheet ? 'dialog' : 'region'"
      :aria-modal="isSheet ? 'true' : undefined"
      aria-label="Discovery"
      aria-keyshortcuts="D"
      tabindex="-1"
    >
      <div
        v-if="!isSheet"
        class="discovery-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Panelbreite ändern"
        @pointerdown="startResize"
      ></div>
      <DiscoveryWorkspace compact />
    </aside>
  </Transition>
</template>
