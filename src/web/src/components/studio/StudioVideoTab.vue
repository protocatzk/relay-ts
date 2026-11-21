<script setup lang="ts">
import ToggleField from '@/src/components/ToggleField.vue';
import type { VideoLayout } from '@/src/api/types';
import type { PreviewAspect } from '@/src/overlay-studio';

defineProps<{
  videoLayout: VideoLayout;
  previewAspect: PreviewAspect;
  previewAspects: { value: PreviewAspect; label: string }[];
  panelId: string;
  tabId: string;
}>();

defineEmits<{
  (e: 'update:previewAspect', val: PreviewAspect): void;
  (e: 'reset'): void;
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
      v-model="videoLayout.enabled"
      label="Video-Layout"
    />
    <p class="field-hint">
      Gilt für Quelle, Screens und lokale Videos.
    </p>
    <div class="studio-grid">
      <div class="field">
        <label for="studio-video-scale">Größe (%)</label>
        <input
          id="studio-video-scale"
          v-model.number="videoLayout.scale"
          type="range"
          min="50"
          max="400"
          step="1"
        />
        <p class="field-hint mono">{{ videoLayout.scale }} %</p>
      </div>
      <div class="field">
        <label for="studio-video-pos-x">X-Position (%)</label>
        <input
          id="studio-video-pos-x"
          v-model.number="videoLayout.position_x"
          type="range"
          min="0"
          max="100"
          step="1"
        />
        <p class="field-hint mono">{{ videoLayout.position_x }} %</p>
      </div>
      <div class="field">
        <label for="studio-video-pos-y">Y-Position (%)</label>
        <input
          id="studio-video-pos-y"
          v-model.number="videoLayout.position_y"
          type="range"
          min="0"
          max="100"
          step="1"
        />
        <p class="field-hint mono">{{ videoLayout.position_y }} %</p>
      </div>
      <div class="field">
        <label for="studio-video-preview-aspect">Vorschau-Quellformat</label>
        <select
          id="studio-video-preview-aspect"
          :value="previewAspect"
          @change="$emit('update:previewAspect', ($event.target as HTMLSelectElement).value as PreviewAspect)"
        >
          <option v-for="aspect in previewAspects" :key="aspect.value" :value="aspect.value">
            {{ aspect.label }}
          </option>
        </select>
        <p class="field-hint">Nur für die Studio-Vorschau relevant.</p>
      </div>
    </div>
    <div class="actions">
      <button type="button" class="btn btn-ghost btn-sm" @click="$emit('reset')">
        100 % zentriert
      </button>
    </div>
  </div>
</template>
