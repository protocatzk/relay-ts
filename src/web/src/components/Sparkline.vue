<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    values: number[];
    color?: string;
    height?: number;
    strokeWidth?: number;
    fill?: boolean;
  }>(),
  {
    color: 'var(--accent)',
    height: 34,
    strokeWidth: 1.6,
    fill: true,
  },
);

const line = computed(() => {
  const values = props.values;
  if (values.length < 2) return '';
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const range = max - min || 1;
  const width = 100;
  const innerHeight = 32;
  const step = width / (values.length - 1);
  const points = values.map((value, index) => {
    const x = index * step;
    const y = innerHeight - ((value - min) / range) * (innerHeight - 3) - 1.5;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return `M${points.join(' L')}`;
});

const area = computed(() => (line.value ? `${line.value} L100,32 L0,32 Z` : ''));
</script>

<template>
  <svg
    class="sparkline"
    :height="height"
    viewBox="0 0 100 32"
    preserveAspectRatio="none"
    role="img"
    aria-hidden="true"
  >
    <path v-if="area" class="sparkline-area" :d="area" :style="{ fill: color }" />
    <path class="sparkline-line" :d="line || undefined" :style="{ stroke: color, strokeWidth }" />
  </svg>
</template>
