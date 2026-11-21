<script setup lang="ts">
import ColorInput from '@/src/components/ColorInput.vue';
import StudioGroup from '@/src/components/StudioGroup.vue';
import ToggleField from '@/src/components/ToggleField.vue';
import type { TextOverlay } from '@/src/api/types';
import type { Section } from '@/src/overlay-studio';

defineProps<{
  text: TextOverlay;
  positions: { value: string; label: string }[];
  panelId: string;
  tabId: string;
  groupOpen: (section: Section, name: string, fallbackIdx: number) => boolean;
}>();

defineEmits<{
  (e: 'setGroupOpen', section: Section, name: string, open: boolean): void;
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
      v-model="text.enabled"
      label="Text-Overlay"
    />
    <StudioGroup
      title="Inhalt & Position"
      :open="groupOpen('text', 'content', 0)"
      @update:open="$emit('setGroupOpen', 'text', 'content', $event)"
    >
      <div class="field">
        <label for="studio-text-content">Text</label>
        <textarea id="studio-text-content" v-model="text.text" rows="2" maxlength="300"></textarea>
      </div>
      <div class="studio-grid">
        <div class="field">
          <label for="studio-text-position">Position</label>
          <select id="studio-text-position" v-model="text.position">
            <option v-for="position in positions" :key="position.value" :value="position.value">
              {{ position.label }}
            </option>
          </select>
        </div>
        <div class="field">
          <label for="studio-text-font-size">Schriftgröße (px)</label>
          <input id="studio-text-font-size" v-model.number="text.font_size" type="number" min="10" max="64" />
        </div>
        <div class="field">
          <label for="studio-text-margin">Randabstand (px)</label>
          <input id="studio-text-margin" v-model.number="text.margin" type="number" min="0" max="120" />
        </div>
      </div>
    </StudioGroup>
    <StudioGroup
      title="Animation & Stil"
      :open="groupOpen('text', 'look', 1)"
      @update:open="$emit('setGroupOpen', 'text', 'look', $event)"
    >
      <div class="studio-grid">
        <div class="field">
          <label for="studio-text-speed">Lauftext-Geschwindigkeit</label>
          <input id="studio-text-speed" v-model.number="text.speed" type="number" min="10" max="300" />
        </div>
        <div class="field">
          <label for="studio-text-font-color">Schriftfarbe</label>
          <ColorInput id="studio-text-font-color" v-model="text.font_color" />
        </div>
        <div class="field">
          <label for="studio-text-box-color">Hintergrundfarbe</label>
          <ColorInput id="studio-text-box-color" v-model="text.box_color" alpha />
        </div>
      </div>
      <div class="checkbox-grid studio-checks">
        <label class="checkbox"><input v-model="text.marquee" type="checkbox" /> Lauftext aktivieren</label>
        <label class="checkbox"><input v-model="text.show_box" type="checkbox" /> Hintergrundbox anzeigen</label>
      </div>
    </StudioGroup>
  </div>
</template>
