<script setup lang="ts">
import type { AuthSessionInfo } from '@/src/api/types';
import { formatDateTime } from '@/src/utils/format';

defineProps<{
  sessions: AuthSessionInfo[];
  sessionsLoading: boolean;
  sessionsError: string;
}>();

defineEmits<{
  (e: 'revoke', session: AuthSessionInfo): void;
  (e: 'revokeAll'): void;
}>();
</script>

<template>
  <section id="settings-sessions" class="card settings-section" tabindex="-1">
    <div class="card-head">
      <div>
        <h2 class="card-title">Sessions</h2>
      </div>
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        :disabled="sessionsLoading || sessions.length === 0"
        @click="$emit('revokeAll')"
      >
        Alle abmelden
      </button>
    </div>
    <div class="settings-body">
      <p v-if="sessionsError" class="alert alert-error" role="alert">{{ sessionsError }}</p>
      <p v-else-if="sessionsLoading" class="muted small">Sessions werden geladen…</p>
      <p v-else-if="sessions.length === 0" class="muted small">Keine aktiven Sessions.</p>
      <ul v-else class="session-list">
        <li v-for="session in sessions" :key="session.id" class="session-item">
          <div class="session-main">
            <strong>{{ session.user }}</strong>
            <span class="badge tone-info">
              {{ session.provider === 'telegram' ? 'Telegram' : 'Passwort' }}
            </span>
            <span v-if="session.current" class="badge tone-success">Diese Sitzung</span>
          </div>
          <p class="session-meta">
            Erstellt {{ formatDateTime(session.created_at) }} · Zuletzt
            {{ formatDateTime(session.last_seen_at) }}
          </p>
          <button
            v-if="!session.current"
            type="button"
            class="btn btn-ghost btn-sm"
            @click="$emit('revoke', session)"
          >
            Abmelden
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>
