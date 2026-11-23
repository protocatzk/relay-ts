<script setup lang="ts">
import ToggleField from '@/src/components/ToggleField.vue';

interface WatchdogModel {
  auto_reconnect: boolean;
  stall_timeout: number;
  min_bitrate: number;
  min_source_rate_percent: number;
  interval: number;
}

interface SinkModel {
  rw_timeout_seconds: number;
}

defineProps<{
  watchdog: WatchdogModel;
  sink: SinkModel;
  dirty: boolean;
  saving: boolean;
  busySaving: boolean;
}>();

defineEmits<{
  (e: 'save'): void;
}>();
</script>

<template>
  <section id="settings-watchdog" class="card settings-section" tabindex="-1">
    <div class="card-head">
      <div>
        <h2 class="card-title">Watchdog</h2>
      </div>
      <div class="settings-section-actions">
        <span v-if="dirty" class="badge tone-warning">Ungespeichert</span>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          aria-label="Watchdog speichern"
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
        v-model="watchdog.auto_reconnect"
        label="Automatisch neu verbinden"
      />
      <div class="settings-grid">
        <div class="field">
          <label for="watchdog-stall">Stall-Timeout (Sekunden)</label>
          <input id="watchdog-stall" v-model.number="watchdog.stall_timeout" type="number" min="5" max="600" />
        </div>
        <div class="field">
          <label for="watchdog-bitrate">Minimale Bitrate (kbit/s)</label>
          <input id="watchdog-bitrate" v-model.number="watchdog.min_bitrate" type="number" min="0" max="50000" />
        </div>
        <div class="field">
          <label for="watchdog-rate">Mindest-Quellrate (% Echtzeit, 0 = aus)</label>
          <input id="watchdog-rate" v-model.number="watchdog.min_source_rate_percent" type="number" min="0" max="200" />
        </div>
        <div class="field">
          <label for="watchdog-interval">Prüfintervall (Sekunden)</label>
          <input id="watchdog-interval" v-model.number="watchdog.interval" type="number" min="1" max="60" />
        </div>
        <div class="field">
          <label for="sink-rw-timeout">YouTube-Sink: Schreib-Timeout (Sekunden)</label>
          <input
            id="sink-rw-timeout"
            v-model.number="sink.rw_timeout_seconds"
            type="number"
            min="5"
            max="300"
          />
          <p class="hint">Wie lange ein blockierter RTMP-Schreibvorgang wartet, bevor der Sink neu startet. Höhere Werte überleben kurze Netzstaus (Standard 15).</p>
        </div>
      </div>
    </div>
  </section>
</template>
