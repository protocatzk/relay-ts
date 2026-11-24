<script setup lang="ts">
/** Compact hit row for the cockpit discovery panel (#92). */
import { computed } from 'vue';
import { resolveAvatarSrc } from '@/src/composables/useAvatarFallback';
import { formatNumber } from '@/src/utils/format';
import type { DiscoveryHit, Streamer } from '@/src/api/types';

const props = defineProps<{
  hit: DiscoveryHit;
  existing?: Streamer;
  busy?: boolean;
  failedAvatar?: boolean;
}>();

const emit = defineEmits<{
  queue: [hit: DiscoveryHit];
  switch: [hit: DiscoveryHit];
  add: [hit: DiscoveryHit];
  activate: [streamer: Streamer];
  preview: [hit: DiscoveryHit];
  avatarError: [handle: string];
}>();

const initials = computed(() => {
  const source = props.hit.display_name || props.hit.handle;
  const parts = source.replace(/^@/, '').split(/[\s._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase();
});

const avatarSrc = computed(() =>
  resolveAvatarSrc(props.hit.avatar_url, Boolean(props.failedAvatar)),
);

const viewerLabel = computed(() =>
  props.hit.viewers === null ? null : formatNumber(props.hit.viewers),
);
</script>

<template>
  <li class="hit-row">
    <div class="hit-avatar" aria-hidden="true">
      <img
        v-if="avatarSrc"
        :src="avatarSrc"
        alt=""
        loading="lazy"
        @error="emit('avatarError', hit.handle)"
      />
      <span v-else>{{ initials }}</span>
    </div>

    <div class="hit-body">
      <div class="hit-title">
        <strong>{{ hit.display_name }}</strong>
        <span v-if="hit.live" class="hit-live" aria-label="live">●</span>
        <span v-else class="hit-offline">offline</span>
      </div>
      <p class="hit-meta mono">
        @{{ hit.handle.replace(/^@/, '') }}
        <template v-if="viewerLabel">· ▲ {{ viewerLabel }}</template>
        <template v-if="existing">
          · {{ existing.status.active ? 'aktiv' : existing.enabled ? 'bereit' : 'deaktiviert' }}
        </template>
      </p>
    </div>

    <div class="hit-actions">
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        :disabled="busy || !hit.live"
        :title="hit.live ? 'Als Nächstes in die Regie-Queue' : 'Stream ist offline'"
        aria-label="In die Queue"
        @click="emit('queue', hit)"
      >
        ⏭
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        :disabled="busy || !hit.live"
        :title="hit.live ? 'Sofort auf diesen Stream umschalten' : 'Stream ist offline'"
        aria-label="Umschalten"
        @click="emit('switch', hit)"
      >
        ↪
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        title="Vorhören im Zapper"
        :disabled="busy || !hit.live"
        aria-label="Im Zapper vorhören"
        @click="emit('preview', hit)"
      >
        ⚡
      </button>
      <details class="hit-menu">
        <summary class="btn btn-ghost btn-xs" aria-label="Weitere Aktionen">⋯</summary>
        <div class="hit-menu-list">
          <button type="button" :disabled="busy" @click="emit('preview', hit)">
            Im Zapper öffnen
          </button>
          <button v-if="!existing" type="button" :disabled="busy" @click="emit('add', hit)">
            Als Streamer speichern
          </button>
          <button
            v-else-if="!existing.enabled"
            type="button"
            :disabled="busy"
            @click="emit('activate', existing)"
          >
            Streamer aktivieren
          </button>
          <a v-else :href="`#/streamers`">In Streamer verwalten</a>
        </div>
      </details>
    </div>
  </li>
</template>

<style scoped>
.hit-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
}

.hit-row:hover {
  background: var(--surface-2);
  border-color: var(--border-subtle);
}

.hit-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 34px;
  height: 34px;
  overflow: hidden;
  border-radius: 50%;
  background: var(--surface-3);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.hit-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hit-body {
  min-width: 0;
  flex: 1;
}

.hit-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.hit-title strong {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hit-live {
  color: var(--success);
  font-size: 9px;
}

.hit-offline {
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-dim);
  font-size: 9px;
}

.hit-meta {
  margin: 1px 0 0;
  color: var(--text-dim);
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hit-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}

.hit-actions .btn-xs {
  min-width: 26px;
  padding: 0 5px;
}

.hit-menu {
  position: relative;
}

.hit-menu > summary {
  list-style: none;
  cursor: pointer;
}

.hit-menu > summary::-webkit-details-marker {
  display: none;
}

.hit-menu-list {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  min-width: 190px;
  padding: 4px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  background: var(--surface-1);
  box-shadow: var(--elev-2);
}

.hit-menu-list button,
.hit-menu-list a {
  padding: 7px 9px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
  text-decoration: none;
}

.hit-menu-list button:hover,
.hit-menu-list a:hover {
  background: var(--surface-hover);
  color: var(--text-strong);
}

.hit-menu-list button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
