<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { ScheduleAction, ScheduleRule, ScheduleRuleInput } from '@/src/api/types';
import { confirmAction } from '@/src/composables/useConfirm';
import { useStore } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';
import { formatDateTime } from '@/src/utils/format';

const { store, refreshStreamers, refreshPlaylists } = useStore();
const { pushToast } = useToast();

const WEEKDAYS = [
  { value: 1, label: 'Mo' },
  { value: 2, label: 'Di' },
  { value: 3, label: 'Mi' },
  { value: 4, label: 'Do' },
  { value: 5, label: 'Fr' },
  { value: 6, label: 'Sa' },
  { value: 0, label: 'So' },
] as const;

const ACTIONS: { value: ScheduleAction; label: string }[] = [
  { value: 'start_streamer', label: 'Streamer starten' },
  { value: 'start_playlist', label: 'Playlist starten' },
  { value: 'start_queue', label: 'Regie-Queue starten' },
  { value: 'start_screen', label: 'Screen anzeigen' },
  { value: 'stop', label: 'Stream stoppen' },
];

const schedules = ref<ScheduleRule[]>([]);
const loading = ref(true);
const loadError = ref('');
const saving = ref(false);
const runningId = ref<string | null>(null);
const editingId = ref<string | null>(null);

const draft = reactive<ScheduleRuleInput>({
  name: '',
  enabled: true,
  days: [1, 2, 3, 4, 5, 6, 0],
  time: '20:00',
  timezone: 'Europe/Berlin',
  action: 'start_streamer',
  target_id: '',
});

const needsTarget = computed(
  () =>
    draft.action === 'start_streamer' ||
    draft.action === 'start_playlist' ||
    draft.action === 'start_screen',
);

function resetDraft(): void {
  editingId.value = null;
  draft.name = '';
  draft.enabled = true;
  draft.days = [1, 2, 3, 4, 5, 6, 0];
  draft.time = '20:00';
  draft.timezone = 'Europe/Berlin';
  draft.action = 'start_streamer';
  draft.target_id = store.streamers[0]?.id ?? '';
}

function editRule(rule: ScheduleRule): void {
  editingId.value = rule.id;
  draft.name = rule.name;
  draft.enabled = rule.enabled;
  draft.days = [...rule.days];
  draft.time = rule.time;
  draft.timezone = rule.timezone;
  draft.action = rule.action;
  draft.target_id = rule.target_id ?? '';
}

function toggleDay(day: number): void {
  const index = draft.days.indexOf(day);
  if (index >= 0) {
    if (draft.days.length <= 1) return;
    draft.days.splice(index, 1);
  } else {
    draft.days.push(day);
  }
}

function onActionChange(): void {
  if (draft.action === 'start_streamer') {
    draft.target_id = store.streamers[0]?.id ?? '';
  } else if (draft.action === 'start_playlist') {
    draft.target_id = store.playlists[0]?.id ?? '';
  } else if (draft.action === 'start_screen') {
    draft.target_id = 'pause';
  } else {
    draft.target_id = null;
  }
}

function actionLabel(rule: ScheduleRule): string {
  const base = ACTIONS.find((item) => item.value === rule.action)?.label ?? rule.action;
  return rule.target_id ? `${base}: ${rule.target_id}` : base;
}

function daysLabel(days: number[]): string {
  return WEEKDAYS.filter((day) => days.includes(day.value))
    .map((day) => day.label)
    .join(', ');
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    const [list] = await Promise.all([
      api.schedules.list(),
      refreshStreamers().catch(() => undefined),
      refreshPlaylists().catch(() => undefined),
    ]);
    schedules.value = list;
    if (!editingId.value && !draft.target_id && draft.action === 'start_streamer') {
      draft.target_id = store.streamers[0]?.id ?? '';
    }
  } catch (error) {
    loadError.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
}

async function saveRule(): Promise<void> {
  if (!draft.name.trim()) {
    pushToast('Bitte einen Namen eingeben.', 'error');
    return;
  }
  saving.value = true;
  try {
    const payload: ScheduleRuleInput = {
      name: draft.name.trim(),
      enabled: draft.enabled,
      days: [...draft.days],
      time: draft.time,
      timezone: draft.timezone.trim() || 'Europe/Berlin',
      action: draft.action,
      target_id: needsTarget.value ? (draft.target_id?.trim() || null) : null,
    };
    if (editingId.value) {
      await api.schedules.update(editingId.value, payload);
      pushToast('Zeitplan aktualisiert.', 'success');
    } else {
      await api.schedules.create(payload);
      pushToast('Zeitplan angelegt.', 'success');
    }
    resetDraft();
    schedules.value = await api.schedules.list();
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    saving.value = false;
  }
}

/**
 * Optimistic toggle (#88): the switch flips immediately, the list is reloaded
 * after the server confirms and rolled back with a toast when the call fails.
 */
async function toggleEnabled(rule: ScheduleRule): Promise<void> {
  const previous = schedules.value.map((entry) => ({ ...entry }));
  const next = !rule.enabled;
  rule.enabled = next;
  try {
    await api.schedules.update(rule.id, { enabled: next });
    schedules.value = await api.schedules.list();
  } catch (error) {
    schedules.value = previous;
    pushToast(errorMessage(error), 'error');
  }
}

async function runNow(rule: ScheduleRule): Promise<void> {
  runningId.value = rule.id;
  try {
    await api.schedules.run(rule.id);
    schedules.value = await api.schedules.list();
    pushToast(`Zeitplan „${rule.name}“ ausgeführt.`, 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    runningId.value = null;
  }
}

async function removeRule(rule: ScheduleRule): Promise<void> {
  const ok = await confirmAction(`Zeitplan „${rule.name}“ wirklich löschen?`, {
    title: 'Zeitplan löschen',
    confirmLabel: 'Löschen',
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await api.schedules.remove(rule.id);
    if (editingId.value === rule.id) resetDraft();
    schedules.value = await api.schedules.list();
    pushToast('Zeitplan gelöscht.', 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Zeitplan</h1>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-secondary btn-sm" :disabled="loading" @click="load">
          Aktualisieren
        </button>
      </div>
    </div>

    <div v-if="loadError" class="alert alert-error" role="alert">{{ loadError }}</div>

    <form class="card settings-section" @submit.prevent="saveRule">
      <div class="card-head">
        <h2 class="card-title">{{ editingId ? 'Zeitplan bearbeiten' : 'Neuer Zeitplan' }}</h2>
        <button v-if="editingId" type="button" class="btn btn-ghost btn-sm" @click="resetDraft">
          Abbrechen
        </button>
      </div>
      <div class="settings-body">
        <div class="settings-grid">
          <div class="field">
            <label for="sched-name">Name</label>
            <input id="sched-name" v-model="draft.name" type="text" maxlength="100" placeholder="z. B. Abend-Stream" required />
          </div>
          <div class="field">
            <label for="sched-time">Uhrzeit</label>
            <input id="sched-time" v-model="draft.time" type="time" required />
          </div>
          <div class="field">
            <label for="sched-tz">Zeitzone</label>
            <input id="sched-tz" v-model="draft.timezone" type="text" placeholder="Europe/Berlin" required />
          </div>
          <div class="field">
            <label for="sched-action">Aktion</label>
            <select id="sched-action" v-model="draft.action" @change="onActionChange">
              <option v-for="item in ACTIONS" :key="item.value" :value="item.value">
                {{ item.label }}
              </option>
            </select>
          </div>
          <div v-if="draft.action === 'start_streamer'" class="field">
            <label for="sched-target-streamer">Streamer</label>
            <select id="sched-target-streamer" v-model="draft.target_id">
              <option v-for="s in store.streamers" :key="s.id" :value="s.id">
                {{ s.name }} ({{ s.id }})
              </option>
            </select>
          </div>
          <div v-else-if="draft.action === 'start_playlist'" class="field">
            <label for="sched-target-playlist">Playlist</label>
            <select id="sched-target-playlist" v-model="draft.target_id">
              <option v-for="p in store.playlists" :key="p.id" :value="p.id">
                {{ p.name }} ({{ p.id }})
              </option>
            </select>
          </div>
          <div v-else-if="draft.action === 'start_screen'" class="field">
            <label for="sched-target-screen">Screen</label>
            <select id="sched-target-screen" v-model="draft.target_id">
              <option value="pause">Pausenscreen</option>
              <option value="startup">Startbildschirm</option>
            </select>
          </div>
        </div>

        <fieldset class="field" style="border: 0; padding: 0; margin: 0">
          <legend style="font-size: 13px; margin-bottom: 6px">Wochentage</legend>
          <div class="row-wrap" style="display: flex; flex-wrap: wrap; gap: 6px">
            <button
              v-for="day in WEEKDAYS"
              :key="day.value"
              type="button"
              class="btn btn-sm"
              :class="draft.days.includes(day.value) ? 'btn-primary' : 'btn-ghost'"
              :aria-pressed="draft.days.includes(day.value)"
              @click="toggleDay(day.value)"
            >
              {{ day.label }}
            </button>
          </div>
        </fieldset>

        <div class="form-actions">
          <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px">
            <input id="sched-enabled" v-model="draft.enabled" type="checkbox" />
            Regel aktiv
          </label>
          <button type="submit" class="btn btn-primary btn-sm" :disabled="saving">
            {{ editingId ? 'Aktualisieren' : 'Anlegen' }}
          </button>
        </div>
      </div>
    </form>

    <section class="card">
      <div class="card-head">
        <h2 class="card-title">Geplante Regeln</h2>
        <span class="badge tone-neutral">{{ schedules.length }}</span>
      </div>
      <div v-if="loading" class="empty">
        <span class="spinner" aria-hidden="true"></span>
        <p>Zeitpläne werden geladen…</p>
      </div>
      <p v-else-if="schedules.length === 0" class="empty compact">Noch keine Zeitpläne angelegt.</p>
      <ul v-else class="session-list">
        <li v-for="rule in schedules" :key="rule.id" class="session-item">
          <div class="session-main">
            <strong>{{ rule.name }}</strong>
            <span class="badge" :class="rule.enabled ? 'tone-success' : 'tone-neutral'">
              {{ rule.enabled ? 'Aktiv' : 'Pausiert' }}
            </span>
            <span class="badge tone-info mono">{{ rule.time }} · {{ rule.timezone }}</span>
          </div>
          <p class="session-meta">
            {{ daysLabel(rule.days) }} · {{ actionLabel(rule) }}
            <template v-if="rule.next_run_at"> · Nächste Ausführung: {{ formatDateTime(rule.next_run_at) }}</template>
            <template v-if="rule.last_run_at"> · Zuletzt: {{ formatDateTime(rule.last_run_at) }}</template>
          </p>
          <p v-if="rule.last_error" class="alert alert-error" role="alert">{{ rule.last_error }}</p>
          <div style="display: flex; flex-wrap: wrap; gap: 6px">
            <button type="button" class="btn btn-ghost btn-sm" @click="toggleEnabled(rule)">
              {{ rule.enabled ? 'Deaktivieren' : 'Aktivieren' }}
            </button>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              :disabled="runningId === rule.id"
              @click="runNow(rule)"
            >
              Jetzt ausführen
            </button>
            <button type="button" class="btn btn-ghost btn-sm" @click="editRule(rule)">
              Bearbeiten
            </button>
            <button type="button" class="btn btn-ghost btn-sm" @click="removeRule(rule)">
              Löschen
            </button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
