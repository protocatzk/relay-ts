import { describe, it, expect, vi } from 'vitest';
import { createDefaultAgentToolRegistry } from '../src/core/mcp/tool-registry.js';
import { createRelayMcpServer } from '../src/core/mcp/server.js';

describe('MCP Tool Registry & Server', () => {
  const supervisor = {
    buildStatus: vi.fn().mockReturnValue({ state: 'live', active_streamer_id: 'alice' }),
    buildQueueSnapshot: vi.fn().mockReturnValue({ entries: [], playing: false, index: null, loop: false }),
    streamersView: vi.fn().mockReturnValue([]),
    start: vi.fn().mockResolvedValue({ state: 'live' }),
    stop: vi.fn().mockResolvedValue({ state: 'idle' }),
    showScreen: vi.fn().mockResolvedValue({ state: 'paused' }),
    hideScreen: vi.fn().mockResolvedValue({ state: 'live' }),
    restartSink: vi.fn().mockResolvedValue({}),
    queuePlayNow: vi.fn().mockResolvedValue({}),
    sendChatTest: vi.fn(),
  } as any;

  const mockCtx = {
    supervisor,
    store: {} as any,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: () => mockCtx.logger,
    } as any,
    audit: { record: vi.fn() } as any,
  };

  it('registers core tools and executes them', async () => {
    const registry = createDefaultAgentToolRegistry();
    const tools = registry.list();

    expect(tools.length).toBeGreaterThan(10);
    expect(tools.some((t) => t.name === 'relay_get_status')).toBe(true);
    expect(tools.some((t) => t.name === 'relay_start_streamer')).toBe(true);

    const status = await registry.execute('relay_get_status', {}, mockCtx, 'mcp');
    expect(status).toEqual({ state: 'live', active_streamer_id: 'alice' });
    expect(supervisor.buildStatus).toHaveBeenCalled();
    expect(mockCtx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'mcp',
        action: 'tool.relay_get_status',
      }),
    );
  });

  it('initializes McpServer without errors', () => {
    const registry = createDefaultAgentToolRegistry();
    const mcpServer = createRelayMcpServer(registry, mockCtx);
    expect(mcpServer).toBeDefined();
  });
});
