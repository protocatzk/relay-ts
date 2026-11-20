<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorMessage } from '@/src/api/client';
import type {
  YouTubeBroadcast,
  YouTubeBroadcastInput,
  YouTubeStatus,
} from '@/src/api/types';
import { formatDateTime } from '@/src/utils/format';
import { sortStreamersByPriority } from '@/src/utils/sort-streamers';
import { useToast } from '@/src/composables/useToast';
import { useStore } from '@/src/composables/useStore';
import YouTubeBroadcastEditor from '@/src/components/YouTubeBroadcastEditor.vue';
import ToggleField from '@/src/components/ToggleField.vue';

const { pushToast } = useToast();
const { store } = useStore();
const route = useRoute();
const router = useRouter();

const status = ref<YouTubeStatus | null>(null);
const loading = ref(true);
const connecting = ref(false);
const disconnecting = ref(false);
const error = ref('');
const broadcasts = ref<YouTubeBroadcast[]>([]);
const broadcastsLoading = ref(false);
const broadcastsError = ref('');
const broadcastsFetchedAt = ref<string | null>(null);
const editorOpen = ref(false);
const editing = ref<YouTubeBroadcast | null>(null);
const saving = ref(false);
const editorError = ref('');
const actingId = ref<string | null>(null);
const automationSaving = ref(false);
const automationMode = ref<'off' | 'relay_only' | 'all'>('relay_only');
const autoStart = ref(true);
const autoStop = ref(true);

const BROADCAST_STATUS: Record<string, { label: string; tone: string }> = {
  live: { label: 'Live', tone: 'tone-success' },
  testing: { label: 'Test', tone: 'tone-info' },
  ready: { label: 'Bereit', tone: 'tone-success' },
  created: { label: 'Geplant', tone: 'tone-neutral' },
  complete: { label: 'Beendet', tone: 'tone-neutral' },
  revoked: { label: 'Widerrufen', tone: 'tone-danger' },
};

const PRIVACY_LABELS: Record<string, string> = {
  public: 'Öffentlich',
  unlisted: 'Nicht gelistet',
  private: 'Privat',
};

const STREAM_STATUS_LABELS: Record<string, string> = {
  active: 'Aktiv',
  ready: 'Bereit',
  inactive: 'Inaktiv',
  created: 'Neu',
  error: 'Fehler',
};

const HEALTH_LABELS: Record<string, string> = {
  good: 'gut',
  ok: 'ok',
  bad: 'schlecht',
  noData: 'keine Daten',
};

function broadcastStatusLabel(value: string): string {
  return BROADCAST_STATUS[value]?.label ?? value;
}

function broadcastTone(value: string): string {
  return BROADCAST_STATUS[value]?.tone ?? 'tone-neutral';
}

function privacyLabel(value: string): string {
  return PRIVACY_LABELS[value] ?? value;
}

function streamLabel(broadcast: YouTubeBroadcast): string {
  if (!broadcast.bound_stream_id) return 'Nicht zugeordnet';
  const parts = [STREAM_STATUS_LABELS[broadcast.stream_status ?? ''] ?? broadcast.stream_status ?? '–'];
  const health = broadcast.stream_health ? HEALTH_LABELS[broadcast.stream_health] : '';
  if (health) parts.push(health);
  return parts.join(' · ');
}

const CALLBACK_ERRORS: Record<string, string> = {
  cancelled: 'Die Verbindung wurde abgebrochen.',
  state_invalid: 'Die Anmelde-Sitzung ist abgelaufen. Bitte erneut verbinden.',
  exchange_failed: 'Google hat die Anmeldung abgelehnt. Bitte erneut versuchen.',
  not_configured: 'Google-Client-ID oder Client-Secret fehlen in der Konfiguration.',
};

const connected = computed(() => status.value?.connected ?? false);
const relayIngestStreamer = computed(() => {
  const candidates = sortStreamersByPriority(
    store.streamers.filter((streamer) => streamer.enabled && streamer.youtube_key_set),
  );
  return (
    candidates.find((streamer) => streamer.status.active) ??
    candidates.find((streamer) => streamer.preferred) ??
    candidates[0] ??
    null
  );
});

watch(
  () => status.value?.automation,
  (automation) => {
    if (!automation) return;
    automationMode.value = automation.mode;
    autoStart.value = automation.auto_start;
    autoStop.value = automation.auto_stop;
  },
  { immediate: true },
);
const accountLabel = computed(() => {
  const account = status.value?.account;
  if (!account) return '';
  return account.channel_title || account.channel_id || 'YouTube-Konto';
});

const callbackError = computed(() => {
  const value = route.query.error;
  return typeof value === 'string' ? (CALLBACK_ERRORS[value] ?? 'Verbindung fehlgeschlagen.') : '';
});

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    status.value = await api.youtube.status();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

async function loadBroadcasts(): Promise<void> {
  if (!status.value?.connected) {
    broadcasts.value = [];
    return;
  }
  broadcastsLoading.value = true;
  broadcastsError.value = '';
  try {
    const data = await api.youtube.broadcasts();
    broadcasts.value = data.items;
    broadcastsFetchedAt.value = data.fetched_at;
  } catch (err) {
    broadcastsError.value = errorMessage(err);
  } finally {
    broadcastsLoading.value = false;
  }
}

async function refresh(): Promise<void> {
  await load();
  await loadBroadcasts();
}

function openCreate(): void {
  editing.value = null;
  editorError.value = '';
  editorOpen.value = true;
}

function openEdit(broadcast: YouTubeBroadcast): void {
  editing.value = broadcast;
  editorError.value = '';
  editorOpen.value = true;
}

async function saveBroadcast(payload: {
  id: string | null;
  body: YouTubeBroadcastInput;
}): Promise<void> {
  saving.value = true;
  editorError.value = '';
  try {
    if (payload.id) {
      await api.youtube.updateBroadcast(payload.id, payload.body);
      pushToast('Broadcast aktualisiert.', 'success');
    } else {
      await api.youtube.createBroadcast(payload.body);
      pushToast('Broadcast angelegt.', 'success');
    }
    editorOpen.value = false;
    editing.value = null;
    await loadBroadcasts();
  } catch (err) {
    editorError.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}

async function runAction(
  broadcast: YouTubeBroadcast,
  action: () => Promise<unknown>,
  message: string,
): Promise<void> {
  actingId.value = broadcast.id;
  try {
    await action();
    pushToast(message, 'success');
    await loadBroadcasts();
  } catch (err) {
    pushToast(errorMessage(err), 'error');
  } finally {
    actingId.value = null;
  }
}

async function saveAutomation(patch: {
  mode?: 'off' | 'relay_only' | 'all';
  auto_start?: boolean;
  auto_stop?: boolean;
}): Promise<void> {
  automationSaving.value = true;
  try {
    const automation = await api.youtube.updateAutomation({
      mode: patch.mode ?? automationMode.value,
      auto_start: patch.auto_start ?? autoStart.value,
      auto_stop: patch.auto_stop ?? autoStop.value,
    });
    if (status.value) status.value = { ...status.value, automation };
    automationMode.value = automation.mode;
    autoStart.value = automation.auto_start;
    autoStop.value = automation.auto_stop;
    pushToast('YouTube-Automatik gespeichert.', 'success');
  } catch (err) {
    pushToast(errorMessage(err), 'error');
  } finally {
    automationSaving.value = false;
  }
}

async function assignToRelay(broadcast: YouTubeBroadcast): Promise<void> {
  const target = relayIngestStreamer.value;
  if (!target) {
    pushToast('Kein RELAY-Ingest konfiguriert.', 'error');
    return;
  }
  if (
    !window.confirm(
      `Broadcast „${broadcast.title}“ an den RELAY-Ingest von ${target.name} binden?`,
    )
  ) {
    return;
  }
  actingId.value = broadcast.id;
  try {
    await api.youtube.assignBroadcast(broadcast.id, target.id);
    pushToast('Broadcast an den RELAY-Ingest gebunden.', 'success');
    await loadBroadcasts();
  } catch (err) {
    pushToast(errorMessage(err), 'error');
  } finally {
    actingId.value = null;
  }
}

async function startBroadcast(broadcast: YouTubeBroadcast): Promise<void> {
  if (!window.confirm(`Broadcast „${broadcast.title}“ jetzt live schalten?`)) return;  await runAction(
    broadcast,
    () => api.youtube.transitionBroadcast(broadcast.id, 'live'),
    'Broadcast ist live.',
  );
}

async function completeBroadcast(broadcast: YouTubeBroadcast): Promise<void> {
  if (!window.confirm(`Broadcast „${broadcast.title}“ beenden?`)) return;
  await runAction(
    broadcast,
    () => api.youtube.transitionBroadcast(broadcast.id, 'complete'),
    'Broadcast beendet.',
  );
}

async function publishBroadcast(broadcast: YouTubeBroadcast): Promise<void> {
  if (!window.confirm(`Broadcast „${broadcast.title}“ öffentlich stellen?`)) return;
  await runAction(
    broadcast,
    () => api.youtube.publishBroadcast(broadcast.id),
    'Broadcast ist jetzt öffentlich.',
  );
}

async function removeBroadcast(broadcast: YouTubeBroadcast): Promise<void> {
  if (!window.confirm(`Broadcast „${broadcast.title}“ endgültig löschen?`)) return;
  await runAction(
    broadcast,
    () => api.youtube.deleteBroadcast(broadcast.id),
    'Broadcast gelöscht.',
  );
}

async function connect(): Promise<void> {
  connecting.value = true;
  error.value = '';
  try {
    const { url } = await api.youtube.start();
    window.location.assign(url);
  } catch (err) {
    error.value = errorMessage(err);
    connecting.value = false;
  }
}

async function disconnect(): Promise<void> {
  disconnecting.value = true;
  error.value = '';
  try {
    status.value = await api.youtube.disconnect();
    broadcasts.value = [];
    broadcastsFetchedAt.value = null;
    pushToast('YouTube-Konto getrennt.', 'success');
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    disconnecting.value = false;
  }
}

onMounted(async () => {
  await load();
  if (status.value?.connected) await loadBroadcasts();
  if (route.query.connected === '1') {
    pushToast('YouTube-Konto verbunden.', 'success');
    await router.replace({ path: '/youtube' });
  } else if (route.query.error) {
    await router.replace({ path: '/youtube' });
  } else if (route.query.connected === '0') {
    await router.replace({ path: '/youtube' });
  }
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>YouTube</h1>
        <p class="page-sub">
          Konto verbinden, Streams planen und Broadcasts verwalten.
        </p>
      </div>
      <div class="page-actions">
        <button
          v-if="status?.connected"
          type="button"
          class="btn btn-primary"
          @click="openCreate"
        >
          Broadcast anlegen
        </button>
        <button type="button" class="btn btn-ghost" :disabled="loading" @click="refresh()">
          Aktualisieren
        </button>
      </div>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
    <div v-if="callbackError" class="alert alert-error" role="alert">{{ callbackError }}</div>

    <div v-if="loading && !status" class="card empty">
      <span class="spinner spinner-lg" aria-hidden="true"></span>
      <p>YouTube-Status wird geladen…</p>
    </div>

    <template v-else-if="status">
      <section v-if="!status.configured" class="card">
        <div class="card-head">
          <div>
            <h2 class="card-title">Google-Client fehlt</h2>
            <p class="card-sub">Ohne OAuth-Client kann RELAY kein YouTube-Konto verbinden.</p>
          </div>
          <span class="badge tone-warning">Nicht konfiguriert</span>
        </div>
        <div class="stack">
          <p class="muted">
            Trage in <code>.env</code> <code>GOOGLE_CLIENT_ID</code>,
            <code>GOOGLE_CLIENT_SECRET</code> und <code>GOOGLE_REDIRECT_URI</code> ein und starte
            den Container neu. Die Redirect-URI muss im Google-Client exakt hinterlegt sein.
          </p>
        </div>
      </section>

      <section v-else class="card">
        <div class="card-head">
          <div>
            <h2 class="card-title">Verbindung</h2>
            <p class="card-sub">
              Ein YouTube-Konto, Tokens ausschließlich serverseitig gespeichert.
            </p>
          </div>
          <span class="badge" :class="connected ? 'tone-success' : 'tone-neutral'">
            {{ connected ? 'Verbunden' : 'Nicht verbunden' }}
          </span>
        </div>

        <dl v-if="connected" class="settings-summary">
          <div>
            <dt>Kanal</dt>
            <dd>{{ accountLabel }}</dd>
          </div>
          <div v-if="status.account.channel_id">
            <dt>Kanal-ID</dt>
            <dd class="mono">{{ status.account.channel_id }}</dd>
          </div>
          <div>
            <dt>Verbunden seit</dt>
            <dd>{{ formatDateTime(status.connected_at) }}</dd>
          </div>
          <div>
            <dt>Zugriff gültig bis</dt>
            <dd>{{ formatDateTime(status.expires_at) }}</dd>
          </div>
          <div>
            <dt>Berechtigungen</dt>
            <dd class="mono small">{{ status.scopes.join(' ') || '–' }}</dd>
          </div>
        </dl>

        <p v-else class="muted">
          Verbinde das Google-Konto, das den YouTube-Kanal besitzt. RELAY kann danach Streams
          anlegen, planen und starten. Der Zugriff kann jederzeit widerrufen werden.
        </p>

        <div class="live-preview-actions">
          <button
            v-if="!connected"
            type="button"
            class="btn btn-primary"
            :disabled="connecting"
            @click="connect"
          >
            <span v-if="connecting" class="spinner" aria-hidden="true"></span>
            Konto verbinden
          </button>
          <button
            v-else
            type="button"
            class="btn btn-ghost"
            :disabled="disconnecting"
            @click="disconnect"
          >
            <span v-if="disconnecting" class="spinner" aria-hidden="true"></span>
            Verbindung trennen
          </button>
          <button v-if="connected" type="button" class="btn btn-ghost" @click="connect">
            Erneut verbinden
          </button>
        </div>
      </section>

      <section v-if="connected" class="card">
        <div class="card-head">
          <div>
            <h2 class="card-title">Automatik</h2>
            <p class="card-sub">
              Steuert, ob RELAY Broadcasts selbst live schaltet und beendet.
            </p>
          </div>
          <span class="badge" :class="automationMode === 'off' ? 'tone-muted' : 'tone-success'">
            {{ automationMode === 'off' ? 'Aus' : automationMode === 'all' ? 'Alle' : 'Nur RELAY' }}
          </span>
        </div>
        <div class="settings-grid">
          <div class="field">
            <label for="yt-automation-mode">Modus</label>
            <select
              id="yt-automation-mode"
              v-model="automationMode"
              :disabled="automationSaving"
              @change="saveAutomation({ mode: automationMode })"
            >
              <option value="off">Aus – nur manuell</option>
              <option value="relay_only">Nur RELAY-Broadcasts (empfohlen)</option>
              <option value="all">Alle Broadcasts am Ingest</option>
            </select>
            <p class="field-hint">
              „Alle" umfasst auch in YouTube Studio erzeugte Broadcasts (Quick Live).
            </p>
          </div>
          <ToggleField
            :model-value="autoStart"
            label="Automatisch live"
            description="Nach dem Sink-Start den passenden Broadcast live schalten"
            :disabled="automationSaving || automationMode === 'off'"
            @update:model-value="saveAutomation({ auto_start: $event })"
          />
          <ToggleField
            :model-value="autoStop"
            label="Automatisch beenden"
            description="Beim Stream-Stop den aktiven Broadcast abschließen"
            :disabled="automationSaving || automationMode === 'off'"
            @update:model-value="saveAutomation({ auto_stop: $event })"
          />
        </div>
        <p class="field-hint">
          Im Modus „Nur RELAY" bleiben Studio-/Quick-Live-Broadcasts unberührt – auch beim
          automatischen Beenden.
        </p>
      </section>

      <section class="card">
        <div class="card-head">
          <div>
            <h2 class="card-title">Broadcasts</h2>
            <p class="card-sub">Geplante, laufende und beendete Streams des Kanals.</p>
          </div>
          <span class="badge tone-neutral">
            {{ broadcastsLoading && broadcasts.length === 0 ? 'Lädt…' : `${broadcasts.length} Einträge` }}
          </span>
        </div>

        <div v-if="broadcastsError" class="alert alert-error" role="alert">
          {{ broadcastsError }}
        </div>

        <div v-else-if="broadcastsLoading && broadcasts.length === 0" class="empty">
          <span class="spinner spinner-lg" aria-hidden="true"></span>
          <p>Broadcasts werden geladen…</p>
        </div>

        <div v-else-if="broadcasts.length === 0" class="empty">
          <p>Keine Broadcasts gefunden. Anlegen und Planen folgt im nächsten Schritt.</p>
        </div>

        <div v-else class="table-wrap">
          <table class="data-table" role="table">
            <caption class="sr-only">YouTube-Broadcasts des verbundenen Kanals</caption>
            <thead>
              <tr role="row">
                <th scope="col" role="columnheader">Titel</th>
                <th scope="col" role="columnheader">Status</th>
                <th scope="col" role="columnheader">Sichtbarkeit</th>
                <th scope="col" role="columnheader">Geplant</th>
                <th scope="col" role="columnheader">Gebundener Ingest</th>
                <th scope="col" role="columnheader">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="broadcast in broadcasts" :key="broadcast.id" role="row">
                <td data-label="Titel" role="cell">
                  <a :href="broadcast.watch_url" target="_blank" rel="noopener noreferrer">
                    {{ broadcast.title || broadcast.id }}
                  </a>
                  <span
                    class="badge badge-xs"
                    :class="broadcast.relay_managed ? 'tone-success' : 'tone-muted'"
                    :title="
                      broadcast.relay_managed
                        ? 'Von RELAY angelegt – Automatik erlaubt'
                        : 'In YouTube Studio/Quick Live angelegt – RELAY fasst ihn nicht automatisch an'
                    "
                  >
                    {{ broadcast.relay_managed ? 'RELAY' : 'Extern' }}
                  </span>
                  <br />
                  <small class="mono">{{ broadcast.id }}</small>
                </td>
                <td data-label="Status" role="cell">
                  <span class="badge" :class="broadcastTone(broadcast.status)">
                    {{ broadcastStatusLabel(broadcast.status) }}
                  </span>
                </td>
                <td data-label="Sichtbarkeit" role="cell">{{ privacyLabel(broadcast.privacy) }}</td>
                <td data-label="Geplant" role="cell">
                  {{ formatDateTime(broadcast.scheduled_start) }}
                </td>
                <td data-label="Gebundener Ingest" role="cell">{{ streamLabel(broadcast) }}</td>
                <td data-label="Aktionen" role="cell">
                  <div class="row-actions">
                    <button
                      v-if="['created', 'ready'].includes(broadcast.status)"
                      type="button"
                      class="btn btn-ghost btn-xs"
                      title="An den aktiven RELAY-Ingest binden"
                      :disabled="actingId !== null"
                      @click="assignToRelay(broadcast)"
                    >
                      Ingest
                    </button>
                    <button
                      v-if="['created', 'ready', 'testing'].includes(broadcast.status)"
                      type="button"
                      class="btn btn-ghost btn-xs"
                      :disabled="actingId !== null"
                      @click="startBroadcast(broadcast)"
                    >
                      <span
                        v-if="actingId === broadcast.id"
                        class="spinner"
                        aria-hidden="true"
                      ></span>
                      Live
                    </button>
                    <button
                      v-if="['live', 'testing'].includes(broadcast.status)"
                      type="button"
                      class="btn btn-ghost btn-xs"
                      :disabled="actingId !== null"
                      @click="completeBroadcast(broadcast)"
                    >
                      Beenden
                    </button>
                    <button
                      v-if="broadcast.privacy !== 'public' && broadcast.status !== 'complete'"
                      type="button"
                      class="btn btn-ghost btn-xs"
                      :disabled="actingId !== null"
                      @click="publishBroadcast(broadcast)"
                    >
                      Veröffentlichen
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      :disabled="actingId !== null"
                      @click="openEdit(broadcast)"
                    >
                      Bearbeiten
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      :disabled="actingId !== null"
                      @click="removeBroadcast(broadcast)"
                    >
                      Löschen
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="broadcastsFetchedAt" class="muted small">
            Stand {{ formatDateTime(broadcastsFetchedAt) }} · wird 20 s zwischengespeichert
          </p>
        </div>
      </section>
    </template>

    <YouTubeBroadcastEditor
      :open="editorOpen"
      :broadcast="editing"
      :streamers="store.streamers"
      :saving="saving"
      :error="editorError"
      @close="editorOpen = false"
      @save="saveBroadcast"
    />
  </div>
</template>
