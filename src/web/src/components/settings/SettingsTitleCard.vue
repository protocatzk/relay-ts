<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ToggleField from '@/src/components/ToggleField.vue';

interface StreamingModel {
  title_template: string;
  global_key_enabled: boolean;
  global_youtube_key_set: boolean;
}

const props = defineProps<{
  streaming: StreamingModel;
  youtube?: { rtmp_url: string };
  globalYoutubeKey: string;
  clearGlobalYoutubeKey: boolean;
  dirty: boolean;
  saving: boolean;
  busySaving: boolean;
}>();

defineEmits<{
  (e: 'update:globalYoutubeKey', value: string): void;
  (e: 'update:clearGlobalYoutubeKey', value: boolean): void;
  (e: 'save'): void;
}>();

const BACKUP_RTMP_URL = 'rtmp://b.rtmp.youtube.com/live2';
const CUSTOM_CHOICE = 'custom';

const customEndpoint = ref(false);
watch(
  () => props.youtube?.rtmp_url ?? '',
  (url) => {
    const value = url.trim();
    customEndpoint.value = value !== '' && value !== BACKUP_RTMP_URL;
  },
  { immediate: true },
);

const endpointChoice = computed(() =>
  customEndpoint.value ? CUSTOM_CHOICE : (props.youtube?.rtmp_url ?? ''),
);

function setEndpointChoice(event: Event): void {
  const choice = (event.target as HTMLSelectElement).value;
  const youtube = props.youtube;
  if (!youtube) return;
  if (choice === CUSTOM_CHOICE) {
    customEndpoint.value = true;
    youtube.rtmp_url = '';
  } else {
    customEndpoint.value = false;
    youtube.rtmp_url = choice;
  }
}
</script>

<template>
  <section id="settings-title" class="card settings-section" tabindex="-1">
    <div class="card-head">
      <div>
        <h2 class="card-title">YouTube-Titel &amp; Globaler Stream-Key</h2>
        <p class="card-sub">
          Globaler Stream-Key kann bei Bedarf alle individuellen Streamer-Keys überschreiben.
        </p>
      </div>
      <div class="settings-section-actions">
        <span
          class="badge"
          :class="
            streaming.global_key_enabled && (streaming.global_youtube_key_set || globalYoutubeKey.trim())
              ? 'tone-success'
              : streaming.global_youtube_key_set
                ? 'tone-info'
                : 'tone-neutral'
          "
        >
          {{
            streaming.global_key_enabled && (streaming.global_youtube_key_set || globalYoutubeKey.trim())
              ? 'Globaler Key aktiv'
              : streaming.global_youtube_key_set
                ? 'Key hinterlegt (Override aus)'
                : 'Individuelle Keys'
          }}
        </span>
        <span v-if="dirty" class="badge tone-warning">Ungespeichert</span>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          aria-label="YouTube-Titel und Stream-Key speichern"
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
        <ToggleField
          v-model="streaming.global_key_enabled"
          label="Globalen Stream-Key erzwingen"
          description="Überschreibt alle individuellen Streamer-Keys mit dem globalen YouTube-Key."
        />

        <div class="field">
          <label for="global-youtube-key">Globaler YouTube-Stream-Key</label>
          <div class="input-badge-row">
            <input
              id="global-youtube-key"
              :value="globalYoutubeKey"
              type="password"
              maxlength="300"
              autocomplete="new-password"
              :placeholder="
                clearGlobalYoutubeKey
                  ? 'Wird beim Speichern gelöscht'
                  : streaming.global_youtube_key_set
                    ? 'Gespeichert – zum Ändern neu eingeben'
                    : 'xxxx-xxxx-xxxx-xxxx-xxxx'
              "
              @input="
                $emit('update:clearGlobalYoutubeKey', false);
                $emit('update:globalYoutubeKey', ($event.target as HTMLInputElement).value);
              "
            />
            <span
              v-if="streaming.global_youtube_key_set && !clearGlobalYoutubeKey"
              class="badge tone-success"
            >
              Gesetzt
            </span>
            <span v-else-if="clearGlobalYoutubeKey" class="badge tone-warning">
              Wird gelöscht
            </span>
            <button
              v-if="streaming.global_youtube_key_set && !clearGlobalYoutubeKey"
              type="button"
              class="btn btn-ghost btn-xs"
              @click="
                $emit('update:globalYoutubeKey', '');
                $emit('update:clearGlobalYoutubeKey', true);
              "
            >
              Key löschen
            </button>
            <button
              v-else-if="clearGlobalYoutubeKey"
              type="button"
              class="btn btn-ghost btn-xs"
              @click="$emit('update:clearGlobalYoutubeKey', false)"
            >
              Behalten
            </button>
          </div>
          <p class="field-hint">
            Wenn aktiv, streamen alle Kanäle auf diesen YouTube-Key. Ist der Schalter aus, dient ein
            hinterlegter globaler Key als Fallback für Streamer ohne eigenen Key.
          </p>
        </div>

        <div class="field">
          <label for="youtube-rtmp-endpoint">RTMP-Endpoint (YouTube Ingest)</label>
          <select id="youtube-rtmp-endpoint" :value="endpointChoice" @change="setEndpointChoice">
            <option value="">Standard (a.rtmp.youtube.com/live2)</option>
            <option :value="BACKUP_RTMP_URL">Backup (b.rtmp.youtube.com/live2)</option>
            <option value="custom">Eigene RTMP-URL…</option>
          </select>
          <input
            v-if="customEndpoint && youtube"
            id="youtube-rtmp-custom"
            v-model="youtube.rtmp_url"
            type="text"
            maxlength="500"
            spellcheck="false"
            placeholder="rtmp://beispiel.de/live"
          />
          <p class="field-hint">
            Leer = Standard-Ingest des Servers. Eigene URLs müssen mit
            <code>rtmp://</code> oder <code>rtmps://</code> beginnen. Ein Wechsel startet den
            YouTube-Sink neu.
          </p>
        </div>

        <div class="field field-span-2">
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
    </div>
  </section>
</template>
