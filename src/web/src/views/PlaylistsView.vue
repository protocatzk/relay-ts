<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { Playlist, PlaylistInput } from '@/src/api/types';
import ModalDialog from '@/src/components/ModalDialog.vue';
import ToggleField from '@/src/components/ToggleField.vue';
import { useStore } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';
import { formatNumber } from '@/src/utils/format';

const { store, refreshPlaylists, refreshStatus } = useStore();
const { pushToast } = useToast();

const busy = ref<string | null>(null);
const editorOpen = ref(false);
const editingPlaylist = ref<Playlist | null>(null);
const saving = ref(false);
const deleteTarget = ref<Playlist | null>(null);
const deleting = ref(false);
const form = reactive({
  id: '',
  name: '',
  channels: '',
  auto_advance: true,
  wrap: false,
  advance_delay_seconds: 5,
  end_after_minutes: null as number | null,
  youtube_key: '',
});

const activePlaylist = computed(() => store.status?.active_playlist ?? null);

function isActive(playlist: Playlist): boolean {
  return activePlaylist.value?.id === playlist.id;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function resetForm(): void {
  form.id = '';
  form.name = '';
  form.channels = '';
  form.auto_advance = true;
  form.wrap = false;
  form.advance_delay_seconds = 5;
  form.end_after_minutes = null;
  form.youtube_key = '';
}

function openCreate(): void {
  editingPlaylist.value = null;
  resetForm();
  editorOpen.value = true;
}

function openEdit(playlist: Playlist): void {
  editingPlaylist.value = playlist;
  form.id = playlist.id;
  form.name = playlist.name;
  form.channels = playlist.channels.join('\n');
  form.auto_advance = playlist.auto_advance;
  form.wrap = playlist.wrap;
  form.advance_delay_seconds = playlist.advance_delay_seconds;
  form.end_after_minutes = playlist.end_after_minutes ?? null;
  form.youtube_key = '';
  editorOpen.value = true;
}

function closeEditor(): void {
  if (saving.value) return;
  editorOpen.value = false;
}

async function savePlaylist(): Promise<void> {
  const channels = form.channels
    .split(/[\n,]+/)
    .map((channel) => channel.trim().replace(/^@+/, ''))
    .filter(Boolean);
  if (!form.name.trim() || channels.length === 0) {
    pushToast('Name und mindestens ein Kanal sind erforderlich.', 'error');
    return;
  }
  const id = form.id.trim() || slugify(form.name);
  const payload: PlaylistInput = {
    name: form.name.trim(),
    channels,
    auto_advance: form.auto_advance,
    wrap: form.wrap,
    advance_delay_seconds: Math.max(0, Number(form.advance_delay_seconds) || 0),
    end_after_minutes: form.end_after_minutes ? Number(form.end_after_minutes) : null,
    ...(form.youtube_key.trim() ? { youtube_key: form.youtube_key.trim() } : {}),
  };
  saving.value = true;
  try {
    if (editingPlaylist.value) {
      await api.playlists.update(editingPlaylist.value.id, payload);
      pushToast(`Playlist „${payload.name}“ gespeichert.`, 'success');
    } else {
      await api.playlists.create({ ...payload, id });
      pushToast(`Playlist „${payload.name}“ angelegt.`, 'success');
    }
    await refreshPlaylists();
    editorOpen.value = false;
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    saving.value = false;
  }
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value;
  if (!target) return;
  deleting.value = true;
  try {
    await api.playlists.remove(target.id);
    await Promise.allSettled([refreshPlaylists(), refreshStatus()]);
    pushToast(`Playlist „${target.name}“ gelöscht.`, 'success');
    deleteTarget.value = null;
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    deleting.value = false;
  }
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
        <button type="button" class="btn btn-primary" :disabled="busy !== null" @click="openCreate">
          Neue Playlist
        </button>
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
          <button type="button" class="btn btn-ghost btn-sm" :disabled="busy !== null" @click="openEdit(playlist)">
            Bearbeiten
          </button>
          <button type="button" class="btn btn-ghost btn-sm" :disabled="busy !== null" @click="deleteTarget = playlist">
            Löschen
          </button>
        </div>
      </article>
    </div>

    <p v-if="activePlaylist" class="muted small">
      Aktive Playlist: <strong>{{ activePlaylist.name }}</strong> · Kanal
      {{ activePlaylist.index + 1 }} von {{ activePlaylist.total }}
    </p>

    <ModalDialog
      :open="editorOpen"
      :title="editingPlaylist ? 'Playlist bearbeiten' : 'Neue Playlist'"
      size="md"
      @close="closeEditor"
    >
      <form id="playlist-form" class="stack" @submit.prevent="savePlaylist">
        <div class="form-grid">
          <div class="field">
            <label for="playlist-id">ID</label>
            <input
              id="playlist-id"
              v-model="form.id"
              type="text"
              :disabled="Boolean(editingPlaylist)"
              placeholder="abend"
              spellcheck="false"
            />
          </div>
          <div class="field">
            <label for="playlist-name">Name</label>
            <input id="playlist-name" v-model="form.name" type="text" placeholder="Abendprogramm" />
          </div>
        </div>
        <div class="field">
          <label for="playlist-channels">Kanäle (eine pro Zeile oder kommagetrennt)</label>
          <textarea id="playlist-channels" v-model="form.channels" rows="6" spellcheck="false"></textarea>
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="playlist-delay">Wechselverzögerung (s)</label>
            <input id="playlist-delay" v-model.number="form.advance_delay_seconds" type="number" min="0" max="600" />
          </div>
          <div class="field">
            <label for="playlist-end">Ende nach (Minuten, optional)</label>
            <input id="playlist-end" v-model.number="form.end_after_minutes" type="number" min="1" max="1440" placeholder="z. B. 120" />
          </div>
        </div>
        <ToggleField v-model="form.auto_advance" label="Auto-Advance" description="Bei Offline-Quelle automatisch zum nächsten Kanal." />
        <ToggleField v-model="form.wrap" label="Wrap" description="Am Ende wieder zum ersten Kanal springen." />
        <div class="field">
          <label for="playlist-key">YouTube-Key (optional, leer = bestehenden behalten)</label>
          <input id="playlist-key" v-model="form.youtube_key" type="password" autocomplete="new-password" />
        </div>
      </form>
      <template #footer>
        <button type="button" class="btn btn-ghost" :disabled="saving" @click="closeEditor">Abbrechen</button>
        <button type="submit" form="playlist-form" class="btn btn-primary" :disabled="saving">
          <span v-if="saving" class="spinner" aria-hidden="true"></span>
          Speichern
        </button>
      </template>
    </ModalDialog>

    <ModalDialog
      :open="deleteTarget !== null"
      title="Playlist löschen"
      size="sm"
      @close="deleteTarget = null"
    >
      <p>Soll die Playlist <strong>{{ deleteTarget?.name }}</strong> wirklich gelöscht werden?</p>
      <template #footer>
        <button type="button" class="btn btn-ghost" :disabled="deleting" @click="deleteTarget = null">Abbrechen</button>
        <button type="button" class="btn btn-danger" :disabled="deleting" @click="confirmDelete">
          <span v-if="deleting" class="spinner" aria-hidden="true"></span>
          Löschen
        </button>
      </template>
    </ModalDialog>
  </div>
</template>
