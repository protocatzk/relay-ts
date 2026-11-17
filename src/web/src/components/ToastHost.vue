<script setup lang="ts">
import { useToast } from '@/src/composables/useToast';

const { toasts, dismissToast } = useToast();
</script>

<template>
  <div class="toast-host" aria-live="polite" aria-atomic="false">
    <TransitionGroup name="toast">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="toast"
        :class="`toast-${toast.kind}`"
        role="status"
      >
        <span class="toast-icon" aria-hidden="true">
          <svg v-if="toast.kind === 'success'" viewBox="0 0 24 24" width="18" height="18" fill="none">
            <path d="m5 12.5 4.2 4.2L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <svg v-else-if="toast.kind === 'error'" viewBox="0 0 24 24" width="18" height="18" fill="none">
            <path d="M12 7v6M12 17h.01" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" />
          </svg>
          <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" />
            <path d="M12 11v5M12 8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </span>
        <p class="toast-message">{{ toast.message }}</p>
        <button class="toast-close" aria-label="Meldung schließen" @click="dismissToast(toast.id)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
