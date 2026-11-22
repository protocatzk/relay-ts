import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { ApiContext } from '../context.js';
import { createDefaultAgentToolRegistry } from '../../core/mcp/tool-registry.js';
import { createRelayMcpServer } from '../../core/mcp/server.js';

export async function registerMcpRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  const toolRegistry = createDefaultAgentToolRegistry();
  const mcpContext = {
    supervisor: ctx.supervisor,
    store: ctx.store,
    logger: ctx.logger.child({ module: 'mcp' }),
    audit: ctx.audit,
    scenes: ctx.scenes,
    discovery: ctx.discovery,
  };

  const mcpServer = createRelayMcpServer(toolRegistry, mcpContext);
  const transports = new Map<string, SSEServerTransport>();

  // 1. SSE Connection Endpoint for MCP Clients
  app.get('/api/mcp/sse', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    const transport = new SSEServerTransport('/api/mcp/message', reply.raw);
    const sessionId = transport.sessionId;
    transports.set(sessionId, transport);

    request.raw.on('close', () => {
      transports.delete(sessionId);
    });

    await mcpServer.connect(transport);
  });

  // 2. Incoming JSON-RPC Messages from MCP Client
  app.post('/api/mcp/message', async (request: FastifyRequest, reply: FastifyReply) => {
    const sessionId = (request.query as { sessionId?: string })?.sessionId;
    if (!sessionId || !transports.has(sessionId)) {
      return reply.code(400).send({ error: 'Ungültige oder fehlende sessionId' });
    }
    const transport = transports.get(sessionId)!;
    await transport.handlePostMessage(request.raw, reply.raw, request.body);
  });

  // 3. Simple REST Tool Inspection / Direct Invocation (internal agent / dashboard)
  app.get('/api/mcp/tools', async () => {
    return {
      tools: toolRegistry.list().map((t) => ({
        name: t.name,
        description: t.description,
      })),
    };
  });

  app.post('/api/mcp/tools/:name', async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    const res = await toolRegistry.execute(name, request.body, mcpContext, 'agent');
    return { ok: true, result: res };
  });
}
