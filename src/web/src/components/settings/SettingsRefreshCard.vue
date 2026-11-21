<script setup lang="ts">
import ToggleField from '@/src/components/ToggleField.vue';

interface AutoRefreshModel {
  enabled: boolean;
  interval: number;
}

defineProps<{
  refresh: AutoRefreshModel;
  dirty: boolean;
  saving: boolean;
  busySaving: boolean;
}>();

defineEmits<{
  (e: 'save'): void;
}>();
</script>

<template>
  <section id="settings-refresh" class="card settings-section" tabindex="-1">
    <div class="card-head">
      <div>
        <h2 class="card-title">Auto-Refresh</h2>
      </div>
      <div class="settings-section-actions">
        <span v-if="dirty" class="badge tone-warning">Ungespeichert</span>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          aria-label="Auto-Refresh speichern"
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
        v-model="refresh.enabled"
        label="Auto-Refresh aktiviert"
      />
      <div class="settings-grid">
        <div class="field">
          <label for="refresh-interval">Intervall (Minuten)</label>
          <input id="refresh-interval" v-model.number="refresh.interval" type="number" min="1" max="720" />
        </div>
      </div>
    </div>
  </section>
</template>
