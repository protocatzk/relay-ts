<script setup lang="ts">
/**
 * Cockpit dashboard (#88).
 *
 * Layout: one sticky status line, a regie action row, then three columns
 * (preview · queue · widgets) and the vitals strip. Everything the operator
 * needs during a show is reachable without changing pages.
 */
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, errorMessage } from '@/src/api/client';
import type {
  ChatAnalyticsSnapshot,
  EarningsPeriod,
  Streamer,
  TitlePreview,
} from '@/src/api/types';
import CockpitActions from '@/src/components/CockpitActions.vue';
import PlaybackTransport from '@/src/components/cockpit/PlaybackTransport.vue';
import LivePreview from '@/src/components/LivePreview.vue';
import ModuleVital from '@/src/components/ModuleVital.vue';
import RegieQueue from '@/src/components/RegieQueue.vue';
import StatusBadge from '@/src/components/StatusBadge.vue';
import AppBadge from '@/src/components/ui/AppBadge.vue';
import AppButton from '@/src/components/ui/AppButton.vue';

const CockpitDiscoveryCard = defineAsyncComponent(
  () => import('@/src/components/cockpit/CockpitDiscoveryCard.vue'),
);
const EarningsPanel = defineAsyncComponent(
  () => import('@/src/components/EarningsPanel.vue'),
);
import { useDiscoveryFeed } from '@/src/composables/useDiscoveryFeed';
import { useDiscoveryPanel } from '@/src/composables/useDiscoveryPanel';
import { useMediaQuery } from '@/src/composables/useMediaQuery';
import { runOptimistic } from '@/src/composables/useOptimistic';
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
  applyQueue,
} = useStore();
const { series } = useTelemetry();
const { open: discoveryOpen, openDiscoveryPanel } = useDiscoveryPanel();
const discoveryFeed = useDiscoveryFeed();
const { pushToast } = useToast();

const col3Tab = ref<'streamers' | 'discovery'>('streamers');
const streamerFilter = ref<'live' | 'all'>('live');
const streamerSearch = ref('');
const mobileTab = ref<'queue' | 'live' | 'discovery' | 'monitor' | 'stats'>('queue');
const isMobile = useMediaQuery('(max-width: 720px)');

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
const liveStreamersCount = computed(() => streamers.value.filter((s) => s.status.online === true).length);
const filteredStreamers = computed(() => {
  const q = streamerSearch.value.trim().toLowerCase();
  const base =
    streamerFilter.value === 'live' && liveStreamersCount.value > 0
      ? streamers.value.filter((s) => s.status.online === true || s.status.active)
      : streamers.value;
  if (!q) return base;
  return base.filter(
    (s) => s.name.toLowerCase().includes(q) || s.tiktok.toLowerCase().includes(q),
  );
});
const soundboardPads = computed(() =>
  (store.soundboard?.sounds ?? []).filter((s) => s.kind === 'sfx').slice(0, 4),
);
const activeSoundboardIds = computed(() => new Set((store.soundboard?.playing ?? []).map((p) => p.id)));

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
  busy.value = `start:${streamer.id}`;
  try {
    await runOptimistic({
      patch: {
        state: 'starting',
        active_streamer_id: streamer.id,
        active_streamer_name: streamer.name,
      },
      mutation: () => api.streamers.start(streamer.id),
      successMessage: `${streamer.name} wird gestartet.`,
    });
    await refreshStreamers();
  } finally {
    busy.value = null;
  }
}

async function stopStreamer(streamer: Streamer): Promise<void> {
  busy.value = `stop:${streamer.id}`;
  try {
    await runOptimistic({
      patch: {
        state: 'stopping',
        active_streamer_id: null,
        active_streamer_name: null,
      },
      mutation: () => api.streamers.stop(streamer.id),
      successMessage: `${streamer.name} wird gestoppt.`,
    });
    await refreshStreamers();
  } finally {
    busy.value = null;
  }
}

async function switchStreamer(streamer: Streamer): Promise<void> {
  busy.value = `switch:${streamer.id}`;
  try {
    await runOptimistic({
      patch: {
        state: 'starting',
        active_streamer_id: streamer.id,
        active_streamer_name: streamer.name,
      },
      mutation: () => api.streamers.switchTo(streamer.id),
      successMessage: `${streamer.name} wird gestartet.`,
    });
    await refreshStreamers();
  } finally {
    busy.value = null;
  }
}

/** Appends a streamer to the regie queue (#94). */
async function queueStreamer(streamer: Streamer): Promise<void> {
  busy.value = `queue:${streamer.id}`;
  try {
    const result = await api.playback.enqueue(streamer.id, 'end');
    applyQueue(result.queue);
    pushToast(`„${streamer.name}“ steht jetzt in der Regie-Queue.`, 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    busy.value = null;
  }
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
  const el = document.querySelector<HTMLElement>('.cockpit-queue');
  el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  el?.querySelector<HTMLElement>('.regie-add-details > summary')?.focus?.();
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
  <div class="page page-dashboard cockpit cockpit-v2" :class="{ 'is-discovery-open': discoveryOpen }">
    <h1 class="sr-only">Dashboard</h1>
    <!-- Kompakte 1-Zeilen Command-Bar (Status + Transport + Aktionen) -->
    <header class="cockpit-command-bar">
      <div class="cockpit-status-compact">
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
              <span class="mono">{{ formatUptime(status?.uptime_seconds) }}</span>
              <template v-if="status?.chat.viewers != null"> · <span class="mono">{{ formatNumber(status.chat.viewers) }} Z.</span></template>
              · <span class="mono">{{ formatBitrate(status?.sink.bitrate_kbps) }}</span>
              <template v-if="autoRefreshLabel !== '–'"> · Refresh <span class="mono">{{ autoRefreshLabel }}</span></template>
              <RouterLink v-if="state === 'error'" to="/logs" class="hero-log-link">Logs</RouterLink>
            </p>
          </div>
        </div>
        <div class="cockpit-top-tools">
          <CockpitActions @queue-now="focusQueue" />
          <AppButton to="/deck" variant="ghost" size="sm" title="Stream-Deck öffnen">Stream-Deck</AppButton>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            title="Stream-Deck in neuem Fenster öffnen"
            @click="openStreamDeckWindow(router)"
          >
            ↗
          </button>
        </div>
      </div>

      <PlaybackTransport />
    </header>

    <div v-if="status?.watchdog.last_error" class="alert alert-warn" role="status">
      <strong>Watchdog:</strong> {{ status.watchdog.last_error }}
      <RouterLink to="/logs" class="btn btn-ghost btn-sm">Logs</RouterLink>
    </div>

    <!-- Mobile Segment-Navigation (< 720px) -->
    <nav class="cockpit-mob-tabs" aria-label="Cockpit-Bereiche">
      <button type="button" :class="{ active: mobileTab === 'queue' }" @click="mobileTab = 'queue'">Queue</button>
      <button type="button" :class="{ active: mobileTab === 'live' }" @click="mobileTab = 'live'">Live ({{ liveStreamersCount }})</button>
      <button type="button" :class="{ active: mobileTab === 'discovery' }" @click="mobileTab = 'discovery'">Disc.</button>
      <button type="button" :class="{ active: mobileTab === 'monitor' }" @click="mobileTab = 'monitor'">Monitor</button>
      <button type="button" :class="{ active: mobileTab === 'stats' }" @click="mobileTab = 'stats'">Stats</button>
    </nav>

    <!-- 3-Spalten Regiepult -->
    <div class="cockpit-grid cockpit-grid-3col">
      <!-- SPALTE 1: Monitor, Vitals & Wartung -->
      <section
        v-if="!isMobile || mobileTab === 'monitor'"
        class="cockpit-col cockpit-col-preview mob-pane"
        :class="{ 'is-mob-active': mobileTab === 'monitor' }"
        aria-label="Monitor und Technik"
      >
        <LivePreview :state="state" />
        <div class="cockpit-preview-note">
          <span class="label">Chat-Overlay</span>
          <AppBadge :tone="status?.chat.canvas_active ? 'success' : 'neutral'" size="xs">
            {{ status?.chat.canvas_active ? 'Canvas live' : 'Canvas inaktiv' }}
          </AppBadge>
          <span class="mono">{{ status?.chat.messages ?? 0 }} Nachr.</span>
          <AppButton to="/overlays" variant="ghost" size="xs">Studio</AppButton>
        </div>

        <section class="cockpit-vitals-compact" aria-label="System-Vitals">
          <ModuleVital
            label="Quelle"
            :value="formatBitrate(status?.source.bitrate_kbps)"
            :sub="`${status?.source.connected ? 'Verbunden' : 'Offline'} · ${formatNumber(status?.source.reconnects)} Rec.`"
            module="source"
            :series="series('source_kbps')"
            :tone="sourceTone"
          />
          <ModuleVital
            label="Relay"
            :value="formatSeconds(status?.relay.buffer_seconds)"
            :sub="`Delay ${formatNumber(status?.relay.delay_seconds)}s · ${formatNumber(status?.relay.ingest_clients)} Ingest`"
            module="relay"
            :series="series('relay_buffer_s')"
            :tone="status?.relay.catching_up ? 'warning' : undefined"
          />
          <ModuleVital
            label="Sink"
            :value="formatBitrate(status?.sink.bitrate_kbps)"
            :sub="`${formatFps(status?.sink.fps)} · ${formatNumber(status?.sink.dropped_frames)} Drop`"
            module="sink"
            :series="series('sink_kbps')"
            :tone="sinkTone"
          />
          <ModuleVital
            label="Watchdog"
            :value="formatNumber(status?.watchdog.stall_count)"
            :sub="status?.watchdog.last_error ?? `Timeout ${formatNumber(status?.watchdog.stall_timeout)}s`"
            module="watchdog"
            :series="series('watchdog_stalls')"
            :tone="watchdogTone"
          />
        </section>

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
                <input id="quick-tiktok" v-model="quick.tiktok" type="text" placeholder="@username" autocomplete="off" />
              </div>
              <div class="field">
                <label for="quick-key">YouTube-Stream-Key <span class="req">*</span></label>
                <input id="quick-key" v-model="quick.youtube_key" type="password" placeholder="Stream-Key" autocomplete="new-password" />
              </div>
              <div class="field">
                <label for="quick-name">Name <span class="muted">(optional)</span></label>
                <input id="quick-name" v-model="quick.name" type="text" placeholder="Anzeigename" autocomplete="off" />
              </div>
              <button type="submit" class="btn btn-primary" :disabled="busy === 'quickstart'">
                Jetzt starten
              </button>
            </form>
            <div v-if="store.playlists.length > 0" class="stack compact">
              <div class="field">
                <label for="quick-playlist">Playlist</label>
                <select id="quick-playlist" v-model="selectedPlaylist">
                  <option v-for="playlist in store.playlists" :key="playlist.id" :value="playlist.id">
                    {{ playlist.name }} ({{ playlist.channels.length }})
                  </option>
                </select>
              </div>
              <button type="button" class="btn btn-secondary" :disabled="busy === 'playlist' || !selectedPlaylist" @click="playSelectedPlaylist">
                Playlist abspielen
              </button>
            </div>
          </details>
        </details>
      </section>

      <!-- SPALTE 2: Regie-Queue & Soundboard -->
      <section
        v-if="!isMobile || mobileTab === 'queue'"
        class="cockpit-col cockpit-col-center mob-pane"
        :class="{ 'is-mob-active': mobileTab === 'queue' }"
        aria-label="Regie-Queue und Soundboard"
      >
        <RegieQueue class="cockpit-queue" />

        <section v-if="soundboardPads.length > 0" class="card cockpit-soundboard" aria-label="Soundboard">
          <div class="card-head">
            <span class="card-title">Soundboard</span>
            <div class="cockpit-sb-tools">
              <RouterLink to="/soundboard" class="btn btn-ghost btn-xs">Öffnen</RouterLink>
              <button type="button" class="btn btn-danger btn-xs" @click="api.soundboard.stop('all')">Stopp</button>
            </div>
          </div>
          <div class="cockpit-sb-grid">
            <button
              v-for="pad in soundboardPads"
              :key="pad.id"
              type="button"
              class="btn btn-ghost btn-sm cockpit-sb-pad"
              :class="{ 'is-playing': activeSoundboardIds.has(pad.id) }"
              @click="api.soundboard.play(pad.id)"
            >
              {{ pad.name }}
            </button>
          </div>
        </section>
      </section>

      <!-- SPALTE 3: Streamer-Schaltbrett, Discovery & Einnahmen -->
      <section
        v-if="!isMobile || mobileTab === 'live' || mobileTab === 'discovery' || mobileTab === 'stats'"
        class="cockpit-col cockpit-col-right mob-pane"
        :class="{ 'is-mob-active': mobileTab === 'live' || mobileTab === 'discovery' || mobileTab === 'stats' }"
        aria-label="Streamer, Discovery und Einnahmen"
      >
        <section
          v-if="!isMobile || mobileTab === 'live' || mobileTab === 'discovery'"
          class="card cockpit-streamers mob-subpane"
          :class="{ 'is-mob-active': mobileTab === 'live' || mobileTab === 'discovery' }"
          aria-labelledby="cockpit-streamer-title"
        >
          <div class="cockpit-col3-head">
            <div class="cockpit-seg-switch" role="tablist">
              <button
                type="button"
                role="tab"
                :aria-selected="col3Tab === 'streamers' && mobileTab !== 'discovery'"
                :class="{ active: col3Tab === 'streamers' && mobileTab !== 'discovery' }"
                @click="col3Tab = 'streamers'; if (mobileTab === 'discovery') mobileTab = 'live'"
              >
                Streamer ({{ liveStreamersCount }})
              </button>
              <button
                type="button"
                role="tab"
                :aria-selected="col3Tab === 'discovery' || mobileTab === 'discovery'"
                :class="{ active: col3Tab === 'discovery' || mobileTab === 'discovery' }"
                @click="col3Tab = 'discovery'"
              >
                Discovery ({{ discoveryFeed.totalLive.value }})
              </button>
            </div>

            <div v-if="col3Tab === 'streamers' && mobileTab !== 'discovery'" class="cockpit-filter-chips">
              <button
                type="button"
                class="chip-btn"
                :class="{ active: streamerFilter === 'live' }"
                @click="streamerFilter = 'live'"
              >
                Live
              </button>
              <button
                type="button"
                class="chip-btn"
                :class="{ active: streamerFilter === 'all' }"
                @click="streamerFilter = 'all'"
              >
                Alle ({{ streamers.length }})
              </button>
            </div>
            <button
              v-else
              type="button"
              class="btn btn-ghost btn-xs"
              @click="openDiscoveryPanel()"
            >
              Zapper (D) ↗
            </button>
          </div>

          <!-- Streamer-Liste -->
          <div v-if="col3Tab === 'streamers' && mobileTab !== 'discovery'" class="cockpit-streamer-pane">
            <div class="cockpit-streamer-search">
              <input
                v-model="streamerSearch"
                type="search"
                placeholder="Streamer filtern…"
                aria-label="Streamer filtern"
              />
              <RouterLink to="/streamers" class="btn btn-ghost btn-xs">Verwalten</RouterLink>
            </div>

            <div v-if="store.streamers.length === 0" class="empty">
              <p>Noch keine Streamer angelegt.</p>
              <RouterLink to="/streamers" class="btn btn-primary btn-sm">Ersten Streamer anlegen</RouterLink>
            </div>

            <ul v-else class="streamer-list cockpit-streamer-scroll">
              <li
                v-for="streamer in filteredStreamers"
                :key="streamer.id"
                class="streamer-row"
                :class="{ 'is-offline-row': streamer.status.online !== true && !streamer.status.active }"
              >
                <span class="online-indicator" :class="streamer.status.online === true ? 'is-online' : streamer.status.online === false ? 'is-offline' : 'is-unknown'">
                  <span class="dot" aria-hidden="true"></span>
                </span>
                <div class="streamer-identity">
                  <strong>{{ streamer.name }}</strong>
                  <span class="streamer-meta">@{{ streamer.tiktok.replace(/^@/, '') }}</span>
                </div>
                <span v-if="streamer.status.active" class="badge tone-success">Aktiv</span>
                <div class="streamer-actions">
                  <button
                    v-if="streamer.status.active"
                    type="button"
                    class="btn btn-ghost btn-xs"
                    :disabled="busy !== null"
                    @click="stopStreamer(streamer)"
                  >
                    Stopp
                  </button>
                  <button
                    v-else-if="status?.active_streamer_id"
                    type="button"
                    class="btn btn-primary btn-xs"
                    :disabled="busy !== null || !streamer.enabled"
                    @click="switchStreamer(streamer)"
                  >
                    Live
                  </button>
                  <button
                    v-else
                    type="button"
                    class="btn btn-primary btn-xs"
                    :disabled="busy !== null || !streamer.enabled"
                    @click="startStreamer(streamer)"
                  >
                    Start
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    :disabled="busy !== null"
                    title="Ans Ende der Regie-Queue hängen"
                    @click="queueStreamer(streamer)"
                  >
                    + Q
                  </button>
                </div>
              </li>
            </ul>

            <button type="button" class="cockpit-disc-teaser" @click="col3Tab = 'discovery'">
              <span><strong>Discovery:</strong> {{ discoveryFeed.totalLive.value }} live</span>
              <span class="muted">Vorhören →</span>
            </button>
          </div>

          <!-- Discovery-Ansicht mit Inline-Player -->
          <CockpitDiscoveryCard v-else />
        </section>

        <div
          v-if="!isMobile || mobileTab === 'stats'"
          class="cockpit-earnings-wrap mob-subpane"
          :class="{ 'is-mob-active': mobileTab === 'stats' }"
        >
          <EarningsPanel
            v-if="store.earnings"
            :earnings="store.earnings"
            :refreshing="refreshingEarnings"
            @refresh="refreshEarnings"
            @period="changeEarningsPeriod"
          />
        </div>
      </section>
    </div>

    <!-- Mobile Sticky Mini-Transport -->
    <div class="cockpit-mob-transport" aria-label="Schnellsteuerung">
      <div class="cockpit-mob-transport-info">
        <strong>{{ targetLabel }}</strong>
        <span class="muted">{{ status?.active_streamer_name ? 'Live' : 'Bereit' }}</span>
      </div>
      <div class="cockpit-mob-transport-btns">
        <button type="button" class="btn btn-ghost btn-sm" @click="api.playback.previous()">⏮</button>
        <button type="button" class="btn btn-primary btn-sm" @click="isPaused ? api.playback.resume() : api.playback.pause()">
          {{ isPaused ? '▶' : '⏸' }}
        </button>
        <button type="button" class="btn btn-ghost btn-sm" @click="api.playback.next()">⏭</button>
        <button type="button" class="btn btn-danger btn-sm" @click="api.playback.stop()">⏹</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cockpit-v2 { display: flex; flex-direction: column; gap: 10px; }
.cockpit-command-bar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-card, 12px);
  background: var(--glass-bg-strong, var(--surface-2));
}
.cockpit-status-compact {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.cockpit-top-tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cockpit-grid-3col {
  display: grid;
  grid-template-columns: minmax(250px, 28%) minmax(0, 42%) minmax(280px, 30%);
  gap: 10px;
  align-items: stretch;
}
.cockpit-col { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.cockpit-vitals-compact { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.cockpit-queue { flex: 1; min-height: 280px; max-height: calc(100vh - 280px); }
.cockpit-soundboard .card-head { display: flex; justify-content: space-between; align-items: center; }
.cockpit-sb-tools { display: flex; gap: 4px; }
.cockpit-sb-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.cockpit-sb-pad { justify-content: flex-start; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cockpit-sb-pad.is-playing { border-color: var(--accent, #22d3ee); background: rgba(34, 211, 238, 0.14); }
.cockpit-streamers { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 320px; max-height: calc(100vh - 360px); }
.cockpit-col3-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap; }
.cockpit-seg-switch { display: flex; background: var(--surface-1, rgba(0,0,0,0.25)); padding: 2px; border-radius: 8px; border: 1px solid var(--border); }
.cockpit-seg-switch button { border: 0; background: transparent; color: var(--text-muted); font-size: 12px; padding: 4px 8px; border-radius: 6px; cursor: pointer; }
.cockpit-seg-switch button.active { background: var(--accent, #22d3ee); color: #061018; font-weight: 600; }
.cockpit-filter-chips { display: flex; gap: 4px; }
.chip-btn { border: 1px solid var(--border); background: transparent; color: var(--text-muted); font-size: 11px; padding: 2px 8px; border-radius: 999px; cursor: pointer; }
.chip-btn.active { background: var(--surface-3); color: var(--text-strong); border-color: var(--accent, #22d3ee); }
.cockpit-streamer-pane { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; }
.cockpit-streamer-search { display: flex; gap: 6px; align-items: center; }
.cockpit-streamer-search input { flex: 1; min-width: 0; }
.cockpit-streamer-scroll { flex: 1; overflow-y: auto; min-height: 0; padding-right: 2px; }
.is-offline-row { opacity: 0.6; }
.cockpit-disc-teaser {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2, rgba(255,255,255,0.03));
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}
.cockpit-disc-teaser:hover { border-color: var(--accent, #22d3ee); }

.cockpit-mob-tabs, .cockpit-mob-transport { display: none; }

@media (max-width: 1199px) {
  .cockpit-grid-3col { grid-template-columns: minmax(240px, 1fr) minmax(0, 1.3fr); }
  .cockpit-col-right { grid-column: 1 / -1; }
}

@media (max-width: 720px) {
  .cockpit-mob-tabs {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 2px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 3px;
  }
  .cockpit-mob-tabs button {
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font-size: 11.5px;
    padding: 6px 2px;
    border-radius: 7px;
    cursor: pointer;
  }
  .cockpit-mob-tabs button.active {
    background: var(--accent, #22d3ee);
    color: #061018;
    font-weight: 600;
  }
  .cockpit-grid-3col { grid-template-columns: 1fr; }
  .mob-pane { display: none; }
  .mob-pane.is-mob-active { display: flex; }
  .mob-subpane { display: none; }
  .mob-subpane.is-mob-active { display: flex; }
  .cockpit-queue, .cockpit-streamers { max-height: none; }
  .cockpit-mob-transport {
    position: sticky;
    bottom: 62px;
    z-index: 25;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface, var(--surface-2));
  }
  .cockpit-mob-transport-info { min-width: 0; display: flex; flex-direction: column; font-size: 12px; }
  .cockpit-mob-transport-info strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cockpit-mob-transport-btns { display: flex; gap: 4px; flex-shrink: 0; }
}
</style>
