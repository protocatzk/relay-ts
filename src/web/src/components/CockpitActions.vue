<script setup lang="ts">
/**
 * Cockpit action row (#88).
 *
 * One button per registry action, ordered for the regie top tasks: switch,
 * pause, stop, next, sink, queue. Buttons disable themselves through the action
 * guards and explain why via `title`.
 */
import { computed } from 'vue';
import AppButton from '@/src/components/ui/AppButton.vue';
import { useActions } from '@/src/composables/useActions';
import type { ActionDef } from '@/src/actions';

const emit = defineEmits<{ 'queue-now': [] }>();

const { actions, busyId, isEnabled, reasonFor, runAction } = useActions();

/** Order shown in the cockpit, independent of registry order. */
const BASE_ORDER = ['stream.switch', 'screen.pause', 'stream.stop', 'queue.next', 'sink.restart'];

interface Entry {
  action: ActionDef;
  variant: 'accent' | 'primary' | 'danger' | 'secondary';
  icon: string;
}

const BASE_ICONS: Record<string, string> = {
  'stream.switch': 'M7 4v16M7 4l-3 3M7 4l3 3M17 20V4M17 20l3-3M17 20l-3-3',
  'screen.pause': 'M8 5v14M16 5v14',
  'stream.stop': 'M6 6h12v12H6z',
  'queue.next': 'M5 5l10 7-10 7zM19 5v14',
  'sink.restart': 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
};

const VARIANTS: Record<string, Entry['variant']> = {
  'stream.start': 'primary',
  'stream.switch': 'accent',
  'screen.pause': 'primary',
  'stream.stop': 'danger',
  'queue.next': 'secondary',
  'sink.restart': 'secondary',
};

const ICONS: Record<string, string> = {
  'stream.start': 'M8 5v14l11-7z',
};

const entries = computed<Entry[]>(() => {
  const start = actions.value.find((action) => action.id === 'stream.start');
  // "Start" only appears while the cockpit is idle, otherwise it would always be
  // disabled and just add noise.
  const order = start && isEnabled(start) ? ['stream.start', ...BASE_ORDER] : BASE_ORDER;
  return order
    .map((id) => {
      const action = actions.value.find((entry) => entry.id === id);
      if (!action) return null;
      return { action, variant: VARIANTS[id] ?? 'secondary', icon: ICONS[id] ?? BASE_ICONS[id] ?? '' };
    })
    .filter((entry): entry is Entry => entry !== null);
});

function titleFor(entry: Entry): string {
  const reason = reasonFor(entry.action);
  return reason ?? entry.action.description;
}
</script>

<template>
  <div class="cockpit-actions" role="group" aria-label="Regie-Aktionen">
    <AppButton
      v-for="entry in entries"
      :key="entry.action.id"
      :variant="entry.variant"
      size="sm"
      :loading="busyId === entry.action.id"
      :disabled="!isEnabled(entry.action) || (busyId !== null && busyId !== entry.action.id)"
      :title="titleFor(entry)"
      @click="runAction(entry.action.id)"
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
        <path
          :d="entry.icon"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      {{ entry.action.label }}
    </AppButton>
    <AppButton
      variant="secondary"
      size="sm"
      title="Eintrag aus der Regie-Queue auswählen und sofort abspielen"
      @click="emit('queue-now')"
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
        <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
      </svg>
      Queue +
    </AppButton>
  </div>
</template>
