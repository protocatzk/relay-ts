<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import {
  SECTIONS,
  desktopNavSide,
  sectionEntry,
  sectionFor,
} from '@/src/navigation';
import { prefetchPath } from '@/src/router/prefetch';
import { useStore } from '@/src/composables/useStore';

const { store } = useStore();

/** Green dot while the sink is on air (#88). */
const streaming = computed(() => {
  const status = store.status;
  return Boolean(status && status.state === 'live' && status.sink.running);
});

const route = useRoute();

const activeSection = computed(() => sectionFor(route.meta.section)?.id ?? null);

// Tapping a section opens the sub-page last visited in that section.
const entries = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  for (const section of SECTIONS) map[section.id] = sectionEntry(section);
  return map;
});

function onKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (!target || !target.classList.contains('bnav-item')) return;

  const items = Array.from(
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLAnchorElement>('.bnav-item')
  );
  const currentIndex = items.indexOf(target as HTMLAnchorElement);
  if (currentIndex === -1) return;

  let nextIndex = -1;
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    nextIndex = (currentIndex + 1) % items.length;
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    nextIndex = (currentIndex - 1 + items.length) % items.length;
  } else if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = items.length - 1;
  }

  if (nextIndex !== -1) {
    event.preventDefault();
    items[nextIndex]?.focus();
  }
}
</script>

<template>
  <nav
    class="bottom-nav"
    :class="`side-${desktopNavSide}`"
    aria-label="Hauptnavigation"
    @keydown="onKeydown"
  >
    <RouterLink
      v-for="section in SECTIONS"
      :key="section.id"
      :to="entries[section.id]"
      class="bnav-item"
      :class="{ 'is-active': activeSection === section.id }"
      @pointerenter="prefetchPath(entries[section.id])"
      @focus="prefetchPath(entries[section.id])"
      :aria-current="activeSection === section.id ? 'page' : undefined"
      :aria-label="section.id === 'live' && streaming ? `${section.label} – Stream läuft` : section.label"
      :aria-description="section.description"
      :title="`${section.label} – ${section.description}`"
    >
      <svg class="bnav-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
        <path
          v-for="(segment, index) in section.segments"
          :key="index"
          :d="segment.d"
          :fill="segment.fill ? 'currentColor' : 'none'"
          :stroke="segment.fill ? 'none' : 'currentColor'"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span v-if="section.id === 'live' && streaming" class="bnav-signal" aria-hidden="true"></span>
      <span class="bnav-label">{{ section.label }}</span>
    </RouterLink>
  </nav>
</template>
