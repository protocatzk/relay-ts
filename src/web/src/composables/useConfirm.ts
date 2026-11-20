import { reactive } from 'vue';

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
}

interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: 'danger' | 'primary';
}

const state = reactive<ConfirmState>({
  open: false,
  title: 'Bestätigen',
  message: '',
  confirmLabel: 'Bestätigen',
  cancelLabel: 'Abbrechen',
  tone: 'danger',
});

let resolver: ((confirmed: boolean) => void) | null = null;

/**
 * Opens an app-styled confirmation modal and resolves to `true` when confirmed
 * or `false` when cancelled/dismissed. Replaces native `window.confirm()`.
 */
export function confirmAction(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  if (resolver) {
    resolver(false);
    resolver = null;
  }
  state.title = options.title ?? 'Bestätigen';
  state.message = message;
  state.confirmLabel = options.confirmLabel ?? 'Bestätigen';
  state.cancelLabel = options.cancelLabel ?? 'Abbrechen';
  state.tone = options.tone ?? 'danger';
  state.open = true;
  return new Promise<boolean>((resolve) => {
    resolver = resolve;
  });
}

function finish(result: boolean): void {
  state.open = false;
  const resolve = resolver;
  resolver = null;
  resolve?.(result);
}

export function useConfirmDialog() {
  return {
    state,
    confirm: () => finish(true),
    cancel: () => finish(false),
  };
}
