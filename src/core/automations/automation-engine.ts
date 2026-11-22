import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { AuditLogStore } from '../audit-log.js';
import type { Supervisor } from '../supervisor/supervisor.js';
import type { SceneStore } from '../overlays/scene-store.js';
import type { WebhookDispatcher } from '../notifications/webhooks.js';
import type { TelegramBot } from '../telegram/bot.js';
import type { EventBus, StatusSnapshot } from '../events.js';
import { NotFoundError, ValidationError, toErrorMessage } from '../../utils/errors.js';
import { readJsonFile, writeJsonFile } from '../../utils/fs.js';
import { formatZodError } from '../config/schema.js';
import {
  AutomationWorkflowCreateSchema,
  AutomationWorkflowUpdateSchema,
  type AutomationConnection,
  type AutomationNode,
  type AutomationWorkflow,
  type WorkflowExecutionLog,
} from './types.js';

export interface AutomationEngineDeps {
  filePath: string;
  logger: Logger;
  supervisor: Supervisor;
  bus: EventBus;
  audit?: AuditLogStore;
  scenes?: SceneStore;
  webhooks?: WebhookDispatcher;
  telegramBot?: TelegramBot | null;
}

export class AutomationEngine {
  private readonly filePath: string;
  private readonly logger: Logger;
  private readonly supervisor: Supervisor;
  private readonly bus: EventBus;
  private readonly audit?: AuditLogStore;
  private readonly scenes?: SceneStore;
  private readonly webhooks?: WebhookDispatcher;
  private readonly telegramBot?: TelegramBot | null;

  private workflows: AutomationWorkflow[] = [];
  private executionLogs: WorkflowExecutionLog[] = [];
  private nodeCooldowns = new Map<string, number>(); // `${workflowId}:${nodeId}` -> timestamp
  private statusSubscription?: { unsubscribe: () => void };

  constructor(deps: AutomationEngineDeps) {
    this.filePath = deps.filePath;
    this.logger = deps.logger.child({ module: 'automations' });
    this.supervisor = deps.supervisor;
    this.bus = deps.bus;
    this.audit = deps.audit;
    this.scenes = deps.scenes;
    this.webhooks = deps.webhooks;
    this.telegramBot = deps.telegramBot;
  }

  async start(): Promise<void> {
    await this.load();
    this.initEventListeners();
    this.logger.info({ count: this.workflows.length }, 'Automation engine started');
  }

  stop(): void {
    if (this.statusSubscription) {
      this.statusSubscription.unsubscribe();
      this.statusSubscription = undefined;
    }
  }

  listWorkflows(): AutomationWorkflow[] {
    return this.workflows;
  }

  getWorkflow(id: string): AutomationWorkflow {
    const wf = this.workflows.find((w) => w.id === id);
    if (!wf) throw new NotFoundError(`Workflow ${id} nicht gefunden`);
    return wf;
  }

  async createWorkflow(raw: unknown): Promise<AutomationWorkflow> {
    const parsed = AutomationWorkflowCreateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(formatZodError(parsed.error));
    }
    const now = new Date().toISOString();
    const wf: AutomationWorkflow = {
      id: randomUUID(),
      name: parsed.data.name,
      description: parsed.data.description,
      enabled: parsed.data.enabled ?? true,
      nodes: (parsed.data.nodes as AutomationNode[]) ?? [],
      connections: (parsed.data.connections as AutomationConnection[]) ?? [],
      createdAt: now,
      updatedAt: now,
      executionCount: 0,
    };
    this.workflows.push(wf);
    await this.save();
    this.audit?.record({ actor: 'system:automations', source: 'system', action: 'automation.create', target: wf.name, result: 'ok' });
    return wf;
  }

  async updateWorkflow(id: string, raw: unknown): Promise<AutomationWorkflow> {
    const parsed = AutomationWorkflowUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(formatZodError(parsed.error));
    }
    const idx = this.workflows.findIndex((w) => w.id === id);
    if (idx === -1) throw new NotFoundError(`Workflow ${id} nicht gefunden`);

    const current = this.workflows[idx]!;
    const updated: AutomationWorkflow = {
      ...current,
      ...parsed.data,
      nodes: (parsed.data.nodes as AutomationNode[]) ?? current.nodes,
      connections: (parsed.data.connections as AutomationConnection[]) ?? current.connections,
      updatedAt: new Date().toISOString(),
    };
    this.workflows[idx] = updated;
    await this.save();
    this.audit?.record({ actor: 'system:automations', source: 'system', action: 'automation.update', target: updated.name, result: 'ok' });
    return updated;
  }

  async deleteWorkflow(id: string): Promise<void> {
    const idx = this.workflows.findIndex((w) => w.id === id);
    if (idx === -1) throw new NotFoundError(`Workflow ${id} nicht gefunden`);
    const [removed] = this.workflows.splice(idx, 1);
    await this.save();
    this.audit?.record({ actor: 'system:automations', source: 'system', action: 'automation.delete', target: removed?.name, result: 'ok' });
  }

  async executeWorkflow(id: string, triggerNodeId?: string, payload?: Record<string, unknown>): Promise<WorkflowExecutionLog> {
    const wf = this.getWorkflow(id);
    const execId = randomUUID();
    const startedAt = new Date().toISOString();
    const executedNodeIds: string[] = [];

    // Find starting trigger node (or first node)
    let startNode: AutomationNode | undefined;
    if (triggerNodeId) {
      startNode = wf.nodes.find((n) => n.id === triggerNodeId);
    }
    if (!startNode) {
      startNode = wf.nodes.find((n) => n.type.startsWith('trigger_')) ?? wf.nodes[0];
    }

    if (!startNode) {
      const log: WorkflowExecutionLog = {
        id: execId,
        workflowId: id,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: 'failed',
        triggerNodeId: '',
        executedNodeIds: [],
        error: 'Keine ausführbaren Nodes im Workflow vorhanden',
      };
      this.recordLog(log);
      return log;
    }

    this.logger.info({ workflowId: id, name: wf.name, startNode: startNode.name }, 'Executing workflow');

    // Run graph traversal starting from startNode
    try {
      await this.runNodeSequence(wf, startNode, payload ?? {}, executedNodeIds);
      const finishedAt = new Date().toISOString();
      const log: WorkflowExecutionLog = {
        id: execId,
        workflowId: id,
        startedAt,
        finishedAt,
        status: 'success',
        triggerNodeId: startNode.id,
        executedNodeIds,
      };
      wf.lastExecutedAt = finishedAt;
      wf.executionCount = (wf.executionCount ?? 0) + 1;
      wf.lastExecutionStatus = 'success';
      await this.save();
      this.recordLog(log);
      return log;
    } catch (err) {
      const finishedAt = new Date().toISOString();
      const errMsg = toErrorMessage(err);
      this.logger.error({ workflowId: id, error: errMsg }, 'Workflow execution failed');
      const log: WorkflowExecutionLog = {
        id: execId,
        workflowId: id,
        startedAt,
        finishedAt,
        status: 'failed',
        triggerNodeId: startNode.id,
        executedNodeIds,
        error: errMsg,
      };
      wf.lastExecutedAt = finishedAt;
      wf.executionCount = (wf.executionCount ?? 0) + 1;
      wf.lastExecutionStatus = 'failed';
      await this.save();
      this.recordLog(log);
      return log;
    }
  }

  private async runNodeSequence(
    wf: AutomationWorkflow,
    node: AutomationNode,
    context: Record<string, unknown>,
    executedIds: string[],
  ): Promise<void> {
    if (executedIds.includes(node.id)) {
      // Prevent infinite loops in cyclic graphs
      return;
    }
    executedIds.push(node.id);

    // Execute the current node
    const result = await this.executeSingleNode(wf, node, context);
    if (result.shouldHalt) {
      return;
    }

    // Determine outgoing port (e.g. 'out' or 'true' / 'false')
    const activePort = result.outputPort ?? 'out';

    // Find downstream nodes
    const outgoingConns = wf.connections.filter(
      (c) => c.fromNode === node.id && (c.fromOutput === activePort || c.fromOutput === 'out'),
    );

    for (const conn of outgoingConns) {
      const nextNode = wf.nodes.find((n) => n.id === conn.toNode);
      if (nextNode) {
        await this.runNodeSequence(wf, nextNode, { ...context, ...result.outputData }, executedIds);
      }
    }
  }

  private async executeSingleNode(
    wf: AutomationWorkflow,
    node: AutomationNode,
    ctx: Record<string, unknown>,
  ): Promise<{ outputPort?: string; outputData?: Record<string, unknown>; shouldHalt?: boolean }> {
    const params = node.parameters ?? {};

    switch (node.type) {
      case 'trigger_schedule':
      case 'trigger_stream_state':
      case 'trigger_streamer_status':
      case 'trigger_vital_threshold':
      case 'trigger_chat_event':
      case 'trigger_webhook':
        return { outputPort: 'out', outputData: { ...ctx, ...params } };

      case 'flow_cooldown': {
        const seconds = Number(params.seconds ?? 60);
        const key = `${wf.id}:${node.id}`;
        const last = this.nodeCooldowns.get(key) ?? 0;
        const now = Date.now();
        if (now - last < seconds * 1000) {
          this.logger.debug({ node: node.name, key }, 'Cooldown active – halting workflow execution');
          return { shouldHalt: true };
        }
        this.nodeCooldowns.set(key, now);
        return { outputPort: 'out' };
      }

      case 'flow_delay': {
        const ms = Math.min(Math.max(Number(params.seconds ?? 1) * 1000, 100), 30000);
        await new Promise((r) => setTimeout(r, ms));
        return { outputPort: 'out' };
      }

      case 'flow_condition': {
        // Evaluate condition (e.g. state equals 'live', or streamer online)
        const field = String(params.field ?? 'state');
        const operator = String(params.operator ?? 'equals');
        const expected = String(params.value ?? '');

        const status = this.supervisor.buildStatus();
        let actual = '';
        if (field === 'state') actual = status.state;
        else if (field === 'active_streamer') actual = status.active_streamer_id ?? '';
        else if (field === 'sink_running') actual = String(status.sink.running);

        let match = false;
        if (operator === 'equals') match = actual === expected;
        else if (operator === 'not_equals') match = actual !== expected;
        else if (operator === 'contains') match = actual.includes(expected);

        return { outputPort: match ? 'true' : 'false' };
      }

      case 'action_switch_streamer': {
        const streamerId = String(params.streamer_id ?? '');
        if (streamerId) {
          await this.supervisor.start(streamerId);
        }
        return { outputPort: 'out' };
      }

      case 'action_start_playlist': {
        const playlistId = String(params.playlist_id ?? '');
        if (playlistId) {
          await this.supervisor.playPlaylist(playlistId);
        }
        return { outputPort: 'out' };
      }

      case 'action_screen': {
        const screenType = String(params.screen ?? 'pause') as 'startup' | 'pause';
        const action = String(params.action ?? 'start');
        if (action === 'start') {
          await this.supervisor.showScreen(screenType);
        } else {
          await this.supervisor.hideScreen();
        }
        return { outputPort: 'out' };
      }

      case 'action_restart_sink': {
        await this.supervisor.restartSink();
        return { outputPort: 'out' };
      }

      case 'action_overlay_scene': {
        const sceneId = String(params.scene_id ?? '');
        if (sceneId && this.scenes) {
          await this.supervisor.activateScene(sceneId);
        }
        return { outputPort: 'out' };
      }

      case 'action_telegram': {
        const text = String(params.text ?? 'Relay Automation Alert');
        if (this.telegramBot) {
          this.logger.info({ text }, 'Triggered Telegram automation action');
        }
        return { outputPort: 'out' };
      }

      case 'action_webhook': {
        const url = String(params.url ?? '');
        const message = String(params.message ?? 'Automation event');
        if (url) {
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event: 'relay_automation', message, timestamp: new Date().toISOString() }),
          }).catch((err) => {
            this.logger.warn({ url, err: toErrorMessage(err) }, 'Webhook action failed');
          });
        }
        return { outputPort: 'out' };
      }

      default:
        return { outputPort: 'out' };
    }
  }

  private initEventListeners(): void {
    let lastState: string | null = null;

    this.statusSubscription = this.bus.observe().subscribe((event) => {
      if (event.type === 'status') {
        const snap = event.data;
        if (lastState && lastState !== snap.state) {
          this.checkStateChangeWorkflows(lastState, snap.state, snap);
        }
        lastState = snap.state;
      }
    });
  }

  private checkStateChangeWorkflows(fromState: string, toState: string, snap: StatusSnapshot): void {
    for (const wf of this.workflows) {
      if (!wf.enabled) continue;
      const stateTrigger = wf.nodes.find((n) => n.type === 'trigger_stream_state');
      if (stateTrigger) {
        const targetState = stateTrigger.parameters.target_state;
        if (!targetState || targetState === toState) {
          void this.executeWorkflow(wf.id, stateTrigger.id, { fromState, toState, status: snap });
        }
      }
    }
  }

  private recordLog(log: WorkflowExecutionLog): void {
    this.executionLogs.unshift(log);
    if (this.executionLogs.length > 50) {
      this.executionLogs.pop();
    }
  }

  getExecutionLogs(): WorkflowExecutionLog[] {
    return this.executionLogs;
  }

  private async load(): Promise<void> {
    try {
      const data = readJsonFile<AutomationWorkflow[]>(this.filePath, []);
      if (Array.isArray(data)) {
        this.workflows = data;
      }
    } catch {
      this.workflows = [];
    }
  }

  private async save(): Promise<void> {
    await writeJsonFile(this.filePath, this.workflows);
  }
}
