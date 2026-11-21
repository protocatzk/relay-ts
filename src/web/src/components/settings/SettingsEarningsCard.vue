<script setup lang="ts">
import ToggleField from '@/src/components/ToggleField.vue';

interface EarningsModel {
  enabled: boolean;
  source_url: string;
  interval: number;
  period: 'today' | '24h' | '7d' | '30d' | 'all';
  view: 'compact' | 'standard' | 'detailed';
  api_key_set: boolean;
}

defineProps<{
  earnings: EarningsModel;
  earningsApiKey: string;
  dirty: boolean;
  saving: boolean;
  busySaving: boolean;
}>();

defineEmits<{
  (e: 'save'): void;
  (e: 'update:earningsApiKey', val: string): void;
}>();
</script>

<template>
  <section id="settings-earnings" class="card settings-section" tabindex="-1">
    <div class="card-head">
      <div>
        <h2 class="card-title">Einnahmen</h2>
        <p class="card-sub">TokTracker-Format.</p>
      </div>
      <div class="settings-section-actions">
        <span v-if="dirty" class="badge tone-warning">Ungespeichert</span>
        <span v-if="earnings.api_key_set" class="badge tone-success">API-Key gesetzt</span>
        <span v-else class="badge tone-muted">Kein API-Key</span>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          aria-label="Einnahmen speichern"
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
        v-model="earnings.enabled"
        label="Einnahmen-Monitor aktiviert"
      />
      <div class="settings-grid">
        <div class="field">
          <label for="earnings-url">Quell-URL</label>
          <input id="earnings-url" v-model="earnings.source_url" type="url" spellcheck="false" />
        </div>
        <div class="field">
          <label for="earnings-key">API-Key</label>
          <input
            id="earnings-key"
            :value="earningsApiKey"
            type="password"
            :placeholder="earnings.api_key_set ? '•••••••• (gesetzt – leer lassen zum Behalten)' : 'API-Key eingeben'"
            autocomplete="new-password"
            @input="$emit('update:earningsApiKey', ($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="field">
          <label for="earnings-interval">Aktualisierungsintervall (Sekunden)</label>
          <input id="earnings-interval" v-model.number="earnings.interval" type="number" min="30" max="3600" />
        </div>
        <div class="field">
          <label for="earnings-period">Zeitraum</label>
          <select id="earnings-period" v-model="earnings.period">
            <option value="today">Heute</option>
            <option value="24h">Letzte 24 h</option>
            <option value="7d">Letzte 7 Tage</option>
            <option value="30d">Letzte 30 Tage</option>
            <option value="all">Gesamt</option>
          </select>
        </div>
        <div class="field">
          <label for="earnings-view">Dashboard-Anzeige</label>
          <select id="earnings-view" v-model="earnings.view">
            <option value="compact">Kompakt</option>
            <option value="standard">Standard</option>
            <option value="detailed">Ausführlich</option>
          </select>
        </div>
      </div>
      <div class="alert alert-info">
        Overlay-Text und Position:
        <RouterLink to="/overlays">Overlay-Studio</RouterLink>
      </div>
    </div>
  </section>
</template>
