<script setup lang="ts">
import type { DiscoveryHit, Streamer } from '@/src/api/types';
import { resolveAvatarSrc } from '@/src/composables/useAvatarFallback';

const props = defineProps<{
  hit: DiscoveryHit;
  actionBusy: string | null;
  existingStreamer: Streamer | undefined;
  failedAvatars: Set<string>;
}>();

const emit = defineEmits<{
  (e: 'preview', handle: string): void;
  (e: 'add', hit: DiscoveryHit): void;
  (e: 'activate', streamer: Streamer): void;
  (e: 'queue', hit: DiscoveryHit): void;
  (e: 'switch', hit: DiscoveryHit): void;
  (e: 'avatarError', handle: string): void;
}>();

function avatarSrc(): string | null {
  return resolveAvatarSrc(props.hit.avatar_url, props.failedAvatars.has(props.hit.handle));
}

function isFallbackAvatar(): boolean {
  return !props.hit.avatar_url || props.failedAvatars.has(props.hit.handle);
}
</script>

<template>
  <article
    class="card hit-card"
    :class="{ 'is-live': hit.live, 'is-busy': actionBusy?.includes(hit.handle) }"
    role="listitem"
  >
    <div class="hit-header">
      <div class="avatar-wrap">
        <img
          v-if="avatarSrc()"
          :src="avatarSrc()!"
          :alt="`Avatar von ${hit.display_name}`"
          class="avatar-img"
          :class="{ 'is-fallback-avatar': isFallbackAvatar() }"
          loading="lazy"
          referrerpolicy="no-referrer"
          @error="emit('avatarError', hit.handle)"
        />
        <div v-else class="avatar-fallback" aria-hidden="true">
          {{ (hit.display_name || hit.handle).slice(0, 2).toUpperCase() }}
        </div>
        <span
          class="status-indicator"
          :class="hit.live ? 'status-live' : 'status-offline'"
          :title="hit.live ? 'Live' : 'Offline'"
        ></span>
      </div>

      <div class="hit-meta">
        <div class="name-row">
          <h2 class="hit-name" :title="hit.display_name">{{ hit.display_name }}</h2>
          <span class="source-tag">{{ hit.source }}</span>
        </div>
        <a
          :href="`https://www.tiktok.com/@${hit.handle}`"
          target="_blank"
          rel="noopener noreferrer"
          class="hit-handle mono"
          :title="`TikTok-Profil öffnen: @${hit.handle}`"
        >
          @{{ hit.handle }}
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
          </svg>
        </a>
      </div>
    </div>

    <div class="hit-body">
      <p v-if="hit.title" class="hit-title" :title="hit.title">
        {{ hit.title }}
      </p>
      <p v-else-if="hit.bio" class="hit-bio">
        {{ hit.bio }}
      </p>
      <p v-else class="hit-title muted italic">
        Kein Raumtitel
      </p>

      <div class="hit-stats mono">
        <span class="badge" :class="hit.live ? 'badge-success' : 'badge-muted'">
          {{ hit.live ? 'LIVE' : 'OFFLINE' }}
        </span>
        <span v-if="hit.viewers !== null" class="viewers-count">
          👥 {{ hit.viewers.toLocaleString('de-DE') }}
        </span>
        <button
          v-if="hit.live"
          type="button"
          class="btn-preview-inline mono"
          title="Im Live-Zapper anschauen und durchzappen"
          @click="emit('preview', hit.handle)"
        >
          👁 Vorschau
        </button>
        <span
          v-if="existingStreamer"
          class="badge"
          :class="existingStreamer.enabled ? 'badge-info' : 'badge-warning'"
        >
          {{ existingStreamer.enabled ? 'IN LISTE (AKTIV)' : 'IN LISTE (AUS)' }}
        </span>
      </div>
    </div>

    <div class="hit-actions">
      <!-- Button 1: Als Streamer speichern / aktivieren -->
      <template v-if="!existingStreamer">
        <button
          type="button"
          class="btn btn-sm btn-outline"
          :disabled="Boolean(actionBusy)"
          @click="emit('add', hit)"
        >
          <span v-if="actionBusy === `add:${hit.handle}`" class="spinner" aria-hidden="true"></span>
          <span>💾 Speichern</span>
        </button>
      </template>
      <template v-else-if="!existingStreamer.enabled">
        <button
          type="button"
          class="btn btn-sm btn-warning"
          :disabled="Boolean(actionBusy)"
          @click="emit('activate', existingStreamer)"
        >
          <span v-if="actionBusy === `activate:${existingStreamer.id}`" class="spinner" aria-hidden="true"></span>
          <span>⚡ Jetzt aktivieren</span>
        </button>
      </template>
      <template v-else>
        <span class="btn btn-sm btn-disabled" aria-disabled="true">
          ✓ Aktiv
        </span>
      </template>

      <!-- Button 2: In Queue -->
      <button
        type="button"
        class="btn btn-sm btn-outline"
        :disabled="Boolean(actionBusy) || !hit.live"
        :title="!hit.live ? 'Nur für aktive Live-Streams verfügbar' : 'Als nächstes Ziel in die Regie-Queue einreihen'"
        @click="emit('queue', hit)"
      >
        <span v-if="actionBusy === `queue:${hit.handle}`" class="spinner" aria-hidden="true"></span>
        <span>⏭ In Queue</span>
      </button>

      <!-- Button 3: Jetzt umschalten -->
      <button
        type="button"
        class="btn btn-sm btn-primary"
        :disabled="Boolean(actionBusy) || !hit.live"
        :title="!hit.live ? 'Nur für aktive Live-Streams verfügbar' : 'Sofort auf diesen Streamer umschalten'"
        @click="emit('switch', hit)"
      >
        <span v-if="actionBusy === `switch:${hit.handle}`" class="spinner" aria-hidden="true"></span>
        <span>▶ Umschalten</span>
      </button>
    </div>
  </article>
</template>

<style scoped>
.hit-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: var(--space-3, 0.75rem);
  border: 1px solid var(--border-color, #2a2a2a);
  border-radius: 2px;
  background: var(--bg-card, #141414);
  transition: border-color 0.15s ease;
}

.hit-card.is-live {
  border-left: 3px solid var(--color-success, #22c55e);
}

.hit-card:hover {
  border-color: var(--border-hover, #444);
}

.hit-header {
  display: flex;
  gap: var(--space-3, 0.75rem);
  align-items: center;
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

.status-offline {
  background-color: var(--text-muted, #666);
}

.hit-meta {
  flex: 1;
  min-width: 0;
}

.name-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.hit-name {
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.source-tag {
  font-size: 0.65rem;
  font-family: var(--font-mono, monospace);
  padding: 0.1rem 0.35rem;
  border-radius: 2px;
  background: var(--bg-surface, #1e1e1e);
  color: var(--text-muted, #888);
  border: 1px solid var(--border-color, #333);
  text-transform: uppercase;
}

.hit-handle {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.78rem;
  color: var(--color-accent, #38bdf8);
  text-decoration: none;
  margin-top: 0.15rem;
}

.hit-handle:hover {
  text-decoration: underline;
}

.hit-body {
  margin: var(--space-2, 0.5rem) 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.hit-title,
.hit-bio {
  font-size: 0.82rem;
  margin: 0 0 0.5rem;
  line-height: 1.35;
  color: var(--text-primary, #ddd);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.hit-stats {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.75rem;
  flex-wrap: wrap;
}

.viewers-count {
  color: var(--text-primary, #ddd);
}

.btn-preview-inline {
  background: rgba(56, 189, 248, 0.12);
  border: 1px solid rgba(56, 189, 248, 0.35);
  color: #38bdf8;
  font-size: 0.72rem;
  padding: 0.12rem 0.45rem;
  border-radius: 2px;
  cursor: pointer;
}

.btn-preview-inline:hover {
  background: rgba(56, 189, 248, 0.24);
}

.hit-actions {
  display: flex;
  gap: 0.35rem;
  margin-top: 0.5rem;
}

.hit-actions .btn {
  flex: 1;
  font-size: 0.75rem;
  padding: 0.3rem 0.4rem;
  justify-content: center;
}
</style>
