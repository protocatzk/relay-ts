<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AppHeader from '@/src/components/AppHeader.vue';
import AppBottomNav from '@/src/components/AppBottomNav.vue';
import SectionTabs from '@/src/components/SectionTabs.vue';
import ToastHost from '@/src/components/ToastHost.vue';
import PwaPrompt from '@/src/components/PwaPrompt.vue';
import UnsavedChangesDialog from '@/src/components/UnsavedChangesDialog.vue';
import { checkServerVersion } from '@/src/composables/usePwa';
import { bootstrap, stopEvents, useStore } from '@/src/composables/useStore';

const route = useRoute();
const { store } = useStore();
const mainContent = ref<HTMLElement | null>(null);

const isAuthLayout = computed(() => route.meta.layout === 'auth');
const isDeckLayout = computed(() => route.meta.layout === 'deck');

function focusMain(event: MouseEvent): void {
  event.preventDefault();
  mainContent.value?.focus();
}

onMounted(() => {
  if (store.authenticated) void bootstrap();
});

watch(
  () => store.authenticated,
  (authenticated) => {
    if (authenticated) void bootstrap();
  },
);

// A newer server version means this bundle is stale; force a fresh load.
watch(
  () => store.status?.version,
  (version) => checkServerVersion(version),
  { immediate: true },
);

onBeforeUnmount(() => {
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
    <div class="app-main">
      <AppHeader />
      <SectionTabs />
      <main id="main-content" ref="mainContent" class="content" tabindex="-1">
        <router-view />
      </main>
      <footer class="app-footer">
        <span>RELAY Restreamer</span>
        <span v-if="store.status" class="mono">v{{ store.status.version }}</span>
      </footer>
    </div>
    <AppBottomNav />
  </div>

  <ToastHost />
  <PwaPrompt />
  <UnsavedChangesDialog />
</template>
