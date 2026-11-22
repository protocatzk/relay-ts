import { z } from 'zod';
import type { Logger } from 'pino';
import type { Supervisor } from '../supervisor/supervisor.js';
import type { StreamerStore } from '../store/streamer-store.js';
import type { AuditLogStore } from '../audit-log.js';
import type { SceneStore } from '../overlays/scene-store.js';
import type { DiscoveryService } from '../source/discovery/discovery-service.js';

export interface AgentToolContext {
  supervisor: Supervisor;
  store: StreamerStore;
  logger: Logger;
  audit?: AuditLogStore;
  scenes?: SceneStore;
  discovery?: DiscoveryService;
}

export interface ToolDefinition<TParams extends z.ZodTypeAny = z.ZodTypeAny, TResult = unknown> {
  name: string;
  description: string;
  destructive?: boolean;
  schema: TParams;
  execute: (params: z.infer<TParams>, ctx: AgentToolContext, source?: 'mcp' | 'agent') => Promise<TResult>;
}

export class AgentToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register<TParams extends z.ZodTypeAny, TResult>(tool: ToolDefinition<TParams, TResult>): void {
    this.tools.set(tool.name, tool as unknown as ToolDefinition);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  async execute(name: string, rawParams: unknown, ctx: AgentToolContext, source: 'mcp' | 'agent' = 'mcp'): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unbekanntes Tool: ${name}`);

    const parsed = tool.schema.safeParse(rawParams);
    if (!parsed.success) {
      throw new Error(`Ungültige Parameter für ${name}: ${parsed.error.message}`);
    }

    try {
      const result = await tool.execute(parsed.data, ctx, source);
      ctx.audit?.record({
        actor: source === 'mcp' ? 'mcp:client' : 'agent:internal',
        source,
        action: `tool.${name}`,
        target: String(JSON.stringify(rawParams)).slice(0, 100),
        result: 'ok',
      });
      return result;
    } catch (err: any) {
      ctx.audit?.record({
        actor: source === 'mcp' ? 'mcp:client' : 'agent:internal',
        source,
        action: `tool.${name}`,
        target: String(JSON.stringify(rawParams)).slice(0, 100),
        result: 'error',
        detail: err?.message || String(err),
      });
      throw err;
    }
  }
}

export function createDefaultAgentToolRegistry(): AgentToolRegistry {
  const registry = new AgentToolRegistry();

  // 1. relay_get_status
  registry.register({
    name: 'relay_get_status',
    description: 'Liefert den aktuellen Live-Status von RELAY (StreamState, Bitrate, FPS, Buffer, aktiver Streamer/Screen).',
    schema: z.object({}),
    execute: async (_params, ctx) => ctx.supervisor.buildStatus(),
  });

  // 2. relay_list_streamers
  registry.register({
    name: 'relay_list_streamers',
    description: 'Listet alle konfigurierten TikTok-Streamer mit Online-Status und Priorität auf.',
    schema: z.object({}),
    execute: async (_params, ctx) => ctx.supervisor.streamersView(),
  });

  // 3. relay_start_streamer
  registry.register({
    name: 'relay_start_streamer',
    description: 'Startet das Restreaming eines bestimmten konfigurierten Streamers anhand seiner ID.',
    destructive: true,
    schema: z.object({ streamer_id: z.string().describe('ID des Streamers') }),
    execute: async ({ streamer_id }, ctx) => ctx.supervisor.start(streamer_id),
  });

  // 4. relay_stop_stream
  registry.register({
    name: 'relay_stop_stream',
    description: 'Beendet den aktuellen Stream oder aktiven Screen und setzt RELAY in den Idle-Zustand.',
    destructive: true,
    schema: z.object({}),
    execute: async (_params, ctx) => ctx.supervisor.stop(),
  });

  // 5. relay_show_screen
  registry.register({
    name: 'relay_show_screen',
    description: 'Zeigt den Pausenscreen oder den Startbildschirm manuell an.',
    destructive: true,
    schema: z.object({
      screen: z.enum(['pause', 'startup']).describe('Screen-Typ (pause oder startup)'),
    }),
    execute: async ({ screen }, ctx) => ctx.supervisor.showScreen(screen),
  });

  // 6. relay_hide_screen
  registry.register({
    name: 'relay_hide_screen',
    description: 'Blendet den manuellen Pausen- oder Startbildschirm aus.',
    destructive: true,
    schema: z.object({}),
    execute: async (_params, ctx) => ctx.supervisor.hideScreen(),
  });

  // 7. relay_restart_sink
  registry.register({
    name: 'relay_restart_sink',
    description: 'Startet den YouTube-Sink-Prozess kontrolliert neu (z. B. bei DTS-Fehlern).',
    destructive: true,
    schema: z.object({}),
    execute: async (_params, ctx) => ctx.supervisor.restartSink(),
  });

  // 8. relay_queue_list
  registry.register({
    name: 'relay_queue_list',
    description: 'Gibt die aktuelle Regie-Queue mit allen Einträgen und Wiedergabestatus zurück.',
    schema: z.object({}),
    execute: async (_params, ctx) => ctx.supervisor.buildQueueSnapshot(),
  });

  // 9. relay_queue_play_now
  registry.register({
    name: 'relay_queue_play_now',
    description: 'Schiebt ein Video ("file:..."), einen Streamer oder Screen sofort als nächsten Eintrag in die Regie-Queue und startet die Wiedergabe.',
    destructive: true,
    schema: z.object({
      channel: z.string().describe('z. B. "file:trailer.mp4" oder Streamer-ID oder "screen:pause"'),
    }),
    execute: async ({ channel }, ctx) => ctx.supervisor.queuePlayNow(channel),
  });

  // 10. relay_queue_next
  registry.register({
    name: 'relay_queue_next',
    description: 'Springt in der Regie-Queue zum nächsten Element.',
    destructive: true,
    schema: z.object({}),
    execute: async (_params, ctx) => ctx.supervisor.queueNext(),
  });

  // 11. relay_queue_stop
  registry.register({
    name: 'relay_queue_stop',
    description: 'Stoppt die Wiedergabe der Regie-Queue.',
    destructive: true,
    schema: z.object({}),
    execute: async (_params, ctx) => ctx.supervisor.queueStop(),
  });

  // 12. relay_playlist_play
  registry.register({
    name: 'relay_playlist_play',
    description: 'Startet das Abspielen einer konfigurierten Playlist.',
    destructive: true,
    schema: z.object({ playlist_id: z.string().describe('ID der Playlist') }),
    execute: async ({ playlist_id }, ctx) => ctx.supervisor.playPlaylist(playlist_id),
  });

  // 13. relay_activate_scene
  registry.register({
    name: 'relay_activate_scene',
    description: 'Aktiviert eine gespeicherte Overlay-Szene atomar (Layout & Overlays).',
    destructive: true,
    schema: z.object({ scene_id: z.string().describe('ID der Overlay-Szene') }),
    execute: async ({ scene_id }, ctx) => ctx.supervisor.activateScene(scene_id),
  });

  // 14. relay_discovery_search
  registry.register({
    name: 'relay_discovery_search',
    description: 'Sucht nach Live-Streams auf TikTok per Freitext/Keyword oder Region.',
    schema: z.object({
      query: z.string().describe('Suchbegriff (z. B. "gaming", "deutsch")'),
      region: z.string().optional().describe('Ländercode (z. B. "DE", "US")'),
    }),
    execute: async ({ query, region }, ctx) => {
      if (!ctx.discovery) throw new Error('DiscoveryService nicht verfügbar');
      return ctx.discovery.search(query, { region });
    },
  });

  // 15. relay_discovery_trending
  registry.register({
    name: 'relay_discovery_trending',
    description: 'Holt die aktuellen Trending-Live-Streams von TikTok.',
    schema: z.object({
      region: z.string().optional().describe('Ländercode (z. B. "DE")'),
    }),
    execute: async ({ region }, ctx) => {
      if (!ctx.discovery) throw new Error('DiscoveryService nicht verfügbar');
      return ctx.discovery.trending({ region });
    },
  });

  // 16. relay_send_chat_message
  registry.register({
    name: 'relay_send_chat_message',
    description: 'Sendet eine Test-/Regie-Nachricht in das Live-Overlay.',
    schema: z.object({
      user: z.string().default('Regie').describe('Absendername'),
      text: z.string().describe('Nachrichtentext'),
    }),
    execute: async ({ user, text }, ctx) => {
      const messages = ctx.supervisor.addTestChatMessage(user, text);
      return { ok: true, count: messages.length };
    },
  });

  return registry;
}
