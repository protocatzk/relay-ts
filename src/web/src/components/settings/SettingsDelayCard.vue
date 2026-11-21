<script setup lang="ts">
import ToggleField from '@/src/components/ToggleField.vue';

interface DelayBufferModel {
  enabled: boolean;
  size: number;
  catchup_rate?: number;
}

defineProps<{
  model: DelayBufferModel;
  dirty: boolean;
  saving: boolean;
  busySaving: boolean;
}>();

defineEmits<{
  (e: 'save'): void;
}>();
</script>

<template>
  <section id="settings-delay" class="card settings-section" tabindex="-1">
    <div class="card-head">
      <div>
        <h2 class="card-title">Verzögerung</h2>
      </div>
      <div class="settings-section-actions">
        <span v-if="dirty" class="badge tone-warning">Ungespeichert</span>
        <span class="badge tone-warning">Neustart erforderlich</span>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          aria-label="Verzögerung speichern"
          :disabled="!dirty || busySaving"
          @click="$emit('save')"
        >
          <span v-if="saving" class="spinner" aria-hidden="true"></span>
          Speichern
        </button>
      </div>
    </div>
    <div class="settings-body">
      <ToggleField
        v-model="model.enabled"
        label="Delay-Buffer aktiviert"
        description="Puffert die Quelle gegen kurze Aussetzer."
      />
      <div class="settings-grid">
        <div class="field">
          <label for="delay-size">Puffergröße (Sekunden)</label>
          <input id="delay-size" v-model.number="model.size" type="number" min="0" max="300" />
          <p class="field-hint">20–40 s empfohlen; Neustart erforderlich.</p>
        </div>
        <div class="field">
          <label for="delay-catchup-rate">Catch-Up-Faktor</label>
          <input
            id="delay-catchup-rate"
            v-model.number="model.catchup_rate"
            type="number"
            min="1"
            max="1.1"
            step="0.01"
          />
          <p class="field-hint">1.01 empfohlen (baut überschüssigen Puffer mit 1,01× ab; 1 = aus).</p>
        </div>
      </div>
    </div>
  </section>
</template>
