import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentToolRegistry, AgentToolContext } from './tool-registry.js';
import { VERSION } from '../../version.js';

export function createRelayMcpServer(registry: AgentToolRegistry, ctx: AgentToolContext): McpServer {
  const server = new McpServer({
    name: 'relay-mcp-server',
    version: VERSION,
  });

  // Resources
  server.resource(
    'relay-status',
    'relay://status',
    { description: 'Aktueller System- und Live-Stream-Status von RELAY' },
    async () => ({
      contents: [
        {
          uri: 'relay://status',
          mimeType: 'application/json',
          text: JSON.stringify(ctx.supervisor.buildStatus(), null, 2),
        },
      ],
    }),
  );

  server.resource(
    'relay-queue',
    'relay://queue',
    { description: 'Inhalt der aktuellen Regie-Warteschlange' },
    async () => ({
      contents: [
        {
          uri: 'relay://queue',
          mimeType: 'application/json',
          text: JSON.stringify(ctx.supervisor.buildQueueSnapshot(), null, 2),
        },
      ],
    }),
  );

  // Register all tools from registry into McpServer
  for (const tool of registry.list()) {
    const rawSchema = tool.schema instanceof z.ZodObject ? tool.schema.shape : {};
    server.tool(
      tool.name,
      tool.description,
      rawSchema,
      async (params: any) => {
        try {
          const res = await registry.execute(tool.name, params, ctx, 'mcp');
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(res, null, 2),
              },
            ],
          };
        } catch (err: any) {
          return {
            content: [
              {
                type: 'text',
                text: `Fehler bei ${tool.name}: ${err?.message || String(err)}`,
              },
            ],
            isError: true,
          };
        }
      },
    );
  }

  // Pre-configured Prompts
  server.prompt(
    'regie-briefing',
    'Erstellt ein kompaktes Regie-Briefing über den aktuellen Stream und Queue-Stand',
    async () => {
      const status = ctx.supervisor.buildStatus();
      const queue = ctx.supervisor.buildQueueSnapshot();
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Bitte gib mir ein Regie-Briefing zu RELAY:\n- Status: ${status.state}\n- Aktiver Streamer: ${status.active_streamer_name || status.active_streamer_id || 'keiner'}\n- Bitrate: ${status.sink.bitrate_kbps || 0} kbps, FPS: ${status.sink.fps || 0}\n- Queue: ${queue.entries.length} Einträge (Wiedergabe: ${queue.playing ? 'aktiv' : 'inaktiv'})\n- Empfehlung für nächste Regie-Schritte?`,
            },
          },
        ],
      };
    },
  );

  return server;
}
