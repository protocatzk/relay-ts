import { z } from 'zod';

export type AutomationNodeType =
  // Triggers
  | 'trigger_schedule'
  | 'trigger_stream_state'
  | 'trigger_streamer_status'
  | 'trigger_vital_threshold'
  | 'trigger_chat_event'
  | 'trigger_webhook'
  // Logic & Flow
  | 'flow_condition'
  | 'flow_delay'
  | 'flow_cooldown'
  // Actions
  | 'action_switch_streamer'
  | 'action_start_playlist'
  | 'action_queue_item'
  | 'action_screen'
  | 'action_overlay_scene'
  | 'action_send_chat'
  | 'action_telegram'
  | 'action_webhook'
  | 'action_restart_sink';

export interface WorkflowPosition {
  x: number;
  y: number;
}

export interface AutomationNode {
  id: string;
  type: AutomationNodeType;
  name: string;
  position: WorkflowPosition;
  parameters: Record<string, unknown>;
}

export interface AutomationConnection {
  id: string;
  fromNode: string;
  fromOutput: string; // 'out' | 'true' | 'false' | 'loop' | 'done'
  toNode: string;
  toInput: string; // 'in'
}

export interface WorkflowExecutionLog {
  id: string;
  workflowId: string;
  startedAt: string;
  finishedAt: string;
  status: 'success' | 'failed' | 'partial';
  triggerNodeId: string;
  executedNodeIds: string[];
  error?: string;
}

export interface AutomationWorkflow {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  nodes: AutomationNode[];
  connections: AutomationConnection[];
  createdAt: string;
  updatedAt: string;
  lastExecutedAt?: string;
  executionCount: number;
  lastExecutionStatus?: 'success' | 'failed' | 'partial';
}

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1) as z.ZodType<AutomationNodeType>,
  name: z.string().trim().min(1).max(100),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  parameters: z.record(z.string(), z.unknown()).default({}),
});

export const WorkflowConnectionSchema = z.object({
  id: z.string().min(1),
  fromNode: z.string().min(1),
  fromOutput: z.string().default('out'),
  toNode: z.string().min(1),
  toInput: z.string().default('in'),
});

export const AutomationWorkflowCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  enabled: z.boolean().default(true),
  nodes: z.array(WorkflowNodeSchema).default([]),
  connections: z.array(WorkflowConnectionSchema).default([]),
});

export const AutomationWorkflowUpdateSchema = AutomationWorkflowCreateSchema.partial();
