import { reactive } from 'vue';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const toasts = reactive<Toast[]>([]);
const timers = new Map<number, number>();
let nextId = 1;

export function dismissToast(id: number): void {
  const index = toasts.findIndex((toast) => toast.id === id);
  if (index !== -1) toasts.splice(index, 1);
  const timer = timers.get(id);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timers.delete(id);
  }
}

export function pushToast(message: string, kind: ToastKind = 'info', duration = 4500): number {
  const id = nextId++;
  toasts.push({ id, kind, message });
  while (toasts.length > 5) {
    const oldest = toasts[0];
    if (oldest) dismissToast(oldest.id);
    else toasts.shift();
  }
  const timer = window.setTimeout(() => dismissToast(id), duration);
  timers.set(id, timer);
  return id;
}

export function useToast() {
  return { toasts, pushToast, dismissToast };
}
