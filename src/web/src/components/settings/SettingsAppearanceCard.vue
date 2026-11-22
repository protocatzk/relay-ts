<script setup lang="ts">
import { computed } from 'vue';
import { desktopNavSide, setDesktopNavSide, type DesktopNavSide } from '@/src/navigation';

const side = computed<DesktopNavSide>({
  get: () => desktopNavSide.value,
  set: (val) => setDesktopNavSide(val),
});
</script>

<template>
  <section id="settings-appearance" class="card settings-section" tabindex="-1">
    <div class="card-head">
      <div>
        <h2 class="card-title">Erscheinungsbild & Navigation</h2>
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
      </div>
    </div>
  </section>
</template>
