<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import type {
  AutomationConnection,
  AutomationNode,
  AutomationNodeType,
  AutomationWorkflow,
  WorkflowExecutionLog,
} from '@/src/api/types';
import { useToast } from '@/src/composables/useToast';
import { useStore } from '@/src/composables/useStore';

const { pushToast } = useToast();
const { store } = useStore();

const workflows = ref<AutomationWorkflow[]>([]);
const executions = ref<WorkflowExecutionLog[]>([]);
const activeWorkflow = ref<AutomationWorkflow | null>(null);
const loading = ref(false);
const executing = ref(false);
const activeTab = ref<'editor' | 'executions'>('editor');

// Canvas Zoom & Pan
const panX = ref(100);
const panY = ref(100);
const zoom = ref(1);
const isPanning = ref(false);
const panStart = { x: 0, y: 0 };

// Dragging Node
const draggingNodeId = ref<string | null>(null);
const dragOffset = { x: 0, y: 0 };

// Connecting Nodes
const connectingFrom = ref<{ nodeId: string; output: string } | null>(null);
const connectMousePos = ref<{ x: number; y: number }>({ x: 0, y: 0 });

// Selected Node for Drawer
const selectedNode = ref<AutomationNode | null>(null);

// Node Catalog Definitions (for Add Node menu)
interface NodeTypeDef {
  type: AutomationNodeType;
  label: string;
  category: 'trigger' | 'flow' | 'action';
  icon: string;
  color: string;
  outputs: string[];
}

const NODE_CATALOG: NodeTypeDef[] = [
  // Triggers
  {
    type: 'trigger_stream_state',
    label: 'Stream-Status',
    category: 'trigger',
    icon: '⚡',
    color: '#f97316',
    outputs: ['out'],
  },
  {
    type: 'trigger_schedule',
    label: 'Zeitplan (Cron)',
    category: 'trigger',
    icon: '⏱️',
    color: '#eab308',
    outputs: ['out'],
  },
  {
    type: 'trigger_webhook',
    label: 'Webhook Trigger',
    category: 'trigger',
    icon: '🪝',
    color: '#ec4899',
    outputs: ['out'],
  },
  // Flow & Logic
  {
    type: 'flow_condition',
    label: 'Bedingung (IF)',
    category: 'flow',
    icon: '🔀',
    color: '#22c55e',
    outputs: ['true', 'false'],
  },
  {
    type: 'flow_cooldown',
    label: 'Cooldown Filter',
    category: 'flow',
    icon: '🛡️',
    color: '#10b981',
    outputs: ['out'],
  },
  {
    type: 'flow_delay',
    label: 'Verzögerung',
    category: 'flow',
    icon: '⏳',
    color: '#06b6d4',
    outputs: ['out'],
  },
  // Actions
  {
    type: 'action_switch_streamer',
    label: 'Streamer wechseln',
    category: 'action',
    icon: '👤',
    color: '#3b82f6',
    outputs: ['out'],
  },
  {
    type: 'action_start_playlist',
    label: 'Playlist abspielen',
    category: 'action',
    icon: '📋',
    color: '#6366f1',
    outputs: ['out'],
  },
  {
    type: 'action_screen',
    label: 'Pause / Startbild',
    category: 'action',
    icon: '📺',
    color: '#8b5cf6',
    outputs: ['out'],
  },
  {
    type: 'action_overlay_scene',
    label: 'Overlay-Szene',
    category: 'action',
    icon: '🎨',
    color: '#a855f7',
    outputs: ['out'],
  },
  {
    type: 'action_restart_sink',
    label: 'Sink neu starten',
    category: 'action',
    icon: '🔄',
    color: '#ef4444',
    outputs: ['out'],
  },
  {
    type: 'action_telegram',
    label: 'Telegram Alert',
    category: 'action',
    icon: '✈️',
    color: '#0ea5e9',
    outputs: ['out'],
  },
  {
    type: 'action_webhook',
    label: 'HTTP Request (🌐)',
    category: 'action',
    icon: '🌐',
    color: '#8b5cf6',
    outputs: ['out'],
  },
];

const showAddMenu = ref(false);

function getNodeDef(type: AutomationNodeType): NodeTypeDef {
  return (
    NODE_CATALOG.find((n) => n.type === type) ?? {
      type,
      label: type,
      category: 'action',
      icon: '⚙️',
      color: '#6b7280',
      outputs: ['out'],
    }
  );
}

async function loadData(): Promise<void> {
  loading.value = true;
  try {
    const res = await api.automations.list();
    workflows.value = res.workflows;
    executions.value = res.executions;
    if (workflows.value.length > 0 && !activeWorkflow.value) {
      activeWorkflow.value = workflows.value[0]!;
    } else if (workflows.value.length === 0) {
      await createInitialWorkflow();
    }
  } catch (err) {
    pushToast(`Fehler beim Laden: ${errorMessage(err)}`, 'error');
  } finally {
    loading.value = false;
  }
}

async function createInitialWorkflow(): Promise<void> {
  try {
    const res = await api.automations.create({
      name: 'Stream Failover Automation',
      description: 'Schaltet auf Pausenscreen oder Backup wenn Stream offline geht',
      enabled: true,
      nodes: [
        {
          id: 'n_trigger_state',
          type: 'trigger_stream_state',
          name: 'Stream Status Changed',
          position: { x: 80, y: 150 },
          parameters: { target_state: 'error' },
        },
        {
          id: 'n_cooldown',
          type: 'flow_cooldown',
          name: 'Flapping Guard',
          position: { x: 340, y: 150 },
          parameters: { seconds: 30 },
        },
        {
          id: 'n_action_screen',
          type: 'action_screen',
          name: 'Pausenscreen aktivieren',
          position: { x: 590, y: 150 },
          parameters: { screen: 'pause', action: 'start' },
        },
      ],
      connections: [
        {
          id: 'c1',
          fromNode: 'n_trigger_state',
          fromOutput: 'out',
          toNode: 'n_cooldown',
          toInput: 'in',
        },
        {
          id: 'c2',
          fromNode: 'n_cooldown',
          fromOutput: 'out',
          toNode: 'n_action_screen',
          toInput: 'in',
        },
      ],
    });
    workflows.value.push(res.workflow);
    activeWorkflow.value = res.workflow;
  } catch (err) {
    pushToast(errorMessage(err), 'error');
  }
}

async function saveCurrentWorkflow(): Promise<void> {
  if (!activeWorkflow.value) return;
  try {
    const res = await api.automations.update(activeWorkflow.value.id, {
      name: activeWorkflow.value.name,
      description: activeWorkflow.value.description,
      enabled: activeWorkflow.value.enabled,
      nodes: activeWorkflow.value.nodes,
      connections: activeWorkflow.value.connections,
    });
    activeWorkflow.value = res.workflow;
    const idx = workflows.value.findIndex((w) => w.id === res.workflow.id);
    if (idx !== -1) workflows.value[idx] = res.workflow;
    pushToast('Workflow gespeichert', 'success');
  } catch (err) {
    pushToast(errorMessage(err), 'error');
  }
}

async function executeCurrentWorkflow(): Promise<void> {
  if (!activeWorkflow.value || executing.value) return;
  executing.value = true;
  try {
    const res = await api.automations.execute(activeWorkflow.value.id);
    if (res.ok) {
      pushToast('Workflow erfolgreich ausgeführt!', 'success');
    } else {
      pushToast(`Workflow-Fehler: ${res.execution.error}`, 'error');
    }
    executions.value.unshift(res.execution);
    if (activeWorkflow.value) {
      activeWorkflow.value.lastExecutedAt = res.execution.finishedAt;
      activeWorkflow.value.executionCount += 1;
      activeWorkflow.value.lastExecutionStatus = res.execution.status;
    }
  } catch (err) {
    pushToast(errorMessage(err), 'error');
  } finally {
    executing.value = false;
  }
}

// Canvas Drag & Pan
function onCanvasMouseDown(e: MouseEvent): void {
  if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('canvas-grid')) {
    isPanning.value = true;
    panStart.x = e.clientX - panX.value;
    panStart.y = e.clientY - panY.value;
    selectedNode.value = null;
  }
}

function onCanvasMouseMove(e: MouseEvent): void {
  if (isPanning.value) {
    panX.value = e.clientX - panStart.x;
    panY.value = e.clientY - panStart.y;
  } else if (draggingNodeId.value && activeWorkflow.value) {
    const node = activeWorkflow.value.nodes.find((n) => n.id === draggingNodeId.value);
    if (node) {
      node.position.x = Math.round((e.clientX - panX.value) / zoom.value - dragOffset.x);
      node.position.y = Math.round((e.clientY - panY.value) / zoom.value - dragOffset.y);
    }
  } else if (connectingFrom.value) {
    connectMousePos.value = {
      x: (e.clientX - panX.value) / zoom.value,
      y: (e.clientY - panY.value) / zoom.value,
    };
  }
}

function onCanvasMouseUp(): void {
  isPanning.value = false;
  if (draggingNodeId.value) {
    draggingNodeId.value = null;
    void saveCurrentWorkflow();
  }
  connectingFrom.value = null;
}

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  const delta = e.deltaY < 0 ? 0.1 : -0.1;
  zoom.value = Math.min(Math.max(zoom.value + delta, 0.4), 2);
}

// Node Dragging
function startNodeDrag(node: AutomationNode, e: MouseEvent): void {
  e.stopPropagation();
  selectedNode.value = node;
  draggingNodeId.value = node.id;
  dragOffset.x = (e.clientX - panX.value) / zoom.value - node.position.x;
  dragOffset.y = (e.clientY - panY.value) / zoom.value - node.position.y;
}

// Connecting Ports
function startConnection(node: AutomationNode, output: string, e: MouseEvent): void {
  e.stopPropagation();
  connectingFrom.value = { nodeId: node.id, output };
  connectMousePos.value = {
    x: (e.clientX - panX.value) / zoom.value,
    y: (e.clientY - panY.value) / zoom.value,
  };
}

function completeConnection(targetNode: AutomationNode, e: MouseEvent): void {
  e.stopPropagation();
  if (!connectingFrom.value || !activeWorkflow.value) return;
  if (connectingFrom.value.nodeId === targetNode.id) return; // No self-loops

  // Check if connection already exists
  const exists = activeWorkflow.value.connections.some(
    (c) =>
      c.fromNode === connectingFrom.value?.nodeId &&
      c.fromOutput === connectingFrom.value?.output &&
      c.toNode === targetNode.id,
  );

  if (!exists) {
    activeWorkflow.value.connections.push({
      id: `c_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      fromNode: connectingFrom.value.nodeId,
      fromOutput: connectingFrom.value.output,
      toNode: targetNode.id,
      toInput: 'in',
    });
    void saveCurrentWorkflow();
  }
  connectingFrom.value = null;
}

function deleteConnection(connId: string): void {
  if (!activeWorkflow.value) return;
  activeWorkflow.value.connections = activeWorkflow.value.connections.filter((c) => c.id !== connId);
  void saveCurrentWorkflow();
}

function deleteNode(nodeId: string): void {
  if (!activeWorkflow.value) return;
  activeWorkflow.value.nodes = activeWorkflow.value.nodes.filter((n) => n.id !== nodeId);
  activeWorkflow.value.connections = activeWorkflow.value.connections.filter(
    (c) => c.fromNode !== nodeId && c.toNode !== nodeId,
  );
  if (selectedNode.value?.id === nodeId) selectedNode.value = null;
  void saveCurrentWorkflow();
}

function addNode(typeDef: NodeTypeDef): void {
  if (!activeWorkflow.value) return;
  const id = `node_${Date.now().toString(36)}`;
  // Spawn in center of canvas view
  const spawnX = Math.round((-panX.value + 400) / zoom.value);
  const spawnY = Math.round((-panY.value + 300) / zoom.value);

  const newNode: AutomationNode = {
    id,
    type: typeDef.type,
    name: typeDef.label,
    position: { x: spawnX, y: spawnY },
    parameters: {},
  };
  activeWorkflow.value.nodes.push(newNode);
  selectedNode.value = newNode;
  showAddMenu.value = false;
  void saveCurrentWorkflow();
}

// Bezier Curves Calculation
function getPortPosition(node: AutomationNode, port: string, isOutput: boolean): { x: number; y: number } {
  const nodeWidth = 200;
  const nodeHeight = 76;
  if (!isOutput) {
    return { x: node.position.x, y: node.position.y + nodeHeight / 2 };
  }
  // Output port
  if (port === 'true') {
    return { x: node.position.x + nodeWidth, y: node.position.y + 24 };
  }
  if (port === 'false') {
    return { x: node.position.x + nodeWidth, y: node.position.y + 52 };
  }
  return { x: node.position.x + nodeWidth, y: node.position.y + nodeHeight / 2 };
}

function calculatePath(start: { x: number; y: number }, end: { x: number; y: number }): string {
  const dx = Math.abs(end.x - start.x) * 0.5;
  const control1X = start.x + Math.max(dx, 40);
  const control1Y = start.y;
  const control2X = end.x - Math.max(dx, 40);
  const control2Y = end.y;
  return `M ${start.x} ${start.y} C ${control1X} ${control1Y}, ${control2X} ${control2Y}, ${end.x} ${end.y}`;
}

onMounted(() => {
  void loadData();
});
</script>

<template>
  <div class="automations-view">
    <!-- Top Bar: Workflow Title, View Toggles & Actions -->
    <header class="n8n-header">
      <div class="header-left">
        <div class="workflow-selector">
          <select v-if="workflows.length > 0" v-model="activeWorkflow" class="workflow-select">
            <option v-for="wf in workflows" :key="wf.id" :value="wf">
              {{ wf.name }}
            </option>
          </select>
          <span v-if="activeWorkflow" class="workflow-status-badge" :class="{ 'is-active': activeWorkflow.enabled }">
            {{ activeWorkflow.enabled ? 'Aktiv' : 'Pausiert' }}
          </span>
        </div>
        <div class="tab-pills">
          <button
            type="button"
            class="tab-pill"
            :class="{ active: activeTab === 'editor' }"
            @click="activeTab = 'editor'"
          >
            Workflow-Editor
          </button>
          <button
            type="button"
            class="tab-pill"
            :class="{ active: activeTab === 'executions' }"
            @click="activeTab = 'executions'"
          >
            Ausführungen ({{ executions.length }})
          </button>
        </div>
      </div>

      <div class="header-actions">
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="showAddMenu = !showAddMenu"
        >
          ➕ Node hinzufügen
        </button>
        <button
          v-if="activeWorkflow"
          type="button"
          class="btn btn-primary btn-sm btn-execute"
          :disabled="executing"
          @click="executeCurrentWorkflow"
        >
          <span v-if="executing" class="spinner-sm"></span>
          <span v-else>⚡ Test-Lauf</span>
        </button>
      </div>
    </header>

    <!-- Node Catalog Flyout Menu -->
    <div v-if="showAddMenu" class="node-catalog-modal" @click.self="showAddMenu = false">
      <div class="catalog-card">
        <div class="catalog-head">
          <h3>Node zum Workflow hinzufügen</h3>
          <button type="button" class="btn-close" @click="showAddMenu = false">✕</button>
        </div>
        <div class="catalog-grid">
          <div
            v-for="item in NODE_CATALOG"
            :key="item.type"
            class="catalog-item"
            :style="{ borderColor: item.color }"
            @click="addNode(item)"
          >
            <div class="item-icon" :style="{ backgroundColor: item.color }">{{ item.icon }}</div>
            <div class="item-details">
              <strong>{{ item.label }}</strong>
              <span class="item-category">{{ item.category }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- MAIN TAB: Canvas Flow Editor -->
    <main v-if="activeTab === 'editor'" class="canvas-wrapper">
      <div
        class="canvas-area"
        @mousedown="onCanvasMouseDown"
        @mousemove="onCanvasMouseMove"
        @mouseup="onCanvasMouseUp"
        @wheel="onWheel"
      >
        <!-- Canvas Transform Container -->
        <div
          class="canvas-content"
          :style="{
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }"
        >
          <!-- SVG Connecting Cables -->
          <svg class="connections-layer" aria-hidden="true">
            <template v-if="activeWorkflow">
              <g
                v-for="conn in activeWorkflow.connections"
                :key="conn.id"
                class="cable-group"
                @dblclick="deleteConnection(conn.id)"
              >
                <!-- Invisible wider hit area for click/hover -->
                <path
                  v-if="
                    activeWorkflow.nodes.find((n) => n.id === conn.fromNode) &&
                    activeWorkflow.nodes.find((n) => n.id === conn.toNode)
                  "
                  :d="
                    calculatePath(
                      getPortPosition(
                        activeWorkflow.nodes.find((n) => n.id === conn.fromNode)!,
                        conn.fromOutput,
                        true,
                      ),
                      getPortPosition(
                        activeWorkflow.nodes.find((n) => n.id === conn.toNode)!,
                        conn.toInput,
                        false,
                      ),
                    )
                  "
                  class="cable-hit"
                />
                <!-- Visible Cable -->
                <path
                  v-if="
                    activeWorkflow.nodes.find((n) => n.id === conn.fromNode) &&
                    activeWorkflow.nodes.find((n) => n.id === conn.toNode)
                  "
                  :d="
                    calculatePath(
                      getPortPosition(
                        activeWorkflow.nodes.find((n) => n.id === conn.fromNode)!,
                        conn.fromOutput,
                        true,
                      ),
                      getPortPosition(
                        activeWorkflow.nodes.find((n) => n.id === conn.toNode)!,
                        conn.toInput,
                        false,
                      ),
                    )
                  "
                  class="cable-line"
                />
              </g>
            </template>

            <!-- Dynamic Connecting Wire while Dragging Wire -->
            <path
              v-if="connectingFrom && activeWorkflow && activeWorkflow.nodes.find((n) => n.id === connectingFrom?.nodeId)"
              :d="
                calculatePath(
                  getPortPosition(
                    activeWorkflow.nodes.find((n) => n.id === connectingFrom?.nodeId)!,
                    connectingFrom.output,
                    true,
                  ),
                  connectMousePos,
                )
              "
              class="cable-line dragging"
            />
          </svg>

          <!-- Nodes Elements -->
          <template v-if="activeWorkflow">
            <div
              v-for="node in activeWorkflow.nodes"
              :key="node.id"
              class="n8n-node"
              :class="{
                'is-selected': selectedNode?.id === node.id,
                'is-trigger': node.type.startsWith('trigger_'),
              }"
              :style="{
                left: `${node.position.x}px`,
                top: `${node.position.y}px`,
              }"
              @mousedown="startNodeDrag(node, $event)"
              @click.stop="selectedNode = node"
            >
              <!-- Input Port (Left) -->
              <div
                v-if="!node.type.startsWith('trigger_')"
                class="node-port port-input"
                title="Input verbinden"
                @mouseup="completeConnection(node, $event)"
              ></div>

              <!-- Node Icon -->
              <div
                class="node-icon-box"
                :style="{ backgroundColor: getNodeDef(node.type).color }"
              >
                <span>{{ getNodeDef(node.type).icon }}</span>
              </div>

              <!-- Node Body -->
              <div class="node-body">
                <span class="node-title">{{ node.name }}</span>
                <span class="node-type-label">{{ getNodeDef(node.type).label }}</span>
              </div>

              <!-- Output Ports (Right) -->
              <template v-if="node.type === 'flow_condition'">
                <div
                  class="node-port port-output port-true"
                  title="Wahr / True"
                  @mousedown="startConnection(node, 'true', $event)"
                >
                  <span class="port-label">T</span>
                </div>
                <div
                  class="node-port port-output port-false"
                  title="Falsch / False"
                  @mousedown="startConnection(node, 'false', $event)"
                >
                  <span class="port-label">F</span>
                </div>
              </template>
              <template v-else>
                <div
                  class="node-port port-output"
                  title="Verbindung ziehen"
                  @mousedown="startConnection(node, 'out', $event)"
                ></div>
              </template>
            </div>
          </template>
        </div>

        <!-- Canvas Controls (Zoom In/Out/Reset) -->
        <div class="canvas-controls">
          <button type="button" class="btn-ctrl" title="Vergrößern" @click="zoom = Math.min(zoom + 0.15, 2)">+</button>
          <span class="zoom-level">{{ Math.round(zoom * 100) }}%</span>
          <button type="button" class="btn-ctrl" title="Verkleinern" @click="zoom = Math.max(zoom - 0.15, 0.4)">-</button>
          <button type="button" class="btn-ctrl" title="Zurücksetzen" @click="panX = 100; panY = 100; zoom = 1">⤢</button>
        </div>
      </div>

      <!-- Node Parameters Drawer (Right Side) -->
      <aside v-if="selectedNode" class="node-drawer">
        <div class="drawer-head">
          <h3>{{ selectedNode.name }}</h3>
          <button type="button" class="btn-icon" @click="selectedNode = null">✕</button>
        </div>

        <div class="drawer-body">
          <div class="field">
            <label>Node-Name</label>
            <input v-model="selectedNode.name" type="text" @blur="saveCurrentWorkflow" />
          </div>

          <!-- Parameter Fields per Node Type -->
          <template v-if="selectedNode.type === 'trigger_stream_state'">
            <div class="field">
              <label>Ziel-Zustand</label>
              <select v-model="selectedNode.parameters.target_state" @change="saveCurrentWorkflow">
                <option value="">Jeder Wechsel</option>
                <option value="live">Live (Stream gestartet)</option>
                <option value="paused">Paused (Pausenscreen)</option>
                <option value="reconnecting">Reconnecting</option>
                <option value="error">Error / Quell-Ausfall</option>
                <option value="idle">Idle (Beendet)</option>
              </select>
            </div>
          </template>

          <template v-else-if="selectedNode.type === 'flow_cooldown'">
            <div class="field">
              <label>Cooldown-Dauer (Sekunden)</label>
              <input
                v-model.number="selectedNode.parameters.seconds"
                type="number"
                min="1"
                max="3600"
                placeholder="60"
                @blur="saveCurrentWorkflow"
              />
            </div>
          </template>

          <template v-else-if="selectedNode.type === 'action_screen'">
            <div class="field">
              <label>Screen-Typ</label>
              <select v-model="selectedNode.parameters.screen" @change="saveCurrentWorkflow">
                <option value="pause">Pausenscreen</option>
                <option value="startup">Startbildschirm</option>
              </select>
            </div>
            <div class="field">
              <label>Aktion</label>
              <select v-model="selectedNode.parameters.action" @change="saveCurrentWorkflow">
                <option value="start">Einblenden / Starten</option>
                <option value="stop">Ausblenden / Stoppen</option>
              </select>
            </div>
          </template>

          <template v-else-if="selectedNode.type === 'action_switch_streamer'">
            <div class="field">
              <label>Streamer auswählen</label>
              <select v-model="selectedNode.parameters.streamer_id" @change="saveCurrentWorkflow">
                <option v-for="s in store.streamers" :key="s.id" :value="s.id">
                  {{ s.name }} (@{{ s.tiktok }})
                </option>
              </select>
            </div>
          </template>

          <template v-else-if="selectedNode.type === 'action_start_playlist'">
            <div class="field">
              <label>Playlist auswählen</label>
              <select v-model="selectedNode.parameters.playlist_id" @change="saveCurrentWorkflow">
                <option v-for="p in store.playlists" :key="p.id" :value="p.id">
                  {{ p.name }}
                </option>
              </select>
            </div>
          </template>

          <template v-else-if="selectedNode.type === 'action_telegram'">
            <div class="field">
              <label>Benachrichtigungstext</label>
              <textarea
                :value="String(selectedNode.parameters.text ?? '')"
                rows="3"
                placeholder="Alarm: Streamer offline!"
                @input="selectedNode.parameters.text = ($event.target as HTMLTextAreaElement).value"
                @blur="saveCurrentWorkflow"
              ></textarea>
            </div>
          </template>

          <template v-else-if="selectedNode.type === 'action_webhook'">
            <div class="field">
              <label>Ziel-URL (POST)</label>
              <input
                v-model="selectedNode.parameters.url"
                type="url"
                placeholder="https://discord.com/api/webhooks/..."
                @blur="saveCurrentWorkflow"
              />
            </div>
            <div class="field">
              <label>Payload Message</label>
              <input
                v-model="selectedNode.parameters.message"
                type="text"
                placeholder="Streamer offline gegangen"
                @blur="saveCurrentWorkflow"
              />
            </div>
          </template>

          <div class="drawer-actions">
            <button
              type="button"
              class="btn btn-danger btn-sm"
              @click="deleteNode(selectedNode.id)"
            >
              Node löschen
            </button>
          </div>
        </div>
      </aside>
    </main>

    <!-- EXECUTIONS TAB -->
    <section v-else class="executions-area">
      <div v-if="executions.length === 0" class="empty-state">
        <p>Noch keine Workflow-Ausführungen protokolliert.</p>
      </div>
      <div v-else class="executions-list">
        <div
          v-for="exec in executions"
          :key="exec.id"
          class="execution-card"
          :class="`is-${exec.status}`"
        >
          <div class="exec-head">
            <span class="status-indicator"></span>
            <strong>{{ exec.status === 'success' ? 'Erfolgreich' : 'Fehlgeschlagen' }}</strong>
            <span class="exec-time">{{ new Date(exec.startedAt).toLocaleTimeString() }}</span>
          </div>
          <div class="exec-meta">
            <span>Ausgeführte Nodes: {{ exec.executedNodeIds.length }}</span>
            <span v-if="exec.error" class="exec-error">{{ exec.error }}</span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.automations-view {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 120px);
  margin: -16px;
  background-color: #0b0f17;
  color: #f1f5f9;
  overflow: hidden;
}

/* Negative margin matches the desktop content padding; on phones the padding
   is 12 px, so the bleed has to shrink with it (#88). */
@media (max-width: 720px) {
  .automations-view {
    margin: 0;
    height: calc(100vh - 150px);
  }
}

.n8n-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: #111827;
  border-bottom: 1px solid #1f2937;
  z-index: 10;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.workflow-select {
  font-size: 15px;
  font-weight: 700;
  background: #1e293b;
  color: #fff;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 6px 12px;
}

.workflow-status-badge {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 12px;
  background: #374151;
  color: #9ca3af;
  margin-left: 8px;
}
.workflow-status-badge.is-active {
  background: #064e3b;
  color: #34d399;
}

.tab-pills {
  display: flex;
  background: #1e293b;
  border-radius: 6px;
  padding: 3px;
}
.tab-pill {
  border: none;
  background: transparent;
  color: #94a3b8;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 4px;
  cursor: pointer;
}
.tab-pill.active {
  background: #334155;
  color: #fff;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.btn-execute {
  background: #f97316 !important;
  color: white !important;
  font-weight: 700 !important;
  border: none !important;
}

/* Canvas Area */
.canvas-wrapper {
  position: relative;
  flex: 1;
  overflow: hidden;
}

.canvas-area {
  position: absolute;
  inset: 0;
  background-color: #0b0f17;
  background-image: radial-gradient(circle, #1e293b 1px, transparent 1px);
  background-size: 24px 24px;
  cursor: grab;
  user-select: none;
}
.canvas-area:active {
  cursor: grabbing;
}

.canvas-content {
  position: absolute;
  top: 0;
  left: 0;
  width: 10000px;
  height: 10000px;
  pointer-events: none;
}

.connections-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: all;
}

.cable-line {
  fill: none;
  stroke: #475569;
  stroke-width: 3;
  transition: stroke 0.2s;
}
.cable-group:hover .cable-line {
  stroke: #38bdf8;
  stroke-width: 4;
}
.cable-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 16;
  cursor: pointer;
}
.cable-line.dragging {
  stroke: #f97316;
  stroke-dasharray: 6 4;
}

/* Nodes */
.n8n-node {
  position: absolute;
  width: 200px;
  height: 76px;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  pointer-events: all;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  cursor: move;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.n8n-node:hover {
  border-color: #64748b;
}
.n8n-node.is-selected {
  border-color: #f97316;
  box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.3), 0 4px 12px rgba(0, 0, 0, 0.6);
}

.node-icon-box {
  width: 42px;
  height: 42px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}

.node-body {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.node-title {
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.node-type-label {
  font-size: 11px;
  color: #94a3b8;
}

/* Ports */
.node-port {
  position: absolute;
  width: 14px;
  height: 14px;
  background: #fff;
  border: 3px solid #1e293b;
  border-radius: 50%;
  cursor: crosshair;
  z-index: 5;
  transition: transform 0.1s, background-color 0.1s;
}
.node-port:hover {
  transform: scale(1.3);
  background: #f97316;
}

.port-input {
  left: -7px;
  top: 50%;
  transform: translateY(-50%);
}

.port-output {
  right: -7px;
  top: 50%;
  transform: translateY(-50%);
}
.port-true {
  top: 24px;
  background: #22c55e;
}
.port-false {
  top: 52px;
  background: #ef4444;
}
.port-label {
  position: absolute;
  right: 18px;
  font-size: 9px;
  font-weight: 800;
  color: #94a3b8;
}

/* Canvas Controls */
.canvas-controls {
  position: absolute;
  bottom: 24px;
  left: 24px;
  display: flex;
  align-items: center;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}
.btn-ctrl {
  background: transparent;
  border: none;
  color: #fff;
  width: 32px;
  height: 32px;
  font-size: 16px;
  cursor: pointer;
}
.btn-ctrl:hover {
  background: #334155;
}
.zoom-level {
  font-size: 11px;
  color: #94a3b8;
  padding: 0 8px;
  font-family: monospace;
}

/* Drawer */
.node-drawer {
  position: absolute;
  top: 0;
  right: 0;
  width: 320px;
  height: 100%;
  background: #111827;
  border-left: 1px solid #1f2937;
  padding: 20px;
  overflow-y: auto;
  z-index: 20;
}
.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.drawer-head h3 {
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  margin: 0;
}
.btn-icon {
  background: transparent;
  border: none;
  color: #94a3b8;
  font-size: 16px;
  cursor: pointer;
}

.drawer-body .field {
  margin-bottom: 16px;
}
.drawer-body label {
  display: block;
  font-size: 12px;
  color: #94a3b8;
  margin-bottom: 6px;
}
.drawer-body input,
.drawer-body select,
.drawer-body textarea {
  width: 100%;
  background: #1e293b;
  border: 1px solid #334155;
  color: #fff;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
}
.drawer-actions {
  margin-top: 24px;
  border-top: 1px solid #1f2937;
  padding-top: 16px;
}

/* Catalog Modal */
.node-catalog-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.catalog-card {
  width: 620px;
  background: #111827;
  border: 1px solid #334155;
  border-radius: 10px;
  padding: 24px;
}
.catalog-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 16px;
}
.catalog-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  max-height: 480px;
  overflow-y: auto;
}
.catalog-item {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #1e293b;
  border: 1px solid #334155;
  border-left-width: 4px;
  padding: 10px 14px;
  border-radius: 6px;
  cursor: pointer;
  transition: transform 0.1s, background 0.1s;
}
.catalog-item:hover {
  background: #334155;
  transform: translateY(-2px);
}
.item-icon {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}
.item-details {
  display: flex;
  flex-direction: column;
}
.item-details strong {
  font-size: 13px;
  color: #fff;
}
.item-category {
  font-size: 10px;
  color: #94a3b8;
  text-transform: uppercase;
}

/* Executions Area */
.executions-area {
  padding: 24px;
  overflow-y: auto;
}
.execution-card {
  background: #1e293b;
  border: 1px solid #334155;
  border-left-width: 4px;
  border-radius: 6px;
  padding: 14px 18px;
  margin-bottom: 12px;
}
.execution-card.is-success {
  border-left-color: #22c55e;
}
.execution-card.is-failed {
  border-left-color: #ef4444;
}
.exec-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.exec-time {
  font-size: 12px;
  color: #94a3b8;
  margin-left: auto;
}
.exec-meta {
  font-size: 12px;
  color: #cbd5e1;
}
.exec-error {
  display: block;
  color: #f87171;
  margin-top: 4px;
}
</style>
