<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import {
  SECTIONS,
  desktopNavSide,
  sectionEntry,
  sectionFor,
  toggleDesktopNavSide,
} from '@/src/navigation';

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
      :aria-current="activeSection === section.id ? 'page' : undefined"
      :aria-label="section.label"
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
      <span class="bnav-label">{{ section.label }}</span>
    </RouterLink>

    <div class="bnav-divider" aria-hidden="true" />

    <button
      type="button"
      class="bnav-toggle-side"
      :title="desktopNavSide === 'left' ? 'Navigation nach rechts verschieben' : 'Navigation nach links verschieben'"
      :aria-label="desktopNavSide === 'left' ? 'Navigation nach rechts verschieben' : 'Navigation nach links verschieben'"
      @click="toggleDesktopNavSide"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path v-if="desktopNavSide === 'left'" d="M9 18l6-6-6-6" />
        <path v-else d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  </nav>
</template>
