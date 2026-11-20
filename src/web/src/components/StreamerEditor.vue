<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { StreamQuality, Streamer, StreamerInput } from '@/src/api/types';
import { useUnsavedChanges } from '@/src/composables/useUnsavedChanges';
import ModalDialog from './ModalDialog.vue';

const props = defineProps<{
  open: boolean;
  streamer: Streamer | null;
  saving: boolean;
  error: string;
}>();

const emit = defineEmits<{
  close: [];
  save: [payload: { id: string; body: StreamerInput }];
}>();

const QUALITY_OPTIONS: { value: StreamQuality; label: string }[] = [
  { value: 'best', label: 'Beste verfügbare' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: '480p', label: '480p' },
  { value: '360p', label: '360p' },
];

interface StreamerForm {
  id: string;
  name: string;
  tiktok: string;
  youtube_key: string;
  quality: StreamQuality;
  auto_start: boolean;
  preferred: boolean;
  priority: number;
  enabled: boolean;
  own_stream: boolean;
}

const source = props.streamer;

const form = reactive<StreamerForm>({
  id: source?.id ?? '',
  name: source?.name ?? '',
  tiktok: source?.tiktok ?? '',
  youtube_key: '',
  quality: source?.quality ?? 'best',
  auto_start: source?.auto_start ?? false,
  preferred: source?.preferred ?? false,
  priority: source?.priority ?? 0,
  enabled: source?.enabled ?? true,
  own_stream: source?.own_stream ?? false,
});

const idTouched = ref(source !== null);
const validationError = ref('');
const initialSnapshot = JSON.stringify(form);

const dirty = computed(() => props.open && JSON.stringify(form) !== initialSnapshot);

const { confirmDiscard } = useUnsavedChanges(dirty, {
  message: 'Du hast ungespeicherte Änderungen an diesem Streamer. Möchtest du sie verwerfen?',
});

async function requestClose(): Promise<void> {
  if (props.saving) return;
  if (!(await confirmDiscard())) return;
  emit('close');
}

const isCreate = computed(() => source === null);
const modalTitle = computed(() =>
  isCreate.value ? 'Neuer Streamer' : `Streamer bearbeiten · ${source?.name ?? ''}`,
);

const keySourceLabel = computed(() => {
  if (!source) return 'Optional';
  switch (source.youtube_key_source) {
    case 'streamer':
      return 'Im Streamer gesetzt';
    case 'env':
      return 'Aus Umgebung';
    default:
      return 'Nicht gesetzt';
  }
});

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function onNameInput(): void {
  if (isCreate.value && !idTouched.value) form.id = slugify(form.name);
}

function markIdTouched(): void {
  idTouched.value = true;
}

function buildBody(): StreamerInput {
  const body: StreamerInput = {
    name: form.name.trim(),
    tiktok: form.tiktok.trim(),
    quality: form.quality,
    auto_start: form.auto_start,
    preferred: form.preferred,
    priority: Number.isFinite(form.priority)
      ? Math.min(999, Math.max(0, Math.trunc(form.priority)))
      : 0,
    enabled: form.enabled,
    own_stream: form.own_stream,
  };

  const youtubeKey = form.youtube_key.trim();
  if (youtubeKey) body.youtube_key = youtubeKey;

  return body;
}

function submit(): void {
  validationError.value = '';
  if (!form.name.trim()) {
    validationError.value = 'Bitte einen Namen für den Streamer angeben.';
    return;
  }
  if (!form.tiktok.trim()) {
    validationError.value = 'Bitte ein TikTok-Handle oder eine URL angeben.';
    return;
  }
  if (isCreate.value) {
    const id = form.id.trim();
    if (!id) {
      validationError.value = 'Bitte eine Streamer-ID (Slug) angeben.';
      return;
    }
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
      validationError.value =
        'Die Streamer-ID darf nur Kleinbuchstaben, Zahlen, Bindestriche und Unterstriche enthalten.';
      return;
    }
  }
  emit('save', { id: form.id.trim(), body: buildBody() });
}
</script>

<template>
  <ModalDialog :open="open" :title="modalTitle" size="lg" @close="requestClose">
    <form id="streamer-form" class="stack" @submit.prevent="submit">
      <div v-if="error || validationError" class="alert alert-error" role="alert">
        {{ validationError || error }}
      </div>

      <div class="form-grid">
        <div class="field">
          <label for="streamer-id">ID / Slug <span v-if="isCreate" class="req">*</span></label>
          <input
            id="streamer-id"
            v-model="form.id"
            type="text"
            :readonly="!isCreate"
            :disabled="!isCreate"
            placeholder="z. B. main-channel"
            spellcheck="false"
            autocomplete="off"
            @input="markIdTouched"
          />
          <p class="field-hint">
            {{ isCreate ? 'Kleinbuchstaben, Zahlen, - und _.' : 'Nach dem Anlegen nicht änderbar.' }}
          </p>
        </div>

        <div class="field">
          <label for="streamer-name">Name <span class="req">*</span></label>
          <input
            id="streamer-name"
            v-model="form.name"
            type="text"
            placeholder="Anzeigename"
            autocomplete="off"
            @input="onNameInput"
          />
        </div>

        <div class="field">
          <label for="streamer-tiktok">TikTok-Handle oder URL <span class="req">*</span></label>
          <input
            id="streamer-tiktok"
            v-model="form.tiktok"
            type="text"
            placeholder="@username oder https://tiktok.com/@username/live"
            spellcheck="false"
            autocomplete="off"
          />
        </div>

        <div class="field">
          <label for="streamer-key">YouTube-Stream-Key</label>
          <div class="input-badge-row">
            <input
              id="streamer-key"
              v-model="form.youtube_key"
              type="password"
              placeholder="Leer lassen = bestehenden Key behalten"
              autocomplete="new-password"
            />
            <span v-if="streamer?.youtube_key_set" class="badge tone-success">Key gesetzt</span>
          </div>
          <p class="field-hint">
            {{ keySourceLabel }}
            <template v-if="!isCreate && streamer?.youtube_key_set">
              · Leer lassen, um den bestehenden Key zu behalten.
            </template>
          </p>
        </div>

        <div class="field">
          <label for="streamer-quality">Qualität</label>
          <select id="streamer-quality" v-model="form.quality">
            <option v-for="option in QUALITY_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <div class="field">
          <label for="streamer-priority">Priorität</label>
          <input
            id="streamer-priority"
            v-model.number="form.priority"
            type="number"
            min="0"
            max="999"
            step="1"
            inputmode="numeric"
          />
          <p class="field-hint">
            Kleinere Zahl = höhere Priorität (Wechsel und Auto-Start).
          </p>
        </div>

        <div class="field field-span-2">
          <span class="field-label">Optionen</span>
          <div class="checkbox-grid">
            <label class="checkbox">
              <input v-model="form.enabled" type="checkbox" />
              <span>Aktiviert</span>
            </label>
            <label class="checkbox">
              <input v-model="form.auto_start" type="checkbox" />
              <span>Automatisch starten</span>
            </label>
            <label class="checkbox">
              <input v-model="form.preferred" type="checkbox" />
              <span>Bevorzugt</span>
            </label>
            <label class="checkbox">
              <input v-model="form.own_stream" type="checkbox" />
              <span>Eigener Stream</span>
            </label>
          </div>
        </div>
      </div>

      <div class="alert alert-info">
        Overlays gelten global für alle Streamer:
        <RouterLink to="/overlays">Overlay-Studio</RouterLink>
      </div>
    </form>

    <template #footer>
      <button type="button" class="btn btn-ghost" :disabled="saving" @click="requestClose">
        Abbrechen
      </button>
      <button type="submit" form="streamer-form" class="btn btn-primary" :disabled="saving">
        <span v-if="saving" class="spinner" aria-hidden="true"></span>
        {{ saving ? 'Speichern…' : isCreate ? 'Streamer anlegen' : 'Änderungen speichern' }}
      </button>
    </template>
  </ModalDialog>
</template>
