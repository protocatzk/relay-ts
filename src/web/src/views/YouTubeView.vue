<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorMessage } from '@/src/api/client';
import type { YouTubeBroadcast, YouTubeStatus } from '@/src/api/types';
import { formatDateTime } from '@/src/utils/format';
import { useToast } from '@/src/composables/useToast';

const { pushToast } = useToast();
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
              </tr>
            </thead>
            <tbody>
              <tr v-for="broadcast in broadcasts" :key="broadcast.id" role="row">
                <td data-label="Titel" role="cell">
                  <a :href="broadcast.watch_url" target="_blank" rel="noopener noreferrer">
                    {{ broadcast.title || broadcast.id }}
                  </a>
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
              </tr>
            </tbody>
          </table>
          <p v-if="broadcastsFetchedAt" class="muted small">
            Stand {{ formatDateTime(broadcastsFetchedAt) }} · wird 20 s zwischengespeichert
          </p>
        </div>
      </section>
    </template>
  </div>
</template>
