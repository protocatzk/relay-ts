<script setup lang="ts">
import type { SoundboardSettings } from '@/src/api/types';
import ToggleField from '@/src/components/ToggleField.vue';

interface AudioModel {
  normalize: 'off' | 'loudnorm' | 'dynaudnorm';
  target_lufs: number;
  gain_db: number;
  silence_detect: boolean;
  silence_threshold_db: number;
  silence_seconds: number;
}

defineProps<{
  audio: AudioModel;
  soundboard?: SoundboardSettings;
  dirty: boolean;
  saving: boolean;
  busySaving: boolean;
}>();

defineEmits<{
  (e: 'save'): void;
}>();
</script>

<template>
  <section id="settings-audio" class="card settings-section" tabindex="-1">
    <div class="card-head">
      <div>
        <h2 class="card-title">Audio</h2>
      </div>
      <div class="settings-section-actions">
        <span v-if="dirty" class="badge tone-warning">Ungespeichert</span>
        <span class="badge tone-warning">Sink-Neustart erforderlich</span>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          aria-label="Audio speichern"
          :disabled="!dirty || busySaving"
          @click="$emit('save')"
        >
          <span v-if="saving" class="spinner" aria-hidden="true"></span>
          Speichern
        </button>
      </div>
    </div>
    <div class="settings-body">
      <div class="settings-grid">
        <div class="field">
          <label for="audio-normalize">Lautheits-Normalisierung</label>
          <select id="audio-normalize" v-model="audio.normalize">
            <option value="off">Aus</option>
            <option value="loudnorm">EBU R128 (loudnorm)</option>
            <option value="dynaudnorm">Dynamisch (dynaudnorm)</option>
          </select>
        </div>
        <div class="field">
          <label for="audio-target-lufs">Ziel-Lautheit (LUFS)</label>
          <input
            id="audio-target-lufs"
            v-model.number="audio.target_lufs"
            type="number"
            min="-30"
            max="-6"
            step="0.5"
          />
          <p class="field-hint">−16 LUFS empfohlen für YouTube Live (nur bei loudnorm).</p>
        </div>
        <div class="field">
          <label for="audio-gain">Pegel-Anpassung (dB)</label>
          <input
            id="audio-gain"
            v-model.number="audio.gain_db"
            type="number"
            min="-24"
            max="24"
            step="0.5"
          />
        </div>
      </div>
      <ToggleField
        v-model="audio.silence_detect"
        label="Audio-Stille erkennen"
        description="Meldet anhaltende Stille im Status, auf dem Dashboard und per Webhook (startet den Sink nicht neu)."
      />
      <div class="settings-grid">
        <div class="field">
          <label for="audio-silence-threshold">Stille-Schwelle (dB)</label>
          <input
            id="audio-silence-threshold"
            v-model.number="audio.silence_threshold_db"
            type="number"
            min="-80"
            max="-10"
          />
        </div>
        <div class="field">
          <label for="audio-silence-seconds">Stille-Dauer (Sekunden)</label>
          <input
            id="audio-silence-seconds"
            v-model.number="audio.silence_seconds"
            type="number"
            min="2"
            max="300"
          />
        </div>
      </div>

      <template v-if="soundboard">
        <hr class="settings-divider" />
        <h3 class="settings-subtitle">Soundboard</h3>
        <ToggleField
          v-model="soundboard.enabled"
          label="Soundboard-Mischung im Stream aktivieren"
          description="Öffnet pipe:5 am YouTube-Sink für SFX-Pads und Musikbett (Änderung startet den Sink neu)."
        />
        <ToggleField
          v-model="soundboard.ducking"
          label="Automatisches Ducking"
          description="Senkt den Stream-Ton ab, solange ein Soundboard-Audio spielt."
        />
        <div class="settings-grid">
          <div class="field">
            <label for="sb-duck-db">Ducking-Stärke (dB)</label>
            <input
              id="sb-duck-db"
              v-model.number="soundboard.duck_db"
              type="number"
              min="-30"
              max="-3"
              step="1"
            />
          </div>
          <div class="field">
            <label for="sb-max-concurrent">Max. gleichzeitige SFX</label>
            <input
              id="sb-max-concurrent"
              v-model.number="soundboard.max_concurrent"
              type="number"
              min="1"
              max="16"
            />
          </div>
          <div class="field">
            <label for="sb-cache-mb">PCM-Cache (MB)</label>
            <input
              id="sb-cache-mb"
              v-model.number="soundboard.cache_mb"
              type="number"
              min="16"
              max="1024"
            />
          </div>
        </div>
      </template>
    </div>
  </section>
</template>
