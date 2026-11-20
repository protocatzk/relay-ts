<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type { TotpSetupResponse, TotpStatus } from '@/src/api/types';
import { useToast } from '@/src/composables/useToast';
import { formatDateTime } from '@/src/utils/format';

const { pushToast } = useToast();

const status = ref<TotpStatus | null>(null);
const loading = ref(true);
const loadError = ref('');
const busy = ref(false);
const setup = ref<TotpSetupResponse | null>(null);
const confirmCode = ref('');
const recoveryCodes = ref<string[]>([]);
const disablePassword = ref('');
const showDisableForm = ref(false);

const qrDataUrl = computed(() =>
  setup.value ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.value.qr_svg)}` : '',
);

async function loadStatus(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    status.value = await api.auth.totpStatus();
  } catch (error) {
    loadError.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
}

async function startSetup(): Promise<void> {
  busy.value = true;
  recoveryCodes.value = [];
  confirmCode.value = '';
  try {
    setup.value = await api.auth.totpSetup();
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    busy.value = false;
  }
}

function cancelSetup(): void {
  setup.value = null;
  confirmCode.value = '';
}

async function enableTotp(): Promise<void> {
  const code = confirmCode.value.trim();
  if (!code) {
    pushToast('Bitte den 6-stelligen Bestätigungscode eingeben.', 'error');
    return;
  }
  busy.value = true;
  try {
    const result = await api.auth.totpEnable(code);
    status.value = result.status;
    recoveryCodes.value = result.recovery_codes;
    setup.value = null;
    confirmCode.value = '';
    pushToast('Zwei-Faktor-Authentifizierung aktiviert.', 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    busy.value = false;
  }
}

async function disableTotp(): Promise<void> {
  if (!disablePassword.value) {
    pushToast('Bitte das aktuelle Passwort zur Bestätigung eingeben.', 'error');
    return;
  }
  busy.value = true;
  try {
    const result = await api.auth.totpDisable(disablePassword.value);
    status.value = result.status;
    disablePassword.value = '';
    showDisableForm.value = false;
    recoveryCodes.value = [];
    pushToast('Zwei-Faktor-Authentifizierung deaktiviert.', 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    busy.value = false;
  }
}

async function copyText(text: string, message: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    pushToast(message, 'success');
  } catch {
    pushToast('Kopieren nicht möglich – bitte manuell markieren.', 'info');
  }
}

onMounted(() => {
  void loadStatus();
});
</script>

<template>
  <section id="settings-totp" class="card settings-section" tabindex="-1">
    <div class="card-head">
      <div>
        <h2 class="card-title">Zwei-Faktor-Authentifizierung (TOTP)</h2>
        <p class="card-sub">Optionaler zweiter Faktor für den Passwort-Login. Bestehende Sessions und Telegram bleiben unberührt.</p>
      </div>
      <div class="settings-section-actions">
        <span v-if="status?.enabled" class="badge tone-success">Aktiv</span>
        <span v-else-if="status" class="badge tone-muted">Inaktiv</span>
      </div>
    </div>

    <div class="settings-body">
      <p v-if="loadError" class="alert alert-error" role="alert">{{ loadError }}</p>
      <p v-else-if="loading && !status" class="muted small">2FA-Status wird geladen…</p>

      <template v-else-if="status">
        <div v-if="recoveryCodes.length > 0" class="alert alert-warn totp-recovery-box">
          <strong>Recovery-Codes sichern (einmalige Anzeige):</strong>
          <p class="field-hint">
            Jeder Code funktioniert genau einmal, falls deine Authenticator-App nicht verfügbar ist.
          </p>
          <ul class="totp-codes mono">
            <li v-for="code in recoveryCodes" :key="code">{{ code }}</li>
          </ul>
          <div class="quick-actions">
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              @click="copyText(recoveryCodes.join('\n'), 'Recovery-Codes kopiert.')"
            >
              Alle kopieren
            </button>
            <button type="button" class="btn btn-ghost btn-sm" @click="recoveryCodes = []">
              Gemerkt
            </button>
          </div>
        </div>

        <template v-if="!status.enabled">
          <p v-if="!status.password_configured" class="muted small">
            Kein Dashboard-Passwort konfiguriert – 2FA steht nur bei aktivem Passwort-Login zur Verfügung.
          </p>

          <div v-else-if="!setup" class="quick-actions">
            <button type="button" class="btn btn-secondary btn-sm" :disabled="busy" @click="startSetup">
              <span v-if="busy" class="spinner" aria-hidden="true"></span>
              2FA einrichten
            </button>
          </div>

          <div v-else class="totp-setup">
            <div class="totp-qr-wrap">
              <img :src="qrDataUrl" alt="TOTP QR-Code für Authenticator-App" class="totp-qr" width="192" height="192" />
            </div>
            <div class="totp-setup-fields stack">
              <p class="field-hint">
                QR-Code mit einer Authenticator-App (z. B. Aegis, Bitwarden, Google Authenticator) scannen
                oder den Schlüssel manuell eingeben:
              </p>
              <div class="totp-secret-row">
                <code class="mono totp-secret">{{ setup.secret }}</code>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  @click="copyText(setup.secret, 'Secret kopiert.')"
                >
                  Kopieren
                </button>
              </div>
              <div class="field">
                <label for="totp-confirm-code">6-stelliger Bestätigungscode</label>
                <input
                  id="totp-confirm-code"
                  v-model="confirmCode"
                  type="text"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  maxlength="12"
                  placeholder="123456"
                  @keydown.enter.prevent="enableTotp"
                />
              </div>
              <div class="quick-actions">
                <button type="button" class="btn btn-primary btn-sm" :disabled="busy" @click="enableTotp">
                  <span v-if="busy" class="spinner" aria-hidden="true"></span>
                  2FA aktivieren
                </button>
                <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="cancelSetup">
                  Abbrechen
                </button>
              </div>
            </div>
          </div>
        </template>

        <template v-else>
          <p class="muted small">
            Aktiviert seit {{ status.enabled_at ? formatDateTime(status.enabled_at) : '–' }} ·
            Verbleibende Recovery-Codes: <strong>{{ status.recovery_codes_remaining }}</strong>
          </p>

          <div v-if="!showDisableForm" class="quick-actions">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              @click="showDisableForm = true"
            >
              2FA deaktivieren
            </button>
          </div>

          <div v-else class="totp-disable-box stack">
            <div class="field">
              <label for="totp-disable-password">Aktuelles Passwort zur Bestätigung</label>
              <input
                id="totp-disable-password"
                v-model="disablePassword"
                type="password"
                autocomplete="current-password"
                placeholder="Passwort eingeben"
                @keydown.enter.prevent="disableTotp"
              />
            </div>
            <div class="quick-actions">
              <button type="button" class="btn btn-danger btn-sm" :disabled="busy" @click="disableTotp">
                <span v-if="busy" class="spinner" aria-hidden="true"></span>
                Deaktivierung bestätigen
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                :disabled="busy"
                @click="showDisableForm = false; disablePassword = ''"
              >
                Abbrechen
              </button>
            </div>
          </div>
        </template>
      </template>
    </div>
  </section>
</template>
