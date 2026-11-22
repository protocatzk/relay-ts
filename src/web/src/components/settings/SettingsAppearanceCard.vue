<script setup lang="ts">
import { computed } from 'vue';
import { desktopNavSide, setDesktopNavSide, type DesktopNavSide } from '@/src/navigation';
import {
  DEFAULT_AVATAR_SVG_URL,
  RELAY_LOGO_AVATAR_URL,
  avatarFallbackCustomUrl,
  avatarFallbackMode,
  resolvedFallbackAvatarUrl,
  setAvatarFallbackCustomUrl,
  setAvatarFallbackMode,
  type AvatarFallbackMode,
} from '@/src/composables/useAvatarFallback';

const side = computed<DesktopNavSide>({
  get: () => desktopNavSide.value,
  set: (val) => setDesktopNavSide(val),
});

const fallbackMode = computed<AvatarFallbackMode>({
  get: () => avatarFallbackMode.value,
  set: (val) => setAvatarFallbackMode(val),
});

const customAvatarUrl = computed<string>({
  get: () => avatarFallbackCustomUrl.value,
  set: (val) => setAvatarFallbackCustomUrl(val),
});

const previewSrc = computed(() => resolvedFallbackAvatarUrl.value);
</script>

<template>
  <section id="settings-appearance" class="card settings-section" tabindex="-1">
    <div class="card-head">
      <div>
        <h2 class="card-title">Erscheinungsbild &amp; Navigation</h2>
      </div>
    </div>
    <div class="settings-body">
      <div class="settings-grid">
        <div class="field">
          <label for="desktop-nav-side">Desktop-Navigation (Pille)</label>
          <select id="desktop-nav-side" v-model="side">
            <option value="left">Links (Standard)</option>
            <option value="right">Rechts</option>
          </select>
          <p class="field-hint">
            Positioniert die Navigations-Pille am linken oder rechten Bildschirmrand auf Desktop-Monitoren (&gt; 720px). Auf Mobilgeräten bleibt die Leiste am unteren Rand.
          </p>
        </div>

        <div class="field">
          <label for="avatar-fallback-mode">Fallback-Avatar (bei fehlendem Profilbild)</label>
          <div class="avatar-setting-row">
            <select id="avatar-fallback-mode" v-model="fallbackMode">
              <option value="svg">Generisches Streamer-SVG (Standard)</option>
              <option value="logo">RELAY-Logo</option>
              <option value="initials">Initialen (Buchstaben)</option>
              <option value="custom">Eigenes Bild / URL</option>
            </select>
            <div class="avatar-preview-box" title="Vorschau des Fallback-Avatars">
              <img
                v-if="previewSrc"
                :src="previewSrc"
                alt="Fallback-Avatar Vorschau"
                class="avatar-preview-img"
                @error="($event.target as HTMLImageElement).src = DEFAULT_AVATAR_SVG_URL"
              />
              <span v-else class="avatar-preview-initials mono">ST</span>
            </div>
          </div>
          <p class="field-hint">
            Wird nur als Fallback angezeigt, wenn ein Streamer-Avatar fehlt oder vom TikTok-CDN nicht geladen werden kann.
          </p>
        </div>

        <div v-if="fallbackMode === 'custom'" class="field field-span-2">
          <label for="avatar-fallback-custom-url">Eigene Fallback-Avatar-URL oder Pfad</label>
          <div class="input-badge-row">
            <input
              id="avatar-fallback-custom-url"
              v-model="customAvatarUrl"
              type="text"
              spellcheck="false"
              placeholder="https://… oder /logo.png oder data:image/svg+xml;…"
            />
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              @click="customAvatarUrl = DEFAULT_AVATAR_SVG_URL"
            >
              Streamer-SVG
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              @click="customAvatarUrl = RELAY_LOGO_AVATAR_URL"
            >
              RELAY-Logo
            </button>
          </div>
          <p class="field-hint">
            Beliebige Bild-/SVG-URL oder lokaler Pfad (z. B. <code>/avatar-fallback.svg</code>, <code>/logo.svg</code>, <code>/logo.png</code>).
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.avatar-setting-row {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.avatar-setting-row select {
  flex: 1;
}

.avatar-preview-box {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  border: 1px solid var(--border-color, #333);
  background: var(--bg-surface, #1a1a1f);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

.avatar-preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-preview-initials {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--text-muted, #aaa);
}
</style>
