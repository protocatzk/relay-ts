<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { YouTubeBroadcast } from '@/src/api/types';

const connected = ref(false);
const loading = ref(false);
const error = ref('');
const broadcasts = ref<YouTubeBroadcast[]>([]);
const open = ref(false);

const hostname = computed(() => window.location.hostname || 'relay.positronium.dev');

/** Prefer a currently live broadcast; otherwise the one with an active ingest. */
const liveBroadcast = computed<YouTubeBroadcast | null>(
  () =>
    broadcasts.value.find((b) => b.status === 'live') ??
    broadcasts.value.find((b) => b.stream_status === 'active') ??
    null,
);

const chatUrl = computed(() => {
  const broadcast = liveBroadcast.value;
  if (!broadcast) return '';
  const videoId = encodeURIComponent(broadcast.id);
  const domain = encodeURIComponent(hostname.value);
  return `https://www.youtube.com/live_chat?v=${videoId}&embed_domain=${domain}`;
});

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const status = await api.youtube.status();
    connected.value = status.connected;
    if (status.connected) {
      const data = await api.youtube.broadcasts();
      broadcasts.value = data.items;
    } else {
      broadcasts.value = [];
    }
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

function toggle(): void {
  open.value = !open.value;
}

onMounted(load);
</script>

<template>
  <section class="card youtube-chat-card" aria-labelledby="youtube-chat-title">
    <div class="card-head">
      <div>
        <h2 id="youtube-chat-title" class="card-title">YouTube-Chat</h2>
        <p class="card-sub">Live-Chat des aktiven Broadcasts, eingebettet.</p>
      </div>
      <div class="card-badges">
        <span
          v-if="loading"
          class="badge tone-neutral"
        >Lädt…</span>
        <span
          v-else-if="liveBroadcast"
          class="badge tone-success"
        >{{ liveBroadcast.title || 'Live' }}</span>
        <span
          v-else
          class="badge tone-neutral"
        >Kein Live-Broadcast</span>
      </div>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

    <div v-if="!connected" class="stack">
      <p class="muted">
        Kein YouTube-Konto verbunden.
        <RouterLink to="/youtube">Jetzt verbinden</RouterLink>
      </p>
    </div>

    <template v-else>
      <p v-if="!liveBroadcast && !loading" class="muted">
        Es läuft gerade kein Live-Broadcast. Sobald ein Broadcast live ist, kann der Chat hier
        eingeblendet werden.
      </p>

      <div v-if="liveBroadcast" class="stack">
        <div class="youtube-chat-stage" :class="{ 'is-open': open }">
          <iframe
            v-if="open && chatUrl"
            :src="chatUrl"
            class="youtube-chat-frame"
            title="YouTube Live-Chat"
            referrerpolicy="origin"
            allow="autoplay; encrypted-media"
            loading="lazy"
          ></iframe>
          <div v-else class="youtube-chat-placeholder">
            <p>Chat wird erst beim Öffnen geladen.</p>
          </div>
        </div>
        <div class="live-preview-actions">
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="loading"
            @click="toggle"
          >
            {{ open ? 'Chat schließen' : 'Chat öffnen' }}
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="loading"
            @click="load"
          >
            Aktualisieren
          </button>
        </div>
        <p class="muted small">
          Hinweis: Die Anmeldung im Chat hängt von deinem Browser-Konto bei Google ab – nicht vom
          serverseitigen OAuth von RELAY. Ohne Browser-Login ist der Chat nur lesbar.
        </p>
      </div>
    </template>
  </section>
</template>
