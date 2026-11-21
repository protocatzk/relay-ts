<script setup lang="ts">
import ToggleField from '@/src/components/ToggleField.vue';
import type { LogoOverlay } from '@/src/api/types';

defineProps<{
  logo: LogoOverlay;
  positions: { value: string; label: string }[];
  panelId: string;
  tabId: string;
}>();
</script>

<template>
  <div
    :id="panelId"
    role="tabpanel"
    :aria-labelledby="tabId"
    tabindex="0"
    class="studio-body"
  >
    <ToggleField
      v-model="logo.enabled"
      label="Logo-Overlay"
    />
    <div class="studio-grid">
      <div class="field">
        <label for="studio-logo-position">Position</label>
        <select id="studio-logo-position" v-model="logo.position">
          <option v-for="position in positions" :key="position.value" :value="position.value">
            {{ position.label }}
          </option>
        </select>
      </div>
      <div class="field">
        <label for="studio-logo-width">Breite (px)</label>
        <input
          id="studio-logo-width"
          v-model.number="logo.width"
          type="number"
          min="32"
          max="1024"
        />
      </div>
      <div class="field">
        <label for="studio-logo-opacity">Deckkraft (%)</label>
        <input
          id="studio-logo-opacity"
          v-model.number="logo.opacity"
          type="range"
          min="0"
          max="100"
          step="5"
        />
        <p class="field-hint mono">{{ logo.opacity }} %</p>
      </div>
      <div class="field">
        <label for="studio-logo-margin">Randabstand (px)</label>
        <input
          id="studio-logo-margin"
          v-model.number="logo.margin"
          type="number"
          min="0"
          max="120"
        />
      </div>
    </div>
    <p class="field-hint">
      Das Logo wird aus <code class="mono">web/dist/logo.png</code> geladen und als eigener Stream (fd 4) in den Sink gespeist.
    </p>
  </div>
</template>
