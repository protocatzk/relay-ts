<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { ApiKeyItem, ApiKeyScopeInfo } from '@/src/api/types';
import { formatDateTime } from '@/src/utils/format';
import { useToast } from '@/src/composables/useToast';
import ModalDialog from '@/src/components/ModalDialog.vue';

const { pushToast } = useToast();

const keys = ref<ApiKeyItem[]>([]);
const scopes = ref<ApiKeyScopeInfo[]>([]);
const loading = ref(false);
const error = ref('');

// Dialog State
const createModalOpen = ref(false);
const generatedKeyModalOpen = ref(false);
const createdKeySecret = ref('');
const createdKeyRecord = ref<ApiKeyItem | null>(null);

const form = ref({
  name: '',
  scopes: ['*'] as string[],
  expiresInDays: null as number | null,
});
const creating = ref(false);

async function loadData(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [keysRes, scopesRes] = await Promise.all([
      api.apiKeys.list(),
      api.apiKeys.scopes(),
    ]);
    keys.value = keysRes.keys;
    scopes.value = scopesRes.scopes;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

function openCreateDialog(): void {
  form.value = {
    name: '',
    scopes: ['*'],
    expiresInDays: null,
  };
  createModalOpen.value = true;
}

function toggleScope(scope: string): void {
  if (scope === '*') {
    form.value.scopes = ['*'];
    return;
  }
  // Wenn Wildcard zuvor gewählt war, entfernen
  const filtered = form.value.scopes.filter((s) => s !== '*');
  const idx = filtered.indexOf(scope);
  if (idx >= 0) {
    filtered.splice(idx, 1);
  } else {
    filtered.push(scope);
  }
  form.value.scopes = filtered.length > 0 ? filtered : ['read:status'];
}

async function handleCreateKey(): Promise<void> {
  if (!form.value.name.trim()) return;
  creating.value = true;
  try {
    const res = await api.apiKeys.create({
      name: form.value.name.trim(),
      scopes: form.value.scopes,
      expires_in_days: form.value.expiresInDays,
    });
    createdKeySecret.value = res.key;
    createdKeyRecord.value = res.record;
    createModalOpen.value = false;
    generatedKeyModalOpen.value = true;
    await loadData();
    pushToast(`API-Key „${res.record.name}“ erfolgreich erzeugt.`, 'success');
  } catch (err) {
    pushToast(errorMessage(err), 'error');
  } finally {
    creating.value = false;
  }
}

async function handleRevoke(key: ApiKeyItem): Promise<void> {
  if (!confirm(`Möchtest du den API-Key „${key.name}“ (${key.prefix}) wirklich widerrufen? Externe Anwendungen verlieren sofort den Zugriff.`)) {
    return;
  }
  try {
    await api.apiKeys.revoke(key.id);
    await loadData();
    pushToast(`API-Key „${key.name}“ widerrufen.`, 'success');
  } catch (err) {
    pushToast(errorMessage(err), 'error');
  }
}

async function handleDelete(key: ApiKeyItem): Promise<void> {
  if (!confirm(`API-Key „${key.name}“ endgültig löschen?`)) {
    return;
  }
  try {
    await api.apiKeys.delete(key.id);
    await loadData();
    pushToast(`API-Key gelöscht.`, 'success');
  } catch (err) {
    pushToast(errorMessage(err), 'error');
  }
}

function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text).then(
    () => pushToast('Schlüssel in die Zwischenablage kopiert.', 'success'),
    () => pushToast('Kopieren fehlgeschlagen.', 'error'),
  );
}

onMounted(() => {
  void loadData();
});
</script>

<template>
  <section id="settings-api-keys" class="card settings-section" tabindex="-1">
    <div class="card-head">
      <div>
        <h2 class="card-title">API-Zugang & Keys</h2>
        <p class="card-subtitle">
          Verwalte persönliche API-Tokens und Zugriffs-Schlüssel für externe Clients (z. B. Stream Deck, Companion, Regie-Bots oder MCP-Agenten).
        </p>
      </div>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        @click="openCreateDialog"
      >
        + Neuer API-Key
      </button>
    </div>

    <div class="settings-body">
      <p v-if="error" class="alert alert-error" role="alert">{{ error }}</p>
      <p v-else-if="loading && keys.length === 0" class="muted small">Lade API-Keys…</p>
      <p v-else-if="keys.length === 0" class="muted small">
        Es wurden noch keine API-Keys angelegt. Erstelle einen Schlüssel, um externen Anwendungen granularen Zugriff zu gewähren.
      </p>

      <div v-else class="keys-table-container">
        <table class="keys-table">
          <thead>
            <tr>
              <th>Name & Präfix</th>
              <th>Berechtigungen (Scopes)</th>
              <th>Status</th>
              <th>Zuletzt verwendet</th>
              <th>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="key in keys" :key="key.id">
              <td class="key-name-cell">
                <strong>{{ key.name }}</strong>
                <span class="mono small muted">{{ key.prefix }}</span>
              </td>
              <td>
                <div class="scope-badges">
                  <span
                    v-for="s in key.scopes"
                    :key="s"
                    class="badge"
                    :class="s === '*' || s === 'admin' ? 'tone-danger' : 'tone-info'"
                  >
                    {{ s === '*' ? 'Vollzugriff (*)' : s }}
                  </span>
                </div>
              </td>
              <td>
                <span v-if="key.status === 'active'" class="badge tone-success">Aktiv</span>
                <span v-else-if="key.status === 'expired'" class="badge tone-warning">Abgelaufen</span>
                <span v-else class="badge tone-danger">Widerrufen</span>
              </td>
              <td class="small muted">
                <template v-if="key.last_used_at">
                  {{ formatDateTime(key.last_used_at) }}
                  <span v-if="key.last_used_ip" class="mono block">({{ key.last_used_ip }})</span>
                </template>
                <template v-else>
                  Noch nie
                </template>
              </td>
              <td>
                <div class="actions-group">
                  <button
                    v-if="!key.revoked"
                    type="button"
                    class="btn btn-ghost btn-sm tone-warning"
                    title="Key sofort sperren"
                    @click="handleRevoke(key)"
                  >
                    Widerrufen
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    title="Eintrag entfernen"
                    @click="handleDelete(key)"
                  >
                    Löschen
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal: Neuer Key erzeugen -->
    <ModalDialog
      :open="createModalOpen"
      title="Neuen API-Key erstellen"
      confirm-label="Key erzeugen"
      :confirm-disabled="!form.name.trim() || creating"
      @confirm="handleCreateKey"
      @cancel="createModalOpen = false"
    >
      <form class="key-form" @submit.prevent="handleCreateKey">
        <label class="field">
          <span class="field-label">Name / Verwendungszweck:</span>
          <input
            v-model="form.name"
            type="text"
            placeholder="z. B. Stream Deck Studio, Home Assistant, Nightbot"
            required
            maxlength="64"
          />
        </label>

        <label class="field">
          <span class="field-label">Gültigkeitsdauer:</span>
          <select v-model="form.expiresInDays">
            <option :value="null">Unbegrenzt gültig</option>
            <option :value="7">7 Tage</option>
            <option :value="30">30 Tage</option>
            <option :value="90">90 Tage</option>
            <option :value="365">1 Jahr</option>
          </select>
        </label>

        <fieldset class="scopes-field">
          <legend class="field-label">Berechtigungen (Scopes):</legend>
          <div class="scopes-list">
            <label
              v-for="s in scopes"
              :key="s.scope"
              class="scope-option"
            >
              <input
                type="checkbox"
                :checked="form.scopes.includes(s.scope)"
                @change="toggleScope(s.scope)"
              />
              <div class="scope-text">
                <strong>{{ s.label }} <code class="mono small">{{ s.scope }}</code></strong>
                <span class="muted small">{{ s.description }}</span>
              </div>
            </label>
          </div>
        </fieldset>
      </form>
    </ModalDialog>

    <!-- Modal: Einmalige Secret-Anzeige -->
    <ModalDialog
      :open="generatedKeyModalOpen"
      title="API-Key erfolgreich erzeugt"
      confirm-label="Verstanden & Schließen"
      @confirm="generatedKeyModalOpen = false"
      @cancel="generatedKeyModalOpen = false"
    >
      <div class="secret-display">
        <div class="alert alert-warning" role="alert">
          <strong>Wichtig:</strong> Dieser Schlüssel wird aus Sicherheitsgründen nur ein einziges Mal im Klartext angezeigt. Kopiere ihn jetzt und bewahre ihn sicher auf!
        </div>

        <div class="secret-box">
          <input
            type="text"
            readonly
            :value="createdKeySecret"
            class="secret-input mono"
            @focus="($event.target as HTMLInputElement).select()"
          />
          <button
            type="button"
            class="btn btn-primary btn-sm"
            @click="copyToClipboard(createdKeySecret)"
          >
            Kopieren
          </button>
        </div>

        <p class="muted small">
          Verwende diesen Key im <code>Authorization: Bearer {{ createdKeySecret.slice(0, 16) }}...</code> HTTP-Header.
        </p>
      </div>
    </ModalDialog>
  </section>
</template>

<style scoped>
.keys-table-container {
  overflow-x: auto;
  margin-top: var(--space-2, 0.5rem);
}

.keys-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.keys-table th,
.keys-table td {
  padding: 0.6rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border-color, #2b2b2b);
}

.keys-table th {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--text-muted, #888);
}

.key-name-cell {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.scope-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.actions-group {
  display: flex;
  gap: 0.25rem;
}

.key-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.scopes-field {
  border: 1px solid var(--border-color, #333);
  border-radius: 4px;
  padding: 0.75rem;
}

.scopes-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 240px;
  overflow-y: auto;
  margin-top: 0.5rem;
}

.scope-option {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  cursor: pointer;
  padding: 0.35rem 0.5rem;
  border-radius: 4px;
  background: var(--bg-surface, #1e1e1e);
}

.scope-option:hover {
  background: var(--bg-hover, #252525);
}

.scope-text {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.secret-display {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.secret-box {
  display: flex;
  gap: 0.5rem;
}

.secret-input {
  flex: 1;
  padding: 0.5rem;
  background: var(--bg-base, #121212);
  border: 1px solid var(--border-color, #333);
  color: var(--color-success, #22c55e);
  font-weight: 600;
  border-radius: 4px;
}
</style>
