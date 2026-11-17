<script setup lang="ts">
import { computed } from 'vue';
import type { StreamState } from '@/src/api/types';
import { stateLabel, stateTone } from '@/src/utils/format';

const props = defineProps<{
  state: StreamState | null | undefined;
  large?: boolean;
}>();

const tone = computed(() => stateTone(props.state));
const label = computed(() => stateLabel(props.state));
const pulsing = computed(() => props.state === 'live' || props.state === 'reconnecting' || props.state === 'starting');
</script>

<template>
  <span class="badge status-badge" :class="[`tone-${tone}`, { 'badge-lg': large }]">
    <span class="dot" :class="{ 'dot-pulse': pulsing }" aria-hidden="true"></span>
    {{ label }}
  </span>
</template>
