<script setup lang="ts">
/**
 * Card surface with explicit elevation (#88).
 *
 * `level` maps to the three surface levels from `tokens.css`. Level 1 is a flat
 * panel (default), level 2 lifts interactive areas, level 3 is for overlays.
 */
export type AppCardLevel = 1 | 2 | 3;

withDefaults(
  defineProps<{
    level?: AppCardLevel;
    /** Removes the default padding for cards that manage their own layout. */
    flush?: boolean;
    /** Semantic element, `section` by default. */
    as?: 'section' | 'article' | 'div' | 'aside';
  }>(),
  { level: 1, flush: false, as: 'section' },
);
</script>

<template>
  <component :is="as" class="card" :class="[`card-elev-${level}`, flush ? 'card-flush' : null]">
    <slot />
  </component>
</template>
