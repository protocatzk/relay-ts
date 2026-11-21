<script setup lang="ts">
interface StreamingModel {
  title_template: string;
}

defineProps<{
  streaming: StreamingModel;
  dirty: boolean;
  saving: boolean;
  busySaving: boolean;
}>();

defineEmits<{
  (e: 'save'): void;
}>();
</script>

<template>
  <section id="settings-title" class="card settings-section" tabindex="-1">
    <div class="card-head">
      <div>
        <h2 class="card-title">YouTube-Titel</h2>
      </div>
      <div class="settings-section-actions">
        <span v-if="dirty" class="badge tone-warning">Ungespeichert</span>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          aria-label="YouTube-Titel speichern"
          :disabled="!dirty || busySaving"
          @click="$emit('save')"
        >
          <span v-if="saving" class="spinner" aria-hidden="true"></span>
          Speichern
        </button>
      </div>
    </div>
    <div class="settings-body">
      <div class="field">
        <label for="title-template">Titel-Template</label>
        <input
          id="title-template"
          v-model="streaming.title_template"
          type="text"
          maxlength="200"
          spellcheck="false"
        />
        <p class="field-hint">
          Platzhalter: <code>{name}</code>, <code>{tiktok}</code>, <code>{title}</code>,
          <code>{date}</code>, <code>{time}</code>. Nur lokal, wird nicht an YouTube gesendet.
        </p>
      </div>
    </div>
  </section>
</template>
