<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { YouTubeBroadcast, YouTubeLiveChatMessage } from '@/src/api/types';

const props = defineProps<{
  broadcasts: YouTubeBroadcast[];
}>();

const MAX_MESSAGES = 150;
const MIN_POLL_MS = 10_000;

const open = ref(false);
const selectedId = ref('');
const messages = ref<YouTubeLiveChatMessage[]>([]);
const nextPageToken = ref<string | null>(null);
const loading = ref(false);
const offline = ref(false);
const error = ref('');
const lastUpdatedAt = ref<string | null>(null);
const visible = ref(typeof document === 'undefined' ? true : document.visibilityState === 'visible');

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let requestSeq = 0;

const liveBroadcasts = computed(() =>
  props.broadcasts.filter((item) => item.status === 'live'),
);

watch(
  liveBroadcasts,
  (list) => {
    if (list.length === 0) {
      selectedId.value = '';
      stopPolling();
      return;
    }
    if (!list.some((item) => item.id === selectedId.value)) {
      selectedId.value = list[0]!.id;
      resetChat();
    }
  },
  { immediate: true },
);

watch([open, selectedId, visible], () => {
  if (open.value && selectedId.value && visible.value) {
    void pollOnce();
  } else {
    stopPolling();
  }
});

function stopPolling(): void {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function resetChat(): void {
  messages.value = [];
  nextPageToken.value = null;
  offline.value = false;
  error.value = '';
  lastUpdatedAt.value = null;
}

function appendMessages(incoming: YouTubeLiveChatMessage[]): void {
  if (incoming.length === 0) return;
  const seen = new Set(messages.value.map((m) => m.id));
  const merged = [...messages.value];
  for (const msg of incoming) {
    if (!seen.has(msg.id)) {
      seen.add(msg.id);
      merged.push(msg);
    }
  }
  messages.value = merged.slice(-MAX_MESSAGES);
}

async function pollOnce(): Promise<void> {
  stopPolling();
  if (!open.value || !selectedId.value || !visible.value) return;
  const currentSeq = ++requestSeq;
  const broadcastId = selectedId.value;
  loading.value = true;
  error.value = '';
  try {
    const page = await api.youtube.chat(broadcastId, nextPageToken.value ?? undefined);
    if (currentSeq !== requestSeq || selectedId.value !== broadcastId) return;
    offline.value = page.offline;
    nextPageToken.value = page.next_page_token;
    appendMessages(page.messages);
    lastUpdatedAt.value = new Date().toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    if (!page.offline && open.value && visible.value) {
      const delay = Math.max(MIN_POLL_MS, page.polling_interval_ms || MIN_POLL_MS);
      pollTimer = setTimeout(() => {
        void pollOnce();
      }, delay);
    }
  } catch (err) {
    if (currentSeq !== requestSeq) return;
    error.value = errorMessage(err);
  } finally {
    if (currentSeq === requestSeq) loading.value = false;
  }
}

function onVisibilityChange(): void {
  visible.value = document.visibilityState === 'visible';
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange);
});

onBeforeUnmount(() => {
  stopPolling();
  document.removeEventListener('visibilitychange', onVisibilityChange);
});
</script>

<template>
  <section v-if="liveBroadcasts.length > 0" class="card">
    <div class="card-head">
      <div>
        <h2 class="card-title">YouTube Live-Chat</h2>
        <p class="card-sub">
          Pollt nur bei geöffnetem Panel &amp; aktivem Tab (min. 10 s Intervall zum Quota-Schutz).
        </p>
      </div>
      <div class="row-actions">
        <span v-if="lastUpdatedAt && open" class="badge tone-neutral mono">
          Stand {{ lastUpdatedAt }}
        </span>
        <button
          type="button"
          class="btn btn-sm"
          :class="open ? 'btn-primary' : 'btn-ghost'"
          :aria-expanded="open"
          @click="open = !open"
        >
          {{ open ? 'Chat ausblenden' : 'Live-Chat öffnen' }}
        </button>
      </div>
    </div>

    <div v-if="open" class="stack">
      <div v-if="liveBroadcasts.length > 1" class="field">
        <label class="label" for="yt-chat-broadcast">Live-Broadcast</label>
        <select
          id="yt-chat-broadcast"
          v-model="selectedId"
          @change="resetChat()"
        >
          <option v-for="item in liveBroadcasts" :key="item.id" :value="item.id">
            {{ item.title || item.id }}
          </option>
        </select>
      </div>

      <div v-if="error" class="alert alert-error" role="alert">
        {{ error }}
      </div>
      <div v-else-if="offline" class="alert alert-info">
        Für diesen Broadcast ist kein aktiver YouTube Live-Chat verfügbar.
      </div>

      <div class="yt-chat-list" role="log" aria-live="polite" aria-label="YouTube Live-Chat">
        <div v-if="messages.length === 0 && !loading" class="empty">
          <p>Noch keine Chat-Nachrichten empfangen.</p>
        </div>
        <div v-for="msg in messages" :key="msg.id" class="yt-chat-row">
          <span class="mono muted yt-chat-time">{{ formatTime(msg.published_at) }}</span>
          <span class="yt-chat-author">
            <strong>{{ msg.author }}</strong>
            <span v-if="msg.is_owner" class="badge badge-xs tone-success">Host</span>
            <span v-else-if="msg.is_moderator" class="badge badge-xs tone-info">Mod</span>
            <span v-else-if="msg.is_sponsor" class="badge badge-xs tone-warn">Mitglied</span>
          </span>
          <span class="yt-chat-text">{{ msg.text }}</span>
        </div>
      </div>

      <div class="row-actions">
        <button type="button" class="btn btn-sm btn-ghost" :disabled="loading" @click="pollOnce">
          {{ loading ? 'Lädt…' : 'Jetzt aktualisieren' }}
        </button>
        <button
          v-if="messages.length > 0"
          type="button"
          class="btn btn-sm btn-ghost"
          @click="resetChat"
        >
          Leeren
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.yt-chat-list {
  max-height: 22rem;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.65rem 0.75rem;
  background: var(--bg-soft, var(--bg));
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.yt-chat-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem;
  font-size: 0.875rem;
  line-height: 1.4;
}

.yt-chat-time {
  font-size: 0.75rem;
  flex-shrink: 0;
}

.yt-chat-author {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  flex-shrink: 0;
}

.yt-chat-text {
  word-break: break-word;
}
</style>
