<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  title: string;
  open: boolean;
}>();

const emit = defineEmits<{ 'update:open': [open: boolean] }>();

const root = ref<HTMLDetailsElement | null>(null);

function onToggle(event: Event): void {
  const open = (event.target as HTMLDetailsElement).open;
  if (open !== props.open) emit('update:open', open);
}

watch(
  () => props.open,
  (open) => {
    if (root.value && root.value.open !== open) root.value.open = open;
  },
);
</script>

<template>
  <details ref="root" class="studio-group" :open="open" @toggle="onToggle">
    <summary class="studio-group-head">
      <span>{{ title }}</span>
      <span class="studio-group-chevron" aria-hidden="true"></span>
    </summary>
    <div class="studio-group-body">
      <slot />
    </div>
  </details>
</template>
