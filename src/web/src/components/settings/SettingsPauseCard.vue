<script setup lang="ts">
import type { PauseAsset } from '@/src/api/types';
import ToggleField from '@/src/components/ToggleField.vue';

interface PauseModel {
  enabled: boolean;
  text: string;
  subtext: string;
  max_minutes: number;
  grace_seconds: number;
  disconnect_max_minutes?: number;
  disconnect_asset?: string;
  background: string;
  font: string;
  text_color: string;
  color: string;
  fit: 'cover' | 'contain' | 'stretch';
}

defineProps<{
  pause: PauseModel;
  dirty: boolean;
  saving: boolean;
  busySaving: boolean;
  pauseUploading: 'background' | 'font' | null;
  pauseAsset: PauseAsset | null;
  pausePreviewSource: string;
  pausePreviewIsVideo: boolean;
  pauseAssetMetadata: string;
  pauseComposedUrl: string;
  composedPreviewError: string;
}>();

defineEmits<{
  (e: 'save'): void;
  (e: 'uploadAsset', kind: 'background' | 'font', event: Event): void;
  (e: 'removeAsset', kind: 'background' | 'font'): void;
}>();
</script>

<template>
  <section id="settings-pause" class="card settings-section" tabindex="-1">
    <div class="card-head">
      <div>
        <h2 class="card-title">Pause</h2>
      </div>
      <div class="settings-section-actions">
        <span v-if="dirty" class="badge tone-warning">Ungespeichert</span>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          aria-label="Pause speichern"
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
        v-model="pause.enabled"
        label="Pause-Funktion aktiviert"
      />
      <div class="settings-grid">
        <div class="field">
          <label for="pause-text">Haupttext</label>
          <input id="pause-text" v-model="pause.text" type="text" placeholder="Stream pausiert" maxlength="200" />
        </div>
        <div class="field">
          <label for="pause-subtext">Untertext</label>
          <input id="pause-subtext" v-model="pause.subtext" type="text" placeholder="Wir sind gleich zurück." maxlength="200" />
        </div>
        <div class="field">
          <label for="pause-max">Maximale Pausendauer (Minuten, 0 = unbegrenzt)</label>
          <input id="pause-max" v-model.number="pause.max_minutes" type="number" min="0" max="1440" />
        </div>
        <div class="field">
          <label for="pause-grace">Pausenscreen-Verzögerung (Sekunden)</label>
          <input id="pause-grace" v-model.number="pause.grace_seconds" type="number" min="0" max="60" />
          <p class="field-hint">Kurze Unterbrechungen werden überbrückt, bevor der Pausenscreen übernimmt.</p>
        </div>
        <div class="field field-span-2">
          <label for="pause-background">Hintergrundbild oder -video</label>
          <input
            id="pause-background"
            v-model="pause.background"
            type="text"
            spellcheck="false"
            placeholder="z. B. /app/data/pause/background.webm oder https://…/loop.webm"
          />
          <p class="field-hint">
            PNG/JPG/WebP/GIF/MP4/WebM; SVG nur statisch. Leer = Hintergrundfarbe.
          </p>
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
                  pause.background = val;
                  (e.target as HTMLSelectElement).value = '';
                }
              }"
            >
              <option value="" disabled selected>🎨 RELAY-Vorlage wählen…</option>
              <optgroup label="Hochformat (9:16 / 720x1280)">
                <option value="/srv/relay/current/web/dist/slates/relay-pause-vertical-720x1280.mp4">Pausenscreen (MP4 Loop)</option>
                <option value="/srv/relay/current/web/dist/slates/relay-pause-vertical-720x1280.png">Pausenscreen (PNG)</option>
                <option value="/srv/relay/current/web/dist/slates/relay-slate-vertical-720x1280.png">Neutrales Slate (PNG)</option>
              </optgroup>
              <optgroup label="Querformat (16:9 / 1280x720)">
                <option value="/srv/relay/current/web/dist/slates/relay-pause-horizontal-1280x720.mp4">Standard Pause (MP4 Loop)</option>
                <option value="/srv/relay/current/web/dist/slates/relay-pause-horizontal-1280x720.png">Standard Pause (PNG)</option>
                <option value="/srv/relay/current/web/dist/slates/relay-pause-studio-1280x720.mp4">Studio Pause (MP4 Loop)</option>
                <option value="/srv/relay/current/web/dist/slates/relay-pause-studio-1280x720.png">Studio Pause (PNG)</option>
                <option value="/srv/relay/current/web/dist/slates/relay-pause-cyber-1280x720.mp4">Cyber / Neon Pause (MP4 Loop)</option>
                <option value="/srv/relay/current/web/dist/slates/relay-pause-cyber-1280x720.png">Cyber / Neon Pause (PNG)</option>
                <option value="/srv/relay/current/web/dist/slates/relay-slate-horizontal-1280x720.png">Neutrales Slate (PNG)</option>
              </optgroup>
            </select>
            <button
              v-if="pause.background"
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="pauseUploading !== null"
              @click="$emit('removeAsset', 'background')"
            >
              Entfernen
            </button>
            <span v-if="pauseUploading === 'background'" class="muted small">Lädt hoch…</span>
          </div>
          <div v-if="pausePreviewSource" class="pause-preview">
            <video
              v-if="pausePreviewIsVideo"
              :src="pausePreviewSource"
              controls
              muted
              loop
              playsinline
              preload="metadata"
            ></video>
            <img v-else :src="pausePreviewSource" alt="Pausen-Hintergrund-Vorschau" />
          </div>
          <p v-if="pauseAssetMetadata && pauseAsset?.kind !== 'font'" class="field-hint mono">
            {{ pauseAssetMetadata }}
          </p>
          <p v-if="pauseAsset?.warning" class="alert alert-warn">{{ pauseAsset.warning }}</p>
          <p v-if="pauseComposedUrl" class="field-hint">Vorschau mit Text (noch nicht gespeichert):</p>
          <div v-if="pauseComposedUrl" class="pause-preview">
            <img :src="pauseComposedUrl" alt="Pausenscreen-Vorschau mit Text" />
          </div>
          <p v-if="composedPreviewError" class="field-hint mono">{{ composedPreviewError }}</p>
        </div>
        <div class="field">
          <label for="pause-font">Schriftdatei (TTF/OTF)</label>
          <input
            id="pause-font"
            v-model="pause.font"
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
              v-if="pause.font"
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="pauseUploading !== null"
              @click="$emit('removeAsset', 'font')"
            >
              Entfernen
            </button>
            <span v-if="pauseUploading === 'font'" class="muted small">Lädt hoch…</span>
          </div>
          <p v-if="pauseAsset?.kind === 'font'" class="field-hint mono">
            {{ pauseAsset.filename }} · {{ Math.round(pauseAsset.size / 1024) }} KB
          </p>
        </div>
        <div class="field">
          <label for="pause-text-color">Textfarbe</label>
          <input id="pause-text-color" v-model="pause.text_color" type="text" placeholder="white" spellcheck="false" />
        </div>
        <div class="field">
          <label for="pause-color">Hintergrundfarbe (Fallback)</label>
          <input id="pause-color" v-model="pause.color" type="text" spellcheck="false" placeholder="0x101820" />
        </div>
        <div class="field">
          <label for="pause-fit">Bildanpassung</label>
          <select id="pause-fit" v-model="pause.fit">
            <option value="cover">Ausfüllen (cover, beschneidet)</option>
            <option value="contain">Einpassen (contain, Ränder)</option>
            <option value="stretch">Strecken (exakt füllen)</option>
          </select>
        </div>
        <div class="field">
          <label for="pause-disconnect-max">Disconnect-Protection Max (Min., 0 = unbegrenzt)</label>
          <input
            id="pause-disconnect-max"
            v-model.number="pause.disconnect_max_minutes"
            type="number"
            min="0"
            max="1440"
          />
          <p class="field-hint">Maximale Überbrückungszeit bei plötzlichem Verbindungsabbruch.</p>
        </div>
        <div class="field">
          <label for="pause-disconnect-asset">Disconnect-Slate (optional, leer = Standard-Slate)</label>
          <input
            id="pause-disconnect-asset"
            v-model="pause.disconnect_asset"
            type="text"
            spellcheck="false"
            placeholder="/app/data/pause/disconnect.png"
          />
        </div>
      </div>
    </div>
  </section>
</template>
