import type { Logger } from 'pino';
import type { StreamState } from '../events.js';

/**
 * Explicit transition table for the supervisor. Keeping this in one place
 * makes reconnect/pause/playlist edge cases visible instead of scattering
 * assignments across the coordinator.
 */
export const ALLOWED_TRANSITIONS: Record<StreamState, readonly StreamState[]> = {
  idle: ['starting', 'stopping', 'error'],
  starting: ['live', 'paused', 'reconnecting', 'error', 'stopping', 'idle'],
  live: ['starting', 'reconnecting', 'paused', 'stopping', 'error'],
  reconnecting: ['starting', 'live', 'paused', 'error', 'stopping', 'idle'],
  paused: ['starting', 'live', 'reconnecting', 'stopping', 'error', 'idle'],
  stopping: ['idle', 'error'],
  error: ['starting', 'reconnecting', 'paused', 'stopping', 'idle'],
};

export class SupervisorStateMachine {
  private current: StreamState;
  private readonly logger?: Logger;

  constructor(initial: StreamState = 'idle', logger?: Logger) {
    this.current = initial;
    this.logger = logger;
  }

  get state(): StreamState {
    return this.current;
  }

  canTransition(next: StreamState): boolean {
    if (next === this.current) return true;
    return ALLOWED_TRANSITIONS[this.current].includes(next);
  }

  /**
   * Change state while recording invalid transitions. Invalid transitions are
   * logged as warnings rather than thrown so a rare recovery path cannot take
   * the whole service down.
   */
  transition(next: StreamState, reason = ''): void {
    if (next === this.current) return;
    if (!this.canTransition(next)) {
      this.logger?.warn(
        { from: this.current, to: next, reason },
        'Unerwarteter Supervisor-Zustandswechsel',
      );
    }
    this.current = next;
  }
}
