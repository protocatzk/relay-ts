<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { SoundEntry, SoundKind } from '@/src/api/types';
import { refreshSoundboard, store } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';
import { confirmAction } from '@/src/composables/useConfirm';

const { pushToast } = useToast();

const state = computed(() => store.soundboard);
const sounds = computed(() => state.value?.sounds ?? []);
const sfxSounds = computed(() => sounds.value.filter((s) => s.kind === 'sfx'));
const musicSounds = computed(() => sounds.value.filter((s) => s.kind === 'music'));
const playingMap = computed(() => new Map((state.value?.playing ?? []).map((p) => [p.id, p])));
const playingIds = computed(() => new Set(playingMap.value.keys()));

function padProgress(id: string): number {
  const active = playingMap.value.get(id);
  if (!active || active.duration <= 0) return 0;
  return Math.min(100, Math.max(0, (active.position / active.duration) * 100));
}

const uploading = ref(false);
const uploadKind = ref<SoundKind>('sfx');
const dragOver = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

interface UploadQueueItem {
  id: string;
  name: string;
  size: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

const uploadQueue = ref<UploadQueueItem[]>([]);
const ALLOWED_EXTS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.opus']);
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
const editing = ref<SoundEntry | null>(null);
const editName = ref('');
const editKind = ref<SoundKind>('sfx');
const editGain = ref(0);
const editColor = ref('#22d3ee');
const editHotkey = ref('');
const togglingEnabled = ref(false);

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m > 0 ? `${m}:${String(rem).padStart(2, '0')}` : `${rem}s`;
}

async function toggleEnabled(): Promise<void> {
  if (!state.value || togglingEnabled.value) return;
  togglingEnabled.value = true;
  try {
    const current = await api.settings.get();
    await api.settings.update({
      soundboard: {
        ducking: current.soundboard?.ducking ?? true,
        duck_db: current.soundboard?.duck_db ?? -12,
        master_gain_db: current.soundboard?.master_gain_db ?? 0,
        sfx_gain_db: current.soundboard?.sfx_gain_db ?? 0,
        music_gain_db: current.soundboard?.music_gain_db ?? 0,
        max_concurrent: current.soundboard?.max_concurrent ?? 4,
        cache_mb: current.soundboard?.cache_mb ?? 128,
        enabled: !state.value.enabled,
      },
    });
    await refreshSoundboard();
    pushToast(
      !state.value.enabled
        ? 'Soundboard im Stream aktiviert'
        : 'Soundboard im Stream deaktiviert',
      'success',
    );
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    togglingEnabled.value = false;
  }
}

async function playSound(sound: SoundEntry): Promise<void> {
  try {
    const res = await api.soundboard.play(sound.id);
    store.soundboard = res.state;
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  }
}

async function stopAll(scope: 'all' | 'sfx' | 'music' = 'all'): Promise<void> {
  try {
    const res = await api.soundboard.stop(scope);
    store.soundboard = res.state;
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  }
}

async function nextMusic(): Promise<void> {
  try {
    const res = await api.soundboard.nextMusic();
    store.soundboard = res.state;
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  }
}

async function toggleMusicPause(): Promise<void> {
  try {
    const res = await api.soundboard.pauseMusic();
    store.soundboard = res.state;
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  }
}

async function cycleMusicLoop(): Promise<void> {
  const current = state.value?.music?.loop ?? 'all';
  const next = current === 'all' ? 'one' : current === 'one' ? 'off' : 'all';
  try {
    const res = await api.soundboard.setMusicLoop(next);
    store.soundboard = res.state;
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  }
}

async function updateVolume(patch: {
  master_gain_db?: number;
  sfx_gain_db?: number;
  music_gain_db?: number;
}): Promise<void> {
  try {
    const res = await api.soundboard.setVolume(patch);
    store.soundboard = res.state;
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  }
}

async function uploadFiles(files: FileList | null): Promise<void> {
  if (!files || files.length === 0) return;
  const list = Array.from(files);
  const items: UploadQueueItem[] = list.map((file, idx) => ({
    id: `${Date.now()}-${idx}-${file.name}`,
    name: file.name,
    size: file.size,
    status: 'pending',
  }));
  uploadQueue.value = items;
  uploading.value = true;
  let okCount = 0;

  try {
    for (let i = 0; i < list.length; i += 1) {
      const file = list[i]!;
      const item = items[i]!;
      const ext = file.name.includes('.') ? `.${file.name.split('.').pop()!.toLowerCase()}` : '';
      if (ext && !ALLOWED_EXTS.has(ext)) {
        item.status = 'error';
        item.error = 'Format nicht unterstützt (MP3, WAV, OGG, M4A, FLAC, OPUS)';
        continue;
      }
      if (file.size === 0) {
        item.status = 'error';
        item.error = 'Datei ist leer';
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        item.status = 'error';
        item.error = 'Datei größer als 50 MB';
        continue;
      }
      item.status = 'uploading';
      try {
        const res = await api.soundboard.upload(file, { kind: uploadKind.value });
        store.soundboard = res.state;
        item.status = 'done';
        okCount += 1;
      } catch (error) {
        item.status = 'error';
        item.error = errorMessage(error);
      }
    }
    if (okCount > 0) {
      pushToast(
        okCount === 1 ? '1 Audiodatei hochgeladen' : `${okCount} Audiodateien hochgeladen`,
        'success',
      );
    }
  } finally {
    uploading.value = false;
    if (fileInput.value) fileInput.value.value = '';
  }
}

function onDrop(event: DragEvent): void {
  dragOver.value = false;
  void uploadFiles(event.dataTransfer?.files ?? null);
}

function openEdit(sound: SoundEntry): void {
  editing.value = sound;
  editName.value = sound.name;
  editKind.value = sound.kind;
  editGain.value = sound.gain_db;
  editColor.value = sound.color;
  editHotkey.value = sound.hotkey;
}

async function saveEdit(): Promise<void> {
  if (!editing.value) return;
  try {
    const res = await api.soundboard.update(editing.value.id, {
      name: editName.value,
      kind: editKind.value,
      gain_db: editGain.value,
      color: editColor.value,
      hotkey: editHotkey.value,
    });
    store.soundboard = res.state;
    editing.value = null;
    pushToast('Sound aktualisiert', 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  }
}

async function removeSound(sound: SoundEntry): Promise<void> {
  const ok = await confirmAction(`Soll „${sound.name}“ wirklich gelöscht werden?`, {
    title: 'Sound löschen',
    confirmLabel: 'Löschen',
    tone: 'danger',
  });
  if (!ok) return;
  try {
    const res = await api.soundboard.remove(sound.id);
    store.soundboard = res.state;
    pushToast('Sound gelöscht', 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (editing.value) return;
  const target = event.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
    return;
  }
  const key = event.key.toUpperCase();
  if (!/^[1-9QWERTYUIOP]$/.test(key)) return;
  const match = sounds.value.find((s) => s.hotkey.toUpperCase() === key);
  if (match) {
    event.preventDefault();
    void playSound(match);
  }
}

onMounted(() => {
  void refreshSoundboard().catch(() => undefined);
  window.addEventListener('keydown', onKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
});
</script>

<template>
  <div class="soundboard-page">
    <header class="card sb-header">
      <div>
        <h2>Soundboard &amp; Musikbett</h2>
        <p class="muted">
          Mischt SFX und Musik parallel zum Stream in den YouTube-Sink (ohne Sink-Neustart beim Abspielen).
          Nur eigenes oder lizenziertes Material verwenden.
        </p>
      </div>
      <div class="sb-header-actions">
        <button
          type="button"
          class="btn"
          :class="state?.enabled ? 'btn-primary' : 'btn-ghost'"
          :disabled="togglingEnabled"
          @click="toggleEnabled"
        >
          {{ state?.enabled ? 'Im Stream aktiv' : 'Im Stream aktivieren' }}
        </button>
        <button type="button" class="btn btn-danger" @click="stopAll('all')">
          Alles stoppen
        </button>
      </div>
    </header>

    <section class="card sb-mixer">
      <div class="sb-sliders">
        <label class="sb-slider">
          <span>Master ({{ state?.master_gain_db ?? 0 }} dB)</span>
          <input
            type="range"
            min="-40"
            max="12"
            step="1"
            :value="state?.master_gain_db ?? 0"
            @change="updateVolume({ master_gain_db: Number(($event.target as HTMLInputElement).value) })"
          />
        </label>
        <label class="sb-slider">
          <span>SFX ({{ state?.sfx_gain_db ?? 0 }} dB)</span>
          <input
            type="range"
            min="-40"
            max="12"
            step="1"
            :value="state?.sfx_gain_db ?? 0"
            @change="updateVolume({ sfx_gain_db: Number(($event.target as HTMLInputElement).value) })"
          />
        </label>
        <label class="sb-slider">
          <span>Musik ({{ state?.music_gain_db ?? 0 }} dB)</span>
          <input
            type="range"
            min="-40"
            max="12"
            step="1"
            :value="state?.music_gain_db ?? 0"
            @change="updateVolume({ music_gain_db: Number(($event.target as HTMLInputElement).value) })"
          />
        </label>
      </div>
    </section>

    <section class="card">
      <div class="sb-section-head">
        <h3>SFX-Pads ({{ sfxSounds.length }})</h3>
        <button type="button" class="btn btn-ghost btn-sm" @click="stopAll('sfx')">
          SFX stoppen
        </button>
      </div>
      <div v-if="sfxSounds.length === 0" class="muted sb-empty">
        Noch keine SFX-Sounds hochgeladen.
      </div>
      <div v-else class="sb-pad-grid">
        <div
          v-for="sound in sfxSounds"
          :key="sound.id"
          class="sb-pad-wrap"
        >
          <button
            type="button"
            class="sb-pad"
            :class="{ playing: playingIds.has(sound.id) }"
            :style="{ '--pad-color': sound.color }"
            :aria-pressed="playingIds.has(sound.id)"
            @click="playSound(sound)"
          >
            <span class="sb-pad-top">
              <span v-if="sound.hotkey" class="sb-hotkey mono">{{ sound.hotkey }}</span>
              <span class="sb-dur mono">
                {{ playingIds.has(sound.id) ? `-${formatDuration(Math.max(0, sound.duration - (playingMap.get(sound.id)?.position ?? 0)))}` : formatDuration(sound.duration) }}
              </span>
            </span>
            <strong class="sb-pad-name">{{ sound.name }}</strong>
            <span
              v-if="playingIds.has(sound.id)"
              class="sb-pad-progress"
              :style="{ width: `${padProgress(sound.id)}%` }"
            ></span>
          </button>
          <div class="sb-pad-tools">
            <button type="button" class="btn-icon" title="Bearbeiten" @click="openEdit(sound)">✎</button>
            <button type="button" class="btn-icon" title="Löschen" @click="removeSound(sound)">✕</button>
          </div>
        </div>
      </div>
    </section>

    <section class="card sb-music-card">
      <div class="sb-section-head">
        <div class="sb-music-title-wrap">
          <h3>Musikbett ({{ musicSounds.length }})</h3>
          <span
            v-if="state?.music"
            class="badge"
            :class="state.music.paused ? 'tone-warning' : 'tone-success'"
          >
            {{ state.music.paused ? 'Pausiert' : 'Läuft' }}
          </span>
        </div>
        <div class="sb-music-controls">
          <button
            type="button"
            class="btn btn-ghost btn-sm sb-ctrl-btn"
            :title="`Loop-Modus: ${state?.music?.loop ?? 'all'}`"
            @click="cycleMusicLoop"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
              <path d="M17 2l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M21 13v1a4 4 0 0 1-4 4H3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span>{{ state?.music?.loop === 'one' ? '1×' : state?.music?.loop === 'off' ? 'Aus' : 'Alle' }}</span>
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm sb-ctrl-btn"
            :disabled="!state?.music && musicSounds.length === 0"
            @click="state?.music ? toggleMusicPause() : musicSounds[0] && playSound(musicSounds[0])"
          >
            <svg v-if="!state?.music || state.music.paused" viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
              <path d="M8 5.5v13l10-6.5-10-6.5Z" />
            </svg>
            <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
            <span>{{ !state?.music ? 'Abspielen' : state.music.paused ? 'Fortsetzen' : 'Pause' }}</span>
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm sb-ctrl-btn"
            :disabled="musicSounds.length === 0"
            title="Nächster Titel"
            @click="nextMusic"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
              <path d="M5 5.5v13l9-6.5-9-6.5Z" />
              <rect x="16" y="5.5" width="2.5" height="13" rx="1" />
            </svg>
            <span>Weiter</span>
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm sb-ctrl-btn"
            :disabled="!state?.music"
            title="Musik stoppen"
            @click="stopAll('music')"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
              <rect x="5" y="5" width="14" height="14" rx="2" />
            </svg>
            <span>Stopp</span>
          </button>
        </div>
      </div>

      <div v-if="state?.music" class="sb-now-playing">
        <div class="sb-now-playing-row">
          <div class="sb-now-track">
            <span class="sb-eq" :class="{ paused: state.music.paused }" aria-hidden="true">
              <span></span><span></span><span></span>
            </span>
            <strong>{{ state.music.name }}</strong>
          </div>
          <span class="mono sb-now-time">{{ formatDuration(state.music.position) }} / {{ formatDuration(state.music.duration) }}</span>
        </div>
        <div class="sb-music-progress-track">
          <div
            class="sb-music-progress-fill"
            :style="{ width: `${state.music.duration > 0 ? Math.min(100, (state.music.position / state.music.duration) * 100) : 0}%` }"
          ></div>
        </div>
      </div>

      <div v-if="musicSounds.length === 0" class="muted sb-empty">
        Noch keine Musiktitel hochgeladen.
      </div>
      <ul v-else class="sb-music-list">
        <li
          v-for="(track, idx) in musicSounds"
          :key="track.id"
          class="sb-music-row"
          :class="{ active: state?.music?.id === track.id }"
        >
          <button type="button" class="sb-music-play" @click="playSound(track)">
            <span class="sb-track-num mono muted">{{ state?.music?.id === track.id ? '▶' : String(idx + 1).padStart(2, '0') }}</span>
            <span class="sb-track-name">{{ track.name }}</span>
          </button>
          <span v-if="track.gain_db !== 0" class="badge tone-neutral mono">{{ track.gain_db > 0 ? `+${track.gain_db}` : track.gain_db }} dB</span>
          <span class="mono muted sb-track-dur">{{ formatDuration(track.duration) }}</span>
          <div class="sb-row-actions">
            <button type="button" class="btn-icon" title="Bearbeiten" @click="openEdit(track)">✎</button>
            <button type="button" class="btn-icon" title="Löschen" @click="removeSound(track)">✕</button>
          </div>
        </li>
      </ul>
    </section>

    <section
      class="card sb-upload"
      :class="{ 'drag-over': dragOver }"
      @dragover.prevent="dragOver = true"
      @dragleave.prevent="dragOver = false"
      @drop.prevent="onDrop"
    >
      <div class="sb-upload-head">
        <div class="sb-upload-intro">
          <div class="sb-upload-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
              <path d="M12 16V4m0 0-4 4m4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </div>
          <div>
            <strong>Audio-Dateien hochladen</strong>
            <p class="muted small">Dateien hierher ziehen oder auswählen (MP3, WAV, OGG, M4A, FLAC, OPUS · max. 50 MB)</p>
          </div>
        </div>

        <div class="sb-upload-controls">
          <div class="sb-kind-switch" role="group" aria-label="Upload-Kategorie">
            <button
              type="button"
              class="btn btn-sm"
              :class="uploadKind === 'sfx' ? 'btn-primary' : 'btn-ghost'"
              @click="uploadKind = 'sfx'"
            >
              SFX (≤ 60s)
            </button>
            <button
              type="button"
              class="btn btn-sm"
              :class="uploadKind === 'music' ? 'btn-primary' : 'btn-ghost'"
              @click="uploadKind = 'music'"
            >
              Musik (≤ 15m)
            </button>
          </div>
          <label class="btn btn-secondary btn-sm sb-file-btn" :class="{ disabled: uploading }">
            <input
              ref="fileInput"
              class="sr-only"
              type="file"
              accept=".mp3,.wav,.ogg,.m4a,.flac,.opus,audio/*"
              multiple
              :disabled="uploading"
              @change="uploadFiles(($event.target as HTMLInputElement).files)"
            />
            {{ uploading ? 'Lädt hoch…' : 'Dateien wählen' }}
          </label>
        </div>
      </div>

      <div v-if="uploadQueue.length > 0" class="sb-upload-queue">
        <div class="sb-upload-queue-head">
          <span class="small muted">
            {{ uploadQueue.filter((i) => i.status === 'done').length }} / {{ uploadQueue.length }} hochgeladen
          </span>
          <button
            v-if="!uploading"
            type="button"
            class="btn btn-ghost btn-sm"
            @click="uploadQueue = []"
          >
            Liste leeren
          </button>
        </div>
        <ul class="sb-upload-list">
          <li v-for="item in uploadQueue" :key="item.id" class="sb-upload-item">
            <span class="sb-upload-name">{{ item.name }}</span>
            <span class="mono small muted">{{ formatBytes(item.size) }}</span>
            <span v-if="item.status === 'pending'" class="badge tone-neutral">Wartend</span>
            <span v-else-if="item.status === 'uploading'" class="badge tone-info">Lädt…</span>
            <span v-else-if="item.status === 'done'" class="badge tone-success">Fertig</span>
            <span v-else class="badge tone-danger" :title="item.error">{{ item.error || 'Fehler' }}</span>
          </li>
        </ul>
      </div>
    </section>

    <div v-if="editing" class="modal-backdrop" @click.self="editing = null">
      <div class="card modal-card">
        <h3>Sound bearbeiten</h3>
        <label class="field">
          <span>Name</span>
          <input v-model="editName" type="text" maxlength="80" />
        </label>
        <label class="field">
          <span>Kategorie</span>
          <select v-model="editKind">
            <option value="sfx">SFX</option>
            <option value="music">Musik</option>
          </select>
        </label>
        <label class="field">
          <span>Pegel ({{ editGain }} dB)</span>
          <input v-model.number="editGain" type="range" min="-30" max="12" step="1" />
        </label>
        <label class="field">
          <span>Farbe</span>
          <input v-model="editColor" type="color" />
        </label>
        <label class="field">
          <span>Hotkey (1–9, Q–P)</span>
          <input v-model="editHotkey" type="text" maxlength="1" />
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" @click="editing = null">Abbrechen</button>
          <button type="button" class="btn btn-primary" @click="saveEdit">Speichern</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.soundboard-page { display: grid; gap: 1rem; }
.sb-header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem; }
.sb-header-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.sb-sliders { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; }
.sb-slider { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.9rem; }
.sb-section-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; }
.sb-music-title-wrap { display: flex; align-items: center; gap: 0.5rem; }
.sb-music-controls { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.sb-ctrl-btn { display: inline-flex; align-items: center; gap: 0.35rem; }
.sb-pad-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.75rem; }
.sb-pad-wrap { position: relative; }
.sb-pad {
  position: relative;
  overflow: hidden;
  width: 100%;
  min-height: 76px;
  padding: 0.65rem;
  border-radius: var(--radius-md, 8px);
  border: 1px solid color-mix(in srgb, var(--pad-color, #22d3ee) 55%, transparent);
  background: color-mix(in srgb, var(--pad-color, #22d3ee) 14%, var(--elev-2, #181c24));
  color: inherit;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  text-align: left;
  cursor: pointer;
}
.sb-pad.playing {
  box-shadow: 0 0 0 2px var(--pad-color, #22d3ee);
  background: color-mix(in srgb, var(--pad-color, #22d3ee) 28%, var(--elev-2, #181c24));
}
.sb-pad-top { display: flex; justify-content: space-between; font-size: 0.75rem; opacity: 0.85; }
.sb-hotkey { padding: 0 0.3rem; border-radius: 4px; background: rgba(255,255,255,0.12); }
.sb-pad-name { font-size: 0.92rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sb-pad-tools { position: absolute; right: 4px; bottom: 4px; display: flex; gap: 2px; opacity: 0.7; }
.sb-music-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.4rem; }
.sb-music-row { display: flex; align-items: center; gap: 0.65rem; padding: 0.45rem 0.7rem; border-radius: var(--radius-md, 8px); background: var(--elev-2, rgba(255,255,255,0.03)); transition: background 0.15s ease; }
.sb-music-row:hover { background: rgba(255,255,255,0.06); }
.sb-music-row.active { outline: 1px solid var(--accent, #22d3ee); background: rgba(34, 211, 238, 0.08); }
.sb-music-play { flex: 1; min-width: 0; display: flex; align-items: center; gap: 0.6rem; text-align: left; background: none; border: 0; color: inherit; cursor: pointer; font-weight: 500; }
.sb-track-num { font-size: 0.8rem; width: 1.5rem; flex-shrink: 0; }
.sb-track-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sb-track-dur { font-size: 0.85rem; }
.sb-now-playing { display: flex; flex-direction: column; gap: 8px; padding: 0.75rem 0.9rem; margin-bottom: 0.75rem; border-radius: var(--radius-md, 8px); border: 1px solid rgba(34, 211, 238, 0.25); background: rgba(34, 211, 238, 0.08); }
.sb-now-playing-row { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; }
.sb-now-track { display: flex; align-items: center; gap: 0.6rem; min-width: 0; }
.sb-now-track strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sb-now-time { font-size: 0.85rem; flex-shrink: 0; }
.sb-eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 14px; }
.sb-eq span { width: 3px; border-radius: 2px; background: var(--accent, #22d3ee); animation: sbEq 0.9s ease-in-out infinite alternate; }
.sb-eq span:nth-child(1) { height: 6px; animation-delay: 0s; }
.sb-eq span:nth-child(2) { height: 13px; animation-delay: 0.2s; }
.sb-eq span:nth-child(3) { height: 9px; animation-delay: 0.4s; }
.sb-eq.paused span { animation-play-state: paused; opacity: 0.5; }
@keyframes sbEq { from { height: 4px; } to { height: 14px; } }
.sb-music-progress-track { height: 5px; border-radius: 999px; background: rgba(255,255,255,0.12); overflow: hidden; }
.sb-music-progress-fill { height: 100%; background: var(--accent, #22d3ee); transition: width 0.2s linear; }
.sb-pad-progress { position: absolute; left: 0; bottom: 0; height: 3px; background: var(--pad-color, #22d3ee); transition: width 0.2s linear; }
.sb-upload { border: 1px dashed var(--card-border, rgba(255,255,255,0.14)); transition: border-color 0.15s ease, background 0.15s ease; }
.sb-upload.drag-over { border-color: var(--accent, #22d3ee); background: rgba(34, 211, 238, 0.06); }
.sb-upload-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem; }
.sb-upload-intro { display: flex; align-items: center; gap: 0.85rem; }
.sb-upload-icon { width: 42px; height: 42px; border-radius: 10px; display: grid; place-items: center; background: rgba(34, 211, 238, 0.12); color: var(--accent, #22d3ee); flex-shrink: 0; }
.sb-upload-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 0.65rem; }
.sb-kind-switch { display: inline-flex; gap: 4px; padding: 3px; border-radius: 8px; background: var(--elev-2, rgba(255,255,255,0.04)); }
.sb-file-btn { cursor: pointer; }
.sb-file-btn.disabled { opacity: 0.6; pointer-events: none; }
.sb-upload-queue { margin-top: 0.9rem; padding-top: 0.75rem; border-top: 1px solid var(--card-border, rgba(255,255,255,0.08)); }
.sb-upload-queue-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
.sb-upload-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.35rem; }
.sb-upload-item { display: flex; align-items: center; gap: 0.65rem; padding: 0.35rem 0.6rem; border-radius: 6px; background: var(--elev-2, rgba(255,255,255,0.03)); }
.sb-upload-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.88rem; }
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: grid; place-items: center; z-index: 60; padding: 1rem; }
.modal-card { width: min(420px, 100%); display: grid; gap: 0.75rem; }
.field { display: grid; gap: 0.25rem; }
.modal-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
</style>
