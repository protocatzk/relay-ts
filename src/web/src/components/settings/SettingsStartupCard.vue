<script setup lang="ts">
import type { PauseAsset } from '@/src/api/types';
import ToggleField from '@/src/components/ToggleField.vue';

interface StartupModel {
  enabled: boolean;
  duration_seconds: number;
  text: string;
  subtext: string;
  color: string;
  text_color: string;
  fit: 'cover' | 'contain' | 'stretch';
  background: string;
  font: string;
}

defineProps<{
  startup: StartupModel;
  dirty: boolean;
  saving: boolean;
  busySaving: boolean;
  pauseUploading: 'background' | 'font' | null;
  startupAsset: PauseAsset | null;
  startupPreviewSource: string;
  startupPreviewIsVideo: boolean;
  startupAssetMetadata: string;
  startupComposedUrl: string;
}>();

defineEmits<{
  (e: 'save'): void;
  (e: 'uploadAsset', kind: 'background' | 'font', event: Event): void;
  (e: 'removeAsset', kind: 'background' | 'font'): void;
}>();
</script>

<template>
  <section id="settings-startup" class="card settings-section" tabindex="-1">
    <div class="card-head">
      <div>
        <h2 class="card-title">Startbildschirm</h2>
        <p class="card-sub">Vor dem ersten Live-Bild nach dem Start.</p>
      </div>
      <div class="settings-section-actions">
        <span v-if="dirty" class="badge tone-warning">Ungespeichert</span>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          aria-label="Startbildschirm speichern"
          :disabled="!dirty || busySaving"
          @click="$emit('save')"
        >
          <span v-if="saving" class="spinner" aria-hidden="true"></span>
          Speichern
        </button>
      </div>
    </div>
    <div class="settings-body">
      <ToggleField
        v-model="startup.enabled"
        label="Startbildschirm aktiviert"
      />
      <div class="settings-grid">
        <div class="field">
          <label for="startup-duration">Dauer (Sekunden, 0 = aus)</label>
          <input id="startup-duration" v-model.number="startup.duration_seconds" type="number" min="0" max="300" />
        </div>
        <div class="field">
          <label for="startup-text">Haupttext</label>
          <input id="startup-text" v-model="startup.text" type="text" maxlength="200" />
        </div>
        <div class="field">
          <label for="startup-subtext">Untertext</label>
          <input id="startup-subtext" v-model="startup.subtext" type="text" maxlength="200" />
        </div>
        <div class="field">
          <label for="startup-color">Hintergrundfarbe (Fallback)</label>
          <input id="startup-color" v-model="startup.color" type="text" spellcheck="false" placeholder="0x101820" />
        </div>
        <div class="field">
          <label for="startup-text-color">Textfarbe</label>
          <input id="startup-text-color" v-model="startup.text_color" type="text" spellcheck="false" placeholder="white" />
        </div>
        <div class="field">
          <label for="startup-fit">Bildanpassung</label>
          <select id="startup-fit" v-model="startup.fit">
            <option value="cover">Ausfüllen (cover, beschneidet)</option>
            <option value="contain">Einpassen (contain, Ränder)</option>
            <option value="stretch">Strecken (exakt füllen)</option>
          </select>
        </div>
        <div class="field field-span-2">
          <label for="startup-background">Hintergrundbild oder -video</label>
          <input
            id="startup-background"
            v-model="startup.background"
            type="text"
            spellcheck="false"
            placeholder="/app/data/pause/starting-soon.mp4"
          />
          <div class="pause-upload-row">
            <label class="btn btn-ghost btn-sm">
              <input
                class="sr-only"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,video/mp4,video/webm,video/quicktime,video/x-matroska"
                @change="$emit('uploadAsset', 'background', $event)"
              />
              Hintergrund hochladen
            </label>
            <select
              class="btn btn-ghost btn-sm select-template"
              aria-label="RELAY Vorlage auswählen"
              @change="(e) => {
                const val = (e.target as HTMLSelectElement).value;
                if (val) {
                  startup.background = val;
                  (e.target as HTMLSelectElement).value = '';
                }
              }"
            >
              <option value="" disabled selected>🎨 RELAY-Vorlage wählen…</option>
              <optgroup label="Hochformat (9:16 / 720x1280)">
                <option value="/srv/relay/current/web/dist/slates/relay-startup-vertical-720x1280.png">Startbildschirm (PNG)</option>
                <option value="/srv/relay/current/web/dist/slates/relay-slate-vertical-720x1280.png">Neutrales Slate (PNG)</option>
              </optgroup>
              <optgroup label="Querformat (16:9 / 1280x720)">
                <option value="/srv/relay/current/web/dist/slates/relay-startup-horizontal-1280x720.png">Startbildschirm (PNG)</option>
                <option value="/srv/relay/current/web/dist/slates/relay-slate-horizontal-1280x720.png">Neutrales Slate (PNG)</option>
              </optgroup>
            </select>
            <button
              v-if="startup.background"
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="pauseUploading !== null"
              @click="$emit('removeAsset', 'background')"
            >
              Entfernen
            </button>
            <span v-if="pauseUploading === 'background'" class="muted small">Lädt hoch…</span>
          </div>
          <div v-if="startupPreviewSource" class="pause-preview">
            <video
              v-if="startupPreviewIsVideo"
              :src="startupPreviewSource"
              controls
              muted
              loop
              playsinline
              preload="metadata"
            ></video>
            <img v-else :src="startupPreviewSource" alt="Startbildschirm-Vorschau" />
          </div>
          <p v-if="startupAssetMetadata && startupAsset?.kind !== 'font'" class="field-hint mono">
            {{ startupAssetMetadata }}
          </p>
          <p v-if="startupComposedUrl" class="field-hint">Vorschau mit Text (noch nicht gespeichert):</p>
          <div v-if="startupComposedUrl" class="pause-preview">
            <img :src="startupComposedUrl" alt="Startbildschirm-Vorschau mit Text" />
          </div>
        </div>
        <div class="field">
          <label for="startup-font">Schriftdatei (TTF/OTF)</label>
          <input
            id="startup-font"
            v-model="startup.font"
            type="text"
            spellcheck="false"
            placeholder="/app/data/pause/font.ttf"
          />
          <div class="pause-upload-row">
            <label class="btn btn-ghost btn-sm">
              <input
                class="sr-only"
                type="file"
                accept=".ttf,.otf,font/ttf,font/otf"
                @change="$emit('uploadAsset', 'font', $event)"
              />
              Schrift hochladen
            </label>
            <button
              v-if="startup.font"
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="pauseUploading !== null"
              @click="$emit('removeAsset', 'font')"
            >
              Entfernen
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
