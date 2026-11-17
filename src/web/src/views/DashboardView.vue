<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { Streamer } from '@/src/api/types';
import StatusBadge from '@/src/components/StatusBadge.vue';
import { useStore } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';
import {
  formatBitrate,
  formatFps,
  formatNumber,
  formatSeconds,
  formatUptime,
} from '@/src/utils/format';

const { store, refreshStatus, refreshStreamers, refreshPlaylists } = useStore();
const { pushToast } = useToast();

const busy = ref<string | null>(null);
const quick = reactive({ tiktok: '', youtube_key: '', name: '' });
const selectedPlaylist = ref('');

const status = computed(() => store.status);
const state = computed(() => status.value?.state ?? null);
const isPaused = computed(() => state.value === 'paused');

const canStart = computed(
  () =>
    state.value !== 'starting' &&
    state.value !== 'live' &&
    state.value !== 'reconnecting' &&
    state.value !== 'stopping',
);
const canStop = computed(() => {
  if (state.value === 'stopping') return false;
  return Boolean(status.value?.active_streamer_id) || state.value === 'starting' || state.value === 'reconnecting';
});
const canPause = computed(
  () => state.value === 'live' || state.value === 'paused' || state.value === 'reconnecting',
);

const startCandidate = computed<Streamer | null>(() => {
  const enabled = store.streamers.filter((streamer) => streamer.enabled);
  return (
    enabled.find((streamer) => streamer.preferred && streamer.status.online === true) ??
    enabled.find((streamer) => streamer.status.online === true) ??
    enabled.find((streamer) => streamer.preferred) ??
    enabled[0] ??
    null
  );
});

const activePlaylist = computed(() => status.value?.active_playlist ?? null);

function onlineLabel(streamer: Streamer): string {
  if (streamer.status.online === true) return 'Online';
  if (streamer.status.online === false) return 'Offline';
  return 'Unbekannt';
}

function onlineClass(streamer: Streamer): string {
  if (streamer.status.online === true) return 'is-online';
  if (streamer.status.online === false) return 'is-offline';
  return 'is-unknown';
}

type RunMessage =
  | string
  | ((result: unknown) => { message: string; kind: 'success' | 'info' });

function startResultMessage(result: unknown, name: string): { message: string; kind: 'success' | 'info' } {
  const state = (result as { status?: { state?: string } } | undefined)?.status?.state;
  if (state === 'paused') {
    return {
      message: `${name} ist offline – Pausenscreen läuft, Start erfolgt automatisch sobald live.`,
      kind: 'info',
    };
  }
  return { message: `${name} wird gestartet.`, kind: 'success' };
}

async function run(
  key: string,
  action: () => Promise<unknown>,
  successMessage?: RunMessage,
): Promise<unknown> {
  busy.value = key;
  try {
    const result = await action();
    await Promise.allSettled([refreshStatus(), refreshStreamers()]);
    if (typeof successMessage === 'function') {
      const detail = successMessage(result);
      pushToast(detail.message, detail.kind);
    } else if (successMessage) {
      pushToast(successMessage, 'success');
    }
    return result;
  } catch (error) {
    pushToast(errorMessage(error), 'error');
    // A failed start may still have created a streamer.
    await Promise.allSettled([refreshStatus(), refreshStreamers()]);
    return undefined;
  } finally {
    busy.value = null;
  }
}

async function startGlobal(): Promise<void> {
  if (!canStart.value) return;
  const candidate = startCandidate.value;
  if (!candidate) {
    pushToast('Kein aktivierter Streamer vorhanden. Bitte zuerst einen Streamer anlegen.', 'error');
    return;
  }
  await run(
    'start',
    () => api.streamers.start(candidate.id),
    (result) => startResultMessage(result, candidate.name),
  );
}

async function stopGlobal(): Promise<void> {
  const id = status.value?.active_streamer_id;
  if (!id) {
    pushToast('Es läuft aktuell kein Stream.', 'error');
    return;
  }
  await run('stop', () => api.streamers.stop(id), 'Stream wird gestoppt.');
}

async function togglePause(): Promise<void> {
  const paused = isPaused.value;
  await run(
    paused ? 'resume' : 'pause',
    () => (paused ? api.pause.stop() : api.pause.start()),
    paused ? 'Pause beendet.' : 'Pause aktiviert.',
  );
}

async function startStreamer(streamer: Streamer): Promise<void> {
  await run(
    `start:${streamer.id}`,
    () => api.streamers.start(streamer.id),
    (result) => startResultMessage(result, streamer.name),
  );
}

async function switchStreamer(streamer: Streamer): Promise<void> {
  await run(
    `switch:${streamer.id}`,
    () => api.streamers.switchTo(streamer.id),
    (result) => startResultMessage(result, streamer.name),
  );
}

async function stopStreamer(streamer: Streamer): Promise<void> {
  await run(`stop:${streamer.id}`, () => api.streamers.stop(streamer.id), `${streamer.name} wird gestoppt.`);
}

async function playSelectedPlaylist(): Promise<void> {
  const id = selectedPlaylist.value;
  if (!id) return;
  const playlist = store.playlists.find((entry) => entry.id === id);
  await run(
    'playlist',
    () => api.playlists.play(id),
    playlist ? `Playlist „${playlist.name}“ wird abgespielt.` : 'Playlist wird abgespielt.',
  );
}

async function submitQuickStart(): Promise<void> {
  if (!quick.tiktok.trim() || !quick.youtube_key.trim()) {
    pushToast('Bitte TikTok-Handle und YouTube-Key angeben.', 'error');
    return;
  }
  const payload = {
    tiktok: quick.tiktok.trim(),
    youtube_key: quick.youtube_key.trim(),
    ...(quick.name.trim() ? { name: quick.name.trim() } : {}),
  };
  const displayName = quick.name.trim() || quick.tiktok.trim();
  await run(
    'quickstart',
    async () => {
      const result = await api.quickstart(payload);
      quick.tiktok = '';
      quick.youtube_key = '';
      quick.name = '';
      return result;
    },
    (result) => startResultMessage(result, displayName),
  );
}

watch(
  () => store.playlists,
  (playlists) => {
    if (!selectedPlaylist.value && playlists.length > 0) {
      selectedPlaylist.value = playlists[0]?.id ?? '';
    }
  },
  { immediate: true },
);

onMounted(() => {
  void Promise.allSettled([refreshStatus(), refreshStreamers(), refreshPlaylists()]);
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Dashboard</h1>
        <p class="page-sub">Live-Status, Steuerung und Schnellstart deines Restreams.</p>
      </div>
      <div class="page-actions">
        <span class="update-hint mono">
          {{ store.loading.status ? 'Aktualisiere…' : 'Auto-Update via SSE' }}
        </span>
      </div>
    </div>

    <section class="card hero-card">
      <div class="hero-main">
        <div class="hero-top">
          <StatusBadge :state="state" large />
          <span v-if="status?.state === 'live'" class="hero-uptime mono">
            {{ formatUptime(status.uptime_seconds) }}
          </span>
        </div>
        <h2 class="hero-title">
          {{ status?.active_streamer_name ?? 'Kein aktiver Stream' }}
        </h2>
        <p class="hero-sub">
          <template v-if="status?.active_playlist">
            Playlist „{{ status.active_playlist.name }}“ · Kanal {{ status.active_playlist.index + 1 }} von
            {{ status.active_playlist.total }}
          </template>
          <template v-else-if="status?.state === 'paused'">
            Der Stream ist pausiert. Der Pausenscreen wird gesendet.
          </template>
          <template v-else-if="status?.state === 'error'">
            {{ status.watchdog.last_error ?? 'Ein Fehler ist aufgetreten.' }}
          </template>
          <template v-else-if="status">
            {{ status.source.online === false ? 'Quelle offline.' : 'Bereit für den nächsten Start.' }}
          </template>
          <template v-else>Keine Statusdaten empfangen.</template>
        </p>

        <div class="quick-actions">
          <button
            type="button"
            class="btn btn-primary"
            :disabled="!canStart || busy !== null"
            @click="startGlobal"
          >
            <span v-if="busy === 'start'" class="spinner" aria-hidden="true"></span>
            <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
              <path d="m8 5 11 7-11 7V5Z" fill="currentColor" />
            </svg>
            Stream starten
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            :disabled="!canStop || busy !== null"
            @click="stopGlobal"
          >
            <span v-if="busy === 'stop'" class="spinner" aria-hidden="true"></span>
            <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
            </svg>
            Stream stoppen
          </button>
          <button
            type="button"
            class="btn btn-ghost"
            :disabled="!canPause || busy !== null"
            @click="togglePause"
          >
            <span v-if="busy === 'pause' || busy === 'resume'" class="spinner" aria-hidden="true"></span>
            <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
              <path
                v-if="isPaused"
                d="m8 5 11 7-11 7V5Z"
                fill="currentColor"
              />
              <path v-else d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
            </svg>
            {{ isPaused ? 'Pause beenden' : 'Pause' }}
          </button>
        </div>
      </div>

      <dl class="hero-facts">
        <div>
          <dt>Uptime</dt>
          <dd class="mono">{{ formatUptime(status?.uptime_seconds) }}</dd>
        </div>
        <div>
          <dt>Aktive Playlist</dt>
          <dd>{{ activePlaylist?.name ?? '–' }}</dd>
        </div>
        <div>
          <dt>Nächster Auto-Refresh</dt>
          <dd class="mono">
            {{
              status?.auto_refresh.enabled && status.auto_refresh.next_refresh_in_seconds != null
                ? formatUptime(status.auto_refresh.next_refresh_in_seconds)
                : '–'
            }}
          </dd>
        </div>
      </dl>
    </section>

    <div v-if="status?.watchdog.last_error" class="alert alert-warn" role="status">
      <strong>Watchdog:</strong> {{ status.watchdog.last_error }}
    </div>

    <section class="metric-grid" aria-label="Stream-Metriken">
      <div class="card metric">
        <span class="metric-label">Relay-Puffer</span>
        <span class="metric-value mono">{{ formatSeconds(status?.relay.buffer_seconds) }}</span>
        <span class="metric-sub">Verzögerung {{ formatNumber(status?.relay.delay_seconds) }} s</span>
      </div>
      <div class="card metric">
        <span class="metric-label">Quelle</span>
        <span class="metric-value mono">{{ formatBitrate(status?.source.bitrate_kbps) }}</span>
        <span class="metric-sub">
          {{ status?.source.connected ? 'Verbunden' : 'Nicht verbunden' }} ·
          {{ formatNumber(status?.source.reconnects) }} Reconnects
        </span>
      </div>
      <div class="card metric">
        <span class="metric-label">Ausgang</span>
        <span class="metric-value mono">{{ formatBitrate(status?.sink.bitrate_kbps) }}</span>
        <span class="metric-sub">
          Ziel {{ formatBitrate(status?.sink.target_bitrate_kbps) }} ·
          {{ status?.sink.running ? 'Läuft' : 'Gestoppt' }}
        </span>
      </div>
      <div class="card metric">
        <span class="metric-label">FPS</span>
        <span class="metric-value mono">{{ formatFps(status?.sink.fps) }}</span>
        <span class="metric-sub">Geschwindigkeit {{ status?.sink.speed ?? '–' }}</span>
      </div>
      <div class="card metric">
        <span class="metric-label">Dropped Frames</span>
        <span class="metric-value mono">{{ formatNumber(status?.sink.dropped_frames) }}</span>
        <span class="metric-sub">{{ formatNumber(status?.sink.restarts) }} Sink-Neustarts</span>
      </div>
      <div class="card metric">
        <span class="metric-label">Watchdog-Stalls</span>
        <span class="metric-value mono">{{ formatNumber(status?.watchdog.stall_count) }}</span>
        <span class="metric-sub">
          Timeout {{ formatNumber(status?.watchdog.stall_timeout) }} s
        </span>
      </div>
      <div class="card metric">
        <span class="metric-label">Auto-Refresh</span>
        <span class="metric-value mono">
          {{
            status?.auto_refresh.enabled && status.auto_refresh.next_refresh_in_seconds != null
              ? formatUptime(status.auto_refresh.next_refresh_in_seconds)
              : 'Aus'
          }}
        </span>
        <span class="metric-sub">
          Alle {{ formatNumber(status?.auto_refresh.interval_minutes) }} Min. ·
          {{ formatNumber(status?.auto_refresh.count) }}×
        </span>
      </div>
      <div class="card metric">
        <span class="metric-label">Relay-Daten</span>
        <span class="metric-value mono">{{ formatNumber(status?.relay.ingest_clients) }}</span>
        <span class="metric-sub">
          Ingest-Clients · Pacing {{ formatBitrate(status?.relay.pacing_kbps) }}
        </span>
      </div>
    </section>

    <div class="dashboard-grid">
      <section class="card">
        <div class="card-head">
          <div>
            <h2 class="card-title">Schnellstart</h2>
            <p class="card-sub">Neuen TikTok-Stream direkt starten.</p>
          </div>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true" class="card-icon">
            <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
          </svg>
        </div>
        <form class="stack" @submit.prevent="submitQuickStart">
          <div class="field">
            <label for="quick-tiktok">TikTok-Handle <span class="req">*</span></label>
            <input
              id="quick-tiktok"
              v-model="quick.tiktok"
              type="text"
              placeholder="@username"
              spellcheck="false"
              autocomplete="off"
            />
          </div>
          <div class="field">
            <label for="quick-key">YouTube-Stream-Key <span class="req">*</span></label>
            <input
              id="quick-key"
              v-model="quick.youtube_key"
              type="password"
              placeholder="Stream-Key"
              autocomplete="new-password"
            />
          </div>
          <div class="field">
            <label for="quick-name">Name <span class="muted">(optional)</span></label>
            <input id="quick-name" v-model="quick.name" type="text" placeholder="Anzeigename" autocomplete="off" />
          </div>
          <button type="submit" class="btn btn-primary" :disabled="busy === 'quickstart'">
            <span v-if="busy === 'quickstart'" class="spinner" aria-hidden="true"></span>
            Jetzt starten
          </button>
        </form>
      </section>

      <section class="card">
        <div class="card-head">
          <div>
            <h2 class="card-title">Playlist-Schnellstart</h2>
            <p class="card-sub">Playlist direkt abspielen.</p>
          </div>
          <RouterLink to="/playlists" class="btn btn-ghost btn-sm">Alle Playlists</RouterLink>
        </div>
        <div v-if="store.playlists.length > 0" class="stack">
          <div class="field">
            <label for="quick-playlist">Playlist</label>
            <select id="quick-playlist" v-model="selectedPlaylist">
              <option v-for="playlist in store.playlists" :key="playlist.id" :value="playlist.id">
                {{ playlist.name }} ({{ playlist.channels.length }} Kanäle)
              </option>
            </select>
          </div>
          <button
            type="button"
            class="btn btn-secondary"
            :disabled="busy === 'playlist' || !selectedPlaylist"
            @click="playSelectedPlaylist"
          >
            <span v-if="busy === 'playlist'" class="spinner" aria-hidden="true"></span>
            <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
              <path d="m8 5 11 7-11 7V5Z" fill="currentColor" />
            </svg>
            Playlist abspielen
          </button>
          <div v-if="activePlaylist" class="info-row">
            <span class="badge tone-info">Aktiv</span>
            <span>{{ activePlaylist.name }}</span>
            <span class="mono muted">{{ activePlaylist.index + 1 }}/{{ activePlaylist.total }}</span>
          </div>
        </div>
        <div v-else class="empty compact">
          <p>Noch keine Playlists vorhanden.</p>
          <RouterLink to="/playlists" class="btn btn-ghost btn-sm">Playlists ansehen</RouterLink>
        </div>
      </section>
    </div>

    <section class="card">
      <div class="card-head">
        <div>
          <h2 class="card-title">Streamer</h2>
          <p class="card-sub">Online-Status und schneller Wechsel.</p>
        </div>
        <RouterLink to="/streamers" class="btn btn-ghost btn-sm">Verwalten</RouterLink>
      </div>

      <div v-if="store.streamers.length === 0" class="empty">
        <p>Noch keine Streamer angelegt.</p>
        <RouterLink to="/streamers" class="btn btn-primary btn-sm">Ersten Streamer anlegen</RouterLink>
      </div>

      <ul v-else class="streamer-list">
        <li v-for="streamer in store.streamers" :key="streamer.id" class="streamer-row">
          <span class="online-indicator" :class="onlineClass(streamer)">
            <span class="dot" aria-hidden="true"></span>
            {{ onlineLabel(streamer) }}
          </span>
          <div class="streamer-identity">
            <strong>{{ streamer.name }}</strong>
            <span class="streamer-meta">@{{ streamer.tiktok.replace(/^@/, '') }} · {{ streamer.id }}</span>
          </div>
          <span class="badge tone-neutral">{{ streamer.quality }}</span>
          <span v-if="streamer.status.active" class="badge tone-success">Aktiv</span>
          <span v-else-if="!streamer.enabled" class="badge tone-muted">Deaktiviert</span>
          <div class="streamer-actions">
            <button
              v-if="streamer.status.active"
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="busy !== null"
              @click="stopStreamer(streamer)"
            >
              Stoppen
            </button>
            <button
              v-else
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="busy !== null || !streamer.enabled"
              @click="startStreamer(streamer)"
            >
              Starten
            </button>
            <button
              v-if="!streamer.status.active && status?.active_streamer_id"
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="busy !== null || !streamer.enabled"
              @click="switchStreamer(streamer)"
            >
              Wechseln
            </button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
