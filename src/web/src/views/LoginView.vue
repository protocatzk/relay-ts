<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorMessage } from '@/src/api/client';
import { loginWithPassword } from '@/src/composables/useStore';

const router = useRouter();
const route = useRoute();

const password = ref('');
const error = ref('');
const loading = ref(false);
const showPassword = ref(false);

function safeRedirect(): string {
  const redirect = route.query.redirect;
  if (typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')) {
    return redirect;
  }
  return '/';
}

async function submit(): Promise<void> {
  if (!password.value) {
    error.value = 'Bitte ein Passwort eingeben.';
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    await loginWithPassword(password.value);
    await router.replace(safeRedirect());
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card card">
      <div class="login-brand">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="30" height="30" fill="none">
            <rect x="1" y="1" width="30" height="30" rx="9" stroke="currentColor" stroke-width="2" />
            <path
              d="M10 23V9h6.5a4.75 4.75 0 0 1 0 9.5H14l6.5 4.5"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        <div>
          <strong>RELAY</strong>
          <span class="login-brand-sub">Restreamer Dashboard</span>
        </div>
      </div>

      <h1 class="login-title">Anmeldung</h1>
      <p class="login-sub">Bitte Passwort eingeben, um auf das Dashboard zuzugreifen.</p>

      <form class="stack" @submit.prevent="submit">
        <div class="field">
          <label for="login-password">Passwort</label>
          <div class="input-with-button">
            <input
              id="login-password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              placeholder="Passwort"
              autocomplete="current-password"
              autofocus
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

        <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

        <button type="submit" class="btn btn-primary btn-block" :disabled="loading">
          <span v-if="loading" class="spinner" aria-hidden="true"></span>
          {{ loading ? 'Anmelden…' : 'Anmelden' }}
        </button>
      </form>

      <p class="login-foot">Sitzung über HttpOnly-Cookie · Nur für autorisierte Nutzer</p>
    </div>
  </div>
</template>
