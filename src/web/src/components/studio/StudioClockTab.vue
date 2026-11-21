<script setup lang="ts">
import ColorInput from '@/src/components/ColorInput.vue';
import ToggleField from '@/src/components/ToggleField.vue';
import type { ClockOverlay } from '@/src/api/types';

defineProps<{
  clock: ClockOverlay;
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
      v-model="clock.enabled"
      label="Uhr-Overlay"
    />
    <div class="studio-grid">
      <div class="field">
        <label for="studio-clock-format">Format</label>
        <select id="studio-clock-format" v-model="clock.format">
          <option value="%H:%M">HH:MM</option>
          <option value="%H:%M:%S">HH:MM:SS</option>
        </select>
      </div>
      <div class="field">
        <label for="studio-clock-position">Position</label>
        <select id="studio-clock-position" v-model="clock.position">
          <option v-for="position in positions" :key="position.value" :value="position.value">
            {{ position.label }}
          </option>
        </select>
      </div>
      <div class="field">
        <label for="studio-clock-font-size">Schriftgröße (px)</label>
        <input id="studio-clock-font-size" v-model.number="clock.font_size" type="number" min="10" max="64" />
      </div>
      <div class="field">
        <label for="studio-clock-margin">Randabstand (px)</label>
        <input id="studio-clock-margin" v-model.number="clock.margin" type="number" min="0" max="120" />
      </div>
      <div class="field">
        <label for="studio-clock-font-color">Schriftfarbe</label>
        <ColorInput id="studio-clock-font-color" v-model="clock.font_color" />
      </div>
      <div class="field">
        <label for="studio-clock-box-color">Hintergrundfarbe</label>
        <ColorInput id="studio-clock-box-color" v-model="clock.box_color" alpha />
      </div>
    </div>
    <div class="checkbox-grid studio-checks">
      <label class="checkbox"><input v-model="clock.show_box" type="checkbox" /> Hintergrundbox anzeigen</label>
    </div>
  </div>
</template>
