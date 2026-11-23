<script setup lang="ts">
import { onMounted } from 'vue';
import ToggleField from '@/src/components/ToggleField.vue';
import { useTikTokAccounts } from '@/src/composables/useTikTokAccounts';

interface OnlineModel {
  enabled: boolean;
  provider: 'external' | 'tiktok';
  account_id: string;
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

const { accounts, refreshAccounts } = useTikTokAccounts();
onMounted(() => {
  void refreshAccounts();
});
</script>

<template>
  <section id="settings-monitor" class="card settings-section" tabindex="-1">
    <div class="card-head">
      <div>
        <h2 class="card-title">Online-Monitor</h2>
      </div>
      <div class="settings-section-actions">
        <span v-if="dirty" class="badge tone-warning">Ungespeichert</span>
        <span v-if="online.provider === 'tiktok'" class="badge tone-success">TikTok Live-API</span>
        <span v-else-if="online.api_key_set" class="badge tone-success">API-Key gesetzt</span>
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
          <label for="online-provider">Quelle</label>
          <select id="online-provider" v-model="online.provider">
            <option value="tiktok">TikTok Live-API (direkt)</option>
            <option value="external">Externe Überwachungs-API</option>
          </select>
          <p class="field-hint">
            TikTok Live-API prüft alle aktivierten Streamer direkt nacheinander. Für echte Daten
            (statt des leeren Stubs) muss <code>data/cookies.txt</code> eine gültige Session enthalten.
          </p>
        </div>
        <div v-if="online.provider === 'tiktok'" class="field">
          <label for="online-account">Monitoring-Account</label>
          <select id="online-account" v-model="online.account_id">
            <option value="">Aktiver Account (data/cookies.txt)</option>
            <option v-for="account in accounts" :key="account.id" :value="account.id">
              {{ account.label }}{{ account.active ? ' (aktiv)' : '' }}
            </option>
          </select>
          <p class="field-hint">
            Session-Cookie für die Live-Checks. Ohne Auswahl wird die global aktive Session benutzt.
          </p>
        </div>
        <template v-if="online.provider === 'external'">
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
        </template>
        <div class="field">
          <label for="online-interval">Prüfintervall (Sekunden)</label>
          <input id="online-interval" v-model.number="online.interval" type="number" min="10" max="3600" />
        </div>
      </div>
    </div>
  </section>
</template>
