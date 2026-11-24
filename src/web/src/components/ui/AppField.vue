<script setup lang="ts">
/**
 * Form field wrapper: label, control slot, hint and error text (#88).
 *
 * The `id` is wired to `<label for>` and exposed on the slot as `controlId` so
 * inputs stay accessible without repeating the id in every view.
 */
import { computed, useId } from 'vue';

const props = withDefaults(
  defineProps<{
    label: string;
    /** Optional id; generated when omitted. */
    id?: string;
    hint?: string;
    error?: string;
    required?: boolean;
  }>(),
  { required: false },
);

const uid = useId();
const controlId = computed(() => props.id ?? `field-${uid}`);
const hintId = computed(() => (props.hint ? `${controlId.value}-hint` : undefined));
</script>

<template>
  <div class="field" :class="{ 'field-invalid': Boolean(error) }">
    <label :for="controlId">
      {{ label }}
      <span v-if="required" class="req" aria-hidden="true">*</span>
    </label>
    <slot :control-id="controlId" :described-by="hintId" />
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <p v-else-if="hint" :id="hintId" class="field-hint">{{ hint }}</p>
  </div>
</template>
