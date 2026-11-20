<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ModalDialog from './ModalDialog.vue';
import ToggleField from './ToggleField.vue';
import { sortStreamersByPriority } from '@/src/utils/sort-streamers';
import type {
  Streamer,
  YouTubeBroadcast,
  YouTubeBroadcastInput,
} from '@/src/api/types';

const props = defineProps<{
  open: boolean;
  broadcast: YouTubeBroadcast | null;
  streamers: Streamer[];
  saving: boolean;
  error: string;
}>();

const emit = defineEmits<{
  close: [];
  save: [payload: { id: string | null; body: YouTubeBroadcastInput }];
}>();

const title = ref('');
const description = ref('');
const scheduled = ref('');
const privacy = ref<'public' | 'unlisted' | 'private'>('unlisted');
const enableDvr = ref(true);
const streamerId = ref('');
const validationError = ref('');

const isCreate = computed(() => props.broadcast === null);
const modalTitle = computed(() => (isCreate.value ? 'Broadcast anlegen' : 'Broadcast bearbeiten'));

const relayIngest = computed(() => {
  const candidates = sortStreamersByPriority(
    props.streamers.filter((streamer) => streamer.enabled && streamer.youtube_key_set),
  );
  return (
    candidates.find((streamer) => streamer.status.active) ??
    candidates.find((streamer) => streamer.preferred) ??
    candidates[0] ??
    null
  );
});

function toLocalInput(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : new Date(Date.now() + 15 * 60 * 1000);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

watch(
  () => [props.open, props.broadcast] as const,
  ([open]) => {
    if (!open) return;
    validationError.value = '';
    title.value = props.broadcast?.title ?? '';
    description.value = props.broadcast?.description ?? '';
    scheduled.value = toLocalInput(props.broadcast?.scheduled_start ?? null);
    privacy.value = (props.broadcast?.privacy as typeof privacy.value) ?? 'unlisted';
    enableDvr.value = true;
    streamerId.value = '';
  },
  { immediate: true },
);

function submit(): void {
  validationError.value = '';
  if (!title.value.trim()) {
    validationError.value = 'Bitte einen Titel angeben.';
    return;
  }
  const date = new Date(scheduled.value);
  if (!scheduled.value || Number.isNaN(date.getTime())) {
    validationError.value = 'Bitte eine gültige Startzeit angeben.';
    return;
  }
  const body: YouTubeBroadcastInput = {
    title: title.value.trim(),
    description: description.value.trim(),
    scheduled_start: date.toISOString(),
    privacy: privacy.value,
    enable_dvr: enableDvr.value,
  };
  if (isCreate.value && streamerId.value) body.streamer_id = streamerId.value;
  emit('save', { id: props.broadcast?.id ?? null, body });
}
</script>

<template>
  <ModalDialog :open="open" :title="modalTitle" size="lg" @close="emit('close')">
    <form id="youtube-broadcast-form" class="stack" @submit.prevent="submit">
      <div v-if="error || validationError" class="alert alert-error" role="alert">
        {{ validationError || error }}
      </div>

      <div class="field">
        <label for="yt-title">Titel <span class="req">*</span></label>
        <input
          id="yt-title"
          v-model="title"
          type="text"
          maxlength="100"
          required
          autocomplete="off"
        />
        <p class="field-hint">{{ title.length }}/100 Zeichen</p>
      </div>

      <div class="field">
        <label for="yt-description">Beschreibung</label>
        <textarea id="yt-description" v-model="description" rows="4" maxlength="5000"></textarea>
      </div>

      <div class="form-grid">
        <div class="field">
          <label for="yt-scheduled">Startzeit <span class="req">*</span></label>
          <input id="yt-scheduled" v-model="scheduled" type="datetime-local" required />
          <p class="field-hint">Lokale Zeit; RELAY sendet UTC an YouTube.</p>
        </div>
        <div class="field">
          <label for="yt-privacy">Sichtbarkeit</label>
          <select id="yt-privacy" v-model="privacy">
            <option value="unlisted">Nicht gelistet (später veröffentlichen)</option>
            <option value="public">Öffentlich</option>
            <option value="private">Privat</option>
          </select>
        </div>
      </div>

      <div v-if="isCreate" class="field">
        <label for="yt-streamer">Ingest</label>
        <select id="yt-streamer" v-model="streamerId">
          <option value="">RELAY-Ingest (automatisch)</option>
          <option v-for="streamer in streamers" :key="streamer.id" :value="streamer.id">
            {{ streamer.name }}{{ streamer.youtube_key_set ? '' : ' (kein Key)' }}
          </option>
        </select>
        <p class="field-hint">
          Bindet an den laufenden RELAY-Ingest.
          <template v-if="relayIngest"> Aktuell: {{ relayIngest.name }}.</template>
          <template v-else> Kein Streamer mit YouTube-Key konfiguriert.</template>
        </p>
      </div>

      <ToggleField
        v-model="enableDvr"
        label="DVR aktivieren"
        description="Wiedergabe während des Streams erlauben"
      />

      <p class="muted small">
        Auto-Start und Auto-Stop gelten nur für den zugeordneten Ingest.
      </p>
    </form>

    <template #footer>
      <button type="button" class="btn btn-ghost" :disabled="saving" @click="emit('close')">
        Abbrechen
      </button>
      <button type="submit" form="youtube-broadcast-form" class="btn btn-primary" :disabled="saving">
        <span v-if="saving" class="spinner" aria-hidden="true"></span>
        {{ saving ? 'Speichern…' : isCreate ? 'Broadcast anlegen' : 'Änderungen speichern' }}
      </button>
    </template>
  </ModalDialog>
</template>
