<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { api } from '@/src/api/client';
import type { StreamState, YouTubeBroadcast } from '@/src/api/types';

type PlayerStatus = 'idle' | 'connecting' | 'playing' | 'error' | 'unsupported';

const props = defineProps<{ state: StreamState | null }>();

const video = ref<HTMLVideoElement | null>(null);
type Mpegts = typeof import('mpegts.js').default;
type Player = ReturnType<Mpegts['createPlayer']>;

let mpegts: Mpegts | null = null;
const player = shallowRef<Player | null>(null);
const status = ref<PlayerStatus>('idle');
const muted = ref(true);
const error = ref('');
const broadcasts = ref<YouTubeBroadcast[]>([]);

const liveBroadcast = computed<YouTubeBroadcast | null>(
  () =>
    broadcasts.value.find((broadcast) => broadcast.status === 'live') ??
    broadcasts.value.find((broadcast) => broadcast.stream_status === 'active') ??
    null,
);

const chatUrl = computed(() => {
  const broadcast = liveBroadcast.value;
  return broadcast
    ? `https://www.youtube.com/live_chat?v=${encodeURIComponent(broadcast.id)}`
    : '';
});

async function loadChat(): Promise<void> {
  try {
    const youtube = await api.youtube.status();
    broadcasts.value = youtube.connected ? (await api.youtube.broadcasts()).items : [];
  } catch {
    broadcasts.value = [];
  }
}

const canPlay = computed(() =>
  ['live', 'paused', 'starting'].includes(props.state ?? ''),
);
const isRunning = computed(() => status.value === 'connecting' || status.value === 'playing');

function destroyPlayer(): void {
  const current = player.value;
  player.value = null;
  if (!current) return;
  try {
    current.pause();
    current.unload();
    current.detachMediaElement();
    current.destroy();
  } catch {
    /* already destroyed */
  }
}

async function loadMpegts(): Promise<Mpegts> {
  if (!mpegts) {
    const module = await import('mpegts.js');
    mpegts = module.default;
  }
  return mpegts;
}

async function start(): Promise<void> {
  if (!canPlay.value || !video.value || isRunning.value) return;
  const lib = await loadMpegts();
  if (!lib.isSupported()) {
    status.value = 'unsupported';
    error.value = 'Dein Browser unterstützt keine MSE-Wiedergabe.';
    return;
  }
  destroyPlayer();
  error.value = '';
  status.value = 'connecting';
  const instance = lib.createPlayer(
    { type: 'mse', isLive: true, url: '/api/preview.ts' },
    {
      enableWorker: false,
      lazyLoad: true,
      liveBufferLatencyChasing: true,
      liveBufferLatencyMaxLatency: 4,
      liveBufferLatencyMinRemain: 0.5,
    },
  );
  player.value = instance;
  instance.on(lib.Events.ERROR, (_type, detail) => {
    if (player.value !== instance) return;
    status.value = 'error';
    error.value = `Vorschau nicht verfügbar (${detail}).`;
  });
  instance.on(lib.Events.MEDIA_INFO, () => {
    if (player.value !== instance) return;
    status.value = 'playing';
  });
  instance.attachMediaElement(video.value);
  instance.load();
  const playback = instance.play();
  if (playback && typeof playback.then === 'function') {
    void playback.catch(() => {
      status.value = 'error';
      error.value = 'Wiedergabe wurde vom Browser blockiert. Bitte erneut starten.';
    });
  }
}

function stop(): void {
  destroyPlayer();
  status.value = 'idle';
  error.value = '';
}

function toggleMute(): void {
  muted.value = !muted.value;
  if (video.value) video.value.muted = muted.value;
}

async function fullscreen(): Promise<void> {
  if (video.value?.requestFullscreen) await video.value.requestFullscreen();
}

watch(
  () => props.state,
  (next) => {
    if (!['live', 'paused', 'starting'].includes(next ?? '') && player.value) {
      stop();
    }
  },
);

let previewObserver: IntersectionObserver | null = null;
let autoPausedByScroll = false;

watch(
  canPlay,
  (ok) => {
    if (ok && broadcasts.value.length === 0) void loadChat();
  },
  { immediate: true },
);

onMounted(() => {
  if ('IntersectionObserver' in window && video.value) {
    previewObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (!entry.isIntersecting && player.value && status.value === 'playing') {
          // Out of viewport: pause to save CPU, battery, and buffer churn
          try {
            player.value.pause();
            autoPausedByScroll = true;
          } catch {
            /* ignore */
          }
        } else if (entry.isIntersecting && autoPausedByScroll && player.value) {
          // Back in viewport: resume playback
          autoPausedByScroll = false;
          void player.value.play()?.catch(() => {
            /* ignore */
          });
        }
      },
      { threshold: 0.1 },
    );
    previewObserver.observe(video.value);
  }
});

onBeforeUnmount(() => {
  if (previewObserver) {
    previewObserver.disconnect();
    previewObserver = null;
  }
  stop();
});
</script>

<template>
  <section class="card live-preview-card" aria-labelledby="live-preview-title">
    <div class="card-head">
      <div>
        <h2 id="live-preview-title" class="card-title">Live-Vorschau</h2>
        <p class="card-sub">Unabhängig vom YouTube-Sink.</p>
      </div>
      <div class="card-badges">
        <span
          class="badge"
          :class="status === 'playing' ? 'tone-success' : status === 'error' ? 'tone-danger' : 'tone-neutral'"
        >
          {{ status === 'playing' ? 'Live' : status === 'connecting' ? 'Verbinde…' : status === 'error' ? 'Fehler' : 'Bereit' }}
        </span>
        <a
          v-if="chatUrl"
          :href="chatUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="btn btn-ghost btn-sm"
          aria-label="YouTube-Live-Chat öffnen"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
            <path
              d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-2.9-.4-4.1-1L3 20l1-5.2a8.4 8.4 0 0 1-1-4.3A8.5 8.5 0 0 1 11.5 2 8.5 8.5 0 0 1 21 11.5Z"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linejoin="round"
            />
          </svg>
          Chat
        </a>
      </div>
    </div>

    <div class="live-preview-stage">
      <video
        ref="video"
        class="live-preview-video"
        playsinline
        muted
        :class="{ 'is-visible': isRunning }"
      ></video>
      <div v-if="!isRunning" class="live-preview-placeholder">
        <p v-if="!canPlay">Kein aktiver Stream.</p>
        <p v-else-if="status === 'unsupported' || status === 'error'">{{ error }}</p>
        <p v-else>Keine Vorschau.</p>
      </div>
    </div>

    <div class="live-preview-actions">
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="!canPlay"
        @click="isRunning ? stop() : start()"
      >
        <span v-if="status === 'connecting'" class="spinner" aria-hidden="true"></span>
        <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
          <path v-if="!isRunning" d="m8 5 11 7-11 7V5Z" fill="currentColor" />
          <rect v-else x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
        </svg>
        {{ isRunning ? 'Vorschau stoppen' : 'Vorschau starten' }}
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        :disabled="!isRunning"
        :aria-label="muted ? 'Ton einschalten' : 'Ton ausschalten'"
        @click="toggleMute"
      >
        {{ muted ? 'Ton an' : 'Ton aus' }}
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        :disabled="!isRunning"
        aria-label="Vollbild"
        @click="fullscreen"
      >
        Vollbild
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        :disabled="!canPlay"
        aria-label="Vorschau neu laden"
        @click="start"
      >
        Neu laden
      </button>
      <span v-if="error && isRunning" class="muted small">{{ error }}</span>
    </div>
  </section>
</template>
