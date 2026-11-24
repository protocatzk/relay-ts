<script setup lang="ts">
/**
 * Cockpit widget column (#88): viewers, sink health, earnings and chat activity.
 *
 * Each card hides itself when its data source is unavailable instead of showing
 * a zero, so an offline chat overlay never claims "0 Zuschauer".
 */
import { computed, ref } from 'vue';
import Sparkline from '@/src/components/Sparkline.vue';
import { useTelemetry } from '@/src/composables/useTelemetry';
import { formatBitrate, formatFps, formatNumber } from '@/src/utils/format';
import type { ChatAnalyticsSnapshot, EarningsSnapshot, StatusPayload } from '@/src/api/types';

const props = defineProps<{
  status: StatusPayload | null;
  earnings: EarningsSnapshot | null;
  analytics: ChatAnalyticsSnapshot | null;
}>();

const { series } = useTelemetry();
const showAll = ref(false);

const viewers = computed(() => props.status?.chat.viewers ?? null);
const earningsValue = computed(() => {
  const value = props.earnings?.gross ?? props.earnings?.net ?? null;
  if (value === null) return null;
  const currency = props.earnings?.currency === 'USD' ? '$' : '€';
  return `${value.toFixed(2).replace('.', ',')} ${currency}`;
});

const earningsDelta = computed(() => {
  const delta = props.earnings?.delta?.net ?? props.earnings?.delta?.gross ?? null;
  if (delta === null || Math.abs(delta) < 0.01) return null;
  const currency = props.earnings?.currency === 'USD' ? '$' : '€';
  return {
    label: `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(2).replace('.', ',')} ${currency}`,
    tone: delta > 0 ? 'tone-success' : 'tone-danger',
  };
});
const sinkTone = computed(() => {
  const sink = props.status?.sink;
  if (!sink?.running) return 'muted';
  if (sink.last_error || (sink.dts_errors ?? 0) > 0 || sink.silence_active) return 'warning';
  return 'ok';
});
</script>

<template>
  <div class="cockpit-widgets">
    <section v-if="viewers !== null" class="card widget-card" aria-label="Zuschauer">
      <div class="widget-head">
        <span class="widget-label">Zuschauer</span>
        <span class="badge tone-success badge-xs">live</span>
      </div>
      <strong class="widget-value mono">{{ formatNumber(viewers) }}</strong>
      <Sparkline class="widget-spark" :values="series('source_kbps')" color="var(--success)" :height="26" />
    </section>

    <section class="card widget-card" aria-label="Sink">
      <div class="widget-head">
        <span class="widget-label">Sink</span>
        <span class="badge badge-xs" :class="`tone-${sinkTone === 'ok' ? 'success' : sinkTone}`">
          {{ status?.sink.running ? 'läuft' : 'aus' }}
        </span>
      </div>
      <strong class="widget-value mono">
        {{ formatBitrate(status?.sink.bitrate_kbps) }}
      </strong>
      <p class="widget-sub">
        {{ formatFps(status?.sink.fps) }} ·
        Ziel {{ formatBitrate(status?.sink.target_bitrate_kbps) }}
        <template v-if="(status?.sink.dts_errors ?? 0) > 0">
          · {{ formatNumber(status?.sink.dts_errors) }} DTS
        </template>
      </p>
      <Sparkline class="widget-spark" :values="series('sink_kbps')" color="var(--module-sink)" :height="26" />
    </section>

    <section v-if="earningsValue" class="card widget-card" aria-label="Einnahmen">
      <div class="widget-head">
        <span class="widget-label">Einnahmen · {{ earnings?.period_label ?? '24 h' }}</span>
        <span
          v-if="earningsDelta"
          class="badge badge-xs"
          :class="earningsDelta.tone"
        >
          {{ earningsDelta.label }}
        </span>
      </div>
      <strong class="widget-value mono">{{ earningsValue }}</strong>
      <p class="widget-sub">
        <template v-if="earnings?.coins != null">
          {{ formatNumber(earnings.coins) }} Coins<template v-if="earnings.streamer_name"> · {{ earnings.streamer_name }}</template>
        </template>
        <template v-else>Keine Coin-Daten</template>
      </p>
    </section>

    <section v-if="analytics" class="card widget-card widget-card-wide" aria-label="Chat-Aktivität">
      <div class="widget-head">
        <span class="widget-label">Chat · {{ analytics.window_minutes }} min</span>
        <button
          v-if="analytics.top_chatters.length > 0"
          type="button"
          class="widget-toggle"
          :aria-pressed="showAll"
          @click="showAll = !showAll"
        >
          {{ showAll ? 'Weniger' : 'Top-Chatter' }}
        </button>
      </div>
      <strong class="widget-value mono">
        {{ formatNumber(analytics.messages_per_minute) }} <small>/ min</small>
      </strong>
      <Sparkline class="widget-spark" :values="analytics.series" color="var(--module-chat)" :height="30" />
      <ul v-if="showAll" class="widget-list">
        <li v-for="chatter in analytics.top_chatters.slice(0, 5)" :key="chatter.username">
          <span>{{ chatter.username }}</span>
          <span class="mono">{{ chatter.count }}</span>
        </li>
      </ul>
      <p v-else class="widget-sub">
        Peak {{ formatNumber(analytics.peak_per_minute) }} / min ·
        {{ formatNumber(analytics.unique_chatters) }} Chatter
      </p>
    </section>
  </div>
</template>
