<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorMessage } from '@/src/api/client';
import type { YouTubeStatus } from '@/src/api/types';
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
    pushToast('YouTube-Konto getrennt.', 'success');
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    disconnecting.value = false;
  }
}

onMounted(async () => {
  await load();
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
        <button type="button" class="btn btn-ghost" :disabled="loading" @click="load()">
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
            <p class="card-sub">Streams anlegen, planen und Status synchronisieren.</p>
          </div>
          <span class="badge tone-neutral">In Arbeit</span>
        </div>
        <p class="muted">
          Die Broadcast-Verwaltung folgt im nächsten Schritt von #18. Die Verbindung wird bereits
          jetzt dauerhaft gespeichert und automatisch erneuert.
        </p>
      </section>
    </template>
  </div>
</template>
