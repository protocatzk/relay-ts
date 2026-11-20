<script lang="ts">
// Track stacked modals so Escape and focus-trapping apply only to the topmost dialog.
const openModals: symbol[] = [];
</script>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    size?: 'sm' | 'md' | 'lg';
  }>(),
  { size: 'md' },
);

const emit = defineEmits<{ close: [] }>();

const modalToken = Symbol('modal');
const panel = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;

function isTopmost(): boolean {
  return openModals[openModals.length - 1] === modalToken;
}

function registerModal(): void {
  if (!openModals.includes(modalToken)) openModals.push(modalToken);
}

function unregisterModal(): void {
  const index = openModals.indexOf(modalToken);
  if (index !== -1) openModals.splice(index, 1);
}

const focusableSelector =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function onKeydown(event: KeyboardEvent): void {
  if (!props.open || !isTopmost()) return;
  if (event.key === 'Escape') {
    event.stopPropagation();
    emit('close');
    return;
  }
  if (event.key === 'Tab' && panel.value) {
    const nodes = Array.from(panel.value.querySelectorAll<HTMLElement>(focusableSelector)).filter(
      (node) => node.offsetParent !== null,
    );
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

function handleBackdrop(event: MouseEvent): void {
  if (!isTopmost()) return;
  if (event.target === event.currentTarget) emit('close');
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      registerModal();
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      document.body.classList.add('modal-open');
      await nextTick();
      const first = panel.value?.querySelector<HTMLElement>(focusableSelector);
      first?.focus();
    } else {
      unregisterModal();
      if (openModals.length === 0) document.body.classList.remove('modal-open');
      previousFocus?.focus();
      previousFocus = null;
    }
  },
  { immediate: true },
);

onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  unregisterModal();
  if (openModals.length === 0) document.body.classList.remove('modal-open');
});
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="modal-backdrop" @mousedown="handleBackdrop">
        <div
          ref="panel"
          class="modal"
          :class="`modal-${size}`"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
        >
          <header class="modal-head">
            <h2 class="modal-title">{{ title }}</h2>
            <button type="button" class="btn-icon" aria-label="Dialog schließen" @click="emit('close')">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              </svg>
            </button>
          </header>
          <div class="modal-body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="modal-foot">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
