/**
 * Runs registry actions with shared busy state, toasts and a status refresh (#88).
 *
 * Views pass the current context so pure guards stay authoritative and the same
 * action behaves identically in the cockpit row, the queue menu and the palette.
 */
import { computed, ref } from 'vue';
import { errorMessage } from '@/src/api/client';
import {
  buildActions,
  type ActionContext,
  type ActionDef,
  type ActionRunInput,
} from '@/src/actions';
import { patchStatus, rollbackStatus, useStore } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';

export function useActions() {
  const { store, refreshStatus, refreshStreamers } = useStore();
  const { pushToast } = useToast();
  const busyId = ref<string | null>(null);

  const actions = computed<ActionDef[]>(() => buildActions());
  const context = computed<ActionContext>(() => ({
    status: store.status,
    streamers: store.streamers,
  }));

  function isEnabled(action: ActionDef): boolean {
    return action.enabled(context.value);
  }

  function reasonFor(action: ActionDef): string | null {
    return action.reason?.(context.value) ?? null;
  }

  async function runAction(
    id: string,
    input: Partial<ActionRunInput> = {},
  ): Promise<unknown> {
    const action = actions.value.find((entry) => entry.id === id);
    if (!action) return undefined;
    if (!action.enabled(context.value)) {
      const reason = action.reason?.(context.value);
      pushToast(reason ?? 'Aktion ist gerade nicht verfügbar.', 'error');
      return undefined;
    }
    const payload: ActionRunInput = { ...context.value, ...input };
    busyId.value = id;
    let patched = false;
    try {
      const guess = action.optimistic?.(payload) ?? null;
      if (guess) {
        patchStatus(guess);
        patched = true;
      }
      const result = await action.run(payload);
      await Promise.allSettled([refreshStatus(), refreshStreamers()]);
      const note = action.success?.(payload, result) ?? {
        message: action.label,
        kind: 'success' as const,
      };
      pushToast(note.message, note.kind);
      return result;
    } catch (error) {
      if (patched) rollbackStatus();
      pushToast(errorMessage(error), 'error');
      await Promise.allSettled([refreshStatus(), refreshStreamers()]);
      return undefined;
    } finally {
      busyId.value = null;
    }
  }

  return { actions, context, busyId, isEnabled, reasonFor, runAction };
}

/**
 * Runs an action outside a component scope (command palette). The busy state is
 * local to this call, which is fine because the palette closes immediately.
 */
export async function runRegistryAction(
  id: string,
  input: Partial<ActionRunInput> = {},
): Promise<unknown> {
  return useActions().runAction(id, input);
}
