<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { Streamer, StreamerInput } from '@/src/api/types';
import ModalDialog from '@/src/components/ModalDialog.vue';
import StreamerEditor from '@/src/components/StreamerEditor.vue';
import { useStore } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';
import { sortStreamersByLive } from '@/src/utils/sort-streamers';

const { store, refreshStreamers, refreshPlaylists, refreshStatus } = useStore();
const { pushToast } = useToast();

const search = ref('');
const editorOpen = ref(false);
const editing = ref<Streamer | null>(null);
const saving = ref(false);
const saveError = ref('');
const rowBusy = ref<string | null>(null);
const deleteTarget = ref<Streamer | null>(null);
const deleting = ref(false);
const bulkInput = ref('');
const bulkPlaylist = ref('');
const bulkBusy = ref(false);

const filtered = computed(() => {
  const query = search.value.trim().toLowerCase();
  const sorted = sortStreamersByLive(store.streamers);
  if (!query) return sorted;
  return sorted.filter((streamer) => {
    return (
      streamer.name.toLowerCase().includes(query) ||
      streamer.tiktok.toLowerCase().includes(query) ||
      streamer.id.toLowerCase().includes(query)
    );
  });
});

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

function keyLabel(streamer: Streamer): string {
  if (!streamer.youtube_key_set) return 'Fehlt';
  return streamer.youtube_key_source === 'env' ? 'Aus Umgebung' : 'Gesetzt';
}

function openCreate(): void {
  editing.value = null;
  saveError.value = '';
  editorOpen.value = true;
}

function openEdit(streamer: Streamer): void {
  editing.value = streamer;
  saveError.value = '';
  editorOpen.value = true;
}

function closeEditor(): void {
  if (saving.value) return;
  editorOpen.value = false;
  editing.value = null;
  saveError.value = '';
}

async function handleSave(payload: { id: string; body: StreamerInput }): Promise<void> {
  saving.value = true;
  saveError.value = '';
  try {
    if (editing.value) {
      await api.streamers.update(editing.value.id, payload.body);
      pushToast(`Streamer „${payload.body.name}“ gespeichert.`, 'success');
    } else {
      await api.streamers.create({ id: payload.id, ...payload.body });
      pushToast(`Streamer „${payload.body.name}“ angelegt.`, 'success');
    }
    await Promise.allSettled([refreshStreamers(), refreshStatus()]);
    saving.value = false;
    editorOpen.value = false;
    editing.value = null;
  } catch (error) {
    saveError.value = errorMessage(error);
  } finally {
    saving.value = false;
  }
}

async function rowAction(streamer: Streamer, action: 'start' | 'stop' | 'switch'): Promise<void> {
  const key = `${action}:${streamer.id}`;
  rowBusy.value = key;
  try {
    const result =
      action === 'start'
        ? await api.streamers.start(streamer.id)
        : action === 'stop'
          ? await api.streamers.stop(streamer.id)
          : await api.streamers.switchTo(streamer.id);
    await Promise.allSettled([refreshStreamers(), refreshStatus()]);
    const state = (result as { status?: { state?: string } } | undefined)?.status?.state;
    if ((action === 'start' || action === 'switch') && state === 'paused') {
      pushToast(
        `${streamer.name} ist offline – Pausenscreen läuft, Start erfolgt automatisch sobald live.`,
        'info',
      );
      return;
    }
    const messages = {
      start: `${streamer.name} wird gestartet.`,
      stop: `${streamer.name} wird gestoppt.`,
      switch: `Wechsle zu ${streamer.name}.`,
    } as const;
    pushToast(messages[action], 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    rowBusy.value = null;
  }
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value;
  if (!target) return;
  deleting.value = true;
  try {
    await api.streamers.remove(target.id);
    await Promise.allSettled([refreshStreamers(), refreshStatus()]);
    deleteTarget.value = null;
    pushToast(`Streamer „${target.name}“ gelöscht.`, 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    deleting.value = false;
  }
}

async function submitBulk(): Promise<void> {
  const channels = bulkInput.value
    .split(/[\n,]+/)
    .map((channel) => channel.trim())
    .filter(Boolean);
  if (channels.length === 0) {
    pushToast('Mindestens einen Handle oder eine URL eingeben.', 'error');
    return;
  }
  bulkBusy.value = true;
  try {
    const result = await api.streamers.bulkAdd({
      channels,
      ...(bulkPlaylist.value ? { playlist_id: bulkPlaylist.value } : {}),
    });
    await Promise.allSettled([refreshStreamers(), refreshStatus(), refreshPlaylists()]);
    bulkInput.value = '';
    const skipped = result.skipped.length ? `, ${result.skipped.length} bereits vorhanden` : '';
    pushToast(`${result.created.length} Streamer angelegt${skipped}.`, 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    bulkBusy.value = false;
  }
}

onMounted(() => {
  refreshStreamers().catch((error) => pushToast(errorMessage(error), 'error'));
  refreshPlaylists().catch(() => undefined);
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Streamer</h1>
        <p class="page-sub">Streamer verwalten, konfigurieren und starten.</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-primary" @click="openCreate">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
          </svg>
          Neuer Streamer
        </button>
      </div>
    </div>

    <section class="card quick-add-card">
      <div class="card-head">
        <div>
          <h2 class="card-title">Schnell hinzufügen</h2>
          <p class="card-sub">Mehrere Handles oder TikTok-URLs per Zeile oder Komma.</p>
        </div>
      </div>
      <div class="quick-add-row">
        <div class="field">
          <label class="sr-only" for="bulk-channels">Handles oder URLs</label>
          <textarea
            id="bulk-channels"
            v-model="bulkInput"
            rows="2"
            spellcheck="false"
            placeholder="handle1, handle2&#10;https://www.tiktok.com/@handle3"
            @keydown.ctrl.enter.prevent="submitBulk"
            @keydown.meta.enter.prevent="submitBulk"
          ></textarea>
        </div>
        <div class="field">
          <label for="bulk-playlist">An Playlist anhängen</label>
          <select id="bulk-playlist" v-model="bulkPlaylist">
            <option value="">Nicht anhängen</option>
            <option v-for="playlist in store.playlists" :key="playlist.id" :value="playlist.id">
              {{ playlist.name }}
            </option>
          </select>
        </div>
        <button type="button" class="btn btn-primary" :disabled="bulkBusy || !bulkInput.trim()" @click="submitBulk">
          <span v-if="bulkBusy" class="spinner" aria-hidden="true"></span>
          Anlegen
        </button>
      </div>
      <p class="field-hint">IDs und Namen werden aus dem Handle abgeleitet; vorhandene Streamer werden übersprungen. Strg/Cmd+Enter legt an.</p>
    </section>

    <section class="card">
      <div class="toolbar">
        <div class="field field-search">
          <label class="sr-only" for="streamer-search">Streamer durchsuchen</label>
          <span class="search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8" />
              <path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </span>
          <input
            id="streamer-search"
            v-model="search"
            type="search"
            placeholder="Nach Name, Handle oder ID suchen…"
            autocomplete="off"
          />
        </div>
        <span class="muted small">
          {{ filtered.length }} von {{ store.streamers.length }} Streamern
        </span>
      </div>

      <div v-if="store.loading.streamers && store.streamers.length === 0" class="empty">
        <span class="spinner spinner-lg" aria-hidden="true"></span>
        <p>Streamer werden geladen…</p>
      </div>

      <div v-else-if="store.streamers.length === 0" class="empty">
        <svg viewBox="0 0 24 24" width="34" height="34" fill="none" aria-hidden="true">
          <circle cx="9" cy="8" r="3.4" stroke="currentColor" stroke-width="1.5" />
          <path d="M2.8 20c.5-3.2 3-5.2 6.2-5.2s5.7 2 6.2 5.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        <p>Noch keine Streamer angelegt.</p>
        <button type="button" class="btn btn-primary btn-sm" @click="openCreate">
          Ersten Streamer anlegen
        </button>
      </div>

      <div v-else-if="filtered.length === 0" class="empty">
        <p>Keine Streamer passend zu „{{ search }}“ gefunden.</p>
        <button type="button" class="btn btn-ghost btn-sm" @click="search = ''">Suche zurücksetzen</button>
      </div>

      <div v-else class="table-wrap">
        <table class="data-table" role="table">
          <caption class="sr-only">Streamer-Liste mit Status und Aktionen</caption>
          <thead>
            <tr role="row">
              <th scope="col" role="columnheader">Streamer</th>
              <th scope="col" role="columnheader">Status</th>
              <th scope="col" role="columnheader">Qualität</th>
              <th scope="col" role="columnheader">YouTube-Key</th>
              <th scope="col" role="columnheader" class="align-right">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="streamer in filtered"
              :key="streamer.id"
              role="row"
              :class="{ 'row-active': streamer.status.active }"
            >
              <td data-label="Streamer" role="cell">
                <div class="cell-title">
                  {{ streamer.name }}
                  <span v-if="streamer.preferred" class="badge tone-info badge-xs">Bevorzugt</span>
                  <span v-if="streamer.auto_start" class="badge tone-neutral badge-xs">Auto-Start</span>
                  <span
                    v-if="streamer.preferred || streamer.auto_start"
                    class="badge tone-neutral badge-xs"
                  >
                    Prio {{ streamer.priority }}
                  </span>
                  <span v-if="!streamer.enabled" class="badge tone-muted badge-xs">Deaktiviert</span>
                </div>
                <div class="cell-sub mono">{{ streamer.id }} · @{{ streamer.tiktok.replace(/^@/, '') }}</div>
              </td>
              <td data-label="Status" role="cell">
                <div class="cell-stack">
                  <span class="online-indicator" :class="onlineClass(streamer)">
                    <span class="dot" aria-hidden="true"></span>
                    {{ onlineLabel(streamer) }}
                  </span>
                  <span v-if="streamer.status.active" class="badge tone-success badge-xs">Aktiv</span>
                </div>
              </td>
              <td data-label="Qualität" role="cell"><span class="badge tone-neutral">{{ streamer.quality }}</span></td>
              <td data-label="YouTube-Key" role="cell">
                <span class="badge" :class="streamer.youtube_key_set ? 'tone-success' : 'tone-danger'">
                  {{ keyLabel(streamer) }}
                </span>
              </td>
              <td data-label="Aktionen" role="cell">
                <div class="row-actions">
                  <button
                    v-if="streamer.status.active"
                    type="button"
                    class="btn btn-ghost btn-xs"
                    :disabled="rowBusy !== null"
                    @click="rowAction(streamer, 'stop')"
                  >
                    <span v-if="rowBusy === `stop:${streamer.id}`" class="spinner" aria-hidden="true"></span>
                    Stoppen
                  </button>
                  <button
                    v-else
                    type="button"
                    class="btn btn-ghost btn-xs"
                    :disabled="rowBusy !== null || !streamer.enabled"
                    @click="rowAction(streamer, 'start')"
                  >
                    <span v-if="rowBusy === `start:${streamer.id}`" class="spinner" aria-hidden="true"></span>
                    Starten
                  </button>
                  <button
                    v-if="!streamer.status.active && store.status?.active_streamer_id"
                    type="button"
                    class="btn btn-ghost btn-xs"
                    :disabled="rowBusy !== null || !streamer.enabled"
                    @click="rowAction(streamer, 'switch')"
                  >
                    Wechseln
                  </button>
                  <button
                    type="button"
                    class="btn-icon"
                    :aria-label="`${streamer.name} bearbeiten`"
                    title="Bearbeiten"
                    @click="openEdit(streamer)"
                  >
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
                      <path
                        d="m4 20 .9-4.2L16.6 4.1a2 2 0 0 1 2.8 0l.5.5a2 2 0 0 1 0 2.8L8.2 19.1 4 20Z"
                        stroke="currentColor"
                        stroke-width="1.7"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    class="btn-icon btn-icon-danger"
                    :aria-label="`${streamer.name} löschen`"
                    title="Löschen"
                    @click="deleteTarget = streamer"
                  >
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
                      <path
                        d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12M10 11v6M14 11v6"
                        stroke="currentColor"
                        stroke-width="1.7"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <StreamerEditor
      v-if="editorOpen"
      :open="editorOpen"
      :streamer="editing"
      :saving="saving"
      :error="saveError"
      @close="closeEditor"
      @save="handleSave"
    />

    <ModalDialog
      :open="deleteTarget !== null"
      title="Streamer löschen"
      size="sm"
      @close="deleteTarget = null"
    >
      <p>
        Möchtest du den Streamer <strong>{{ deleteTarget?.name }}</strong> wirklich löschen?
      </p>
      <p class="muted small">Diese Aktion kann nicht rückgängig gemacht werden.</p>
      <template #footer>
        <button type="button" class="btn btn-ghost" :disabled="deleting" @click="deleteTarget = null">
          Abbrechen
        </button>
        <button type="button" class="btn btn-danger" :disabled="deleting" @click="confirmDelete">
          <span v-if="deleting" class="spinner" aria-hidden="true"></span>
          Löschen
        </button>
      </template>
    </ModalDialog>
  </div>
</template>
