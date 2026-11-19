<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { YouTubeBroadcast } from '@/src/api/types';

const connected = ref(false);
const loading = ref(false);
const error = ref('');
const broadcasts = ref<YouTubeBroadcast[]>([]);

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
  return `https://www.youtube.com/live_chat?v=${encodeURIComponent(broadcast.id)}`;
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

onMounted(load);
</script>

<template>
  <section class="card youtube-chat-card" aria-labelledby="youtube-chat-title">
    <div class="card-head">
      <div>
        <h2 id="youtube-chat-title" class="card-title">YouTube-Chat</h2>
        <p class="card-sub">Live-Chat des aktiven Broadcasts öffnen.</p>
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
        geöffnet werden.
      </p>

      <div v-if="liveBroadcast" class="stack">
        <div class="live-preview-actions">
          <a
            :href="chatUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn-primary btn-sm"
          >
            Chat öffnen
          </a>
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
          Der Chat öffnet in einem neuen Tab auf youtube.com. Ob du dort angemeldet bist, hängt
          von deinem Browser-Konto bei Google ab – nicht vom serverseitigen OAuth von RELAY.
        </p>
      </div>
    </template>
  </section>
</template>
