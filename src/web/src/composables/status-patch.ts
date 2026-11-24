/**
 * Optimistic status overlay (#88).
 *
 * Keeps a local guess visible until the server catches up, and retains the
 * pre-click snapshot so a failed mutation can roll back. DOM-free on purpose so
 * it can be unit-tested in the Node environment; `useStore` owns the reactive
 * instance.
 */
import type { StatusPayload } from '../api/types.js';

/** How long a local guess survives before a server snapshot wins again. */
export const OPTIMISTIC_TTL_MS = 2000;

export interface StatusHolder {
  status: StatusPayload | null;
}

interface PendingPatch {
  /** Server state right before the guess, used for rollback. */
  snapshot: StatusPayload;
  /** Fields the guess changed; re-applied over newer server snapshots. */
  fields: Partial<StatusPayload>;
  at: number;
}

export class StatusPatchStore {
  private pending: PendingPatch | null = null;

  constructor(private readonly holder: StatusHolder) {}

  /** True while an optimistic patch has not been confirmed or rolled back. */
  get hasPending(): boolean {
    return this.pending !== null;
  }

  /**
   * Applies a local guess immediately so the UI reacts within one frame. The
   * previous server snapshot is kept for `rollback`.
   */
  patch(patch: Partial<StatusPayload>): void {
    const current = this.holder.status;
    if (!current) return;
    // An expired guess is no longer worth rolling back to; start a fresh one.
    if (this.pending && Date.now() - this.pending.at > OPTIMISTIC_TTL_MS) {
      this.pending = null;
    }
    if (!this.pending) {
      this.pending = {
        snapshot: JSON.parse(JSON.stringify(current)) as StatusPayload,
        fields: {},
        at: Date.now(),
      };
    }
    this.pending.fields = { ...this.pending.fields, ...patch };
    this.pending.at = Date.now();
    this.holder.status = { ...current, ...patch };
  }

  /** Drops the local guess and restores the snapshot from before the click. */
  rollback(): void {
    if (!this.pending) return;
    this.holder.status = this.pending.snapshot;
    this.pending = null;
  }

  /** Keeps whatever the server says next; the guess has been confirmed. */
  confirm(): void {
    this.pending = null;
  }

  /**
   * Status snapshots from SSE or polling must not flicker a fresh guess away.
   * Within `OPTIMISTIC_TTL_MS` the patched fields win; after that the server does.
   */
  merge(next: StatusPayload, now = Date.now()): StatusPayload {
    if (!this.pending) return next;
    if (now - this.pending.at > OPTIMISTIC_TTL_MS) {
      this.pending = null;
      return next;
    }
    return { ...next, ...this.pending.fields };
  }
}
