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
const playingIds = computed(() => new Set((state.value?.playing ?? []).map((p) => p.id)));

const uploading = ref(false);
const uploadKind = ref<SoundKind>('sfx');
const dragOver = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
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
  uploading.value = true;
  try {
    for (const file of Array.from(files)) {
      const res = await api.soundboard.upload(file, { kind: uploadKind.value });
      store.soundboard = res.state;
      pushToast(`„${res.sound.name}“ hochgeladen`, 'success');
    }
  } catch (error) {
    pushToast(errorMessage(error), 'error');
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
              <span class="sb-dur mono">{{ formatDuration(sound.duration) }}</span>
            </span>
            <strong class="sb-pad-name">{{ sound.name }}</strong>
          </button>
          <div class="sb-pad-tools">
            <button type="button" class="btn-icon" title="Bearbeiten" @click="openEdit(sound)">✎</button>
            <button type="button" class="btn-icon" title="Löschen" @click="removeSound(sound)">✕</button>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="sb-section-head">
        <h3>Musikbett ({{ musicSounds.length }})</h3>
        <div class="sb-music-controls">
          <button type="button" class="btn btn-ghost btn-sm" @click="cycleMusicLoop">
            Loop: {{ state?.music?.loop ?? 'all' }}
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="!state?.music"
            @click="toggleMusicPause"
          >
            {{ state?.music?.paused ? 'Fortsetzen' : 'Pause' }}
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="musicSounds.length === 0"
            @click="nextMusic"
          >
            Nächster
          </button>
          <button type="button" class="btn btn-ghost btn-sm" @click="stopAll('music')">
            Musik stoppen
          </button>
        </div>
      </div>
      <div v-if="state?.music" class="sb-now-playing">
        <span>Läuft: <strong>{{ state.music.name }}</strong></span>
        <span class="mono">{{ formatDuration(state.music.position) }} / {{ formatDuration(state.music.duration) }}</span>
      </div>
      <div v-if="musicSounds.length === 0" class="muted sb-empty">
        Noch keine Musiktitel hochgeladen.
      </div>
      <ul v-else class="sb-music-list">
        <li
          v-for="track in musicSounds"
          :key="track.id"
          class="sb-music-row"
          :class="{ active: state?.music?.id === track.id }"
        >
          <button type="button" class="sb-music-play" @click="playSound(track)">
            ▶ {{ track.name }}
          </button>
          <span class="mono muted">{{ formatDuration(track.duration) }}</span>
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
      <div class="sb-upload-row">
        <label>
          Kategorie:
          <select v-model="uploadKind">
            <option value="sfx">SFX (max. 60 s)</option>
            <option value="music">Musik (max. 15 min)</option>
          </select>
        </label>
        <input
          ref="fileInput"
          type="file"
          accept=".mp3,.wav,.ogg,.m4a,.flac,.opus,audio/*"
          multiple
          :disabled="uploading"
          @change="uploadFiles(($event.target as HTMLInputElement).files)"
        />
      </div>
      <p class="muted">Audiodatei hierher ziehen oder auswählen (MP3, WAV, OGG, M4A, FLAC, OPUS · max. 50 MB).</p>
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
.sb-music-controls { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.sb-pad-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.75rem; }
.sb-pad-wrap { position: relative; }
.sb-pad {
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
.sb-music-row { display: flex; align-items: center; gap: 0.75rem; padding: 0.4rem 0.6rem; border-radius: var(--radius-md, 8px); background: var(--elev-2, rgba(255,255,255,0.03)); }
.sb-music-row.active { outline: 1px solid var(--accent, #22d3ee); }
.sb-music-play { flex: 1; text-align: left; background: none; border: 0; color: inherit; cursor: pointer; font-weight: 500; }
.sb-now-playing { display: flex; justify-content: space-between; padding: 0.5rem 0.75rem; margin-bottom: 0.5rem; border-radius: var(--radius-md, 8px); background: rgba(34, 211, 238, 0.1); }
.sb-upload.drag-over { outline: 2px dashed var(--accent, #22d3ee); }
.sb-upload-row { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; margin-bottom: 0.5rem; }
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: grid; place-items: center; z-index: 60; padding: 1rem; }
.modal-card { width: min(420px, 100%); display: grid; gap: 0.75rem; }
.field { display: grid; gap: 0.25rem; }
.modal-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
</style>
