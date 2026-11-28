<script setup lang="ts">
import ColorInput from '@/src/components/ColorInput.vue';
import ToggleField from '@/src/components/ToggleField.vue';
import type { VersionOverlay } from '@/src/api/types';

defineProps<{
  versionOverlay: VersionOverlay;
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
      v-model="versionOverlay.enabled"
      label="Versions-Overlay"
    />
    <div class="studio-grid">
      <div class="field">
        <label for="studio-version-prefix">Präfix</label>
        <input id="studio-version-prefix" v-model="versionOverlay.prefix" type="text" maxlength="40" />
      </div>
      <div class="field">
        <label for="studio-version-position">Position</label>
        <select id="studio-version-position" v-model="versionOverlay.position">
          <option v-for="position in positions" :key="position.value" :value="position.value">
            {{ position.label }}
          </option>
        </select>
      </div>
      <div class="field">
        <label for="studio-version-font-size">Schriftgröße (px)</label>
        <input id="studio-version-font-size" v-model.number="versionOverlay.font_size" type="number" min="8" max="48" />
      </div>
      <div class="field">
        <label for="studio-version-margin">Randabstand (px)</label>
        <input id="studio-version-margin" v-model.number="versionOverlay.margin" type="number" min="0" max="120" />
      </div>
      <div class="field">
        <label for="studio-version-offset-x">Offset X (px)</label>
        <input id="studio-version-offset-x" v-model.number="versionOverlay.offset_x" type="number" min="-1920" max="1920" />
      </div>
      <div class="field">
        <label for="studio-version-offset-y">Offset Y (px)</label>
        <input id="studio-version-offset-y" v-model.number="versionOverlay.offset_y" type="number" min="-1080" max="1080" />
      </div>
      <div class="field">
        <label for="studio-version-font-color">Schriftfarbe</label>
        <ColorInput id="studio-version-font-color" v-model="versionOverlay.font_color" alpha />
      </div>
      <div class="field">
        <label for="studio-version-box-color">Hintergrundfarbe</label>
        <ColorInput id="studio-version-box-color" v-model="versionOverlay.box_color" alpha />
      </div>
      <div class="field">
        <label for="studio-version-hint">Update-Hinweis</label>
        <input
          id="studio-version-hint"
          v-model="versionOverlay.update_hint"
          type="text"
          maxlength="60"
          :disabled="!versionOverlay.show_update_hint"
        />
      </div>
    </div>
    <div class="checkbox-grid studio-checks">
      <label class="checkbox"><input v-model="versionOverlay.show_box" type="checkbox" /> Hintergrundbox anzeigen</label>
      <label class="checkbox"><input v-model="versionOverlay.show_update_hint" type="checkbox" /> Update-Hinweis anhängen</label>
    </div>
  </div>
</template>
