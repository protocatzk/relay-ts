<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { logout, useStore } from '@/src/composables/useStore';
import { pushToast } from '@/src/composables/useToast';
import { stateLabel, stateTone } from '@/src/utils/format';

const props = defineProps<{ sidebarOpen: boolean }>();
const emit = defineEmits<{ 'toggle-sidebar': [] }>();

const router = useRouter();
const { store } = useStore();

const state = computed(() => store.status?.state ?? null);
const tone = computed(() => stateTone(state.value));
const theme = ref(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

function toggleTheme(): void {
  theme.value = theme.value === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme.value;
  localStorage.setItem('relay-theme', theme.value);
}

const connectionLabel = computed(() => {
  if (store.connectionMode === 'live') return 'Live';
  if (store.connectionMode === 'connecting') return 'Verbinde…';
  return 'Offline';
});

async function handleLogout(): Promise<void> {
  await logout();
  pushToast('Erfolgreich abgemeldet.', 'info');
  await router.replace({ name: 'login' });
}
</script>

<template>
  <header class="app-header">
    <button
      class="btn-icon menu-toggle"
      aria-label="Navigation öffnen"
      aria-controls="sidebar"
      :aria-expanded="props.sidebarOpen"
      @click="emit('toggle-sidebar')"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
        <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    </button>

    <div class="header-brand">
      <span class="header-title">RELAY</span>
      <span class="header-sub">Restreamer</span>
    </div>

    <div class="header-status" aria-label="Systemstatus">
      <span
        class="status-inline"
        :class="`tone-${tone}`"
        role="status"
        :aria-label="`Status: ${stateLabel(state)}`"
      >
        <span class="dot" aria-hidden="true"></span>
        <span class="status-text">{{ stateLabel(state) }}</span>
      </span>
      <span
        class="conn"
        :class="`conn-${store.connectionMode}`"
        :title="store.sseConnected ? 'Echtzeit-Verbindung aktiv' : 'Keine Echtzeit-Verbindung – Status wird per Polling geladen'"
      >
        <span class="conn-dot" aria-hidden="true"></span>
        {{ connectionLabel }}
      </span>
    </div>

    <div class="header-actions">
      <button type="button" class="theme-toggle" :aria-label="`Theme: ${theme}`" @click="toggleTheme">
        <span aria-hidden="true">{{ theme === 'light' ? '☾' : '☀' }}</span>
        <span class="hide-xs">{{ theme === 'light' ? 'Dark' : 'Light' }}</span>
      </button>
      <button
        v-if="store.authRequired"
        type="button"
        class="btn btn-ghost btn-sm"
        aria-label="Abmelden"
        @click="handleLogout"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
          <path
            d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span class="hide-xs">Abmelden</span>
      </button>
    </div>
  </header>
</template>
