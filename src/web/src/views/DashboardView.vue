<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { EarningsPeriod, Streamer, TitlePreview } from '@/src/api/types';
import EarningsPanel from '@/src/components/EarningsPanel.vue';
import LivePreview from '@/src/components/LivePreview.vue';
import YoutubeChatPanel from '@/src/components/YoutubeChatPanel.vue';
import StatusBadge from '@/src/components/StatusBadge.vue';
import ModuleVital from '@/src/components/ModuleVital.vue';
import { useStore } from '@/src/composables/useStore';
import { useTelemetry } from '@/src/composables/useTelemetry';
import { useToast } from '@/src/composables/useToast';
import {
  formatBitrate,
  formatFps,
  formatNumber,
  formatSeconds,
  formatUptime,
} from '@/src/utils/format';
import { sortStreamersByLive } from '@/src/utils/sort-streamers';

const { store, refreshStatus, refreshStreamers, refreshPlaylists } = useStore();
const { series } = useTelemetry();
const { pushToast } = useToast();

const busy = ref<string | null>(null);
const refreshingEarnings = ref(false);
const quick = reactive({ tiktok: '', youtube_key: '', name: '' });
const selectedPlaylist = ref('');

const status = computed(() => store.status);
const state = computed(() => status.value?.state ?? null);
const isPaused = computed(() => state.value === 'paused');
const manualScreen = computed(() => status.value?.manual_screen ?? null);

const sourceTone = computed(() => {
  if (state.value === 'error') return 'danger';
  if (state.value === 'reconnecting' || !status.value?.source.connected) return 'warning';
  if (status.value?.source.connected) return 'success';
  return undefined;
});
const sinkTone = computed(() => {
  if (state.value === 'error') return 'danger';
  if (state.value === 'live' && status.value?.sink.running) return 'success';
  if (state.value === 'reconnecting') return 'warning';
  return undefined;
});
const watchdogTone = computed(() =>
  status.value?.watchdog.last_error ? 'danger' : undefined,
);

const canStart = computed(
  () =>
    state.value !== 'starting' &&
    state.value !== 'live' &&
    state.value !== 'reconnecting' &&
    state.value !== 'stopping',
);
const canStop = computed(() => {
  if (state.value === 'stopping') return false;
  return (
    Boolean(status.value?.active_streamer_id) ||
    manualScreen.value !== null ||
    state.value === 'starting' ||
    state.value === 'reconnecting'
  );
});
const canPause = computed(
  () =>
    state.value === 'live' ||
    state.value === 'paused' ||
    state.value === 'reconnecting' ||
    state.value === 'idle' ||
    state.value === 'error',
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
const streamers = computed(() => sortStreamersByLive(store.streamers));
const previewUrl = ref(api.overlays.previewUrl(false));
const chatTest = reactive({ username: 'Testuser', text: '' });
const sendingChat = ref(false);
const titlePreview = ref<TitlePreview | null>(null);
let previewTimer: number | null = null;

function refreshPreview(): void {
  previewUrl.value = api.overlays.previewUrl(false);
}

async function sendChatTest(): Promise<void> {
  if (!chatTest.text.trim()) return;
  sendingChat.value = true;
  try {
    await api.chat.test(chatTest.username.trim() || 'Testuser', chatTest.text.trim());
    chatTest.text = '';
    refreshPreview();
    pushToast('Testnachricht an das Overlay gesendet.', 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    sendingChat.value = false;
  }
}

async function restartSink(): Promise<void> {
  await run('sink', () => api.system.restartSink(), 'YouTube-Sink wird neu gestartet.');
}

async function refreshSource(): Promise<void> {
  await run('source', () => api.system.refreshSource(), 'Quell-URL wird aktualisiert.');
}

async function reloadYaml(): Promise<void> {
  await run('reload', () => api.system.reload(), 'Konfiguration neu geladen.');
}

async function refreshEarnings(): Promise<void> {
  refreshingEarnings.value = true;
  try {
    await api.earnings.refresh();
    await refreshStatus();
    pushToast('Einnahmen aktualisiert.', 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    refreshingEarnings.value = false;
  }
}

async function changeEarningsPeriod(period: EarningsPeriod): Promise<void> {
  refreshingEarnings.value = true;
  try {
    await api.earnings.setPeriod(period);
    await refreshStatus();
    pushToast('Einnahmen-Zeitraum geändert.', 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    refreshingEarnings.value = false;
  }
}

async function loadTitle(id: string | null | undefined): Promise<void> {
  if (!id) {
    titlePreview.value = null;
    return;
  }
  try {
    titlePreview.value = await api.streamers.title(id);
  } catch {
    titlePreview.value = null;
  }
}

async function copyTitle(): Promise<void> {
  if (!titlePreview.value?.title) return;
  try {
    await navigator.clipboard.writeText(titlePreview.value.title);
    pushToast('Titel kopiert.', 'success');
  } catch {
    pushToast('Kopieren nicht möglich.', 'error');
  }
}

watch(
  () => status.value?.active_streamer_id,
  (id) => void loadTitle(id),
  { immediate: true },
);

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

type RunMessage = string | ((result: unknown) => { message: string; kind: 'success' | 'info' });

function startResultMessage(
  result: unknown,
  name: string,
): { message: string; kind: 'success' | 'info' } {
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
    if (manualScreen.value) {
      await run('stop', () => api.screens.stop(), 'Screen beendet.');
      return;
    }
    pushToast('Es läuft aktuell kein Stream.', 'error');
    return;
  }
  await run('stop', () => api.streamers.stop(id), 'Stream wird gestoppt.');
}

function screenStopMessage(): string {
  return status.value?.active_streamer_id ? 'Zurück zum Stream.' : 'Screen beendet.';
}

async function togglePause(): Promise<void> {
  const shouldStop = isPaused.value && manualScreen.value !== 'startup';
  await run(
    shouldStop ? 'screen-stop' : 'pause',
    () => (shouldStop ? api.screens.stop() : api.screens.show('pause')),
    shouldStop ? screenStopMessage() : 'Pausenscreen aktiviert.',
  );
}

async function toggleStartup(): Promise<void> {
  const shouldStop = manualScreen.value === 'startup';
  await run(
    shouldStop ? 'screen-stop' : 'startup',
    () => (shouldStop ? api.screens.stop() : api.screens.show('startup')),
    shouldStop ? screenStopMessage() : 'Startbildschirm aktiviert.',
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
  await run(
    `stop:${streamer.id}`,
    () => api.streamers.stop(streamer.id),
    `${streamer.name} wird gestoppt.`,
  );
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
  refreshPreview();
  previewTimer = window.setInterval(refreshPreview, 5000);
});

onBeforeUnmount(() => {
  if (previewTimer !== null) window.clearInterval(previewTimer);
});
</script>

<template>
  <div class="page page-dashboard">
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
      <div class="hero-bar">
        <StatusBadge :state="state" large />
        <div class="hero-titleblock">
          <h2 class="hero-title">
            {{
              status?.active_streamer_name ??
              (manualScreen === 'startup'
                ? 'Startbildschirm'
                : manualScreen === 'pause'
                  ? 'Pausenscreen'
                  : 'Kein aktiver Stream')
            }}
          </h2>
          <p class="hero-sub">
            <template v-if="status?.active_playlist">
              Playlist „{{ status.active_playlist.name }}“ · Kanal
              {{ status.active_playlist.index + 1 }} von {{ status.active_playlist.total }}
            </template>
            <template v-else-if="status?.state === 'paused'">
              {{
                manualScreen === 'startup'
                  ? 'Der Startbildschirm wird gesendet.'
                  : status.active_streamer_id
                    ? 'Der Stream ist pausiert. Der Pausenscreen wird gesendet.'
                    : 'Der Pausenscreen wird gesendet.'
              }}
            </template>
            <template v-else-if="status?.state === 'error'">
              {{ status.watchdog.last_error ?? 'Ein Fehler ist aufgetreten.' }}
            </template>
            <template v-else-if="status">
              {{ status.source.online === false ? 'Quelle offline.' : 'Bereit für den nächsten Start.' }}
            </template>
            <template v-else>Keine Statusdaten empfangen.</template>
          </p>
        </div>
        <div class="quick-actions">
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="!canStart || busy !== null"
            @click="startGlobal"
          >
            <span v-if="busy === 'start'" class="spinner" aria-hidden="true"></span>
            <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
              <path d="m8 5 11 7-11 7V5Z" fill="currentColor" />
            </svg>
            Start
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            :disabled="!canStop || busy !== null"
            @click="stopGlobal"
          >
            <span v-if="busy === 'stop'" class="spinner" aria-hidden="true"></span>
            <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
            </svg>
            Stop
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="!canPause || busy !== null"
            @click="toggleStartup"
          >
            <span
              v-if="busy === 'startup' || busy === 'screen-stop'"
              class="spinner"
              aria-hidden="true"
            ></span>
            <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
              <rect
                x="3"
                y="4"
                width="18"
                height="13"
                rx="2"
                stroke="currentColor"
                stroke-width="1.8"
              />
              <path
                d="M8 21h8M12 17v4"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              />
            </svg>
            Startbild
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="!canPause || busy !== null"
            @click="togglePause"
          >
            <span
              v-if="busy === 'pause' || busy === 'screen-stop'"
              class="spinner"
              aria-hidden="true"
            ></span>
            <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
              <path
                v-if="manualScreen === 'pause' || (isPaused && manualScreen !== 'startup')"
                d="m8 5 11 7-11 7V5Z"
                fill="currentColor"
              />
              <path
                v-else
                d="M8 5v14M16 5v14"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
              />
            </svg>
            {{ manualScreen === 'pause' || (isPaused && manualScreen !== 'startup') ? 'Resume' : 'Pause' }}
          </button>
        </div>
      </div>

      <dl class="hero-facts">
        <div>
          <dt>Uptime</dt>
          <dd class="mono">{{ formatUptime(status?.uptime_seconds) }}</dd>
        </div>
        <div>
          <dt>Playlist</dt>
          <dd>{{ activePlaylist?.name ?? '–' }}</dd>
        </div>
        <div>
          <dt>Auto-Refresh</dt>
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

    <section class="vitals-rail" aria-label="System-Vitals">
      <ModuleVital
        label="Quelle"
        :value="formatBitrate(status?.source.bitrate_kbps)"
        :sub="`${status?.source.connected ? 'Verbunden' : 'Nicht verbunden'} · ${formatNumber(status?.source.reconnects)} Reconnects`"
        module="source"
        :series="series('source_kbps')"
        :tone="sourceTone"
      />
      <ModuleVital
        label="Relay"
        :value="formatSeconds(status?.relay.buffer_seconds)"
        :sub="`Verzögerung ${formatNumber(status?.relay.delay_seconds)} s · ${formatNumber(status?.relay.ingest_clients)} Ingest`"
        module="relay"
        :series="series('relay_buffer_s')"
      />
      <ModuleVital
        label="Sink"
        :value="formatBitrate(status?.sink.bitrate_kbps)"
        :sub="`${formatFps(status?.sink.fps)} · ${formatNumber(status?.sink.dropped_frames)} Dropped · Ziel ${formatBitrate(status?.sink.target_bitrate_kbps)}`"
        module="sink"
        :series="series('sink_kbps')"
        :tone="sinkTone"
      />
      <ModuleVital
        label="Watchdog"
        :value="formatNumber(status?.watchdog.stall_count)"
        :sub="status?.watchdog.last_error ?? `Timeout ${formatNumber(status?.watchdog.stall_timeout)} s`"
        module="watchdog"
        :series="series('watchdog_stalls')"
        :tone="watchdogTone"
      />
    </section>

    <div class="dash-grid">
      <div v-if="status?.watchdog.last_error" class="alert alert-warn span-3" role="status">
        <strong>Watchdog:</strong> {{ status.watchdog.last_error }}
      </div>

      <LivePreview :state="state" />

      <YoutubeChatPanel />

      <section class="card dashboard-live">
      <div class="card-head">
        <div>
          <h2 class="card-title">Overlay & Technik</h2>
          <p class="card-sub">Live-Chat-Vorschau und Wartungsaktionen.</p>
        </div>
        <div class="card-badges">
          <span v-if="status?.chat.canvas_active" class="badge tone-success">Canvas live</span>
          <span v-else class="badge tone-neutral">Canvas inaktiv</span>
          <RouterLink to="/overlays" class="btn btn-ghost btn-sm">Overlay-Studio</RouterLink>
        </div>
      </div>
      <div class="dashboard-live-grid">
        <div class="dashboard-preview-stage">
          <img :src="previewUrl" alt="Chat-Overlay-Vorschau" />
        </div>
        <div class="stack">
          <dl class="settings-summary">
            <div>
              <dt>Chat-Engine</dt>
              <dd>{{ status?.chat.engine ?? '–' }}</dd>
            </div>
            <div>
              <dt>Nachrichten</dt>
              <dd>{{ status?.chat.messages ?? 0 }}</dd>
            </div>
            <div>
              <dt>Chat-API</dt>
              <dd>{{ status?.chat.api_configured ? 'OK' : 'fehlt' }}</dd>
            </div>
          </dl>
          <form class="stack compact" @submit.prevent="sendChatTest">
            <div class="field">
              <label for="dash-chat-text">Testnachricht</label>
              <div class="input-with-button">
                <input
                  id="dash-chat-text"
                  v-model="chatTest.text"
                  type="text"
                  maxlength="300"
                  placeholder="Nachricht ins Overlay senden …"
                />
                <button
                  type="submit"
                  class="btn btn-primary btn-sm"
                  :disabled="sendingChat || !chatTest.text.trim()"
                >
                  <span v-if="sendingChat" class="spinner" aria-hidden="true"></span>
                  Senden
                </button>
              </div>
            </div>
          </form>
          <div v-if="titlePreview" class="field">
            <label for="dash-title">YouTube-Titel</label>
            <div class="input-with-button">
              <input id="dash-title" :value="titlePreview.title" type="text" readonly />
              <button type="button" class="btn btn-ghost btn-sm" @click="copyTitle">
                Kopieren
              </button>
            </div>
          </div>
          <div class="quick-actions">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="busy !== null || !status?.sink.running"
              @click="restartSink"
            >
              Sink neu starten
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="busy !== null || !status?.active_streamer_id"
              @click="refreshSource"
            >
              Quelle aktualisieren
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="busy !== null"
              @click="reloadYaml"
            >
              YAML neu laden
            </button>
          </div>
        </div>
      </div>
    </section>

      <EarningsPanel
        v-if="status?.earnings"
        :earnings="status.earnings"
        :refreshing="refreshingEarnings"
        @refresh="refreshEarnings"
        @period="changeEarningsPeriod"
      />
      <section class="card">
        <div class="card-head">
          <div>
            <h2 class="card-title">Schnellstart</h2>
            <p class="card-sub">Neuen TikTok-Stream direkt starten.</p>
          </div>
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            aria-hidden="true"
            class="card-icon"
          >
            <path
              d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linejoin="round"
            />
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
            <input
              id="quick-name"
              v-model="quick.name"
              type="text"
              placeholder="Anzeigename"
              autocomplete="off"
            />
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
            <span class="mono muted"
              >{{ activePlaylist.index + 1 }}/{{ activePlaylist.total }}</span
            >
          </div>
        </div>
        <div v-else class="empty compact">
          <p>Noch keine Playlists vorhanden.</p>
          <RouterLink to="/playlists" class="btn btn-ghost btn-sm">Playlists ansehen</RouterLink>
        </div>
      </section>

    <section class="card span-3">
      <div class="card-head">
        <div>
          <h2 class="card-title">Streamer</h2>
          <p class="card-sub">Online-Status und schneller Wechsel.</p>
        </div>
        <RouterLink to="/streamers" class="btn btn-ghost btn-sm">Verwalten</RouterLink>
      </div>

      <div v-if="store.streamers.length === 0" class="empty">
        <p>Noch keine Streamer angelegt.</p>
        <RouterLink to="/streamers" class="btn btn-primary btn-sm"
          >Ersten Streamer anlegen</RouterLink
        >
      </div>

      <ul v-else class="streamer-list">
        <li v-for="streamer in streamers" :key="streamer.id" class="streamer-row">
          <span class="online-indicator" :class="onlineClass(streamer)">
            <span class="dot" aria-hidden="true"></span>
            {{ onlineLabel(streamer) }}
          </span>
          <div class="streamer-identity">
            <strong>{{ streamer.name }}</strong>
            <span class="streamer-meta"
              >@{{ streamer.tiktok.replace(/^@/, '') }} · {{ streamer.id }}</span
            >
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
  </div>
</template>
