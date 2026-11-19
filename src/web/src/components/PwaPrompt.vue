<script setup lang="ts">
import { usePwa } from '@/src/composables/usePwa';

const { state, refreshApp, dismissRefresh } = usePwa();
</script>

<template>
  <Transition name="pwa">
    <div v-if="state.needRefresh" class="pwa-banner" role="status">
      <span class="pwa-banner-text">Neue Version verfügbar</span>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="state.updating"
        @click="refreshApp"
      >
        <span v-if="state.updating" class="spinner" aria-hidden="true"></span>
        Neu laden
      </button>
      <button type="button" class="btn-icon pwa-banner-close" aria-label="Hinweis schließen" @click="dismissRefresh">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
          <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>
    </div>
  </Transition>
</template>
