import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../context.js';
import { AppError } from '../../utils/errors.js';

export async function registerAutomationRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  const requireEngine = () => {
    if (!ctx.automations) {
      throw new AppError('automations_unavailable', 'Automations-Engine nicht verfügbar', 503);
    }
    return ctx.automations;
  };

  app.get('/api/automations', async () => {
    const engine = requireEngine();
    return {
      workflows: engine.listWorkflows(),
      executions: engine.getExecutionLogs(),
    };
  });

  app.get('/api/automations/:id', async (request) => {
    const engine = requireEngine();
    const { id } = request.params as { id: string };
    return { workflow: engine.getWorkflow(id) };
  });

  app.post('/api/automations', async (request, reply) => {
    const engine = requireEngine();
    const workflow = await engine.createWorkflow(request.body);
    return reply.code(201).send({ workflow });
  });

  app.put('/api/automations/:id', async (request) => {
    const engine = requireEngine();
    const { id } = request.params as { id: string };
    const workflow = await engine.updateWorkflow(id, request.body);
    return { workflow };
  });

  app.delete('/api/automations/:id', async (request) => {
    const engine = requireEngine();
    const { id } = request.params as { id: string };
    await engine.deleteWorkflow(id);
    return { ok: true };
  });

  app.post('/api/automations/:id/execute', async (request) => {
    const engine = requireEngine();
    const { id } = request.params as { id: string };
    const body = (request.body as { triggerNodeId?: string; payload?: Record<string, unknown> }) ?? {};
    const log = await engine.executeWorkflow(id, body.triggerNodeId, body.payload);
    return {
      ok: log.status === 'success',
      execution: log,
      status: ctx.supervisor.buildStatus(),
    };
  });
}
