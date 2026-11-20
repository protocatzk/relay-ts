<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { AuditEntry, AuditSource, LogEntry, LogLevel, LogQueryParams } from '@/src/api/types';
import { api, errorMessage } from '@/src/api/client';
import ToggleField from '@/src/components/ToggleField.vue';
import { useStore } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';
import { LOG_LEVEL_LABELS, formatClockTime, formatDateTime } from '@/src/utils/format';

type LogsTab = 'server' | 'streamer' | 'audit';

const { store, refreshStreamers, clearLogs } = useStore();
const { pushToast } = useToast();
const route = useRoute();
const router = useRouter();

const LEVELS: ('all' | LogLevel)[] = ['all', 'debug', 'info', 'warn', 'error'];
const PAGE_SIZE = 200;
const FILTER_STORAGE_KEY = 'relay.logs.filters';

function readStoredFilters(): Record<string, string> {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

const stored = readStoredFilters();
const initialTab = (typeof route.query.tab === 'string' ? route.query.tab : stored.tab) as LogsTab;
const activeTab = ref<LogsTab>(
  initialTab === 'streamer' || initialTab === 'audit' ? initialTab : 'server',
);

const initialLevel =
  typeof route.query.level === 'string' ? route.query.level : (stored.level ?? 'all');
const levelFilter = ref<'all' | LogLevel>(
  LEVELS.includes(initialLevel as 'all' | LogLevel) ? (initialLevel as 'all' | LogLevel) : 'all',
);
const textFilter = ref(typeof route.query.q === 'string' ? route.query.q : (stored.q ?? ''));
const streamerFilter = ref(
  typeof route.query.streamer === 'string' ? route.query.streamer : (stored.streamer ?? ''),
);
const sinceFilter = ref(typeof route.query.since === 'string' ? route.query.since : '');
const untilFilter = ref(typeof route.query.until === 'string' ? route.query.until : '');
const autoscroll = ref(true);
const scroller = ref<HTMLElement | null>(null);

// Server-side log pagination state
const serverLogs = ref<LogEntry[]>([]);
const serverTotal = ref(0);
const serverOffset = ref(0);
const serverHasMore = ref(false);
const logsLoading = ref(false);
const exporting = ref<'log' | 'json' | null>(null);

// Audit log state
const auditEntries = ref<AuditEntry[]>([]);
const auditTotal = ref(0);
const auditOffset = ref(0);
const auditHasMore = ref(false);
const auditActors = ref<string[]>([]);
const auditActions = ref<string[]>([]);
const auditActor = ref('');
const auditAction = ref('');
const auditSource = ref<'' | AuditSource>('');
const auditQuery = ref('');
const auditLoading = ref(false);

const AUDIT_PAGE_SIZE = 50;
let searchDebounce: number | null = null;

function persistFilters(): void {
  try {
    localStorage.setItem(
      FILTER_STORAGE_KEY,
      JSON.stringify({
        tab: activeTab.value,
        level: levelFilter.value,
        q: textFilter.value,
        streamer: streamerFilter.value,
      }),
    );
  } catch {
    /* ignore storage failures */
  }
  const query: Record<string, string> = {};
  if (activeTab.value !== 'server') query.tab = activeTab.value;
  if (levelFilter.value !== 'all') query.level = levelFilter.value;
  if (textFilter.value.trim()) query.q = textFilter.value.trim();
  if (activeTab.value === 'streamer' && streamerFilter.value) query.streamer = streamerFilter.value;
  if (sinceFilter.value) query.since = sinceFilter.value;
  if (untilFilter.value) query.until = untilFilter.value;
  void router.replace({ query }).catch(() => undefined);
}

function buildLogParams(offset = serverOffset.value): LogQueryParams {
  const params: LogQueryParams = {
    limit: PAGE_SIZE,
    offset,
  };
  if (levelFilter.value !== 'all') params.level = levelFilter.value;
  if (textFilter.value.trim()) params.q = textFilter.value.trim();
  if (activeTab.value === 'streamer' && streamerFilter.value) {
    params.streamer = streamerFilter.value;
  }
  if (sinceFilter.value) {
    const parsed = Date.parse(sinceFilter.value);
    if (!Number.isNaN(parsed)) params.since = new Date(parsed).toISOString();
  }
  if (untilFilter.value) {
    const parsed = Date.parse(untilFilter.value);
    if (!Number.isNaN(parsed)) params.until = new Date(parsed).toISOString();
  }
  return params;
}

function extras(entry: LogEntry): string {
  const omit = new Set(['time', 'level', 'msg', 'service', 'pid', 'hostname']);
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

/** On page 0 of Server-Logs with no date ceiling, live SSE entries merge seamlessly at the end. */
const displayedLogs = computed<LogEntry[]>(() => {
  if (activeTab.value !== 'server' || serverOffset.value > 0 || untilFilter.value) {
    return serverLogs.value;
  }
  const seen = new Set(serverLogs.value.map((e) => `${e.time}|${e.level}|${e.msg}`));
  const merged = [...serverLogs.value];
  const minWeight = { all: 0, debug: 0, info: 1, warn: 2, error: 3 }[levelFilter.value];
  const weights: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  const query = textFilter.value.trim().toLowerCase();
  const sinceMs = sinceFilter.value ? Date.parse(sinceFilter.value) : Number.NaN;

  for (const entry of store.logs) {
    const key = `${entry.time}|${entry.level}|${entry.msg}`;
    if (seen.has(key)) continue;
    if (weights[entry.level] < minWeight) continue;
    if (!Number.isNaN(sinceMs) && Date.parse(entry.time) < sinceMs) continue;
    if (query && !`${entry.msg} ${extras(entry)}`.toLowerCase().includes(query)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return merged;
});

async function scrollToBottom(): Promise<void> {
  await nextTick();
  const element = scroller.value;
  if (element) element.scrollTop = element.scrollHeight;
}

async function fetchLogs(offset = 0): Promise<void> {
  logsLoading.value = true;
  try {
    const page = await api.logs.query(buildLogParams(offset));
    serverLogs.value = page.lines;
    serverTotal.value = page.total;
    serverOffset.value = page.offset;
    serverHasMore.value = page.has_more;
    if (offset === 0 && autoscroll.value) await scrollToBottom();
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    logsLoading.value = false;
  }
}

async function fetchAudit(offset = 0): Promise<void> {
  auditLoading.value = true;
  try {
    const page = await api.audit.query({
      actor: auditActor.value || undefined,
      action: auditAction.value || undefined,
      source: auditSource.value || undefined,
      q: auditQuery.value.trim() || undefined,
      limit: AUDIT_PAGE_SIZE,
      offset,
    });
    auditEntries.value = page.entries;
    auditTotal.value = page.total;
    auditOffset.value = page.offset;
    auditHasMore.value = page.has_more;
    auditActors.value = page.actors;
    auditActions.value = page.actions;
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    auditLoading.value = false;
  }
}

async function exportLogs(format: 'log' | 'json'): Promise<void> {
  exporting.value = format;
  try {
    const { blob, filename } = await api.logs.exportDownload(format, {
      ...buildLogParams(0),
      limit: 5000,
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    pushToast(`Logs als .${format} exportiert.`, 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    exporting.value = null;
  }
}

async function handleClear(): Promise<void> {
  try {
    await api.logs.clear();
  } catch {
    /* local clear still useful if the request fails */
  }
  clearLogs();
  serverLogs.value = [];
  serverTotal.value = 0;
  serverOffset.value = 0;
  serverHasMore.value = false;
  pushToast('Log-Ansicht geleert.', 'info');
}

function scheduleLogFetch(): void {
  if (searchDebounce !== null) window.clearTimeout(searchDebounce);
  searchDebounce = window.setTimeout(() => {
    searchDebounce = null;
    persistFilters();
    if (activeTab.value === 'audit') {
      void fetchAudit(0);
    } else {
      void fetchLogs(0);
    }
  }, 200);
}

watch([activeTab, levelFilter, streamerFilter, sinceFilter, untilFilter], () => {
  persistFilters();
  if (activeTab.value === 'audit') {
    void fetchAudit(0);
  } else {
    void fetchLogs(0);
  }
});

watch(textFilter, scheduleLogFetch);

watch([auditActor, auditAction, auditSource], () => {
  if (activeTab.value === 'audit') void fetchAudit(0);
});
watch(auditQuery, scheduleLogFetch);

watch(
  () => displayedLogs.value.length,
  () => {
    if (activeTab.value === 'server' && serverOffset.value === 0 && autoscroll.value) {
      void scrollToBottom();
    }
  },
);

watch(autoscroll, (enabled) => {
  if (enabled) void scrollToBottom();
});

onMounted(async () => {
  if (store.streamers.length === 0) {
    void refreshStreamers().catch(() => undefined);
  }
  if (activeTab.value === 'audit') {
    await fetchAudit(0);
  } else {
    await fetchLogs(0);
  }
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Logs</h1>
      </div>
      <div class="page-actions">
        <span class="conn" :class="`conn-${store.connectionMode}`">
          <span class="conn-dot" aria-hidden="true"></span>
          {{ store.connectionMode === 'live' ? 'Live' : store.connectionMode === 'connecting' ? 'Verbinde…' : 'Offline' }}
        </span>
        <span v-if="activeTab !== 'audit'" class="muted small">
          {{ displayedLogs.length }} / {{ Math.max(serverTotal, displayedLogs.length) }} Zeilen
        </span>
        <span v-else class="muted small">{{ auditTotal }} Einträge</span>
      </div>
    </div>

    <div class="logs-mode-tabs" role="tablist" aria-label="Log-Ansicht">
      <button
        type="button"
        role="tab"
        class="chip"
        :class="{ 'is-active': activeTab === 'server' }"
        :aria-selected="activeTab === 'server'"
        @click="activeTab = 'server'"
      >
        Server-Logs
      </button>
      <button
        type="button"
        role="tab"
        class="chip"
        :class="{ 'is-active': activeTab === 'streamer' }"
        :aria-selected="activeTab === 'streamer'"
        @click="activeTab = 'streamer'"
      >
        Streamer-Logs
      </button>
      <button
        type="button"
        role="tab"
        class="chip"
        :class="{ 'is-active': activeTab === 'audit' }"
        :aria-selected="activeTab === 'audit'"
        @click="activeTab = 'audit'"
      >
        Audit-Log
      </button>
    </div>

    <section v-if="activeTab !== 'audit'" class="card logs-card">
      <div class="logs-toolbar">
        <div v-if="activeTab === 'streamer'" class="field logs-streamer-select">
          <label class="sr-only" for="log-streamer">Streamer wählen</label>
          <select id="log-streamer" v-model="streamerFilter">
            <option value="">Alle Streamer</option>
            <option v-for="streamer in store.streamers" :key="streamer.id" :value="streamer.id">
              {{ streamer.name }} ({{ streamer.id }})
            </option>
          </select>
        </div>

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
            placeholder="Serverseitig suchen…"
            autocomplete="off"
          />
        </div>

        <div class="logs-time-range">
          <label class="sr-only" for="log-since">Von</label>
          <input id="log-since" v-model="sinceFilter" type="datetime-local" title="Von" />
          <label class="sr-only" for="log-until">Bis</label>
          <input id="log-until" v-model="untilFilter" type="datetime-local" title="Bis" />
        </div>

        <div class="logs-toolbar-actions">
          <ToggleField v-if="activeTab === 'server'" v-model="autoscroll" label="Autoscroll" />
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="exporting !== null"
            @click="exportLogs('log')"
          >
            <span v-if="exporting === 'log'" class="spinner" aria-hidden="true"></span>
            .log
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="exporting !== null"
            @click="exportLogs('json')"
          >
            <span v-if="exporting === 'json'" class="spinner" aria-hidden="true"></span>
            .json
          </button>
          <button type="button" class="btn btn-ghost btn-sm" @click="handleClear">
            Leeren
          </button>
        </div>
      </div>

      <div ref="scroller" class="log-view" role="log" aria-label="Server-Logs">
        <div v-if="logsLoading && displayedLogs.length === 0" class="log-empty">
          <span class="spinner" aria-hidden="true"></span>
          Logs werden geladen…
        </div>
        <div v-else-if="displayedLogs.length === 0" class="log-empty">
          Keine Einträge für die aktuelle Filterauswahl.
        </div>
        <div
          v-for="(entry, index) in displayedLogs"
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

      <div class="logs-pagination">
        <p class="muted small">
          <template v-if="activeTab === 'server' && serverOffset === 0">Live via SSE · </template>
          Seite {{ Math.floor(serverOffset / PAGE_SIZE) + 1 }} · Gesamt {{ serverTotal }}
        </p>
        <div class="quick-actions">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="logsLoading || !serverHasMore"
            @click="fetchLogs(serverOffset + PAGE_SIZE)"
          >
            Ältere laden
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="logsLoading || serverOffset === 0"
            @click="fetchLogs(Math.max(0, serverOffset - PAGE_SIZE))"
          >
            Neuere
          </button>
        </div>
      </div>
    </section>

    <section v-else class="card logs-card">
      <div class="logs-toolbar">
        <div class="field logs-audit-filter">
          <label class="sr-only" for="audit-actor">Akteur filtern</label>
          <select id="audit-actor" v-model="auditActor">
            <option value="">Alle Akteure</option>
            <option v-for="actor in auditActors" :key="actor" :value="actor">{{ actor }}</option>
          </select>
        </div>
        <div class="field logs-audit-filter">
          <label class="sr-only" for="audit-action">Aktion filtern</label>
          <select id="audit-action" v-model="auditAction">
            <option value="">Alle Aktionen</option>
            <option v-for="action in auditActions" :key="action" :value="action">{{ action }}</option>
          </select>
        </div>
        <div class="field logs-audit-filter">
          <label class="sr-only" for="audit-source">Quelle filtern</label>
          <select id="audit-source" v-model="auditSource">
            <option value="">Alle Quellen</option>
            <option value="web">Web</option>
            <option value="api">API</option>
            <option value="telegram">Telegram</option>
            <option value="system">System</option>
          </select>
        </div>
        <div class="field field-search logs-search">
          <label class="sr-only" for="audit-search">Audit-Log durchsuchen</label>
          <input
            id="audit-search"
            v-model="auditQuery"
            type="search"
            placeholder="Ziel oder Detail suchen…"
            autocomplete="off"
          />
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="auditLoading"
          @click="fetchAudit(0)"
        >
          Aktualisieren
        </button>
      </div>

      <div v-if="auditLoading && auditEntries.length === 0" class="log-empty">
        <span class="spinner" aria-hidden="true"></span>
        Audit-Log wird geladen…
      </div>
      <div v-else-if="auditEntries.length === 0" class="log-empty">
        Noch keine protokollierten Steueraktionen für diesen Filter.
      </div>
      <div v-else class="table-wrap">
        <table class="data-table" role="table">
          <caption class="sr-only">Audit-Log der Steueraktionen</caption>
          <thead>
            <tr role="row">
              <th scope="col" role="columnheader">Zeit</th>
              <th scope="col" role="columnheader">Akteur</th>
              <th scope="col" role="columnheader">Aktion</th>
              <th scope="col" role="columnheader">Ziel</th>
              <th scope="col" role="columnheader">Ergebnis</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(entry, index) in auditEntries" :key="`${entry.time}-${index}`" role="row">
              <td data-label="Zeit" role="cell" class="mono small">
                {{ formatDateTime(entry.time) }}
              </td>
              <td data-label="Akteur" role="cell">
                <span class="mono">{{ entry.actor }}</span>
                <span class="badge tone-neutral badge-xs">{{ entry.source }}</span>
              </td>
              <td data-label="Aktion" role="cell" class="mono">{{ entry.action }}</td>
              <td data-label="Ziel" role="cell" class="mono">{{ entry.target ?? '–' }}</td>
              <td data-label="Ergebnis" role="cell">
                <span class="badge" :class="entry.result === 'ok' ? 'tone-success' : 'tone-danger'">
                  {{ entry.result === 'ok' ? 'OK' : 'Fehler' }}
                </span>
                <span v-if="entry.detail" class="muted small mono"> {{ entry.detail }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="logs-pagination">
        <p class="muted small">
          Seite {{ Math.floor(auditOffset / AUDIT_PAGE_SIZE) + 1 }} · Gesamt {{ auditTotal }}
        </p>
        <div class="quick-actions">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="auditLoading || auditOffset === 0"
            @click="fetchAudit(Math.max(0, auditOffset - AUDIT_PAGE_SIZE))"
          >
            Neuere
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="auditLoading || !auditHasMore"
            @click="fetchAudit(auditOffset + AUDIT_PAGE_SIZE)"
          >
            Ältere
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
