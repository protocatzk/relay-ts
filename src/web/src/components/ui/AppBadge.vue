<script setup lang="ts">
/** Small status chip (#88). Maps onto the existing `.badge` / `.tone-*` styles. */
export type AppBadgeTone = 'neutral' | 'muted' | 'success' | 'warning' | 'danger' | 'info';

withDefaults(
  defineProps<{
    tone?: AppBadgeTone;
    size?: 'xs' | 'md' | 'lg';
  }>(),
  { tone: 'neutral', size: 'md' },
);
</script>

<template>
  <span class="badge" :class="[`tone-${tone}`, size !== 'md' ? `badge-${size}` : null]">
    <slot />
  </span>
</template>
