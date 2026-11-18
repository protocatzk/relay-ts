<script setup lang="ts">
import { computed } from 'vue';
import type { EarningsSnapshot } from '@/src/api/types';
import { formatDateTime, formatNumber } from '@/src/utils/format';

const props = defineProps<{
  earnings: EarningsSnapshot | null;
  refreshing?: boolean;
}>();
const emit = defineEmits<{ refresh: [] }>();

const view = computed(() => props.earnings?.view ?? 'standard');
const isCompact = computed(() => view.value === 'compact');
const isDetailed = computed(() => view.value === 'detailed');
const status = computed(() => props.earnings?.status ?? 'inactive');
const hasData = computed(
  () =>
    Boolean(props.earnings) &&
    (props.earnings?.net != null ||
      props.earnings?.gross != null ||
      props.earnings?.coins != null),
);

const statusLabel = computed(() => {
  switch (status.value) {
    case 'ok':
      return 'Aktuell';
    case 'checking':
      return 'Lädt';
    case 'missing':
      return 'Keine Daten';
    case 'error':
      return 'Fehler';
    case 'disabled':
      return 'Deaktiviert';
    case 'unconfigured':
      return 'Nicht konfiguriert';
    default:
      return 'Kein aktiver Streamer';
  }
});

const statusTone = computed(() => {
  switch (status.value) {
    case 'ok':
      return 'tone-success';
    case 'checking':
      return 'tone-info';
    case 'missing':
    case 'disabled':
      return 'tone-warning';
    case 'error':
      return 'tone-danger';
    default:
      return 'tone-muted';
  }
});

const statusMessage = computed(() => {
  switch (status.value) {
    case 'unconfigured':
      return 'Keine Einnahmenquelle konfiguriert.';
    case 'disabled':
      return 'Die Einnahmen-Anzeige ist in den Einstellungen deaktiviert.';
    case 'inactive':
      return 'Kein aktiver Streamer – Einnahmen werden angezeigt, sobald ein Stream läuft.';
    case 'missing':
      return `Keine Einnahmen-Daten für @${props.earnings?.streamer_handle ?? 'diesen Streamer'} in der Quelle.`;
    case 'error':
      return `Quelle nicht erreichbar: ${props.earnings?.error ?? 'Unbekannter Fehler'}`;
    case 'checking':
      return 'Einnahmen werden geladen…';
    default:
      return '';
  }
});

const streamerLabel = computed(() => {
  const name = props.earnings?.display_name || props.earnings?.streamer_name;
  const handle = props.earnings?.streamer_handle;
  if (!name) return handle ? `@${handle}` : '';
  if (!handle || name.replace(/^@/, '').toLowerCase() === handle.toLowerCase()) return name;
  return `${name} · @${handle}`;
});

function money(value: number | null | undefined, currency = props.earnings?.currency ?? 'EUR'): string {
  if (value == null || !Number.isFinite(value)) return '–';
  return `${formatNumber(value, 2)} ${currency}`;
}

function count(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '–';
  return formatNumber(value);
}

const topGift = computed(() => {
  const gift = props.earnings?.top_gift;
  if (!gift) return '–';
  const parts = [gift.name];
  if (gift.coins != null) parts.push(`${count(gift.coins)} Coins`);
  if (gift.count != null) parts.push(`${count(gift.count)}×`);
  return parts.join(' · ');
});

const topGifter = computed(() => {
  const gifter = props.earnings?.top_gifter;
  if (!gifter) return '–';
  const name = gifter.display_name || gifter.username;
  return gifter.coins == null ? name : `${name} · ${count(gifter.coins)} Coins`;
});

const sessionText = computed(() => {
  const session = props.earnings?.session;
  if (!session) return '–';
  const parts = [money(session.net, session.currency)];
  if (session.coins != null) parts.push(`${count(session.coins)} Coins`);
  if (session.gifts != null) parts.push(`${count(session.gifts)} Gifts`);
  return parts.join(' · ');
});

const sessionDetail = computed(() => {
  const session = props.earnings?.session;
  if (!session) return '';
  const parts: string[] = [];
  if (session.started_at) parts.push(`Start ${formatDateTime(session.started_at)}`);
  if (session.peak_viewers != null) parts.push(`Peak ${count(session.peak_viewers)}`);
  if (session.last_fan_tickets != null) parts.push(`${count(session.last_fan_tickets)} Fan-Tickets`);
  if (session.status) parts.push(session.status);
  return parts.join(' · ');
});

const ratesText = computed(() => {
  const rates = props.earnings?.rates;
  if (!rates) return '';
  const parts: string[] = [];
  if (rates.usd_per_diamond != null) parts.push(`${formatNumber(rates.usd_per_diamond, 4)} USD/Diamond`);
  if (rates.gross_usd_per_coin != null) {
    parts.push(`${formatNumber(rates.gross_usd_per_coin, 4)} USD/Coin brutto`);
  }
  if (rates.usd_to_eur_rate != null) parts.push(`1 USD = ${formatNumber(rates.usd_to_eur_rate, 4)} EUR`);
  return parts.join(' · ');
});

const sourceText = computed(() => {
  const parts: string[] = [];
  if (props.earnings?.updated_at) parts.push(`Aktualisiert ${formatDateTime(props.earnings.updated_at)}`);
  if (props.earnings?.diagnostics?.state) parts.push(`Monitor ${props.earnings.diagnostics.state}`);
  if (props.earnings?.source) parts.push(props.earnings.source);
  return parts.join(' · ');
});
</script>

<template>
  <section class="card earnings-panel" aria-labelledby="earnings-title">
    <div class="card-head">
      <div>
        <h2 id="earnings-title" class="card-title">Einnahmen</h2>
        <p class="card-sub">
          {{ earnings?.period_label ?? 'Heute' }}
          <template v-if="streamerLabel"> · {{ streamerLabel }}</template>
        </p>
      </div>
      <div class="card-badges">
        <span class="badge" :class="statusTone">{{ statusLabel }}</span>
        <span v-if="earnings?.is_live != null" class="badge" :class="earnings.is_live ? 'tone-success' : 'tone-muted'">
          {{ earnings.is_live ? 'Live' : 'Offline' }}
        </span>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="refreshing || !earnings?.configured"
          @click="emit('refresh')"
        >
          <span v-if="refreshing" class="spinner" aria-hidden="true"></span>
          Aktualisieren
        </button>
      </div>
    </div>

    <div v-if="statusMessage" class="alert" :class="status === 'error' ? 'alert-error' : 'alert-info'" role="status">
      {{ statusMessage }}
    </div>

    <div v-if="earnings" class="earnings-kpis" :class="{ 'is-compact': isCompact }">
      <div class="earnings-kpi earnings-kpi-period">
        <span class="earnings-kpi-label">Zeitraum</span>
        <strong class="earnings-kpi-value">{{ earnings.period_label }}</strong>
      </div>
      <div class="earnings-kpi earnings-kpi-net">
        <span class="earnings-kpi-label">Netto</span>
        <strong class="earnings-kpi-value">{{ money(earnings.net) }}</strong>
      </div>
      <template v-if="!isCompact">
        <div class="earnings-kpi">
          <span class="earnings-kpi-label">Brutto</span>
          <strong class="earnings-kpi-value">{{ money(earnings.gross) }}</strong>
        </div>
        <div class="earnings-kpi">
          <span class="earnings-kpi-label">Coins</span>
          <strong class="earnings-kpi-value">{{ count(earnings.coins) }}</strong>
        </div>
        <div class="earnings-kpi">
          <span class="earnings-kpi-label">Gifts</span>
          <strong class="earnings-kpi-value">{{ count(earnings.gifts) }}</strong>
        </div>
        <div class="earnings-kpi">
          <span class="earnings-kpi-label">Gifter</span>
          <strong class="earnings-kpi-value">{{ count(earnings.gifters) }}</strong>
        </div>
      </template>
    </div>

    <div v-if="isDetailed && hasData && earnings" class="earnings-details">
      <div class="earnings-detail">
        <span class="earnings-detail-label">Session</span>
        <strong>{{ sessionText }}</strong>
        <small v-if="sessionDetail">{{ sessionDetail }}</small>
      </div>
      <div class="earnings-detail">
        <span class="earnings-detail-label">Zuschauer</span>
        <strong>{{ count(earnings.viewers) }}</strong>
        <small>{{ count(earnings.followers) }} Follower</small>
      </div>
      <div class="earnings-detail">
        <span class="earnings-detail-label">Top-Gift</span>
        <strong>{{ topGift }}</strong>
      </div>
      <div class="earnings-detail">
        <span class="earnings-detail-label">Top-Gifter</span>
        <strong>{{ topGifter }}</strong>
      </div>
      <div class="earnings-detail">
        <span class="earnings-detail-label">Gifts gesamt</span>
        <strong>{{ count(earnings.gifts_sent) }}</strong>
        <small>{{ count(earnings.gifts) }} Events · {{ count(earnings.gifters) }} Gifter</small>
      </div>
      <div class="earnings-detail">
        <span class="earnings-detail-label">Zuletzt gesehen</span>
        <strong>{{ formatDateTime(earnings.last_seen_at) }}</strong>
        <small v-if="earnings.room_id">Room {{ earnings.room_id }}</small>
      </div>
      <div v-if="ratesText" class="earnings-detail earnings-detail-wide">
        <span class="earnings-detail-label">Kurse</span>
        <strong class="mono">{{ ratesText }}</strong>
      </div>
      <div v-if="earnings.diagnostics" class="earnings-detail earnings-detail-wide">
        <span class="earnings-detail-label">Monitor</span>
        <strong>
          {{ earnings.diagnostics.state ?? '–' }}
          <template v-if="earnings.diagnostics.connected_since">
            · verbunden seit {{ formatDateTime(earnings.diagnostics.connected_since) }}
          </template>
          <template v-if="earnings.diagnostics.reconnect_attempts != null">
            · {{ count(earnings.diagnostics.reconnect_attempts) }} Reconnects
          </template>
        </strong>
        <small v-if="earnings.diagnostics.last_message">{{ earnings.diagnostics.last_message }}</small>
      </div>
    </div>

    <p v-if="sourceText" class="earnings-source muted small">{{ sourceText }}</p>
  </section>
</template>
