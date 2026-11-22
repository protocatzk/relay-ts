<script setup lang="ts">
import { ref } from 'vue';
import { useTikTokAccounts } from '@/src/composables/useTikTokAccounts';

const { accounts, activeAccount, loading, activateAccount, addAccount, removeAccount } = useTikTokAccounts();

const showAdd = ref(false);
const form = ref({ label: '', sessionId: '', targetIdc: '', username: '' });
const saving = ref(false);

async function handleAdd(): Promise<void> {
  if (!form.value.label.trim() || !form.value.sessionId.trim()) return;
  saving.value = true;
  const ok = await addAccount(form.value);
  saving.value = false;
  if (ok) {
    form.value = { label: '', sessionId: '', targetIdc: '', username: '' };
    showAdd.value = false;
  }
}
</script>

<template>
  <section id="settings-tiktok-accounts" class="card">
    <div class="card-head">
      <div>
        <h2 class="card-title">TikTok-Konten</h2>
        <p class="card-sub">
          Verwalte mehrere TikTok-Session-Cookies global für alle Sitzungen (Discovery-Feeds, Following und Quell-Checks).
        </p>
      </div>
      <button
        type="button"
        class="btn btn-sm"
        :class="showAdd ? 'btn-ghost' : 'btn-primary'"
        @click="showAdd = !showAdd"
      >
        {{ showAdd ? 'Abbrechen' : '+ Konto hinzufügen' }}
      </button>
    </div>

    <!-- List of accounts -->
    <div v-if="accounts.length > 0" class="accounts-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Bezeichnung</th>
            <th>Status</th>
            <th>Target IDC</th>
            <th>Cookie</th>
            <th class="align-right">Aktionen</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="acc in accounts" :key="acc.id" :class="{ 'row-active': acc.active }">
            <td>
              <div class="cell-title">{{ acc.label }}</div>
              <div v-if="acc.username" class="cell-sub mono">@{{ acc.username }}</div>
            </td>
            <td>
              <span v-if="acc.active" class="badge tone-success">Aktiv</span>
              <span v-else class="badge tone-neutral">Inaktiv</span>
            </td>
            <td>
              <span class="mono small">{{ acc.targetIdc || '–' }}</span>
            </td>
            <td>
              <span class="badge tone-neutral">Hinterlegt</span>
            </td>
            <td class="align-right">
              <div class="row-actions">
                <button
                  v-if="!acc.active"
                  type="button"
                  class="btn btn-sm btn-ghost"
                  :disabled="loading"
                  @click="activateAccount(acc.id)"
                >
                  Aktivieren
                </button>
                <button
                  type="button"
                  class="btn-icon btn-icon-danger"
                  title="Konto löschen"
                  :disabled="loading"
                  @click="removeAccount(acc.id)"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                    <path
                      d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12M10 11v6M14 11v6"
                      stroke="currentColor"
                      stroke-width="1.7"
                      stroke-linecap="round"
                    />
                  </svg>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="empty small muted">
      Keine TikTok-Konten gespeichert.
    </div>

    <!-- Add Form -->
    <form v-if="showAdd" class="add-account-box" @submit.prevent="handleAdd">
      <h3 class="form-title">Neues TikTok-Konto anlegen</h3>
      <div class="form-grid">
        <div class="field">
          <label for="settings-acc-label">Label / Bezeichnung *</label>
          <input
            id="settings-acc-label"
            v-model="form.label"
            type="text"
            placeholder="z. B. Hauptaccount"
            required
          />
        </div>
        <div class="field">
          <label for="settings-acc-sessionid">TikTok sessionid Cookie *</label>
          <input
            id="settings-acc-sessionid"
            v-model="form.sessionId"
            type="password"
            placeholder="sessionid aus dem Web-Cookie"
            required
          />
        </div>
        <div class="field">
          <label for="settings-acc-targetidc">tt-target-idc (optional)</label>
          <input
            id="settings-acc-targetidc"
            v-model="form.targetIdc"
            type="text"
            placeholder="z. B. useast2a"
          />
        </div>
        <div class="field">
          <label for="settings-acc-username">Benutzername (optional)</label>
          <input
            id="settings-acc-username"
            v-model="form.username"
            type="text"
            placeholder="@deinprofil"
          />
        </div>
      </div>
      <div class="card-actions">
        <button type="submit" class="btn btn-primary" :disabled="saving">
          <span v-if="saving" class="spinner" aria-hidden="true"></span>
          Konto speichern
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.accounts-table-wrap {
  overflow-x: auto;
}

.add-account-box {
  margin-top: 1rem;
  padding: 1rem;
  border-radius: 6px;
  background: var(--bg-surface-elevated, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}
</style>
