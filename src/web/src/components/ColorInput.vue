<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    alpha?: boolean;
    id?: string;
  }>(),
  { alpha: false, id: undefined },
);

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const parts = computed(() => {
  const raw = props.modelValue.trim();
  const at = raw.lastIndexOf('@');
  const base = at > 0 ? raw.slice(0, at) : raw;
  const value = at > 0 ? Number(raw.slice(at + 1)) : 1;
  return {
    base,
    alpha: Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1,
    hasAlpha: at > 0,
  };
});

const hex = computed(() => {
  const base = parts.value.base;
  if (/^#[0-9a-f]{6}$/i.test(base)) return base;
  if (/^0x[0-9a-f]{6}$/i.test(base)) return `#${base.slice(2)}`;
  if (/^#[0-9a-f]{3}$/i.test(base)) {
    return `#${base[1]}${base[1]}${base[2]}${base[2]}${base[3]}${base[3]}`;
  }
  return '#000000';
});

function withAlpha(base: string, alpha: number): string {
  if (!props.alpha) return base;
  return `${base}@${Math.round(alpha * 100) / 100}`;
}

function onColor(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  emit('update:modelValue', withAlpha(value, parts.value.alpha));
}

function onAlpha(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  emit('update:modelValue', withAlpha(parts.value.base, value));
}

function onText(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="color-field">
    <input
      :id="id"
      class="color-swatch"
      type="color"
      :value="hex"
      aria-label="Farbe wählen"
      @input="onColor"
    />
    <input
      class="color-text mono"
      type="text"
      :value="modelValue"
      aria-label="Farbe als Hex- oder Farbwert"
      spellcheck="false"
      @input="onText"
    />
    <input
      v-if="alpha"
      class="color-alpha"
      type="range"
      aria-label="Deckkraft"
      min="0"
      max="1"
      step="0.05"
      :value="parts.alpha"
      :title="`Deckkraft ${Math.round(parts.alpha * 100)} %`"
      @input="onAlpha"
    />
  </div>
</template>
