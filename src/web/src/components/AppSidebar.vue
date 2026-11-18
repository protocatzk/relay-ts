<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useStore } from '@/src/composables/useStore';

defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const route = useRoute();
const { store } = useStore();

const connectionLabel = computed(() => {
  if (store.connectionMode === 'live') return 'Live';
  if (store.connectionMode === 'connecting') return 'Verbinde…';
  return 'Offline';
});

function isActive(path: string): boolean {
  return path === '/' ? route.path === '/' : route.path.startsWith(path);
}
</script>

<template>
  <div v-if="open" class="sidebar-backdrop" aria-hidden="true" @click="emit('close')"></div>

  <aside id="sidebar" class="sidebar" :class="{ 'is-open': open }" aria-label="Hauptnavigation">
    <div class="sidebar-brand">
      <img class="brand-logo" src="/logo.svg" alt="" width="32" height="32" aria-hidden="true" />
      <span class="brand-text">
        <strong>RELAY</strong>
        <small>Restreamer</small>
      </span>
      <button class="btn-icon sidebar-close" aria-label="Menü schließen" @click="emit('close')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
          <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    <nav class="sidebar-nav" aria-label="Hauptnavigation">
      <p class="nav-label">Steuerung</p>

      <RouterLink
        to="/"
        class="nav-link"
        :class="{ 'is-active': isActive('/') }"
        :aria-current="isActive('/') ? 'page' : undefined"
        @click="emit('close')"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8" />
        </svg>
        <span>Dashboard</span>
      </RouterLink>

      <RouterLink
        to="/streamers"
        class="nav-link"
        :class="{ 'is-active': isActive('/streamers') }"
        :aria-current="isActive('/streamers') ? 'page' : undefined"
        @click="emit('close')"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
          <circle cx="9" cy="8" r="3.4" stroke="currentColor" stroke-width="1.8" />
          <path
            d="M2.8 20c.5-3.2 3-5.2 6.2-5.2s5.7 2 6.2 5.2M16.5 5.2a3.2 3.2 0 0 1 0 6.2M18 14.8c2 .6 3.3 2.3 3.6 4.6"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        </svg>
        <span>Streamer</span>
      </RouterLink>

      <RouterLink
        to="/overlays"
        class="nav-link"
        :class="{ 'is-active': isActive('/overlays') }"
        :aria-current="isActive('/overlays') ? 'page' : undefined"
        @click="emit('close')"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
          <rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" stroke-width="1.8" />
          <path d="M7 9h10M7 13h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          <path d="M8 21h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
        <span>Overlays</span>
      </RouterLink>

      <RouterLink
        to="/playlists"
        class="nav-link"
        :class="{ 'is-active': isActive('/playlists') }"
        :aria-current="isActive('/playlists') ? 'page' : undefined"
        @click="emit('close')"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
          <path d="M4 6h16M4 12h10M4 18h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          <path
            d="m16 14 5 3-5 3v-6Z"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linejoin="round"
          />
        </svg>
        <span>Playlists</span>
      </RouterLink>

      <RouterLink
        to="/settings"
        class="nav-link"
        :class="{ 'is-active': isActive('/settings') }"
        :aria-current="isActive('/settings') ? 'page' : undefined"
        @click="emit('close')"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="3.1" stroke="currentColor" stroke-width="1.8" />
          <path
            d="M19 12a7 7 0 0 0-.12-1.3l2-1.55-2-3.45-2.4 1a7 7 0 0 0-2.25-1.3L13.8 3h-3.6l-.43 2.4a7 7 0 0 0-2.25 1.3l-2.4-1-2 3.45 2 1.55A7 7 0 0 0 5 12c0 .44.04.87.12 1.3l-2 1.55 2 3.45 2.4-1a7 7 0 0 0 2.25 1.3l.43 2.4h3.6l.43-2.4a7 7 0 0 0 2.25-1.3l2.4 1 2-3.45-2-1.55c.08-.43.12-.86.12-1.3Z"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
        </svg>
        <span>Einstellungen</span>
      </RouterLink>

      <RouterLink
        to="/logs"
        class="nav-link"
        :class="{ 'is-active': isActive('/logs') }"
        :aria-current="isActive('/logs') ? 'page' : undefined"
        @click="emit('close')"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2.5" stroke="currentColor" stroke-width="1.8" />
          <path d="m7 9 3 3-3 3M12.5 15H17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span>Logs</span>
      </RouterLink>
    </nav>

    <div class="sidebar-foot">
      <span class="conn-mini" :class="`conn-${store.connectionMode}`">
        <span class="conn-dot" aria-hidden="true"></span>
        {{ connectionLabel }}
      </span>
      <span v-if="store.status" class="version mono">v{{ store.status.version }}</span>
    </div>
  </aside>
</template>
