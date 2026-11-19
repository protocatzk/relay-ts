<script setup lang="ts">
import { computed } from 'vue';
import Sparkline from '@/src/components/Sparkline.vue';

export type VitalModule = 'source' | 'relay' | 'sink' | 'watchdog';

const props = defineProps<{
  label: string;
  value: string;
  sub?: string;
  module: VitalModule;
  series: number[];
  /** Status tone overrides the module color for the value text. */
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'muted';
}>();

const modClass = computed(() => `mod-${props.module}`);

const icon = computed(() => {
  switch (props.module) {
    case 'source':
      return 'M5 19a8 8 0 0 1 14 0M12 5a3 3 0 0 1 3 3c0 1.4-1 2.6-3 4.2-2-1.6-3-2.8-3-4.2a3 3 0 0 1 3-3ZM8 19a4 4 0 0 1 8 0';
    case 'relay':
      return 'M7 7h10M7 12h10M7 17h6M17 17l2 1-2 1';
    case 'sink':
      return 'M12 3v11m0 0 4-4m-4 4-4-4M5 19h14';
    case 'watchdog':
      return 'M12 3 4 6v6c0 4.5 3.2 7.6 8 9 4.8-1.4 8-4.5 8-9V6l-8-3Z';
  }
});
</script>

<template>
  <section class="card vital" :class="modClass">
    <div class="vital-head">
      <span class="vital-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
          <path
            :d="icon"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
      <span class="vital-label">{{ label }}</span>
    </div>
    <div class="vital-value mono" :class="tone ? `c-${tone}` : undefined">{{ value }}</div>
    <Sparkline class="vital-spark" :values="series" color="var(--mod)" />
    <p v-if="sub" class="vital-sub">{{ sub }}</p>
  </section>
</template>
