<script setup lang="ts">
import ColorInput from '@/src/components/ColorInput.vue';
import StudioGroup from '@/src/components/StudioGroup.vue';
import ToggleField from '@/src/components/ToggleField.vue';
import type { EarningsSettings } from '@/src/api/types';
import type { Section } from '@/src/overlay-studio';

defineProps<{
  earnings: EarningsSettings;
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
      v-model="earnings.overlay_enabled"
      label="Einnahmen-Overlay"
    />
    <StudioGroup
      title="Template & Stil"
      :open="groupOpen('earnings', 'all', 0)"
      @update:open="$emit('setGroupOpen', 'earnings', 'all', $event)"
    >
      <div class="field">
        <label for="studio-earnings-template">Template</label>
        <textarea
          id="studio-earnings-template"
          v-model="earnings.overlay_template"
          rows="3"
          maxlength="500"
        ></textarea>
        <p class="field-hint">
          Variablen: <code class="mono">{coins}</code>, <code class="mono">{diamonds}</code>,
          <code class="mono">{eur}</code>, <code class="mono">{usd}</code>, <code class="mono">{likes}</code>,
          <code class="mono">{streamers}</code>, <code class="mono">{period}</code>
        </p>
      </div>
      <div class="field">
        <label for="studio-earnings-goal-amount">Spenden-Zielbetrag (EUR, 0 = kein Ziel)</label>
        <input
          id="studio-earnings-goal-amount"
          v-model.number="earnings.goal_amount"
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
        />
        <p class="field-hint">Betrag in EUR, ab dem ein Fortschrittsbalken im Overlay und Chat berechnet wird.</p>
      </div>
      <div v-if="(earnings.goal_amount ?? 0) > 0" class="field">
        <label for="studio-earnings-goal-label">Ziel-Bezeichnung</label>
        <input
          id="studio-earnings-goal-label"
          v-model="earnings.goal_label"
          type="text"
          maxlength="60"
          placeholder="z.B. Neuer Streaming-PC"
        />
        <p class="field-hint">Wird über dem Zielbalken angezeigt. Leer lassen für keine Beschriftung.</p>
      </div>
      <div v-if="(earnings.goal_amount ?? 0) > 0" class="checkbox-grid studio-checks">
        <label class="checkbox">
          <input v-model="earnings.goal_bar_enabled" type="checkbox" />
          Zielbalken im Einnahmen-Overlay anzeigen
        </label>
      </div>
      <div class="studio-grid">
        <div class="field">
          <label for="studio-earnings-position">Position</label>
          <select id="studio-earnings-position" v-model="earnings.overlay_position">
            <option v-for="position in positions" :key="position.value" :value="position.value">
              {{ position.label }}
            </option>
          </select>
        </div>
        <div class="field">
          <label for="studio-earnings-font-size">Schriftgröße (px)</label>
          <input id="studio-earnings-font-size" v-model.number="earnings.overlay_font_size" type="number" min="10" max="64" />
        </div>
        <div class="field">
          <label for="studio-earnings-margin">Randabstand (px)</label>
          <input id="studio-earnings-margin" v-model.number="earnings.overlay_margin" type="number" min="0" max="120" />
        </div>
        <div class="field">
          <label for="studio-earnings-offset-x">Feinjustierung X (px)</label>
          <input id="studio-earnings-offset-x" v-model.number="earnings.overlay_offset_x" type="number" min="-500" max="500" />
        </div>
        <div class="field">
          <label for="studio-earnings-offset-y">Feinjustierung Y (px)</label>
          <input id="studio-earnings-offset-y" v-model.number="earnings.overlay_offset_y" type="number" min="-500" max="500" />
        </div>
        <div class="field">
          <label for="studio-earnings-font-color">Schriftfarbe</label>
          <ColorInput id="studio-earnings-font-color" v-model="earnings.overlay_font_color" />
        </div>
        <div class="field">
          <label for="studio-earnings-box-color">Hintergrundfarbe</label>
          <ColorInput id="studio-earnings-box-color" v-model="earnings.overlay_box_color" alpha />
        </div>
      </div>
      <div class="checkbox-grid studio-checks">
        <label class="checkbox"><input v-model="earnings.overlay_show_box" type="checkbox" /> Hintergrundbox anzeigen</label>
      </div>
    </StudioGroup>
  </div>
</template>
