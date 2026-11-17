<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue: boolean;
    label: string;
    description?: string;
    disabled?: boolean;
  }>(),
  { description: '', disabled: false },
);

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();

function onChange(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).checked);
}
</script>

<template>
  <label class="toggle-field" :class="{ 'is-disabled': disabled }">
    <span class="toggle-copy">
      <span class="toggle-label">{{ label }}</span>
      <span v-if="description" class="toggle-desc">{{ description }}</span>
    </span>
    <span class="switch-wrap">
      <input
        type="checkbox"
        class="switch-input"
        role="switch"
        :checked="modelValue"
        :disabled="disabled"
        @change="onChange"
      />
      <span class="switch" aria-hidden="true"></span>
    </span>
  </label>
</template>
