<script setup lang="ts">
/**
 * Compact list row used by cockpit panels and pickers (#88).
 *
 * `interactive` adds hover/focus affordances; `active` marks the running entry.
 */
withDefaults(
  defineProps<{
    title: string;
    meta?: string | null;
    active?: boolean;
    interactive?: boolean;
    /** Trailing slot stays right-aligned next to the title. */
  }>(),
  { meta: null, active: false, interactive: false },
);
</script>

<template>
  <div
    class="list-item"
    :class="{ 'is-active': active, 'is-interactive': interactive }"
    :aria-current="active ? 'true' : undefined"
  >
    <div v-if="$slots.leading" class="list-item-leading">
      <slot name="leading" />
    </div>
    <div class="list-item-body">
      <div class="list-item-head">
        <strong class="list-item-title">{{ title }}</strong>
        <slot name="trailing" />
      </div>
      <p v-if="meta" class="list-item-meta">{{ meta }}</p>
      <slot />
    </div>
    <slot name="actions" />
  </div>
</template>
