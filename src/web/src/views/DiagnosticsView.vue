<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { DiagnosticsSnapshot } from '@/src/api/types';
import ModalDialog from '@/src/components/ModalDialog.vue';
import { useStore } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';
import {
  formatBytes,
  formatClockTime,
  formatDateTime,
  formatNumber,
  formatUptime,
  stateLabel,
  stateTone,
} from '@/src/utils/format';

const { store, refreshStatus } = useStore();
const { pushToast } = useToast();

const diagnostics = ref<DiagnosticsSnapshot | null>(null);
const loading = ref(true);
const refreshing = ref(false);
const loadError = ref('');
const pendingAction = ref<'restart-sink' | 'refresh-source' | null>(null);
const actionBusy = ref(false);
let pollTimer: number | null = null;

const diskFreePercent = computed(() => {
  const fs = diagnostics.value?.storage.filesystem;
  if (!fs || fs.total_bytes <= 0) return null;
  return Math.round((fs.available_bytes / fs.total_bytes) * 100);
});

const actionTitle = computed(() =>
  pendingAction.value === 'restart-sink' ? 'Sink neu starten' : 'Quelle neu verbinden',
);

const actionDescription = computed(() =>
  pendingAction.value === 'restart-sink'
    ? 'Der YouTube-Sink wird kurz neu aufgebaut. Zuschauer können einen kurzen Aussetzer bemerken.'
    : 'Die aktive TikTok-Quelle wird neu aufgelöst und verbunden. Der YouTube-Sink bleibt dabei bestehen.',
);

async function loadDiagnostics(forceProbe = false, silent = false): Promise<void> {
  if (!silent) loading.value = true;
  else refreshing.value = true;
  loadError.value = '';
  try {
    diagnostics.value = await api.system.diagnostics(forceProbe);
  } catch (error) {
    loadError.value = errorMessage(error);
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function confirmAction(): Promise<void> {
  const action = pendingAction.value;
  if (!action) return;
  actionBusy.value = true;
  try {
    if (action === 'restart-sink') {
      await api.system.restartSink();
      pushToast('YouTube-Sink wird neu gestartet.', 'success');
    } else {
      await api.system.refreshSource();
      pushToast('Quelle wird neu verbunden.', 'success');
    }
    pendingAction.value = null;
    await Promise.allSettled([refreshStatus(), loadDiagnostics(false, true)]);
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    actionBusy.value = false;
  }
}

onMounted(() => {
  void loadDiagnostics(false, false);
  pollTimer = window.setInterval(() => void loadDiagnostics(false, true), 15_000);
});

onBeforeUnmount(() => {
  if (pollTimer !== null) window.clearInterval(pollTimer);
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Diagnose</h1>
      </div>
      <div class="page-actions">
        <span v-if="store.status" class="badge" :class="`tone-${stateTone(store.status.state)}`">
          {{ stateLabel(store.status.state) }}
        </span>
        <RouterLink to="/logs" class="btn btn-ghost btn-sm">Logs öffnen</RouterLink>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="loading || refreshing"
          @click="loadDiagnostics(true, true)"
        >
          <span v-if="refreshing" class="spinner" aria-hidden="true"></span>
          Aktualisieren
        </button>
      </div>
    </div>

    <div v-if="loadError" class="alert alert-error" role="alert">
      <span>{{ loadError }}</span>
      <button type="button" class="btn btn-ghost btn-sm" @click="loadDiagnostics(true)">
        Erneut versuchen
      </button>
    </div>

    <div v-if="loading && !diagnostics" class="card empty">
      <span class="spinner spinner-lg" aria-hidden="true"></span>
      <p>Diagnosedaten werden geladen…</p>
    </div>

    <div v-else-if="diagnostics" class="stack">
      <div class="diag-grid">
        <section class="card diag-card">
          <div class="card-head">
            <h2 class="card-title">Laufzeit &amp; Versionen</h2>
            <span class="badge tone-info mono">v{{ diagnostics.version }}</span>
          </div>
          <dl class="diag-list">
            <div class="diag-row">
              <dt>Uptime (Prozess)</dt>
              <dd class="mono">{{ formatUptime(diagnostics.uptime_seconds) }}</dd>
            </div>
            <div class="diag-row">
              <dt>Node.js</dt>
              <dd class="mono">{{ diagnostics.node_version }} · {{ diagnostics.platform }}</dd>
            </div>
            <div class="diag-row">
              <dt>ffmpeg</dt>
              <dd class="mono diag-wrap">{{ diagnostics.tools.ffmpeg ?? 'nicht gefunden' }}</dd>
            </div>
            <div class="diag-row">
              <dt>yt-dlp</dt>
              <dd class="mono diag-wrap">{{ diagnostics.tools.ytdlp ?? 'nicht gefunden' }}</dd>
            </div>
            <div class="diag-row">
              <dt>Video-Encoder</dt>
              <dd class="mono">
                {{ diagnostics.encoder.active }}
                <span class="muted">({{ diagnostics.encoder.available.join(', ') }})</span>
              </dd>
            </div>
            <div class="diag-row">
              <dt>RAM (RSS / Heap)</dt>
              <dd class="mono">
                {{ formatBytes(diagnostics.memory.rss_bytes) }} /
                {{ formatBytes(diagnostics.memory.heap_used_bytes) }}
              </dd>
            </div>
          </dl>
        </section>

        <section class="card diag-card">
          <div class="card-head">
            <h2 class="card-title">Ports &amp; Stream-Status</h2>
            <span class="muted small mono">PID {{ diagnostics.pid }}</span>
          </div>
          <dl class="diag-list">
            <div class="diag-row">
              <dt>HTTP-Server</dt>
              <dd class="mono">:{{ diagnostics.ports.http }}</dd>
            </div>
            <div class="diag-row">
              <dt>Relay Ingest</dt>
              <dd class="mono">{{ diagnostics.ports.relay_host }}:{{ diagnostics.ports.relay }}</dd>
            </div>
            <div class="diag-row">
              <dt>Relay Playback</dt>
              <dd class="mono">{{ diagnostics.ports.relay_host }}:{{ diagnostics.ports.playback }}</dd>
            </div>
            <div class="diag-row">
              <dt>Sink-Restarts</dt>
              <dd class="mono">{{ formatNumber(diagnostics.metrics.counters.sink_restarts_total ?? 0) }}</dd>
            </div>
            <div class="diag-row">
              <dt>Source-Reconnects</dt>
              <dd class="mono">
                {{ formatNumber(diagnostics.metrics.counters.source_reconnects_total ?? 0) }}
                <span class="muted">
                  ({{ formatNumber(diagnostics.metrics.counters.reconnect_failures_total ?? 0) }} fehlgeschlagen)
                </span>
              </dd>
            </div>
            <div class="diag-row">
              <dt>Watchdog-Auslöser</dt>
              <dd class="mono">{{ formatNumber(diagnostics.metrics.counters.watchdog_triggers_total ?? 0) }}</dd>
            </div>
            <div v-if="store.status" class="diag-row">
              <dt>Relay-Pacing</dt>
              <dd class="mono">
                {{ store.status.relay.buffer_seconds.toFixed(1) }} s /
                {{ formatNumber(store.status.relay.delay_seconds) }} s ·
                {{ (store.status.relay.pacing_multiplier ?? 1).toFixed(2) }}×
                <span v-if="store.status.relay.catching_up" class="badge tone-warning">Catch-Up</span>
              </dd>
            </div>
            <div v-if="store.status" class="diag-row">
              <dt>Sink-Stabilität</dt>
              <dd class="mono diag-wrap">
                {{ formatNumber(store.status.sink.dropped_frames) }} Dropped ·
                {{ formatNumber(store.status.sink.dts_errors ?? 0) }} DTS-Fehler
                <span v-if="store.status.sink.silence_active" class="badge tone-warning">Audio-Stille</span>
                <span v-if="store.status.sink.last_error" class="muted">
                  ({{ store.status.sink.last_error }})
                </span>
              </dd>
            </div>
            <div class="diag-row">
              <dt>Prometheus-Metriken</dt>
              <dd class="mono diag-wrap">/api/metrics?format=prometheus</dd>
            </div>
          </dl>
        </section>
      </div>

      <section class="card diag-card">
        <div class="card-head">
          <div>
            <h2 class="card-title">Speicherbelegung</h2>
            <p class="card-sub">Stand {{ formatDateTime(diagnostics.collected_at) }}</p>
          </div>
          <span
            v-if="diskFreePercent !== null"
            class="badge"
            :class="diskFreePercent < 10 ? 'tone-danger' : diskFreePercent < 20 ? 'tone-warning' : 'tone-success'"
          >
            {{ diskFreePercent }} % frei
          </span>
        </div>
        <div class="diag-storage-grid">
          <div class="diag-stat">
            <span class="diag-stat-label">data/media</span>
            <strong class="mono">{{ formatBytes(diagnostics.storage.media.bytes) }}</strong>
            <span class="muted small">{{ formatNumber(diagnostics.storage.media.files) }} Dateien</span>
          </div>
          <div class="diag-stat">
            <span class="diag-stat-label">logs</span>
            <strong class="mono">{{ formatBytes(diagnostics.storage.logs.bytes) }}</strong>
            <span class="muted small">{{ formatNumber(diagnostics.storage.logs.files) }} Dateien</span>
          </div>
          <div class="diag-stat">
            <span class="diag-stat-label">backups</span>
            <strong class="mono">{{ formatBytes(diagnostics.storage.backups.bytes) }}</strong>
            <span class="muted small">
              {{ diagnostics.storage.backups.exists ? `${formatNumber(diagnostics.storage.backups.files)} Dateien` : 'kein Ordner' }}
            </span>
          </div>
          <div class="diag-stat">
            <span class="diag-stat-label">data gesamt</span>
            <strong class="mono">{{ formatBytes(diagnostics.storage.data.bytes) }}</strong>
            <span class="muted small">{{ formatNumber(diagnostics.storage.data.files) }} Dateien</span>
          </div>
          <div v-if="diagnostics.storage.filesystem" class="diag-stat">
            <span class="diag-stat-label">Dateisystem frei</span>
            <strong class="mono">{{ formatBytes(diagnostics.storage.filesystem.available_bytes) }}</strong>
            <span class="muted small">
              von {{ formatBytes(diagnostics.storage.filesystem.total_bytes) }}
            </span>
          </div>
        </div>
      </section>

      <section class="card diag-card">
        <div class="card-head">
          <div>
            <h2 class="card-title">Schnellaktionen</h2>
            <p class="card-sub">Alle Eingriffe werden erst nach Bestätigung ausgeführt.</p>
          </div>
        </div>
        <div class="quick-actions">
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            :disabled="actionBusy"
            @click="pendingAction = 'restart-sink'"
          >
            Sink neu starten
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            :disabled="actionBusy"
            @click="pendingAction = 'refresh-source'"
          >
            Quelle neu verbinden
          </button>
          <RouterLink to="/logs?level=error" class="btn btn-ghost btn-sm">
            Fehler-Logs öffnen
          </RouterLink>
        </div>
      </section>

      <section class="card diag-card">
        <div class="card-head">
          <div>
            <h2 class="card-title">Letzte Fehler ({{ diagnostics.recent_errors.length }})</h2>
          </div>
          <RouterLink to="/logs?level=error" class="btn btn-ghost btn-sm">Alle Fehler ansehen</RouterLink>
        </div>
        <div v-if="diagnostics.recent_errors.length === 0" class="muted small">
          Keine Fehler im aktuellen Logring.
        </div>
        <div v-else class="log-view diag-errors" role="log" aria-label="Letzte Fehler">
          <div
            v-for="(entry, index) in diagnostics.recent_errors"
            :key="`${entry.time}-${index}-${entry.msg}`"
            class="log-line log-error"
          >
            <span class="log-time">{{ formatClockTime(entry.time) }}</span>
            <span class="log-level">ERROR</span>
            <span class="log-msg">{{ entry.msg }}</span>
          </div>
        </div>
      </section>
    </div>

    <ModalDialog
      :open="pendingAction !== null"
      :title="actionTitle"
      size="sm"
      @close="if (!actionBusy) pendingAction = null;"
    >
      <p>{{ actionDescription }}</p>
      <template #footer>
        <button
          type="button"
          class="btn btn-ghost"
          :disabled="actionBusy"
          @click="pendingAction = null"
        >
          Abbrechen
        </button>
        <button type="button" class="btn btn-primary" :disabled="actionBusy" @click="confirmAction">
          <span v-if="actionBusy" class="spinner" aria-hidden="true"></span>
          Ausführen
        </button>
      </template>
    </ModalDialog>
  </div>
</template>
