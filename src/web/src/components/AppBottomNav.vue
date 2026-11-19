<script setup lang="ts">
import { useRoute } from 'vue-router';

interface NavSegment {
  d: string;
  fill?: boolean;
}

interface NavItem {
  to: string;
  label: string;
  segments: NavSegment[];
}

const route = useRoute();

const ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    segments: [{ d: 'M3.5 3.5h7v7h-7zM13.5 3.5h7v7h-7zM3.5 13.5h7v7h-7zM13.5 13.5h7v7h-7z' }],
  },
  {
    to: '/streamers',
    label: 'Streamer',
    segments: [{ d: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 21v-1a6 6 0 0 1 12 0v1' }],
  },
  {
    to: '/overlays',
    label: 'Overlays',
    segments: [{ d: 'M3 4h18v12H3zM8 21h8M12 17v4' }],
  },
  {
    to: '/playlists',
    label: 'Playlists',
    segments: [
      { d: 'M4 6h16M4 12h10M4 18h7' },
      { d: 'M16 14l5 3-5 3z', fill: true },
    ],
  },
  {
    to: '/youtube',
    label: 'YouTube',
    segments: [
      { d: 'M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z' },
      { d: 'M10 9l6 3-6 3z', fill: true },
    ],
  },
  {
    to: '/media',
    label: 'Medien',
    segments: [
      {
        d: 'M3 7a2 2 0 0 1 2-2h3l2-2h4l2 2h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
      },
    ],
  },
  {
    to: '/settings',
    label: 'Einstellungen',
    segments: [{ d: 'M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M6 16v4' }],
  },
  {
    to: '/logs',
    label: 'Logs',
    segments: [{ d: 'M4 4h16v16H4zM7 9l3 3-3 3M13 15h4' }],
  },
];

function isActive(path: string): boolean {
  return path === '/' ? route.path === '/' : route.path.startsWith(path);
}
</script>

<template>
  <nav class="bottom-nav" aria-label="Hauptnavigation">
    <RouterLink
      v-for="item in ITEMS"
      :key="item.to"
      :to="item.to"
      class="bnav-item"
      :class="{ 'is-active': isActive(item.to) }"
      :aria-current="isActive(item.to) ? 'page' : undefined"
      :aria-label="item.label"
      :title="item.label"
    >
      <svg class="bnav-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
        <path
          v-for="(segment, index) in item.segments"
          :key="index"
          :d="segment.d"
          :fill="segment.fill ? 'currentColor' : 'none'"
          :stroke="segment.fill ? 'none' : 'currentColor'"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span class="bnav-label">{{ item.label }}</span>
    </RouterLink>
  </nav>
</template>
