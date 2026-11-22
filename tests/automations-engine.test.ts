import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AutomationEngine } from '../src/core/automations/automation-engine.js';
import { EventBus } from '../src/core/events.js';
import type { Logger } from 'pino';

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  child: () => mockLogger,
} as unknown as Logger;

describe('AutomationEngine', () => {
  let bus: EventBus;
  let supervisor: any;
  let engine: AutomationEngine;

  beforeEach(() => {
    bus = new EventBus();
    supervisor = {
      buildStatus: vi.fn().mockReturnValue({ state: 'live', active_streamer_id: 'alice', sink: { running: true } }),
      start: vi.fn().mockResolvedValue({}),
      playPlaylist: vi.fn().mockResolvedValue({}),
      showScreen: vi.fn().mockResolvedValue({}),
      hideScreen: vi.fn().mockResolvedValue({}),
      restartSink: vi.fn().mockResolvedValue({}),
      activateScene: vi.fn().mockResolvedValue({}),
    };

    engine = new AutomationEngine({
      filePath: '/tmp/test-automations.json',
      logger: mockLogger,
      supervisor,
      bus,
    });
  });

  it('creates, lists and updates workflows', async () => {
    const wf = await engine.createWorkflow({
      name: 'Stream Failover',
      description: 'Switch to playlist on error',
      nodes: [
        {
          id: 'node-1',
          type: 'trigger_stream_state',
          name: 'State Changed',
          position: { x: 100, y: 100 },
          parameters: { target_state: 'error' },
        },
        {
          id: 'node-2',
          type: 'action_start_playlist',
          name: 'Play Backup',
          position: { x: 350, y: 100 },
          parameters: { playlist_id: 'backup' },
        },
      ],
      connections: [
        {
          id: 'conn-1',
          fromNode: 'node-1',
          fromOutput: 'out',
          toNode: 'node-2',
          toInput: 'in',
        },
      ],
    });

    expect(wf.id).toBeDefined();
    expect(wf.name).toBe('Stream Failover');
    expect(engine.listWorkflows().length).toBe(1);

    const updated = await engine.updateWorkflow(wf.id, { name: 'Stream Failover v2' });
    expect(updated.name).toBe('Stream Failover v2');
  });

  it('executes a workflow traversing nodes and invoking actions', async () => {
    const wf = await engine.createWorkflow({
      name: 'Test Run',
      nodes: [
        {
          id: 'n1',
          type: 'trigger_webhook',
          name: 'Webhook Trigger',
          position: { x: 100, y: 100 },
          parameters: {},
        },
        {
          id: 'n2',
          type: 'action_restart_sink',
          name: 'Restart YouTube Sink',
          position: { x: 350, y: 100 },
          parameters: {},
        },
      ],
      connections: [
        {
          id: 'c1',
          fromNode: 'n1',
          fromOutput: 'out',
          toNode: 'n2',
          toInput: 'in',
        },
      ],
    });

    const result = await engine.executeWorkflow(wf.id, 'n1');
    expect(result.status).toBe('success');
    expect(result.executedNodeIds).toEqual(['n1', 'n2']);
    expect(supervisor.restartSink).toHaveBeenCalled();
  });
});
