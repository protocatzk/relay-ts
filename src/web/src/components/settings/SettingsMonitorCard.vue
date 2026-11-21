<script setup lang="ts">
import ToggleField from '@/src/components/ToggleField.vue';

interface OnlineModel {
  enabled: boolean;
  auto_switch_preferred: boolean;
  source_url: string;
  interval: number;
  api_key_set: boolean;
}

defineProps<{
  online: OnlineModel;
  apiKey: string;
  checkingOnline: boolean;
  dirty: boolean;
  saving: boolean;
  busySaving: boolean;
}>();

defineEmits<{
  (e: 'save'): void;
  (e: 'update:apiKey', val: string): void;
  (e: 'checkOnline'): void;
}>();
</script>

<template>
  <section id="settings-monitor" class="card settings-section" tabindex="-1">
    <div class="card-head">
      <div>
        <h2 class="card-title">Online-Monitor</h2>
      </div>
      <div class="settings-section-actions">
        <span v-if="dirty" class="badge tone-warning">Ungespeichert</span>
        <span v-if="online.api_key_set" class="badge tone-success">API-Key gesetzt</span>
        <span v-else class="badge tone-muted">Kein API-Key</span>
        <button type="button" class="btn btn-ghost btn-sm" :disabled="checkingOnline" @click="$emit('checkOnline')">
          <span v-if="checkingOnline" class="spinner" aria-hidden="true"></span>
          Jetzt prüfen
        </button>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          aria-label="Online-Monitor speichern"
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
        v-model="online.enabled"
        label="Online-Monitor aktiviert"
      />
      <ToggleField
        v-model="online.auto_switch_preferred"
        label="Bevorzugte Streamer automatisch übernehmen"
        description="Wechselt, sobald der Streamer live ist; danach zurück zum vorherigen Ziel."
      />
      <div class="settings-grid">
        <div class="field">
          <label for="online-url">Quell-URL</label>
          <input
            id="online-url"
            v-model="online.source_url"
            type="url"
            placeholder="https://api.example.com/check"
            spellcheck="false"
          />
        </div>
        <div class="field">
          <label for="online-key">API-Key</label>
          <input
            id="online-key"
            :value="apiKey"
            type="password"
            :placeholder="online.api_key_set ? '•••••••• (gesetzt – leer lassen zum Behalten)' : 'API-Key eingeben'"
            autocomplete="new-password"
            @input="$emit('update:apiKey', ($event.target as HTMLInputElement).value)"
          />
          <p class="field-hint">Der Key wird nur beim Speichern übertragen und nie im Klartext angezeigt.</p>
        </div>
        <div class="field">
          <label for="online-interval">Prüfintervall (Sekunden)</label>
          <input id="online-interval" v-model.number="online.interval" type="number" min="10" max="3600" />
        </div>
      </div>
    </div>
  </section>
</template>
