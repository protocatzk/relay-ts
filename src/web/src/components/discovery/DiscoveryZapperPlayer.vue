<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { DiscoveryHit, Streamer } from '@/src/api/types';
import { DEFAULT_AVATAR_SVG_URL, resolveAvatarSrc } from '@/src/composables/useAvatarFallback';
import { resolveZapperKey, ZAPPER_SHORTCUTS } from '@/src/utils/discovery-keys';

type ZapperPlayerStatus = 'idle' | 'connecting' | 'playing' | 'error' | 'unsupported';
type Mpegts = typeof import('mpegts.js').default;
type Player = ReturnType<Mpegts['createPlayer']>;

const props = defineProps<{
  hits: DiscoveryHit[];
  initialIndex: number;
  hasMorePages: boolean;
  loadingMore: boolean;
  actionBusy: string | null;
  getExisting: (handle: string) => Streamer | undefined;
  failedAvatars: Set<string>;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'update:index', index: number): void;
  (e: 'loadMore'): void;
  (e: 'add', hit: DiscoveryHit): void;
  (e: 'activate', streamer: Streamer): void;
  (e: 'queue', hit: DiscoveryHit): void;
  (e: 'switch', hit: DiscoveryHit): void;
  (e: 'avatarError', handle: string): void;
}>();

const zapperIndex = ref(props.initialIndex);
const zapperVideoRef = ref<HTMLVideoElement | null>(null);
const container = ref<HTMLElement | null>(null);
const zapperMuted = ref(false);
const showHelp = ref(false);
const zapperStatus = ref<ZapperPlayerStatus>('idle');
const zapperError = ref<string>('');
let mpegtsLib: Mpegts | null = null;
const zapperPlayer = shallowRef<Player | null>(null);

const currentZapperHit = computed<DiscoveryHit | null>(
  () => props.hits[zapperIndex.value] ?? props.hits[0] ?? null,
);

watch(
  () => zapperIndex.value,
  () => {
    if (!showHelp.value) showHelp.value = false;
    warmNextRooms();
  },
);

watch(
  () => props.initialIndex,
  (newIdx) => {
    if (newIdx !== zapperIndex.value) {
      zapperIndex.value = newIdx;
      void startZapperPlayer();
    }
  },
);

function avatarSrcFor(hit: DiscoveryHit): string | null {
  return resolveAvatarSrc(hit.avatar_url, props.failedAvatars.has(hit.handle));
}

function isUsingFallbackAvatar(hit: DiscoveryHit): boolean {
  return !hit.avatar_url || props.failedAvatars.has(hit.handle);
}

function onAvatarError(handle: string): void {
  emit('avatarError', handle);
}

function zapperPosterFor(hit: DiscoveryHit): string {
  if (hit.cover_url) return hit.cover_url;
  return avatarSrcFor(hit) ?? DEFAULT_AVATAR_SVG_URL;
}

async function loadMpegts(): Promise<Mpegts> {
  if (!mpegtsLib) {
    const mod = await import('mpegts.js');
    mpegtsLib = mod.default;
  }
  return mpegtsLib;
}

function destroyZapperPlayer(): void {
  const current = zapperPlayer.value;
  zapperPlayer.value = null;
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

async function startZapperPlayer(): Promise<void> {
  destroyZapperPlayer();
  const hit = currentZapperHit.value;
  if (!hit || !hit.live) {
    zapperStatus.value = 'idle';
    return;
  }

  await nextTick();
  const videoEl = zapperVideoRef.value;
  if (!videoEl) return;

  const lib = await loadMpegts();
  if (!lib.isSupported()) {
    zapperStatus.value = 'unsupported';
    zapperError.value = 'Dein Browser unterstützt keine MSE-Live-Wiedergabe.';
    return;
  }

  zapperError.value = '';
  zapperStatus.value = 'connecting';
  const streamUrl = `/api/discovery/preview/${encodeURIComponent(hit.handle)}?t=${Date.now()}`;

  const instance = lib.createPlayer(
    { type: 'flv', isLive: true, url: streamUrl },
    {
      enableWorker: false,
      lazyLoad: false,
      liveBufferLatencyChasing: true,
      liveBufferLatencyMaxLatency: 3,
      liveBufferLatencyMinRemain: 0.4,
    },
  );
  zapperPlayer.value = instance;

  instance.on(lib.Events.ERROR, (_type, detail) => {
    if (zapperPlayer.value !== instance) return;
    zapperStatus.value = 'error';
    zapperError.value = `Stream-Vorschau konnte nicht geladen werden (${detail}).`;
  });

  instance.on(lib.Events.MEDIA_INFO, () => {
    if (zapperPlayer.value !== instance) return;
    zapperStatus.value = 'playing';
  });

  videoEl.muted = zapperMuted.value;
  instance.attachMediaElement(videoEl);
  instance.load();
  const playback = instance.play();
  if (playback && typeof playback.then === 'function') {
    void playback.catch(() => {
      if (zapperPlayer.value !== instance) return;
      if (!zapperMuted.value && videoEl) {
        zapperMuted.value = true;
        videoEl.muted = true;
        void instance.play()?.catch(() => {
          zapperStatus.value = 'error';
          zapperError.value = 'Autoplay vom Browser blockiert – bitte auf Play klicken.';
        });
      }
    });
  }
}

function toggleZapperMute(): void {
  zapperMuted.value = !zapperMuted.value;
  if (zapperVideoRef.value) {
    zapperVideoRef.value.muted = zapperMuted.value;
  }
}

function prevZapperStreamer(): void {
  if (zapperIndex.value <= 0) return;
  zapperIndex.value -= 1;
  emit('update:index', zapperIndex.value);
  void startZapperPlayer();
}

async function nextZapperStreamer(): Promise<void> {
  if (zapperIndex.value < props.hits.length - 1) {
    zapperIndex.value += 1;
    emit('update:index', zapperIndex.value);
    void startZapperPlayer();
    if (zapperIndex.value >= props.hits.length - 2) {
      emit('loadMore');
    }
    return;
  }
  if (props.hasMorePages && !props.loadingMore) {
    const prevCount = props.hits.length;
    emit('loadMore');
    // If more items arrive via props watcher or next check, advance
    await nextTick();
    if (props.hits.length > prevCount) {
      zapperIndex.value = prevCount;
      emit('update:index', zapperIndex.value);
      void startZapperPlayer();
    }
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    event.target instanceof HTMLSelectElement
  ) {
    return;
  }

  const action = resolveZapperKey(event.key);
  if (!action) return;
  if (action === 'help') {
    event.preventDefault();
    showHelp.value = !showHelp.value;
    return;
  }
  if (showHelp.value && action !== 'close') return;
  event.preventDefault();
  const hit = currentZapperHit.value;
  switch (action) {
    case 'prev':
      prevZapperStreamer();
      break;
    case 'next':
      void nextZapperStreamer();
      break;
    case 'mute':
      toggleZapperMute();
      break;
    case 'fullscreen':
      void toggleFullscreen();
      break;
    case 'switch':
      if (hit) emit('switch', hit);
      break;
    case 'queue':
      if (hit) emit('queue', hit);
      break;
    case 'add':
      if (hit) emit('add', hit);
      break;
    case 'close':
      if (showHelp.value) showHelp.value = false;
      else emit('close');
      break;
  }
}

/** Fullscreen the stage; the panel stays mounted behind it. */
async function toggleFullscreen(): Promise<void> {
  const stage = container.value;
  if (!stage) return;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await stage.requestFullscreen();
  } catch {
    /* fullscreen may be blocked; ignore */
  }
}

/**
 * Warms the room metadata of the next two hits so zapping does not wait for a
 * cold provider call. Only JSON, never a second video stream.
 */
let warmController: AbortController | null = null;
function warmNextRooms(): void {
  warmController?.abort();
  const controller = new AbortController();
  warmController = controller;
  const upcoming = props.hits.slice(zapperIndex.value + 1, zapperIndex.value + 3);
  for (const hit of upcoming) {
    if (!hit.live) continue;
    void fetch(`/api/discovery/room/${encodeURIComponent(hit.handle)}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    }).catch(() => undefined);
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
  void startZapperPlayer();
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  destroyZapperPlayer();
});

defineExpose({
  prevZapperStreamer,
  nextZapperStreamer,
  startZapperPlayer,
  toggleZapperMute,
});
</script>

<template>
  <section
    v-if="currentZapperHit"
    ref="container"
    class="zapper-container"
    aria-label="TikTok Live-Zapper"
  >
    <div class="zapper-stage">
      <!-- Blurred Ambient Backdrop -->
      <div
        class="zapper-backdrop"
        :style="{ backgroundImage: `url(${zapperPosterFor(currentZapperHit)})` }"
        aria-hidden="true"
      ></div>

      <!-- Live FLV Video Element -->
      <video
        ref="zapperVideoRef"
        class="zapper-video"
        playsinline
        autoplay
        :muted="zapperMuted"
        :poster="zapperPosterFor(currentZapperHit)"
      ></video>

      <!-- Top HUD Bar -->
      <div class="zapper-top-bar">
        <div class="zapper-badges mono">
          <span class="badge badge-live-pulse">● LIVE</span>
          <span v-if="currentZapperHit.viewers !== null" class="zapper-pill">
            👥 {{ currentZapperHit.viewers.toLocaleString('de-DE') }}
          </span>
          <span class="zapper-pill">
            #{{ zapperIndex + 1 }} / {{ props.hits.length }}{{ props.hasMorePages ? '+' : '' }}
          </span>
          <span v-if="zapperStatus === 'connecting'" class="zapper-pill">
            <span class="spinner" aria-hidden="true"></span> Verbinde…
          </span>
        </div>

        <div class="zapper-top-actions">
          <button
            type="button"
            class="btn btn-sm zapper-ctrl-btn"
            :title="zapperMuted ? 'Ton einschalten (Taste M)' : 'Stummschalten (Taste M)'"
            @click="toggleZapperMute"
          >
            {{ zapperMuted ? '🔇 Stumm' : '🔊 Ton an' }}
          </button>
          <button
            type="button"
            class="btn btn-sm zapper-ctrl-btn"
            title="Vorschau neu verbinden"
            @click="startZapperPlayer"
          >
            🔄
          </button>
          <button
            type="button"
            class="btn btn-sm zapper-ctrl-btn"
            title="Tastaturkürzel anzeigen (?)"
            aria-label="Tastaturkürzel anzeigen"
            @click="showHelp = !showHelp"
          >
            ?
          </button>
          <button
            type="button"
            class="btn btn-sm zapper-ctrl-btn"
            title="Zurück zur Karten-Übersicht (Esc)"
            @click="emit('close')"
          >
            ✕ Karten
          </button>
        </div>
      </div>

      <!-- Keyboard help (#92) -->
      <div v-if="showHelp" class="zapper-help" role="dialog" aria-label="Tastaturkürzel">
        <h3>Tastaturkürzel</h3>
        <ul>
          <li v-for="shortcut in ZAPPER_SHORTCUTS" :key="shortcut.keys">
            <kbd>{{ shortcut.keys }}</kbd>
            <span>{{ shortcut.label }}</span>
          </li>
        </ul>
        <button type="button" class="btn btn-sm btn-outline" @click="showHelp = false">
          Schließen (Esc)
        </button>
      </div>

      <!-- Center Error / Retry Overlay -->
      <div v-if="zapperStatus === 'error' || zapperStatus === 'unsupported'" class="zapper-error-overlay">
        <p>{{ zapperError }}</p>
        <div class="zapper-error-actions">
          <button type="button" class="btn btn-sm btn-outline" @click="startZapperPlayer">
            🔄 Erneut versuchen
          </button>
          <button type="button" class="btn btn-sm btn-primary" @click="nextZapperStreamer">
            ▼ Nächster Streamer
          </button>
        </div>
      </div>

      <!-- Bottom Streamer & Regie HUD -->
      <div class="zapper-bottom-hud">
        <div class="zapper-streamer-info">
          <div class="avatar-wrap">
            <img
              v-if="avatarSrcFor(currentZapperHit)"
              :src="avatarSrcFor(currentZapperHit)!"
              :alt="`Avatar von ${currentZapperHit.display_name}`"
              class="avatar-img"
              :class="{ 'is-fallback-avatar': isUsingFallbackAvatar(currentZapperHit) }"
              referrerpolicy="no-referrer"
              @error="onAvatarError(currentZapperHit.handle)"
            />
            <div v-else class="avatar-fallback">
              {{ (currentZapperHit.display_name || currentZapperHit.handle).slice(0, 2).toUpperCase() }}
            </div>
            <span class="status-indicator status-live"></span>
          </div>

          <div class="zapper-text">
            <div class="zapper-name-line">
              <h2 class="zapper-title-name">{{ currentZapperHit.display_name }}</h2>
              <a
                :href="`https://www.tiktok.com/@${currentZapperHit.handle}/live`"
                target="_blank"
                rel="noopener noreferrer"
                class="zapper-handle mono"
              >
                @{{ currentZapperHit.handle }} ↗
              </a>
              <span
                v-if="props.getExisting(currentZapperHit.handle)"
                class="badge"
                :class="props.getExisting(currentZapperHit.handle)?.enabled ? 'badge-info' : 'badge-warning'"
              >
                {{ props.getExisting(currentZapperHit.handle)?.enabled ? 'IN LISTE (AKTIV)' : 'IN LISTE (AUS)' }}
              </span>
            </div>
            <p v-if="currentZapperHit.title" class="zapper-room-title">
              {{ currentZapperHit.title }}
            </p>
            <p v-else-if="currentZapperHit.bio" class="zapper-room-bio">
              {{ currentZapperHit.bio }}
            </p>
          </div>
        </div>

        <div class="zapper-regie-actions">
          <!-- Speichern / Aktivieren -->
          <template v-if="!props.getExisting(currentZapperHit.handle)">
            <button
              type="button"
              class="btn btn-sm btn-outline"
              :disabled="Boolean(props.actionBusy)"
              @click="emit('add', currentZapperHit)"
            >
              <span v-if="props.actionBusy === `add:${currentZapperHit.handle}`" class="spinner" aria-hidden="true"></span>
              <span>💾 Speichern</span>
            </button>
          </template>
          <template v-else-if="!props.getExisting(currentZapperHit.handle)?.enabled">
            <button
              type="button"
              class="btn btn-sm btn-warning"
              :disabled="Boolean(props.actionBusy)"
              @click="emit('activate', props.getExisting(currentZapperHit.handle)!)"
            >
              <span
                v-if="props.actionBusy === `activate:${props.getExisting(currentZapperHit.handle)?.id}`"
                class="spinner"
                aria-hidden="true"
              ></span>
              <span>⚡ Jetzt aktivieren</span>
            </button>
          </template>
          <template v-else>
            <span class="btn btn-sm btn-disabled" aria-disabled="true">
              ✓ Aktiv
            </span>
          </template>

          <!-- In Queue -->
          <button
            type="button"
            class="btn btn-sm btn-outline"
            :disabled="Boolean(props.actionBusy)"
            @click="emit('queue', currentZapperHit)"
          >
            <span v-if="props.actionBusy === `queue:${currentZapperHit.handle}`" class="spinner" aria-hidden="true"></span>
            <span>⏭ In Queue</span>
          </button>

          <!-- Sofort auf YouTube schalten -->
          <button
            type="button"
            class="btn btn-sm btn-primary"
            :disabled="Boolean(props.actionBusy)"
            @click="emit('switch', currentZapperHit)"
          >
            <span v-if="props.actionBusy === `switch:${currentZapperHit.handle}`" class="spinner" aria-hidden="true"></span>
            <span>▶ Jetzt auf YouTube schalten</span>
          </button>
        </div>
      </div>
    </div>

    <!-- RIGHT SIDE TIKTOK ARROW NAVIGATION RAIL -->
    <aside class="zapper-nav-rail" aria-label="Streamer weiter- und zurückschalten">
      <button
        type="button"
        class="zapper-arrow-btn"
        :disabled="zapperIndex <= 0"
        title="Vorheriger Streamer (Pfeil hoch)"
        aria-label="Vorheriger Streamer"
        @click="prevZapperStreamer"
      >
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2">
          <path d="m18 15-6-6-6 6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <div class="zapper-rail-counter mono">
        <span>{{ zapperIndex + 1 }}</span>
        <span class="rail-divider">/</span>
        <span>{{ props.hits.length }}</span>
        <span v-if="props.loadingMore" class="spinner rail-spinner" title="Lade weitere Live-Streamer…"></span>
      </div>

      <button
        type="button"
        class="zapper-arrow-btn"
        :disabled="zapperIndex >= props.hits.length - 1 && !props.hasMorePages && !props.loadingMore"
        title="Nächster Streamer (Pfeil runter)"
        aria-label="Nächster Streamer"
        @click="nextZapperStreamer"
      >
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2">
          <path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <p class="zapper-rail-hint mono">← / → Tasten · ? für Hilfe</p>
    </aside>
  </section>
</template>

<style scoped>
.zapper-help {
  position: absolute;
  inset: 50% auto auto 50%;
  z-index: 5;
  transform: translate(-50%, -50%);
  min-width: 250px;
  padding: 14px 16px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  background: var(--surface-1);
  box-shadow: var(--elev-3);
}

.zapper-help h3 {
  margin: 0 0 8px;
  font-size: 13px;
}

.zapper-help ul {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 0 0 10px;
  padding: 0;
  list-style: none;
}

.zapper-help li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 11.5px;
  color: var(--text-muted);
}

.zapper-help kbd {
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: 10px;
}

.zapper-container {
  display: flex;
  align-items: stretch;
  justify-content: center;
  gap: 1rem;
  min-height: 620px;
  max-height: 78vh;
}

.zapper-stage {
  position: relative;
  flex: 1;
  max-width: 520px;
  background: #000;
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6);
}

.zapper-backdrop {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  filter: blur(28px) brightness(0.25);
  transform: scale(1.1);
  pointer-events: none;
  z-index: 1;
}

.zapper-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: transparent;
  z-index: 2;
}

.zapper-top-bar {
  position: relative;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.75rem 0.85rem;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.75) 0%, transparent 100%);
  pointer-events: auto;
}

.zapper-badges {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  flex-wrap: wrap;
}

.badge-live-pulse {
  background: #ef4444;
  color: #fff;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 0.18rem 0.45rem;
  border-radius: 3px;
  animation: pulse-live 1.8s infinite ease-in-out;
}

@keyframes pulse-live {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.65; }
}

.zapper-pill {
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  color: #e5e5e5;
  padding: 0.18rem 0.5rem;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.zapper-top-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.zapper-ctrl-btn {
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #fff;
  backdrop-filter: blur(4px);
}

.zapper-ctrl-btn:hover {
  background: rgba(255, 255, 255, 0.18);
}

.zapper-error-overlay {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 2rem;
  background: rgba(0, 0, 0, 0.85);
  text-align: center;
  color: #fca5a5;
  font-size: 0.9rem;
}

.zapper-error-actions {
  display: flex;
  gap: 0.5rem;
}

.zapper-bottom-hud {
  position: relative;
  z-index: 4;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 1.25rem 0.85rem 0.85rem;
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.92) 0%, rgba(0, 0, 0, 0.6) 70%, transparent 100%);
  pointer-events: auto;
}

.zapper-streamer-info {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
}

.zapper-text {
  flex: 1;
  min-width: 0;
}

.zapper-name-line {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.zapper-title-name {
  font-size: 1.05rem;
  font-weight: 700;
  margin: 0;
  color: #fff;
  line-height: 1.2;
}

.zapper-handle {
  font-size: 0.8rem;
  color: var(--color-accent, #38bdf8);
  text-decoration: none;
}

.zapper-handle:hover {
  text-decoration: underline;
}

.zapper-room-title {
  margin: 0.25rem 0 0;
  font-size: 0.85rem;
  color: #f0f0f0;
  line-height: 1.3;
}

.zapper-room-bio {
  margin: 0.25rem 0 0;
  font-size: 0.78rem;
  color: #a3a3a3;
  line-height: 1.3;
}

.zapper-regie-actions {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.zapper-regie-actions .btn {
  flex: 1;
  justify-content: center;
}

.zapper-nav-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem 0.25rem;
  min-width: 52px;
}

.zapper-arrow-btn {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 1px solid var(--border-color, #333);
  background: var(--bg-card, #141414);
  color: var(--text-primary, #f0f0f0);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.zapper-arrow-btn:hover:not(:disabled) {
  background: var(--bg-surface-elevated, #242424);
  border-color: var(--color-accent, #38bdf8);
  color: var(--color-accent, #38bdf8);
  transform: scale(1.06);
}

.zapper-arrow-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  transform: none;
}

.zapper-rail-counter {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 0.75rem;
  color: var(--text-muted, #888);
  padding: 0.25rem 0;
  user-select: none;
}

.rail-divider {
  opacity: 0.5;
  line-height: 1;
}

.rail-spinner {
  margin-top: 0.35rem;
  width: 14px;
  height: 14px;
}

.zapper-rail-hint {
  font-size: 0.68rem;
  color: var(--text-muted, #777);
  margin: 0.25rem 0 0;
  text-align: center;
}

.avatar-wrap {
  position: relative;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
}

.avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--border-color, #333);
}

.avatar-fallback {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-surface-elevated, #242424);
  color: var(--text-muted, #888);
  font-family: var(--font-mono, monospace);
  font-size: 0.85rem;
  font-weight: 700;
  border: 1px solid var(--border-color, #333);
}

.status-indicator {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid var(--bg-surface, #1e1e1e);
}

.status-live {
  background-color: var(--color-success, #22c55e);
}

@media (max-width: 680px) {
  .zapper-container {
    flex-direction: column;
    max-height: none;
  }
  .zapper-nav-rail {
    flex-direction: row;
    min-width: 0;
    justify-content: space-around;
  }
  .zapper-rail-counter {
    flex-direction: row;
    gap: 0.35rem;
  }
}
</style>
