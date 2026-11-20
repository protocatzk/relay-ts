<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { SECTIONS, sectionEntry, sectionFor } from '@/src/navigation';

const route = useRoute();

const activeSection = computed(() => sectionFor(route.meta.section)?.id ?? null);

// Tapping a section opens the sub-page last visited in that section.
const entries = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  for (const section of SECTIONS) map[section.id] = sectionEntry(section);
  return map;
});
</script>

<template>
  <nav class="bottom-nav" aria-label="Hauptnavigation">
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
  </nav>
</template>
