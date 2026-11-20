import { onBeforeUnmount, onMounted, reactive, toValue, type MaybeRefOrGetter } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';

export interface UnsavedDialogState {
  open: boolean;
  title: string;
  message: string;
}

const DEFAULT_TITLE = 'Ungespeicherte Änderungen';
const DEFAULT_MESSAGE =
  'Du hast ungespeicherte Änderungen. Möchtest du sie verwerfen und fortfahren?';

const dialogState = reactive<UnsavedDialogState>({
  open: false,
  title: DEFAULT_TITLE,
  message: DEFAULT_MESSAGE,
});

let pendingResolve: ((discard: boolean) => void) | null = null;

/** Shared state and actions for `UnsavedChangesDialog.vue`. */
export function useUnsavedDialog(): {
  state: UnsavedDialogState;
  stay: () => void;
  discard: () => void;
} {
  function finish(discardChanges: boolean): void {
    dialogState.open = false;
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve?.(discardChanges);
  }

  return {
    state: dialogState,
    stay: () => finish(false),
    discard: () => finish(true),
  };
}

/** Open the discard confirmation modal and resolve to `true` when the user chooses to discard. */
export function askDiscardChanges(options?: { title?: string; message?: string }): Promise<boolean> {
  if (pendingResolve) {
    pendingResolve(false);
    pendingResolve = null;
  }
  dialogState.title = options?.title ?? DEFAULT_TITLE;
  dialogState.message = options?.message ?? DEFAULT_MESSAGE;
  dialogState.open = true;
  return new Promise<boolean>((resolve) => {
    pendingResolve = resolve;
  });
}

export interface UnsavedChangesOptions {
  /** Custom title for the confirmation dialog. */
  title?: string;
  /** Custom body message for the confirmation dialog. */
  message?: string;
  /** Disable `onBeforeRouteLeave` when used outside a route view (defaults to true). */
  guardRoute?: boolean;
}

/**
 * Guard unsaved edits against accidental route changes, tab reloads/closes,
 * and manual close actions (via `confirmDiscard`).
 */
export function useUnsavedChanges(
  dirty: MaybeRefOrGetter<boolean>,
  options: UnsavedChangesOptions = {},
): {
  confirmDiscard: (overrideMessage?: string) => Promise<boolean>;
} {
  function onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!toValue(dirty)) return;
    event.preventDefault();
    event.returnValue = '';
  }

  onMounted(() => {
    window.addEventListener('beforeunload', onBeforeUnload);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', onBeforeUnload);
  });

  async function confirmDiscard(overrideMessage?: string): Promise<boolean> {
    if (!toValue(dirty)) return true;
    return askDiscardChanges({
      title: options.title,
      message: overrideMessage ?? options.message,
    });
  }

  if (options.guardRoute !== false) {
    onBeforeRouteLeave(async () => {
      if (!toValue(dirty)) return true;
      return askDiscardChanges({
        title: options.title,
        message: options.message,
      });
    });
  }

  return { confirmDiscard };
}
