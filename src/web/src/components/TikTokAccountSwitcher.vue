<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import ModalDialog from '@/src/components/ModalDialog.vue';
import { useTikTokAccounts } from '@/src/composables/useTikTokAccounts';

const { accounts, activeAccount, loading, refreshAccounts, activateAccount, addAccount, removeAccount } = useTikTokAccounts();

const modalOpen = ref(false);
const showAddForm = ref(false);
const form = ref({ label: '', sessionId: '', targetIdc: '', username: '' });
const saving = ref(false);

const activeLabel = computed(() => {
  if (activeAccount.value) {
    return activeAccount.value.label;
  }
  return 'TikTok-Konto';
});

async function handleSave(): Promise<void> {
  if (!form.value.label.trim() || !form.value.sessionId.trim()) return;
  saving.value = true;
  const ok = await addAccount(form.value);
  saving.value = false;
  if (ok) {
    form.value = { label: '', sessionId: '', targetIdc: '', username: '' };
    showAddForm.value = false;
  }
}

onMounted(() => {
  void refreshAccounts();
});
</script>

<template>
  <div class="account-switcher">
    <button
      type="button"
      class="btn btn-ghost btn-sm account-btn"
      :title="`Aktiver TikTok-Account: ${activeLabel} (Klicken zum Wechseln)`"
      @click="modalOpen = true"
    >
      <span class="account-icon" aria-hidden="true">👤</span>
      <span class="account-text hide-xs">{{ activeLabel }}</span>
      <span v-if="accounts.length > 1" class="badge badge-xs tone-neutral hide-xs">{{ accounts.length }}</span>
    </button>

    <ModalDialog
      :open="modalOpen"
      title="TikTok Accounts verwalten"
      size="md"
      @close="modalOpen = false"
    >
      <div class="account-dialog-body">
        <p class="small muted">
          Der hier gewählte TikTok-Account wird global für alle Discovery-Suchen, den Following-Feed und Quell-Checks verwendet.
        </p>

        <div v-if="accounts.length > 0" class="accounts-list">
          <div
            v-for="acc in accounts"
            :key="acc.id"
            class="account-card"
            :class="{ 'is-active': acc.active }"
          >
            <div class="account-meta">
              <span class="account-title">
                {{ acc.label }}
                <span v-if="acc.username" class="mono small muted">(@{{ acc.username }})</span>
              </span>
              <span v-if="acc.active" class="badge tone-success badge-xs">Aktiv</span>
              <span v-else class="badge tone-neutral badge-xs">Inaktiv</span>
            </div>
            <div class="account-ctrls">
              <button
                v-if="!acc.active"
                type="button"
                class="btn btn-sm btn-primary"
                :disabled="loading"
                @click="activateAccount(acc.id)"
              >
                Aktivieren
              </button>
              <button
                type="button"
                class="btn btn-sm btn-danger btn-icon-only"
                title="Account löschen"
                :disabled="loading"
                @click="removeAccount(acc.id)"
              >
                ✕
              </button>
            </div>
          </div>
        </div>

        <div v-else class="empty-accounts small muted">
          Noch keine TikTok-Accounts hinterlegt. Füge einen Session-Cookie hinzu.
        </div>

        <div class="form-toggle-row">
          <button
            type="button"
            class="btn btn-sm"
            :class="showAddForm ? 'btn-ghost' : 'btn-outline'"
            @click="showAddForm = !showAddForm"
          >
            {{ showAddForm ? 'Abbrechen' : '+ Weiteren Account hinzufügen' }}
          </button>
        </div>

        <form v-if="showAddForm" class="add-account-form card" @submit.prevent="handleSave">
          <h4 class="form-heading">Neues TikTok-Konto</h4>
          <div class="field">
            <label for="acc-global-label">Bezeichnung / Label *</label>
            <input
              id="acc-global-label"
              v-model="form.label"
              type="text"
              placeholder="z. B. Hauptaccount, Streaming-Profil…"
              required
            />
          </div>
          <div class="field">
            <label for="acc-global-sessionid">TikTok sessionid Cookie *</label>
            <input
              id="acc-global-sessionid"
              v-model="form.sessionId"
              type="password"
              placeholder="sessionid Wert aus TikTok Web-Cookies"
              required
            />
          </div>
          <div class="field">
            <label for="acc-global-targetidc">Target IDC (optional)</label>
            <input
              id="acc-global-targetidc"
              v-model="form.targetIdc"
              type="text"
              placeholder="z. B. useast2a"
            />
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary btn-sm" :disabled="saving">
              <span v-if="saving" class="spinner" aria-hidden="true"></span>
              Speichern & Aktivieren
            </button>
          </div>
        </form>
      </div>
    </ModalDialog>
  </div>
</template>

<style scoped>
.account-switcher {
  display: inline-flex;
  align-items: center;
}

.account-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  max-width: 180px;
}

.account-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
}

.account-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.accounts-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.account-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.6rem 0.85rem;
  border-radius: 6px;
  background: var(--bg-surface-elevated, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
}

.account-card.is-active {
  border-color: var(--primary-color, #38bdf8);
}

.account-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.account-title {
  font-weight: 500;
  font-size: 0.9rem;
}

.account-ctrls {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.form-toggle-row {
  display: flex;
  justify-content: flex-start;
}

.add-account-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
}

.form-heading {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
