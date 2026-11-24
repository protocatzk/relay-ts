<script setup lang="ts">
/**
 * Cockpit dashboard (#88).
 *
 * Layout: one sticky status line, a regie action row, then three columns
 * (preview · queue · widgets) and the vitals strip. Everything the operator
 * needs during a show is reachable without changing pages.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, errorMessage } from '@/src/api/client';
import type {
  ChatAnalyticsSnapshot,
  EarningsPeriod,
  Streamer,
  TitlePreview,
} from '@/src/api/types';
import CockpitActions from '@/src/components/CockpitActions.vue';
import CockpitWidgets from '@/src/components/CockpitWidgets.vue';
import EarningsPanel from '@/src/components/EarningsPanel.vue';
import LivePreview from '@/src/components/LivePreview.vue';
import ModuleVital from '@/src/components/ModuleVital.vue';
import RegieQueue from '@/src/components/RegieQueue.vue';
import StatusBadge from '@/src/components/StatusBadge.vue';
import AppBadge from '@/src/components/ui/AppBadge.vue';
import AppButton from '@/src/components/ui/AppButton.vue';
import { useStore } from '@/src/composables/useStore';
import { useTelemetry } from '@/src/composables/useTelemetry';
import { useToast } from '@/src/composables/useToast';
import { openStreamDeckWindow } from '@/src/utils/stream-deck';
import {
  formatBitrate,
  formatFps,
  formatNumber,
  formatSeconds,
  formatUptime,
} from '@/src/utils/format';
import { sortStreamersByLive } from '@/src/utils/sort-streamers';

const router = useRouter();
const {
  store,
  refreshStatus,
  refreshStreamers,
  refreshPlaylists,
  refreshEarnings: syncEarnings,
} = useStore();
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
const activeStreamer = computed<Streamer | null>(() => {
  const id = status.value?.active_streamer_id;
  if (!id) return null;
  return store.streamers.find((streamer) => streamer.id === id) ?? null;
});
const avatarInitials = computed(() => {
  const name = status.value?.active_streamer_name ?? '';
  const parts = name.replace(/^@/, '').split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '–';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
});

const sourceTone = computed(() => {
  if (state.value === 'error') return 'danger';
  if (state.value === 'reconnecting' || !status.value?.source.connected) return 'warning';
  if (status.value?.source.connected) return 'success';
  return undefined;
});
const sinkTone = computed(() => {
  if (state.value === 'error') return 'danger';
  if (state.value === 'reconnecting') return 'warning';
  if (
    status.value?.sink.last_error ||
    (status.value?.sink.dts_errors ?? 0) > 0 ||
    status.value?.sink.silence_active
  ) {
    return 'warning';
  }
  if (state.value === 'live' && status.value?.sink.running) return 'success';
  return undefined;
});
const watchdogTone = computed(() => (status.value?.watchdog.last_error ? 'danger' : undefined));

const targetLabel = computed(() => {
  if (status.value?.active_streamer_name) return status.value.active_streamer_name;
  if (manualScreen.value === 'startup') return 'Startbildschirm';
  if (manualScreen.value === 'pause') return 'Pausenscreen';
  return 'Kein aktiver Stream';
});

const targetSub = computed(() => {
  if (status.value?.active_playlist) {
    return `Playlist „${status.value.active_playlist.name}“ · Kanal ${status.value.active_playlist.index + 1} von ${status.value.active_playlist.total}`;
  }
  if (status.value?.state === 'paused') {
    if (manualScreen.value === 'startup') return 'Der Startbildschirm wird gesendet.';
    return status.value.active_streamer_id
      ? 'Der Stream ist pausiert. Der Pausenscreen wird gesendet.'
      : 'Der Pausenscreen wird gesendet.';
  }
  if (status.value?.state === 'error') {
    return status.value.watchdog.last_error ?? 'Ein Fehler ist aufgetreten.';
  }
  if (status.value) {
    return status.value.source.online === false ? 'Quelle offline.' : 'TikTok → DelayBuffer → YouTube';
  }
  return 'Keine Statusdaten empfangen.';
});

const autoRefreshLabel = computed(() => {
  const auto = status.value?.auto_refresh;
  if (auto?.enabled && auto.next_refresh_in_seconds != null) {
    return formatUptime(auto.next_refresh_in_seconds);
  }
  return '–';
});

const streamers = computed(() => sortStreamersByLive(store.streamers));

/* ---------------------------------------------------------------- preview */

const previewUrl = ref(api.overlays.previewUrl(false));
const chatAnalytics = ref<ChatAnalyticsSnapshot | null>(null);
let previewTimer: number | null = null;
let lastPreviewEtag: string | null = null;
let previewObjectUrl: string | null = null;

async function refreshPreview(): Promise<void> {
  void api.chat
    .analytics()
    .then((data) => {
      chatAnalytics.value = data;
    })
    .catch(() => undefined);

  try {
    const res = await fetch(api.overlays.previewUrl(false), {
      headers: lastPreviewEtag ? { 'If-None-Match': lastPreviewEtag } : {},
    });
    if (res.status === 200) {
      const etag = res.headers.get('etag');
      if (etag) lastPreviewEtag = etag;
      const blob = await res.blob();
      const nextUrl = URL.createObjectURL(blob);
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = nextUrl;
      previewUrl.value = nextUrl;
    }
  } catch {
    // Keep the current preview when the fetch fails.
  }
}

function onVisibilityChange(): void {
  if (document.hidden) {
    if (previewTimer !== null) {
      window.clearInterval(previewTimer);
      previewTimer = null;
    }
  } else {
    void refreshPreview();
    if (previewTimer === null) {
      previewTimer = window.setInterval(() => void refreshPreview(), 5000);
    }
  }
}

/* ------------------------------------------------------------ maintenance */

const chatTest = reactive({ username: 'Testuser', text: '' });
const sendingChat = ref(false);
const titlePreview = ref<TitlePreview | null>(null);

async function sendChatTest(): Promise<void> {
  if (!chatTest.text.trim()) return;
  sendingChat.value = true;
  try {
    await api.chat.test(chatTest.username.trim() || 'Testuser', chatTest.text.trim());
    chatTest.text = '';
    void refreshPreview();
    pushToast('Testnachricht an das Overlay gesendet.', 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    sendingChat.value = false;
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

/* ---------------------------------------------------------------- actions */

async function run(
  key: string,
  action: () => Promise<unknown>,
  successMessage?: string,
): Promise<unknown> {
  busy.value = key;
  try {
    const result = await action();
    await Promise.allSettled([refreshStatus(), refreshStreamers()]);
    if (successMessage) pushToast(successMessage, 'success');
    return result;
  } catch (error) {
    pushToast(errorMessage(error), 'error');
    await Promise.allSettled([refreshStatus(), refreshStreamers()]);
    return undefined;
  } finally {
    busy.value = null;
  }
}

async function restartSink(): Promise<void> {
  await run('sink', () => api.system.restartSink(), 'YouTube-Sink wird neu gestartet.');
}

async function reloadYaml(): Promise<void> {
  await run('reload', () => api.system.reload(), 'Konfiguration neu geladen.');
}

async function refreshEarnings(): Promise<void> {
  refreshingEarnings.value = true;
  try {
    await api.earnings.refresh();
    await syncEarnings();
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
    await syncEarnings();
    pushToast('Einnahmen-Zeitraum geändert.', 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    refreshingEarnings.value = false;
  }
}

async function startStreamer(streamer: Streamer): Promise<void> {
  await run(`start:${streamer.id}`, () => api.streamers.start(streamer.id), `${streamer.name} wird gestartet.`);
}

async function stopStreamer(streamer: Streamer): Promise<void> {
  await run(`stop:${streamer.id}`, () => api.streamers.stop(streamer.id), `${streamer.name} wird gestoppt.`);
}

async function switchStreamer(streamer: Streamer): Promise<void> {
  await run(
    `switch:${streamer.id}`,
    () => api.streamers.switchTo(streamer.id),
    `${streamer.name} wird gestartet.`,
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
    pushToast('Bitte TikTok-Handle und YouTube-Stream-Key angeben.', 'error');
    return;
  }
  const payload = {
    tiktok: quick.tiktok.trim(),
    youtube_key: quick.youtube_key.trim(),
    ...(quick.name.trim() ? { name: quick.name.trim() } : {}),
  };
  const displayName = quick.name.trim() || quick.tiktok.trim();
  await run('quickstart', async () => {
    const result = await api.quickstart(payload);
    quick.tiktok = '';
    quick.youtube_key = '';
    quick.name = '';
    return result;
  }, `${displayName} wird gestartet.`);
}

function focusQueue(): void {
  const el = document.querySelector<HTMLElement>('.cockpit-col-queue');
  el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  el?.querySelector<HTMLElement>('.regie-add button')?.focus();
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
  document.addEventListener('visibilitychange', onVisibilityChange);
  if (!document.hidden) {
    void refreshPreview();
    previewTimer = window.setInterval(() => void refreshPreview(), 5000);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange);
  if (previewTimer !== null) window.clearInterval(previewTimer);
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
});
</script>

<template>
  <div class="page page-dashboard cockpit">
    <div class="page-head cockpit-head">
      <h1>Dashboard</h1>
      <div class="page-actions">
        <AppButton to="/deck" variant="ghost" size="sm" title="Stream-Deck im selben Tab öffnen">
          Stream-Deck
        </AppButton>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          title="Stream-Deck in neuem maximiertem Fenster öffnen"
          @click="openStreamDeckWindow(router)"
        >
          Neues Fenster
        </button>
      </div>
    </div>

    <header class="cockpit-status">
      <div class="cockpit-identity">
        <span class="cockpit-avatar" aria-hidden="true">{{ avatarInitials }}</span>
        <div class="cockpit-identity-text">
          <div class="cockpit-name-row">
            <strong>{{ targetLabel }}</strong>
            <StatusBadge :state="state" />
            <AppBadge v-if="status?.active_scene_name" tone="info" size="xs">
              Szene: {{ status.active_scene_name }}
            </AppBadge>
          </div>
          <p class="cockpit-sub">
            {{ targetSub }}
            <RouterLink v-if="state === 'error'" to="/logs" class="hero-log-link">Logs ansehen</RouterLink>
          </p>
        </div>
      </div>

      <dl class="cockpit-metrics">        <div>
          <dt>Ziel</dt>
          <dd>{{ status?.active_streamer_name ?? '–' }}</dd>
        </div>
        <div>
          <dt>Uptime</dt>
          <dd class="mono">{{ formatUptime(status?.uptime_seconds) }}</dd>
        </div>
        <div>
          <dt>Zuschauer</dt>
          <dd class="mono">
            {{ status?.chat.viewers != null ? formatNumber(status.chat.viewers) : '–' }}
          </dd>
        </div>
        <div>
          <dt>Bitrate</dt>
          <dd class="mono">{{ formatBitrate(status?.sink.bitrate_kbps) }}</dd>
        </div>
        <div>
          <dt>Auto-Refresh</dt>
          <dd class="mono">{{ autoRefreshLabel }}</dd>
        </div>
      </dl>

    </header>

    <CockpitActions @queue-now="focusQueue" />

    <div v-if="status?.watchdog.last_error" class="alert alert-warn" role="status">
      <strong>Watchdog:</strong> {{ status.watchdog.last_error }}
      <RouterLink to="/logs" class="btn btn-ghost btn-sm">Logs</RouterLink>
    </div>

    <div class="cockpit-grid">
      <section class="cockpit-col cockpit-col-preview" aria-label="Vorschau">
        <LivePreview :state="state" />
        <div class="cockpit-preview-note">
          <span class="label">Chat-Overlay</span>
          <AppBadge :tone="status?.chat.canvas_active ? 'success' : 'neutral'" size="xs">
            {{ status?.chat.canvas_active ? 'Canvas live' : 'Canvas inaktiv' }}
          </AppBadge>
          <span class="mono">{{ status?.chat.messages ?? 0 }} Nachr.</span>
          <AppButton to="/overlays" variant="ghost" size="xs">Overlay-Studio</AppButton>
        </div>
      </section>

      <section class="cockpit-col cockpit-col-queue" aria-label="Regie-Queue">
        <RegieQueue />
      </section>

      <aside class="cockpit-col cockpit-col-widgets" aria-label="Kennzahlen">
        <CockpitWidgets
          :status="status"
          :earnings="store.earnings"
          :analytics="chatAnalytics"
        />

        <details class="card cockpit-maintenance">
          <summary class="cockpit-maintenance-summary">
            <span class="card-title">Wartung &amp; Chat</span>
            <span
              class="badge badge-xs"
              :class="status?.chat.api_configured ? 'tone-success' : 'tone-muted'"
            >
              {{ status?.chat.api_configured ? 'Chat-API OK' : 'Chat-API fehlt' }}
            </span>
          </summary>

          <div class="cockpit-preview-stage">
            <img :src="previewUrl" alt="Chat-Overlay-Vorschau" />
          </div>

          <dl class="settings-summary">
            <div>
              <dt>Chat-Engine</dt>
              <dd>{{ status?.chat.engine ?? '–' }}</dd>
            </div>
            <div>
              <dt>Nachrichten</dt>
              <dd class="mono">{{ status?.chat.messages ?? 0 }}</dd>
            </div>
            <template v-if="chatAnalytics">
              <div>
                <dt>Rate (5 min)</dt>
                <dd class="mono">{{ chatAnalytics.messages_per_minute }} / min</dd>
              </div>
              <div>
                <dt>Peak (30 min)</dt>
                <dd class="mono">{{ chatAnalytics.peak_per_minute }} / min</dd>
              </div>
            </template>
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
              <button type="button" class="btn btn-ghost btn-sm" @click="copyTitle">Kopieren</button>
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
            <button type="button" class="btn btn-ghost btn-sm" :disabled="busy !== null" @click="reloadYaml">
              YAML neu laden
            </button>
          </div>

          <details class="cockpit-details">
            <summary>Schnellstart &amp; Playlist</summary>
            <form class="stack compact" @submit.prevent="submitQuickStart">
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

            <div v-if="store.playlists.length > 0" class="stack compact">
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
                Playlist abspielen
              </button>
              <div v-if="status?.active_playlist" class="info-row">
                <span class="badge tone-info">Aktiv</span>
                <span>{{ status.active_playlist.name }}</span>
                <span class="mono muted">
                  {{ status.active_playlist.index + 1 }}/{{ status.active_playlist.total }}
                </span>
              </div>
            </div>
            <div v-else class="empty compact">
              <p>Noch keine Playlists vorhanden.</p>
              <RouterLink to="/playlists" class="btn btn-ghost btn-sm">Playlists ansehen</RouterLink>
            </div>
          </details>
        </details>
      </aside>
    </div>

    <section class="cockpit-vitals" aria-label="System-Vitals">
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
        :sub="`Verzögerung ${formatNumber(status?.relay.delay_seconds)} s · ${formatNumber(status?.relay.ingest_clients)} Ingest${status?.relay.catching_up ? ` · Catch-Up ${(status.relay.pacing_multiplier ?? 1.01).toFixed(2)}×` : ''}`"
        module="relay"
        :series="series('relay_buffer_s')"
        :tone="status?.relay.catching_up ? 'warning' : undefined"
      />
      <ModuleVital
        label="Sink"
        :value="formatBitrate(status?.sink.bitrate_kbps)"
        :sub="`${formatFps(status?.sink.fps)} · ${formatNumber(status?.sink.dropped_frames)} Dropped · Ziel ${formatBitrate(status?.sink.target_bitrate_kbps)}${(status?.sink.dts_errors ?? 0) > 0 ? ` · ${formatNumber(status?.sink.dts_errors)} DTS-Fehler` : ''}${status?.sink.silence_active ? ' · Stille' : ''}`"
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

    <div class="cockpit-lists">
      <section class="card cockpit-streamers" aria-labelledby="cockpit-streamer-title">
        <div class="card-head">
          <div>
            <h2 id="cockpit-streamer-title" class="card-title">Streamer</h2>
          </div>
          <RouterLink to="/streamers" class="btn btn-ghost btn-sm">Verwalten</RouterLink>
        </div>

        <div v-if="store.streamers.length === 0" class="empty">
          <p>Noch keine Streamer angelegt.</p>
          <RouterLink to="/streamers" class="btn btn-primary btn-sm">Ersten Streamer anlegen</RouterLink>
        </div>

        <ul v-else class="streamer-list">
          <li v-for="streamer in streamers" :key="streamer.id" class="streamer-row">
            <span class="online-indicator" :class="streamer.status.online === true ? 'is-online' : streamer.status.online === false ? 'is-offline' : 'is-unknown'">
              <span class="dot" aria-hidden="true"></span>
              {{ streamer.status.online === true ? 'Online' : streamer.status.online === false ? 'Offline' : 'Unbekannt' }}
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

      <div class="cockpit-side">
        <EarningsPanel
          v-if="store.earnings"
          :earnings="store.earnings"
          :refreshing="refreshingEarnings"
          @refresh="refreshEarnings"
          @period="changeEarningsPeriod"
        />

      </div>
    </div>
  </div>
</template>
