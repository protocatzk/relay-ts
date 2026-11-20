<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError, api, errorMessage } from '@/src/api/client';
import type { AuthMethods } from '@/src/api/types';
import { loadAuth, loginWithPassword } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';

const router = useRouter();
const route = useRoute();
const { pushToast } = useToast();

const password = ref('');
const totpCode = ref('');
const totpRequired = ref(false);
const totpInput = ref<HTMLInputElement | null>(null);
const error = ref('');
const loading = ref(false);
const showPassword = ref(false);
const methods = ref<AuthMethods | null>(null);
const methodsError = ref('');

const showTotpField = computed(() => Boolean(methods.value?.totp_enabled || totpRequired.value));

const telegram = ref({
  token: '',
  link: '',
  status: '',
  requesting: false,
});
let pollTimer: number | null = null;

const showPasswordForm = computed(() => methods.value?.password_auth ?? true);
const showTelegram = computed(() => methods.value?.telegram_auth ?? false);
const telegramWaiting = computed(
  () => telegram.value.requesting || Boolean(telegram.value.token) || telegram.value.status !== '',
);

function safeRedirect(): string {
  const redirect = route.query.redirect;
  if (typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')) {
    return redirect;
  }
  return '/';
}

function stopPolling(): void {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollTelegram(): Promise<void> {
  if (!telegram.value.token) return;
  try {
    const result = await api.auth.telegramCheck(telegram.value.token);
    if (result.status === 'approved') {
      stopPolling();
      telegram.value.status = 'Angemeldet. Weiterleitung…';
      await loadAuth();
      await router.replace(safeRedirect());
      return;
    }
    if (result.status === 'denied') {
      stopPolling();
      telegram.value.status = 'Anmeldung abgelehnt. Seite neu laden für einen neuen Versuch.';
      return;
    }
    if (result.status === 'expired') {
      stopPolling();
      telegram.value.status = 'Anfrage abgelaufen. Seite neu laden für einen neuen Versuch.';
    }
  } catch {
    /* transient error: keep polling */
  }
}

async function requestTelegram(): Promise<void> {
  if (telegram.value.token || telegram.value.requesting) return;
  telegram.value.requesting = true;
  telegram.value.status = 'Bereite Anmeldung vor…';
  try {
    const request = await api.auth.telegramRequest();
    telegram.value.token = request.token;
    telegram.value.link = request.deep_link;
    telegram.value.status = 'Warte auf Freigabe in Telegram…';
    stopPolling();
    pollTimer = window.setInterval(() => void pollTelegram(), 2000);
  } catch (caught) {
    telegram.value.status = errorMessage(caught);
    telegram.value.token = '';
    telegram.value.link = '';
  } finally {
    telegram.value.requesting = false;
  }
}

function onTelegramClick(event: MouseEvent): void {
  if (!telegram.value.link) {
    event.preventDefault();
    void requestTelegram();
  }
}

async function submit(): Promise<void> {
  if (!password.value) {
    error.value = 'Bitte ein Passwort eingeben.';
    return;
  }
  if (showTotpField.value && !totpCode.value.trim()) {
    error.value = 'Bitte den 2FA- oder Recovery-Code eingeben.';
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const result = await loginWithPassword(password.value, totpCode.value.trim() || undefined);
    if (result.recovery_code_used) {
      pushToast(
        `Recovery-Code verwendet (noch ${result.recovery_codes_remaining ?? 0} übrig).`,
        'info',
      );
    }
    await router.replace(safeRedirect());
  } catch (caught) {
    if (caught instanceof ApiError && caught.code === 'totp_required') {
      totpRequired.value = true;
      error.value = caught.message;
      await nextTick();
      totpInput.value?.focus();
    } else {
      error.value = errorMessage(caught);
    }
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    methods.value = await api.auth.methods();
    if (methods.value.telegram_auth) void requestTelegram();
  } catch (caught) {
    methodsError.value = errorMessage(caught);
  }
});

onBeforeUnmount(stopPolling);
</script>

<template>
  <div class="login-page">
    <div class="login-card card">
      <div class="login-brand">
        <img class="brand-logo" src="/logo.svg" alt="" width="36" height="36" aria-hidden="true" />
        <div>
          <strong>RELAY</strong>
          <span class="login-brand-sub">Restreamer Dashboard</span>
        </div>
      </div>

      <h1 class="login-title">Anmeldung</h1>
      <p class="login-sub">
        <template v-if="showTelegram">
          Melde dich über den Telegram-Bot an – kein Passwort, kein Code.
        </template>
        <template v-else>Bitte Passwort eingeben, um auf das Dashboard zuzugreifen.</template>
      </p>

      <div v-if="showTelegram" class="login-actions">
        <a
          class="btn btn-primary btn-block"
          :class="{ 'is-disabled': !telegram.link }"
          :href="telegram.link || '#'"
          target="_blank"
          rel="noopener"
          :aria-disabled="!telegram.link"
          @click="onTelegramClick"
        >
          <span v-if="telegram.requesting" class="spinner" aria-hidden="true"></span>
          Mit Telegram anmelden
        </a>
        <p v-if="telegram.status" class="login-status" :class="{ 'is-error': telegram.status.includes('nicht') || telegram.status.includes('abgelehnt') || telegram.status.includes('abgelaufen') }">
          {{ telegram.status }}
        </p>
        <p v-if="telegram.link && methods?.telegram_bot_username" class="login-hint">
          Der Link öffnet den Chat mit @{{ methods.telegram_bot_username }}. Nach
          „Anmelden freigeben“ geht es hier automatisch weiter.
        </p>
      </div>

      <div v-if="showTelegram && showPasswordForm" class="login-divider"><span>oder</span></div>

      <form v-if="showPasswordForm" class="stack" @submit.prevent="submit">
        <div class="field">
          <label for="login-password">Passwort</label>
          <div class="input-with-button">
            <input
              id="login-password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              placeholder="Passwort"
              autocomplete="current-password"
              :autofocus="!showTelegram"
            />
            <button
              type="button"
              class="btn-icon input-suffix"
              :aria-label="showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'"
              @click="showPassword = !showPassword"
            >
              <svg v-if="showPassword" viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                <path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                <path
                  d="M6.5 6.9C4.6 8.2 3.2 10 2.5 12c1.4 4 5 6.5 9.5 6.5 1.6 0 3-.3 4.3-.9M9.8 5.7c.7-.2 1.4-.2 2.2-.2 4.5 0 8.1 2.5 9.5 6.5-.4 1.2-1 2.3-1.8 3.2"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                />
              </svg>
              <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                <path d="M2.5 12C4 8 7.5 5.5 12 5.5S20 8 21.5 12C20 16 16.5 18.5 12 18.5S4 16 2.5 12Z" stroke="currentColor" stroke-width="1.8" />
                <circle cx="12" cy="12" r="2.8" stroke="currentColor" stroke-width="1.8" />
              </svg>
            </button>
          </div>
        </div>

        <div v-if="showTotpField" class="field">
          <label for="login-totp">2FA-Code oder Recovery-Code</label>
          <input
            id="login-totp"
            ref="totpInput"
            v-model="totpCode"
            type="text"
            inputmode="text"
            autocomplete="one-time-code"
            placeholder="123456 oder XXXX-XXXX"
            spellcheck="false"
          />
        </div>

        <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

        <button type="submit" class="btn btn-primary btn-block" :disabled="loading">
          <span v-if="loading" class="spinner" aria-hidden="true"></span>
          {{ loading ? 'Anmelden…' : 'Anmelden' }}
        </button>
      </form>

      <div v-if="methodsError" class="alert alert-error" role="alert">{{ methodsError }}</div>
      <p v-if="showTelegram && telegramWaiting && !telegram.token" class="login-hint">
        Der Bot ist noch nicht verbunden. Lade die Seite in einigen Sekunden neu.
      </p>

      <p class="login-foot">Sitzung über HttpOnly-Cookie · Nur für autorisierte Nutzer</p>
    </div>
  </div>
</template>
