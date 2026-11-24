<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { rememberSectionTab, sectionFor } from '@/src/navigation';
import { prefetchPath } from '@/src/router/prefetch';

const route = useRoute();

const section = computed(() => sectionFor(route.meta.section));
const show = computed(() => (section.value ? section.value.tabs.length > 1 : false));

function isActive(path: string): boolean {
  return route.path === path;
}

watch(
  () => [section.value?.id, route.path] as const,
  ([id, path]) => {
    if (id) rememberSectionTab(id, path);
  },
  { immediate: true },
);
</script>

<template>
  <nav v-if="section && show" class="section-tabs" :aria-label="`${section.label}: Unterseiten`">
    <RouterLink
      v-for="tab in section.tabs"
      :key="tab.to"
      :to="tab.to"
      class="section-tab"
      :class="{ 'is-active': isActive(tab.to) }"
      :aria-current="isActive(tab.to) ? 'page' : undefined"
      @pointerenter="prefetchPath(tab.to)"
      @focus="prefetchPath(tab.to)"
    >
      {{ tab.label }}
    </RouterLink>
  </nav>
</template>
