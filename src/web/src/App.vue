<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AppHeader from '@/src/components/AppHeader.vue';
import AppSidebar from '@/src/components/AppSidebar.vue';
import ToastHost from '@/src/components/ToastHost.vue';
import { bootstrap, stopEvents, useStore } from '@/src/composables/useStore';

const route = useRoute();
const { store } = useStore();
const sidebarOpen = ref(false);

const isAuthLayout = computed(() => route.meta.layout === 'auth');

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') sidebarOpen.value = false;
}

watch(
  () => route.fullPath,
  () => {
    sidebarOpen.value = false;
  },
);

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
  stopEvents();
});
</script>

<template>
  <div v-if="isAuthLayout" class="auth-shell">
    <router-view />
  </div>

  <div v-else class="app-shell">
    <a class="skip-link" href="#main-content">Zum Inhalt springen</a>
    <AppSidebar :open="sidebarOpen" @close="sidebarOpen = false" />
    <div class="app-main">
      <AppHeader :sidebar-open="sidebarOpen" @toggle-sidebar="sidebarOpen = !sidebarOpen" />
      <main id="main-content" class="content" tabindex="-1">
        <router-view />
      </main>
      <footer class="app-footer">
        <span>RELAY Restreamer</span>
        <span v-if="store.status" class="mono">v{{ store.status.version }}</span>
      </footer>
    </div>
  </div>

  <ToastHost />
</template>
