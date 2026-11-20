<script setup lang="ts">
import { useRouter } from 'vue-router';
import LiveMenu from '@/src/components/LiveMenu.vue';
import { logout, useStore } from '@/src/composables/useStore';
import { pushToast } from '@/src/composables/useToast';
import { useTheme } from '@/src/composables/useTheme';
import { usePwa } from '@/src/composables/usePwa';

const router = useRouter();
const { store } = useStore();
const { theme, preference, themeLabel, toggleTheme } = useTheme();
const { state: pwaState, promptInstall } = usePwa();

async function handleInstall(): Promise<void> {
  if (pwaState.isIos) {
    pushToast('Öffne das Teilen-Menü und tippe „Zum Home-Bildschirm“.', 'info');
    return;
  }
  const installed = await promptInstall();
  if (installed) pushToast('RELAY wurde installiert.', 'success');
}

async function handleLogout(): Promise<void> {
  await logout();
  pushToast('Erfolgreich abgemeldet.', 'info');
  await router.replace({ name: 'login' });
}
</script>

<template>
  <header class="app-header">
    <div class="header-brand">
      <img class="header-logo" src="/logo.svg" alt="" width="26" height="26" aria-hidden="true" />
      <span class="header-title">RELAY</span>
      <span class="header-sub">Restreamer</span>
    </div>

    <div class="header-status" aria-label="Systemstatus">
      <LiveMenu />
    </div>

    <div class="header-actions">
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        aria-label="Stream-Deck öffnen"
        title="Stream-Deck (Vollbild-Steuerung)"
        @click="router.push('/deck')"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2.5" stroke="currentColor" stroke-width="1.8" />
          <path d="M3 9h18M3 15h18M9 3v18M15 3v18" stroke="currentColor" stroke-width="1.8" />
        </svg>
        <span class="hide-xs">Deck</span>
      </button>
      <button
        v-if="pwaState.canInstall || pwaState.isIos"
        type="button"
        class="btn btn-ghost btn-sm"
        @click="handleInstall"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
          <path
            d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span class="hide-xs">Installieren</span>
      </button>
      <button
        type="button"
        class="theme-toggle"
        :aria-label="`Theme: ${themeLabel} (${preference})`"
        :title="`Theme wechseln (Auto → Neon → Amber) · aktuell: ${themeLabel}`"
        @click="toggleTheme"
      >
        <span aria-hidden="true">{{ preference === 'auto' ? '◐' : theme === 'light' ? '☾' : '☀' }}</span>
        <span class="hide-xs">{{ themeLabel }}</span>
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
