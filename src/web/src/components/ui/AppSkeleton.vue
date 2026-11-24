<script setup lang="ts">
/**
 * Loading placeholder (#88). Replaces spinners on list/detail views so the
 * layout does not jump once data arrives.
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    /** Width of the last line; earlier lines shrink slightly for a text look. */
    width?: string;
    height?: string;
    lines?: number;
    radius?: string;
  }>(),
  { width: '100%', height: '12px', lines: 1, radius: '6px' },
);

const widths = computed(() =>
  Array.from({ length: Math.max(1, props.lines) }, (_, index) => {
    if (props.lines === 1) return props.width;
    const last = index === props.lines - 1;
    return last ? props.width : `calc(${props.width} * ${1 - (props.lines - 1 - index) * 0.06})`;
  }),
);
</script>

<template>
  <div class="skeleton-stack" aria-hidden="true">
    <span
      v-for="(lineWidth, index) in widths"
      :key="index"
      class="skeleton"
      :style="{ width: lineWidth, height, borderRadius: radius }"
    ></span>
  </div>
</template>
