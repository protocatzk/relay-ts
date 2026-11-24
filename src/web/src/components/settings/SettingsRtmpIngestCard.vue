<script setup lang="ts">
import { ref, computed } from 'vue';
import type { RtmpIngestSettings } from '@/src/api/types';
import { api } from '@/src/api/client';
import ToggleField from '@/src/components/ToggleField.vue';

const props = defineProps<{
  rtmp: RtmpIngestSettings;
  dirty: boolean;
  saving: boolean;
  busySaving: boolean;
  activeStatus?: {
    running: boolean;
    active_client: boolean;
    client_ip: string | null;
    connected_at: string | null;
  } | null;
}>();

defineEmits<{
  (e: 'save'): void;
}>();

const copiedUrl = ref(false);
const copiedKey = ref(false);

const serverHost = computed(() => {
  return window.location.hostname || 'localhost';
});

const rtmpServerUrl = computed(() => {
  return `rtmp://${serverHost.value}:${props.rtmp.port}/live`;
});

async function copyUrl(): Promise<void> {
  try {
    await navigator.clipboard.writeText(rtmpServerUrl.value);
    copiedUrl.value = true;
    setTimeout(() => {
      copiedUrl.value = false;
    }, 2000);
  } catch {
    // clipboard best-effort
  }
}

async function copyKey(): Promise<void> {
  try {
    let key = props.rtmp.stream_key?.trim() ?? '';
    if (!key) {
      // Sanitized settings never contain the key; reveal it on demand.
      key = (await api.settings.rtmpIngestStreamKey()).stream_key;
    }
    await navigator.clipboard.writeText(key);
    copiedKey.value = true;
    setTimeout(() => {
      copiedKey.value = false;
    }, 2000);
  } catch {
    // clipboard best-effort
  }
}

function generateNewKey(): void {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let rand = 'gaming-';
  for (let i = 0; i < 8; i++) {
    rand += chars[Math.floor(Math.random() * chars.length)];
  }
  props.rtmp.stream_key = rand;
}
</script>

<template>
  <section id="settings-rtmp-ingest" class="card settings-section" tabindex="-1">
    <div class="card-head">
      <div>
        <h2 class="card-title">RTMP-Ingest (Gaming-Streams)</h2>
        <p class="card-subtitle">
          Ermöglicht das direkte Einspeisen von Gaming-Streams aus OBS Studio, Streamlabs, vMix oder Hardware-Encodern.
        </p>
      </div>
      <div class="settings-section-actions">
        <span v-if="dirty" class="badge tone-warning">Ungespeichert</span>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          aria-label="RTMP Ingest Einstellungen speichern"
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
        v-model="rtmp.enabled"
        label="RTMP-Ingest-Server aktivieren"
        hint="Startet den internen RTMP-Listener auf dem konfigurierten Port für eingehende OBS-Streams."
      />

      <div class="settings-grid">
        <div class="field">
          <label for="rtmp-port">Port</label>
          <input
            id="rtmp-port"
            v-model.number="rtmp.port"
            type="number"
            min="1"
            max="65535"
            placeholder="1935"
          />
          <p class="field-hint">Standard RTMP-Port ist 1935. Stelle sicher, dass der Port in der Firewall offen ist.</p>
        </div>

        <div class="field">
          <label for="rtmp-stream-key">Stream-Schlüssel (Auth Key)</label>
          <div class="copy-input-row">
            <input
              id="rtmp-stream-key"
              v-model="rtmp.stream_key"
              type="text"
              spellcheck="false"
              :placeholder="rtmp.stream_key_set ? 'gespeichert – leer lassen zum Behalten' : 'z. B. gaming-live'"
            />
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              title="Stream-Key kopieren"
              @click="copyKey"
            >
              {{ copiedKey ? 'Kopiert!' : 'Kopieren' }}
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              title="Zufälligen Schlüssel generieren"
              @click="generateNewKey"
            >
              Neu
            </button>
          </div>
          <p class="field-hint">Verbindungen mit abweichendem Schlüssel werden sofort abgewiesen.</p>
        </div>

        <div class="field field-span-2">
          <ToggleField
            v-model="rtmp.auto_takeover"
            label="Automatischer Regie-Takeover bei Sendestart"
            hint="Sobald OBS den Stream startet, übernimmt RELAY automatisch das Gaming-Signal und schaltet den YouTube-Sink aktiv."
          />
        </div>
      </div>

      <!-- OBS Connection Instructions -->
      <div class="rtmp-connection-box">
        <h3 class="rtmp-connection-title">OBS Studio Konfiguration</h3>
        <p class="field-hint">Trage in OBS unter <strong>Einstellungen → Stream</strong> folgende Werte ein:</p>
        
        <div class="obs-setup-grid">
          <div class="obs-field">
            <span class="obs-label">Plattform / Service:</span>
            <span class="obs-value mono">Benutzerdefiniert... (Custom)</span>
          </div>

          <div class="obs-field">
            <span class="obs-label">Server / URL:</span>
            <div class="obs-copy-group">
              <span class="obs-value mono">{{ rtmpServerUrl }}</span>
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                @click="copyUrl"
              >
                {{ copiedUrl ? 'Kopiert!' : 'Kopieren' }}
              </button>
            </div>
          </div>

          <div class="obs-field">
            <span class="obs-label">Stream-Schlüssel:</span>
            <span class="obs-value mono">{{ rtmp.stream_key || (rtmp.stream_key_set ? '(gespeichert – kopieren)' : '(keiner gesetzt)') }}</span>
          </div>
        </div>

        <div v-if="activeStatus?.active_client" class="rtmp-active-alert">
          <span class="indicator-dot tone-success" aria-hidden="true"></span>
          <span><strong>Gaming-Streamer aktiv verbunden:</strong> Signal wird live empfangen (Client: {{ activeStatus.client_ip || 'verbunden' }})</span>
        </div>
        <div v-else-if="rtmp.enabled" class="rtmp-standby-hint">
          <span class="indicator-dot tone-muted" aria-hidden="true"></span>
          <span>RTMP-Server bereit und wartet auf eingehendes OBS-Signal...</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.rtmp-connection-box {
  margin-top: 1.5rem;
  padding: 1.25rem;
  background: var(--bg-surface-secondary, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius-control);
  /* Long ingest URLs must wrap instead of widening the settings page (#88). */
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.rtmp-connection-title {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.obs-setup-grid {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin: 1rem 0;
  background: rgba(0, 0, 0, 0.2);
  padding: 0.75rem 1rem;
  border-radius: 6px;
}

.obs-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.9rem;
}

.obs-label {
  color: var(--text-muted, #94a3b8);
  font-weight: 500;
}

.obs-value {
  color: var(--text-main, #f8fafc);
  font-weight: 600;
  min-width: 0;
  overflow-wrap: anywhere;
}

.obs-copy-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  min-width: 0;
}

.copy-input-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.copy-input-row input {
  flex: 1;
}

.rtmp-active-alert {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.8rem;
  background: rgba(76, 224, 127, 0.1);
  border: 1px solid rgba(76, 224, 127, 0.3);
  border-radius: 6px;
  color: #4ce07f;
  font-size: 0.875rem;
  margin-top: 0.75rem;
}

.rtmp-standby-hint {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--text-muted, #94a3b8);
  margin-top: 0.75rem;
}

.indicator-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.indicator-dot.tone-success {
  background: #4ce07f;
  box-shadow: 0 0 8px #4ce07f;
}

.indicator-dot.tone-muted {
  background: #64748b;
}
</style>
