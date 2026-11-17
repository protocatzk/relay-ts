<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { Playlist } from '@/src/api/types';
import { useStore } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';
import { formatNumber } from '@/src/utils/format';

const { store, refreshPlaylists, refreshStatus } = useStore();
const { pushToast } = useToast();

const busy = ref<string | null>(null);

const activePlaylist = computed(() => store.status?.active_playlist ?? null);

function isActive(playlist: Playlist): boolean {
  return activePlaylist.value?.id === playlist.id;
}

async function run(
  key: string,
  action: () => Promise<unknown>,
  successMessage: string,
): Promise<void> {
  busy.value = key;
  try {
    await action();
    await Promise.allSettled([refreshPlaylists(), refreshStatus()]);
    pushToast(successMessage, 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    busy.value = null;
  }
}

async function play(playlist: Playlist): Promise<void> {
  await run(`play:${playlist.id}`, () => api.playlists.play(playlist.id), `Playlist „${playlist.name}“ wird abgespielt.`);
}

async function next(): Promise<void> {
  await run('next', () => api.playlists.next(), 'Nächster Kanal wird angesteuert.');
}

async function stop(): Promise<void> {
  await run('stop', () => api.playlists.stop(), 'Playlist gestoppt.');
}

onMounted(() => {
  refreshPlaylists().catch((error) => pushToast(errorMessage(error), 'error'));
  refreshStatus().catch(() => undefined);
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Playlists</h1>
        <p class="page-sub">Kanal-Playlists abspielen, wechseln und stoppen.</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-ghost" :disabled="busy !== null" @click="next">
          <span v-if="busy === 'next'" class="spinner" aria-hidden="true"></span>
          <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
            <path d="M5 5l9 7-9 7V5ZM19 5v14" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round" />
          </svg>
          Nächster
        </button>
        <button type="button" class="btn btn-secondary" :disabled="busy !== null" @click="stop">
          <span v-if="busy === 'stop'" class="spinner" aria-hidden="true"></span>
          <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
          </svg>
          Stop
        </button>
      </div>
    </div>

    <div v-if="store.loading.playlists && store.playlists.length === 0" class="card empty">
      <span class="spinner spinner-lg" aria-hidden="true"></span>
      <p>Playlists werden geladen…</p>
    </div>

    <div v-else-if="store.playlists.length === 0" class="card empty">
      <svg viewBox="0 0 24 24" width="34" height="34" fill="none" aria-hidden="true">
        <path d="M4 6h16M4 12h10M4 18h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        <path d="m16 14 5 3-5 3v-6Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
      </svg>
      <p>Noch keine Playlists konfiguriert.</p>
      <p class="muted small">Playlists werden in der Server-Konfiguration angelegt.</p>
    </div>

    <div v-else class="playlist-grid">
      <article v-for="playlist in store.playlists" :key="playlist.id" class="card playlist-card" :class="{ 'is-active': isActive(playlist) }">
        <div class="card-head">
          <div>
            <h2 class="card-title">{{ playlist.name }}</h2>
            <p class="card-sub mono">{{ playlist.id }}</p>
          </div>
          <div class="card-badges">
            <span v-if="isActive(playlist)" class="badge tone-success">
              <span class="dot dot-pulse" aria-hidden="true"></span>
              Aktiv
            </span>
            <span v-if="playlist.youtube_key_set" class="badge tone-success">Key gesetzt</span>
            <span v-else class="badge tone-danger">Key fehlt</span>
          </div>
        </div>

        <div class="playlist-meta">
          <span class="badge tone-neutral">
            Auto-Advance: {{ playlist.auto_advance ? 'An' : 'Aus' }}
          </span>
          <span class="badge tone-neutral">Wrap: {{ playlist.wrap ? 'An' : 'Aus' }}</span>
          <span class="badge tone-neutral">
            Pause {{ formatNumber(playlist.advance_delay_seconds) }} s
          </span>
          <span v-if="playlist.end_after_minutes" class="badge tone-neutral">
            Ende nach {{ formatNumber(playlist.end_after_minutes) }} Min.
          </span>
        </div>

        <div class="playlist-channels">
          <p class="field-label">Kanäle ({{ playlist.channels.length }})</p>
          <ol v-if="playlist.channels.length > 0" class="channel-list">
            <li v-for="(channel, index) in playlist.channels" :key="`${playlist.id}-${index}`" class="channel-item">
              <span class="channel-index mono">{{ index + 1 }}</span>
              <span class="channel-name">{{ channel }}</span>
            </li>
          </ol>
          <p v-else class="muted small">Keine Kanäle eingetragen.</p>
        </div>

        <div class="playlist-actions">
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="busy !== null"
            @click="play(playlist)"
          >
            <span v-if="busy === `play:${playlist.id}`" class="spinner" aria-hidden="true"></span>
            <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
              <path d="m8 5 11 7-11 7V5Z" fill="currentColor" />
            </svg>
            Play
          </button>
          <button type="button" class="btn btn-ghost btn-sm" :disabled="busy !== null" @click="next">
            Nächster
          </button>
          <button type="button" class="btn btn-ghost btn-sm" :disabled="busy !== null" @click="stop">
            Stop
          </button>
        </div>
      </article>
    </div>

    <p v-if="activePlaylist" class="muted small">
      Aktive Playlist: <strong>{{ activePlaylist.name }}</strong> · Kanal
      {{ activePlaylist.index + 1 }} von {{ activePlaylist.total }}
    </p>
  </div>
</template>
