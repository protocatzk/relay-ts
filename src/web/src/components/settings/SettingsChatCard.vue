<script setup lang="ts">
interface ChatModel {
  api_url: string;
  api_key_set: boolean;
}

defineProps<{
  chat: ChatModel;
  chatApiKey: string;
  dirty: boolean;
  saving: boolean;
  busySaving: boolean;
}>();

defineEmits<{
  (e: 'save'): void;
  (e: 'update:chatApiKey', val: string): void;
}>();
</script>

<template>
  <section id="settings-chat" class="card settings-section" tabindex="-1">
    <div class="card-head">
      <div>
        <h2 class="card-title">Chat-Overlay</h2>
      </div>
      <div class="settings-section-actions">
        <span v-if="dirty" class="badge tone-warning">Ungespeichert</span>
        <RouterLink to="/overlays" class="btn btn-ghost btn-sm">Overlay-Studio</RouterLink>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          aria-label="Chat-Overlay speichern"
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
          <label for="chat-url">Chat-API-URL</label>
          <input
            id="chat-url"
            v-model="chat.api_url"
            type="url"
            placeholder="https://toktracker.example/api/chat-logs"
            spellcheck="false"
          />
          <p class="field-hint">Gilt global für alle Streamer.</p>
        </div>
        <div class="field">
          <label for="chat-key">Chat-API-Key</label>
          <input
            id="chat-key"
            :value="chatApiKey"
            type="password"
            :placeholder="chat.api_key_set ? '•••••••• (gesetzt – leer lassen zum Behalten)' : 'API-Key eingeben'"
            autocomplete="new-password"
            @input="$emit('update:chatApiKey', ($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>
    </div>
  </section>
</template>
