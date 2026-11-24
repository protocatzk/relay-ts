/**
 * Optimistic mutations (#88).
 *
 * Pattern: apply a local guess immediately, fire the request, keep the guess
 * when the server confirms it and roll the visible state back with a toast when
 * the request fails. The confirm/rollback primitives live in `useStore` so a
 * status arriving over SSE cannot flicker the guess away.
 */
import { errorMessage } from '@/src/api/client';
import type { StatusPayload } from '@/src/api/types';
import { patchStatus, refreshStatus, rollbackStatus } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';

export interface OptimisticOptions {
  /** Fields to apply locally before the request starts. */
  patch?: Partial<StatusPayload>;
  /** The network call. */
  mutation: () => Promise<unknown>;
  /** Toast text on success; omit for silent success. */
  successMessage?: string;
  /** Toast text on failure; defaults to the API error. */
  errorMessage?: string;
}

export interface OptimisticResult {
  ok: boolean;
  result?: unknown;
}

/**
 * Runs `mutation` with an optional optimistic patch. Always resolves; the
 * caller decides whether to refresh further stores.
 */
export async function runOptimistic(options: OptimisticOptions): Promise<OptimisticResult> {
  const { pushToast } = useToast();
  if (options.patch) patchStatus(options.patch);
  try {
    const result = await options.mutation();
    // The guess stays until the server snapshot catches up (see OPTIMISTIC_TTL_MS);
    // confirming right away would let a stale SSE event flip it back.
    if (options.successMessage) pushToast(options.successMessage, 'success');
    void refreshStatus().catch(() => undefined);
    return { ok: true, result };
  } catch (error) {
    rollbackStatus();
    pushToast(options.errorMessage ?? errorMessage(error), 'error');
    void refreshStatus().catch(() => undefined);
    return { ok: false };
  }
}
