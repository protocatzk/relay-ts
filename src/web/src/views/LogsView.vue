<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import type { LogEntry, LogLevel } from '@/src/api/types';
import { api, errorMessage } from '@/src/api/client';
import ToggleField from '@/src/components/ToggleField.vue';
import { useStore } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';
import { LOG_LEVEL_LABELS, formatClockTime } from '@/src/utils/format';

const { store, refreshLogs, clearLogs } = useStore();
const { pushToast } = useToast();

const LEVELS: ('all' | LogLevel)[] = ['all', 'debug', 'info', 'warn', 'error'];

const levelFilter = ref<'all' | LogLevel>('all');
const textFilter = ref('');
const autoscroll = ref(true);
const scroller = ref<HTMLElement | null>(null);

function extras(entry: LogEntry): string {
  const omit = new Set(['time', 'level', 'msg']);
  return Object.entries(entry)
    .filter(([key]) => !omit.has(key))
    .map(([key, value]) => {
      if (value !== null && typeof value === 'object') {
        return `${key}=${JSON.stringify(value)}`;
      }
      return `${key}=${String(value)}`;
    })
    .join(' ');
}

const filtered = computed(() => {
  const text = textFilter.value.trim().toLowerCase();
  return store.logs.filter((entry) => {
    if (levelFilter.value !== 'all' && entry.level !== levelFilter.value) return false;
    if (!text) return true;
    const haystack = `${entry.msg} ${extras(entry)}`.toLowerCase();
    return haystack.includes(text);
  });
});

async function scrollToBottom(): Promise<void> {
  await nextTick();
  const element = scroller.value;
  if (element) element.scrollTop = element.scrollHeight;
}

async function handleClear(): Promise<void> {
  try {
    await api.logs.clear();
  } catch {
    /* local clear still useful if the request fails */
  }
  clearLogs();
  pushToast('Log-Ansicht geleert.', 'info');
}

watch(
  () => filtered.value.length,
  () => {
    if (autoscroll.value) void scrollToBottom();
  },
);

watch([levelFilter, textFilter], () => {
  if (autoscroll.value) void scrollToBottom();
});

watch(autoscroll, (enabled) => {
  if (enabled) void scrollToBottom();
});

onMounted(async () => {
  try {
    await refreshLogs(300);
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  }
  if (autoscroll.value) await scrollToBottom();
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Logs</h1>
        <p class="page-sub">Live-Logs des Restreamers durchsuchen und filtern.</p>
      </div>
      <div class="page-actions">
        <span class="conn" :class="`conn-${store.connectionMode}`">
          <span class="conn-dot" aria-hidden="true"></span>
          {{ store.connectionMode === 'live' ? 'Live' : store.connectionMode === 'connecting' ? 'Verbinde…' : 'Offline' }}
        </span>
        <span class="muted small">{{ filtered.length }} / {{ store.logs.length }} Zeilen</span>
      </div>
    </div>

    <section class="card logs-card">
      <div class="logs-toolbar">
        <div class="level-chips" role="group" aria-label="Log-Level filtern">
          <button
            v-for="level in LEVELS"
            :key="level"
            type="button"
            class="chip"
            :class="{ 'is-active': levelFilter === level }"
            :aria-pressed="levelFilter === level"
            @click="levelFilter = level"
          >
            {{ level === 'all' ? 'Alle' : LOG_LEVEL_LABELS[level] }}
          </button>
        </div>

        <div class="field field-search logs-search">
          <label class="sr-only" for="log-search">Logs durchsuchen</label>
          <span class="search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8" />
              <path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </span>
          <input
            id="log-search"
            v-model="textFilter"
            type="search"
            placeholder="Text filtern…"
            autocomplete="off"
          />
        </div>

        <div class="logs-toolbar-actions">
          <ToggleField v-model="autoscroll" label="Autoscroll" />
          <button type="button" class="btn btn-ghost btn-sm" @click="handleClear">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
              <path
                d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            Leeren
          </button>
        </div>
      </div>

      <div ref="scroller" class="log-view" role="log" aria-label="Server-Logs">
        <div v-if="store.loading.logs && store.logs.length === 0" class="log-empty">
          <span class="spinner" aria-hidden="true"></span>
          Logs werden geladen…
        </div>
        <div v-else-if="filtered.length === 0" class="log-empty">
          <template v-if="store.logs.length === 0">Noch keine Log-Einträge empfangen.</template>
          <template v-else>Keine Einträge für die aktuelle Filterauswahl.</template>
        </div>
        <div
          v-for="(entry, index) in filtered"
          :key="`${entry.time}-${index}-${entry.msg}`"
          class="log-line"
          :class="`log-${entry.level}`"
        >
          <span class="log-time">{{ formatClockTime(entry.time) }}</span>
          <span class="log-level">{{ entry.level.toUpperCase() }}</span>
          <span class="log-msg">{{ entry.msg }}</span>
          <span v-if="extras(entry)" class="log-extra">{{ extras(entry) }}</span>
        </div>
      </div>

      <p class="logs-foot muted small">
        Live-Updates via Server-Sent Events · Die Anzeige wird lokal geleert, Server-Logs bleiben erhalten.
      </p>
    </section>
  </div>
</template>
