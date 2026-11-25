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

  // 11b. Unified playback (#94)
  registry.register({
    name: 'relay_playback_state',
    description:
      'Gibt den einheitlichen Wiedergabe-Zustand zurück (Quelle, aktueller und nächster Eintrag, Pause, Position, Loop).',
    schema: z.object({}),
    execute: async (_params, ctx) => ctx.supervisor.buildPlaybackState(),
  });

  registry.register({
    name: 'relay_playback_control',
    description:
      'Steuert die Wiedergabe: play, pause, resume, stop, next, previous oder seek (Sekunden).',
    destructive: true,
    schema: z.object({
      action: z.enum(['play', 'pause', 'resume', 'stop', 'next', 'previous', 'seek']),
      seconds: z.number().min(0).optional().describe('Nur für action=seek'),
    }),
    execute: async ({ action, seconds }, ctx) => {
      switch (action) {
        case 'play':
          return ctx.supervisor.buildPlaybackState();
        case 'pause':
          return ctx.supervisor.showScreen('pause');
        case 'resume':
          return ctx.supervisor.hideScreen();
        case 'stop':
          return ctx.supervisor.stop();
        case 'next':
          return ctx.supervisor.queueNext();
        case 'previous':
          return ctx.supervisor.queuePrevious();
        case 'seek':
          return ctx.supervisor.seekActiveVideo(seconds ?? 0);
      }
    },
  });

  registry.register({
    name: 'relay_queue_enqueue',
    description:
      'Reiht einen Kanal in die Regie-Queue ein: now (sofort), next (als Nächstes) oder end (ans Ende).',
    destructive: true,
    schema: z.object({
      channel: z.string().describe('z. B. "file:trailer.mp4", Streamer-ID oder "screen:pause"'),
      mode: z.enum(['now', 'next', 'end']).default('next'),
    }),
    execute: async ({ channel, mode }, ctx) => ctx.supervisor.queueEnqueue(channel, mode),
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

  // 17. relay_soundboard_state
  registry.register({
    name: 'relay_soundboard_state',
    description: 'Liefert den aktuellen Status und alle Sounds des Soundboards.',
    schema: z.object({}),
    execute: async (_args, ctx) => ctx.supervisor.getSoundboardState(),
  });

  // 18. relay_soundboard_play
  registry.register({
    name: 'relay_soundboard_play',
    description: 'Spielt einen SFX-Sound oder ein Musikbett aus dem Soundboard ab.',
    schema: z.object({
      id_or_name: z.string().describe('Sound-ID oder Name'),
      target: z.enum(['sfx', 'music']).optional().describe('Optional: als SFX oder Musikbett abspielen'),
    }),
    execute: async ({ id_or_name, target }, ctx) => {
      const entry = ctx.supervisor.soundboard.store.findByNameOrId(id_or_name);
      if (!entry) throw new Error(`Sound "${id_or_name}" nicht gefunden`);
      const played = await ctx.supervisor.soundboard.engine.play(entry.id, { target });
      return { ok: true, sound: played, state: ctx.supervisor.getSoundboardState() };
    },
  });

  // 19. relay_soundboard_stop
  registry.register({
    name: 'relay_soundboard_stop',
    description: 'Stoppt laufende Soundboard-Wiedergaben (SFX, Musik oder alles).',
    schema: z.object({
      scope: z.enum(['all', 'sfx', 'music']).default('all').describe('Was gestoppt werden soll'),
    }),
    execute: async ({ scope }, ctx) => {
      ctx.supervisor.soundboard.engine.stop(scope);
      return { ok: true, state: ctx.supervisor.getSoundboardState() };
    },
  });

  return registry;
}
