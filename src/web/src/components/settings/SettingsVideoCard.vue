<script setup lang="ts">
import type { VideoEncoderSetting, VideoPreset, VideoTuneSetting } from '@/src/api/types';

interface VideoModel {
  resolution: string;
  fps: number;
  video_bitrate: number;
  audio_bitrate: number;
  preset: VideoPreset;
  tune?: VideoTuneSetting;
  encoder: VideoEncoderSetting;
}

interface SourceModel {
  reencode: 'off' | 'always' | 'on_reconnect';
}

defineProps<{
  video: VideoModel;
  source: SourceModel;
  resolutions: string[];
  presets: { value: VideoPreset; label: string }[];
  tunes: { value: VideoTuneSetting; label: string }[];
  encoders: { value: VideoEncoderSetting; label: string }[];
  dirty: boolean;
  saving: boolean;
  busySaving: boolean;
}>();

defineEmits<{
  (e: 'save'): void;
}>();
</script>

<template>
  <section id="settings-video" class="card settings-section" tabindex="-1">
    <div class="card-head">
      <div>
        <h2 class="card-title">Video</h2>
      </div>
      <div class="settings-section-actions">
        <span v-if="dirty" class="badge tone-warning">Ungespeichert</span>
        <span class="badge tone-warning">Neustart erforderlich</span>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          aria-label="Video speichern"
          :disabled="!dirty || busySaving"
          @click="$emit('save')"
        >
          <span v-if="saving" class="spinner" aria-hidden="true"></span>
          Speichern
        </button>
      </div>
    </div>
    <div class="settings-body">
      <div class="settings-grid">
        <div class="field">
          <label for="video-resolution">Auflösung</label>
          <select id="video-resolution" v-model="video.resolution">
            <option v-for="resolution in resolutions" :key="resolution" :value="resolution">
              {{ resolution }}
            </option>
          </select>
          <p class="field-hint">Hochkant: 720x1280 oder 1080x1920 · Querformat: 1280x720 oder 1920x1080</p>
        </div>
        <div class="field">
          <label for="video-fps">FPS</label>
          <input id="video-fps" v-model.number="video.fps" type="number" min="1" max="60" />
        </div>
        <div class="field">
          <label for="video-bitrate">Video-Bitrate (kbit/s)</label>
          <input id="video-bitrate" v-model.number="video.video_bitrate" type="number" min="500" max="50000" />
        </div>
        <div class="field">
          <label for="audio-bitrate">Audio-Bitrate (kbit/s)</label>
          <input id="audio-bitrate" v-model.number="video.audio_bitrate" type="number" min="32" max="320" />
        </div>
        <div class="field">
          <label for="video-preset">Encoder-Preset</label>
          <select id="video-preset" v-model="video.preset">
            <option v-for="preset in presets" :key="preset.value" :value="preset.value">
              {{ preset.label }}
            </option>
          </select>
          <p class="field-hint">Schnellere Presets reduzieren die CPU-Last.</p>
        </div>
        <div class="field">
          <label for="video-tune">H.264 Tune</label>
          <select id="video-tune" v-model="video.tune">
            <option v-for="tune in tunes" :key="tune.value" :value="tune.value">
              {{ tune.label }}
            </option>
          </select>
          <p class="field-hint">
            „Aus“ ermöglicht B-Frames und Lookahead für bessere Kompressionseffizienz bei gleicher Bitrate.
          </p>
        </div>
        <div class="field">
          <label for="video-encoder">Video-Encoder</label>
          <select id="video-encoder" v-model="video.encoder">
            <option v-for="encoder in encoders" :key="encoder.value" :value="encoder.value">
              {{ encoder.label }}
            </option>
          </select>
          <p class="field-hint">
            Auto nutzt die GPU, wenn der Encoder beim Start verfügbar ist; sonst libx264.
            Ein nicht verfügbarer Encoder fällt automatisch auf libx264 zurück (siehe Logs).
          </p>
        </div>
        <div class="field">
          <label for="source-reencode">Quellen-Re-Encoding</label>
          <select id="source-reencode" v-model="source.reencode">
            <option value="on_reconnect">Nur bei Reconnect (empfohlen)</option>
            <option value="always">Immer</option>
            <option value="off">Nie (Copy)</option>
          </select>
          <p class="field-hint">Verhindert Mid-GOP-Ruckler beim Neustart der TikTok-Quelle.</p>
        </div>
      </div>
    </div>
  </section>
</template>
