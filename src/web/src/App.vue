<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AppHeader from '@/src/components/AppHeader.vue';
import AppSidebar from '@/src/components/AppSidebar.vue';
import ToastHost from '@/src/components/ToastHost.vue';
import PwaPrompt from '@/src/components/PwaPrompt.vue';
import { bootstrap, stopEvents, useStore } from '@/src/composables/useStore';

const route = useRoute();
const { store } = useStore();
const sidebarOpen = ref(false);
const mainContent = ref<HTMLElement | null>(null);
const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let sidebarWasOpen = false;

const isAuthLayout = computed(() => route.meta.layout === 'auth');
const isDeckLayout = computed(() => route.meta.layout === 'deck');

function sidebarElement(): HTMLElement | null {
  return document.getElementById('sidebar');
}

function menuToggle(): HTMLElement | null {
  return document.getElementById('menu-toggle');
}

function focusMain(event: MouseEvent): void {
  event.preventDefault();
  mainContent.value?.focus();
}

function trapSidebarFocus(event: KeyboardEvent): void {
  const sidebar = sidebarElement();
  if (!sidebar) return;
  const nodes = Array.from(sidebar.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (node) => node.getClientRects().length > 0,
  );
  if (nodes.length === 0) return;
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && sidebarOpen.value) {
    event.preventDefault();
    sidebarOpen.value = false;
    return;
  }
  if (event.key === 'Tab' && sidebarOpen.value) {
    trapSidebarFocus(event);
  }
}

watch(
  () => route.fullPath,
  () => {
    sidebarOpen.value = false;
  },
);

watch(sidebarOpen, async (open) => {
  document.body.classList.toggle('nav-open', open);
  if (open) {
    sidebarWasOpen = true;
    await nextTick();
    const first = sidebarElement()?.querySelector<HTMLElement>(focusableSelector);
    first?.focus();
  } else if (sidebarWasOpen) {
    sidebarWasOpen = false;
    menuToggle()?.focus();
  }
});

onMounted(() => {
  document.addEventListener('keydown', onKeydown);
  if (store.authenticated) void bootstrap();
});

watch(
  () => store.authenticated,
  (authenticated) => {
    if (authenticated) void bootstrap();
  },
);

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  document.body.classList.remove('nav-open');
  stopEvents();
});
</script>

<template>
  <div v-if="isAuthLayout" class="auth-shell">
    <router-view />
  </div>

  <div v-else-if="isDeckLayout" class="deck-shell">
    <router-view />
  </div>

  <div v-else class="app-shell">
    <a class="skip-link" href="#main-content" @click="focusMain">Zum Inhalt springen</a>
    <AppSidebar :open="sidebarOpen" @close="sidebarOpen = false" />
    <div class="app-main">
      <AppHeader :sidebar-open="sidebarOpen" @toggle-sidebar="sidebarOpen = !sidebarOpen" />
      <main id="main-content" ref="mainContent" class="content" tabindex="-1">
        <router-view />
      </main>
      <footer class="app-footer">
        <span>RELAY Restreamer</span>
        <span v-if="store.status" class="mono">v{{ store.status.version }}</span>
      </footer>
    </div>
  </div>

  <ToastHost />
  <PwaPrompt />
</template>
