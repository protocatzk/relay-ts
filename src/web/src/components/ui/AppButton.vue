<script setup lang="ts">
/**
 * Shared button primitive (#88).
 *
 * Wraps the existing `.btn` styles with a typed variant API so views can stop
 * hand-assembling class strings. Renders a `<RouterLink>` when `to` is set.
 */
import { computed } from 'vue';
import type { RouteLocationRaw } from 'vue-router';

export type AppButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
export type AppButtonSize = 'xs' | 'sm' | 'md';

const props = withDefaults(
  defineProps<{
    variant?: AppButtonVariant;
    size?: AppButtonSize;
    /** Destination: renders a RouterLink instead of a button. */
    to?: RouteLocationRaw;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    /** Shows a spinner and disables interaction. */
    loading?: boolean;
    /** Full width of the parent. */
    block?: boolean;
    title?: string;
  }>(),
  {
    variant: 'secondary',
    size: 'md',
    type: 'button',
    disabled: false,
    loading: false,
    block: false,
  },
);
</script>

<template>
  <RouterLink
    v-if="to"
    :to="to"
    class="btn"
    :class="[`btn-${variant}`, size !== 'md' ? `btn-${size}` : null, block ? 'btn-block' : null]"
    :title="title"
  >
    <span v-if="loading" class="spinner" aria-hidden="true"></span>
    <slot />
  </RouterLink>
  <button
    v-else
    :type="type"
    class="btn"
    :class="[`btn-${variant}`, size !== 'md' ? `btn-${size}` : null, block ? 'btn-block' : null]"
    :disabled="disabled || loading"
    :title="title"
    :aria-busy="loading || undefined"
  >
    <span v-if="loading" class="spinner" aria-hidden="true"></span>
    <slot />
  </button>
</template>
