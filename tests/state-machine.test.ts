import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { ALLOWED_TRANSITIONS, SupervisorStateMachine } from '../src/core/supervisor/state-machine.js';
import { nextReconnectDelay, reconnectDelay } from '../src/core/supervisor/reconnect-policy.js';
import { DEFAULT_SETTINGS } from '../src/core/config/schema.js';

describe('SupervisorStateMachine', () => {
  it('allows the normal live and reconnect transitions', () => {
    expect(ALLOWED_TRANSITIONS.idle).toContain('starting');
    expect(ALLOWED_TRANSITIONS.starting).toContain('live');
    expect(ALLOWED_TRANSITIONS.live).toContain('reconnecting');
    expect(ALLOWED_TRANSITIONS.reconnecting).toContain('paused');
    expect(ALLOWED_TRANSITIONS.paused).toContain('live');
    expect(ALLOWED_TRANSITIONS.live).toContain('stopping');
  });

  it('tracks state and warns about unexpected transitions', () => {
    const logger = pino({ level: 'silent' });
    const warn = vi.spyOn(logger, 'warn');
    const machine = new SupervisorStateMachine('idle', logger);
    machine.transition('starting');
    machine.transition('live');
    expect(machine.state).toBe('live');
    machine.transition('idle', 'test');
    expect(machine.state).toBe('idle');
    expect(warn).toHaveBeenCalled();
  });

  it('treats same-state transitions as no-ops', () => {
    const machine = new SupervisorStateMachine('paused');
    machine.transition('paused');
    expect(machine.state).toBe('paused');
  });
});

describe('reconnect policy', () => {
  it('backs off exponentially and caps at the configured maximum', () => {
    expect(nextReconnectDelay(1, 60)).toBe(2000);
    expect(nextReconnectDelay(2, 60)).toBe(4000);
    expect(nextReconnectDelay(4, 60)).toBe(16000);
    expect(nextReconnectDelay(10, 60)).toBe(60000);
  });

  it('honours an explicit delay', () => {
    expect(reconnectDelay(3, DEFAULT_SETTINGS, 1234)).toBe(1234);
    expect(reconnectDelay(3, DEFAULT_SETTINGS)).toBe(8000);
  });
});
