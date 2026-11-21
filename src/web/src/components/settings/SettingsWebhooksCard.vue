<script setup lang="ts">
import type { WebhookEventType } from '@/src/api/types';
import ToggleField from '@/src/components/ToggleField.vue';

interface WebhooksModel {
  enabled: boolean;
  format: 'generic' | 'discord' | 'slack';
  url_set: boolean;
  url_host: string;
  secret_set: boolean;
  cooldown_seconds: number;
  events: WebhookEventType[];
}

defineProps<{
  webhooks: WebhooksModel;
  webhookUrl: string;
  webhookSecret: string;
  testingWebhook: boolean;
  eventOptions: { value: WebhookEventType; label: string }[];
  dirty: boolean;
  saving: boolean;
  busySaving: boolean;
}>();

defineEmits<{
  (e: 'save'): void;
  (e: 'update:webhookUrl', val: string): void;
  (e: 'update:webhookSecret', val: string): void;
  (e: 'test'): void;
  (e: 'toggleEvent', event: WebhookEventType): void;
}>();
</script>

<template>
  <section id="settings-webhooks" class="card settings-section" tabindex="-1">
    <div class="card-head">
      <div>
        <h2 class="card-title">Webhooks</h2>
      </div>
      <div class="settings-section-actions">
        <span v-if="dirty" class="badge tone-warning">Ungespeichert</span>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="testingWebhook || !webhooks.url_set"
          @click="$emit('test')"
        >
          Test-Webhook senden
        </button>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          aria-label="Webhooks speichern"
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
        v-model="webhooks.enabled"
        label="Alerting-Webhooks aktiviert"
        description="Sendet Störungs- und Statusmeldungen asynchron an Discord, Slack oder einen HTTP-Endpunkt."
      />
      <div class="settings-grid">
        <div class="field">
          <label for="webhook-format">Format</label>
          <select id="webhook-format" v-model="webhooks.format">
            <option value="generic">Generisches JSON</option>
            <option value="discord">Discord Embed</option>
            <option value="slack">Slack Webhook</option>
          </select>
        </div>
        <div class="field">
          <label for="webhook-url">Webhook-URL</label>
          <input
            id="webhook-url"
            :value="webhookUrl"
            type="url"
            :placeholder="
              webhooks.url_set
                ? `•••••••• (${webhooks.url_host || 'gesetzt'} – leer lassen zum Behalten)`
                : 'https://discord.com/api/webhooks/...'
            "
            spellcheck="false"
            autocomplete="off"
            @input="$emit('update:webhookUrl', ($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="field">
          <label for="webhook-secret">Signatur-Secret (optional)</label>
          <input
            id="webhook-secret"
            :value="webhookSecret"
            type="password"
            :placeholder="
              webhooks.secret_set
                ? '•••••••• (gesetzt – leer lassen zum Behalten)'
                : 'HMAC-SHA256 Secret'
            "
            autocomplete="new-password"
            @input="$emit('update:webhookSecret', ($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="field">
          <label for="webhook-cooldown">Cooldown (Sekunden)</label>
          <input
            id="webhook-cooldown"
            v-model.number="webhooks.cooldown_seconds"
            type="number"
            min="0"
            max="3600"
          />
        </div>
      </div>
      <fieldset class="field" style="border: 0; padding: 0; margin: 0">
        <legend style="font-size: 13px; margin-bottom: 6px">Ereignisse</legend>
        <div style="display: flex; flex-wrap: wrap; gap: 10px">
          <label
            v-for="ev in eventOptions"
            :key="ev.value"
            style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px"
          >
            <input
              type="checkbox"
              :checked="webhooks.events.includes(ev.value)"
              @change="$emit('toggleEvent', ev.value)"
            />
            {{ ev.label }}
          </label>
        </div>
      </fieldset>
    </div>
  </section>
</template>
