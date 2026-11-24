import { readonly, ref } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { TikTokAccountPublic } from '@/src/api/types';
import { pushToast } from '@/src/composables/useToast';

const accounts = ref<TikTokAccountPublic[]>([]);
const activeAccount = ref<TikTokAccountPublic | null>(null);
const loading = ref(false);

async function refreshAccounts(): Promise<void> {
  loading.value = true;
  try {
    const res = await api.discovery.accounts();
    accounts.value = res.accounts;
    activeAccount.value = res.active;
  } catch {
    // optional
  } finally {
    loading.value = false;
  }
}

async function activateAccount(id: string): Promise<boolean> {
  loading.value = true;
  try {
    const res = await api.discovery.activateAccount(id);
    activeAccount.value = res.account;
    await refreshAccounts();
    pushToast(`TikTok-Account „${res.account.label}“ aktiviert.`, 'success');
    return true;
  } catch (err) {
    pushToast(errorMessage(err), 'error');
    return false;
  } finally {
    loading.value = false;
  }
}

async function addAccount(data: { label: string; sessionId: string; targetIdc?: string; username?: string }): Promise<boolean> {
  loading.value = true;
  try {
    const res = await api.discovery.addAccount(data);
    await refreshAccounts();
    pushToast(`TikTok-Account „${res.account.label}“ angelegt.`, 'success');
    return true;
  } catch (err) {
    pushToast(errorMessage(err), 'error');
    return false;
  } finally {
    loading.value = false;
  }
}

async function removeAccount(id: string, options?: { reassign?: boolean }): Promise<boolean> {
  loading.value = true;
  try {
    const result = await api.discovery.removeAccount(id, options);
    await refreshAccounts();
    pushToast(
      result.reassigned
        ? `TikTok-Account entfernt; ${result.reassigned} Streamer nutzen jetzt das aktive Konto.`
        : 'TikTok-Account entfernt.',
      'success',
    );
    return true;
  } catch (err) {
    pushToast(errorMessage(err), 'error');
    return false;
  } finally {
    loading.value = false;
  }
}

export function useTikTokAccounts() {
  return {
    accounts: readonly(accounts),
    activeAccount: readonly(activeAccount),
    loading: readonly(loading),
    refreshAccounts,
    activateAccount,
    addAccount,
    removeAccount,
  };
}
