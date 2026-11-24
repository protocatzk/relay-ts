/**
 * Shared action registry (#88).
 *
 * One definition per regie action feeds the cockpit action row, the queue
 * context menu and the command palette. Guards are pure functions so they can
 * be unit-tested without a browser; only `run` touches the network.
 */
import { api } from '@/src/api/client';
import { useDiscoveryFeed } from '@/src/composables/useDiscoveryFeed';
import {
  openDiscoveryPanel,
  toggleDiscoveryPanel,
} from '@/src/composables/useDiscoveryPanel';
import type { StatusPayload, Streamer } from '@/src/api/types';
import {
  canStart,
  canStop,
  canToggleScreens,
  nextSwitchCandidate,
  switchReason,
  type ActionContext,
} from '@/src/actions/guards';

export type ActionSection = 'stream' | 'screens' | 'queue' | 'system';

/** Extra input for actions that operate on a concrete entry. */
export interface ActionRunInput extends ActionContext {
  /** Streamer picked by the operator (context menu, palette entry). */
  streamerId?: string;
  /** Queue entry picked by the operator. */
  queueEntryId?: string;
}

export interface ActionSuccess {
  message: string;
  kind: 'success' | 'info';
}

export interface ActionDef {
  id: string;
  label: string;
  /** Short explanation for the palette subtitle and the button tooltip. */
  description: string;
  section: ActionSection;
  keywords: string[];
  /** Whether the action can run right now. */
  enabled: (ctx: ActionContext) => boolean;
  /** Why the action is unavailable; shown in the palette and as tooltip. */
  reason?: (ctx: ActionContext) => string | null;
  run: (input: ActionRunInput) => Promise<unknown>;
  /** Optional confirmation toast; defaults to the plain label. */
  success?: (input: ActionRunInput, result: unknown) => ActionSuccess;
  /**
   * Local status patch applied before the request so the cockpit flips within a
   * frame (#88). Rolled back automatically when the request fails.
   */
  optimistic?: (input: ActionRunInput) => Partial<StatusPayload> | null;
}

/* ------------------------------------------------------------- guard helpers */

export {
  canStart,
  canStop,
  canToggleScreens,
  nextSwitchCandidate,
  switchReason,
  type ActionContext,
} from '@/src/actions/guards';

/* ------------------------------------------------------------------- registry */

export function buildActions(): ActionDef[] {
  return [
    {
      id: 'stream.switch',
      label: 'Umschalten',
      description: 'Nächsten Live-Streamer aufs Programm nehmen',
      section: 'stream',
      keywords: ['wechseln', 'switch', 'umschalten', 'nächster', 'regie'],
      enabled: (ctx) => switchReason(ctx) === null,
      reason: switchReason,
      run: async (input) => {
        const target = input.streamerId
          ? (input.streamers.find((streamer) => streamer.id === input.streamerId) ?? null)
          : nextSwitchCandidate(input.status, input.streamers);
        if (!target) throw new Error('Kein weiterer Live-Streamer');
        return api.streamers.switchTo(target.id);
      },
      success: (input) => {
        const target = input.streamerId
          ? input.streamers.find((streamer) => streamer.id === input.streamerId)
          : nextSwitchCandidate(input.status, input.streamers);
        return { message: `${target?.name ?? 'Streamer'} wird gestartet.`, kind: 'success' };
      },
    },
    {
      id: 'screen.pause',
      label: 'Pause',
      description: 'Pausenscreen ein- oder ausschalten',
      section: 'screens',
      keywords: ['pause', 'pausenscreen', 'screen', 'halten'],
      enabled: (ctx) => canToggleScreens(ctx.status),
      reason: () => 'Im aktuellen Zustand nicht verfügbar',
      run: async (input) =>
        input.status?.manual_screen === 'pause' && input.status.state === 'paused'
          ? api.screens.stop()
          : api.screens.show('pause'),
      success: (input) =>
        input.status?.manual_screen === 'pause' && input.status.state === 'paused'
          ? { message: input.status?.active_streamer_id ? 'Zurück zum Stream.' : 'Screen beendet.', kind: 'info' }
          : { message: 'Pausenscreen aktiviert.', kind: 'success' },
      optimistic: (input) =>
        input.status?.manual_screen === 'pause' && input.status.state === 'paused'
          ? { state: input.status.active_streamer_id ? 'live' : 'idle', manual_screen: null }
          : { state: 'paused', manual_screen: 'pause' },
    },
    {
      id: 'screen.startup',
      label: 'Startbild',
      description: 'Startbildschirm ein- oder ausschalten',
      section: 'screens',
      keywords: ['startbild', 'startup', 'intro', 'screen'],
      enabled: (ctx) => canToggleScreens(ctx.status),
      reason: () => 'Im aktuellen Zustand nicht verfügbar',
      run: async (input) =>
        input.status?.manual_screen === 'startup'
          ? api.screens.stop()
          : api.screens.show('startup'),
      success: (input) =>
        input.status?.manual_screen === 'startup'
          ? { message: input.status?.active_streamer_id ? 'Zurück zum Stream.' : 'Screen beendet.', kind: 'info' }
          : { message: 'Startbildschirm aktiviert.', kind: 'success' },
      optimistic: (input) =>
        input.status?.manual_screen === 'startup'
          ? { state: input.status.active_streamer_id ? 'live' : 'idle', manual_screen: null }
          : { state: 'paused', manual_screen: 'startup' },
    },
    {
      id: 'stream.stop',
      label: 'Stopp',
      description: 'Aktiven Stream beenden',
      section: 'stream',
      keywords: ['stop', 'stopp', 'beenden', 'offline'],
      enabled: (ctx) => canStop(ctx.status),
      reason: () => 'Es läuft kein Stream',
      run: async (input) => {
        const id = input.status?.active_streamer_id ?? null;
        if (id) return api.streamers.stop(id);
        return api.screens.stop();
      },
      success: (input) =>
        input.status?.active_streamer_id
          ? { message: 'Stream wird gestoppt.', kind: 'success' }
          : { message: 'Screen beendet.', kind: 'info' },
    },
    {
      id: 'queue.next',
      label: 'Weiter',
      description: 'Nächsten Playlist-Eintrag starten',
      section: 'queue',
      keywords: ['weiter', 'next', 'queue', 'playlist', 'nächster'],
      enabled: (ctx) => Boolean(ctx.status?.active_playlist),
      reason: () => 'Keine Playlist aktiv',
      run: async () => api.playlists.next(),
      success: () => ({ message: 'Nächster Eintrag wird gestartet.', kind: 'success' }),
    },
    {
      id: 'queue.nextEntry',
      label: 'Queue weiter',
      description: 'Nächsten Regie-Queue-Eintrag abspielen',
      section: 'queue',
      keywords: ['queue', 'weiter', 'regie', 'next'],
      enabled: (ctx) => Boolean(ctx.status?.active_playlist?.id === '__regie__'),
      reason: () => 'Regie-Queue läuft nicht',
      run: async () => api.queue.next(),
      success: () => ({ message: 'Queue rückt weiter.', kind: 'success' }),
    },
    {
      id: 'queue.now',
      label: 'Queue +',
      description: 'Gewählten Eintrag sofort in der Regie abspielen',
      section: 'queue',
      keywords: ['queue', 'sofort', 'regie', 'push', 'abspielen'],
      enabled: () => true,
      run: async (input) => {
        if (!input.queueEntryId) {
          throw new Error('Kein Queue-Eintrag gewählt');
        }
        return api.queue.now(input.queueEntryId);
      },
      success: () => ({ message: 'Eintrag wird sofort abgespielt.', kind: 'success' }),
    },
    {
      id: 'discovery.open',
      label: 'Discovery',
      description: 'Live-Streamer suchen, vorhören und übernehmen',
      section: 'stream',
      keywords: ['discovery', 'suchen', 'finden', 'tiktok', 'zapper', 'trending'],
      enabled: () => true,
      run: async () => {
        toggleDiscoveryPanel();
      },
      success: () => ({ message: 'Discovery geöffnet.', kind: 'info' }),
    },
    {
      id: 'discovery.zapper',
      label: 'Zapper',
      description: 'Live-Zapper öffnen und durch Räume zappen',
      section: 'stream',
      keywords: ['zapper', 'durchzappen', 'discovery', 'vorhören'],
      enabled: () => true,
      run: async () => {
        openDiscoveryPanel();
        useDiscoveryFeed().openZapperAt();
      },
    },
    {
      id: 'sink.restart',
      label: 'Sink neu',
      description: 'YouTube-Sink kontrolliert neu starten',
      section: 'system',
      keywords: ['sink', 'restart', 'neustart', 'ffmpeg', 'youtube'],
      enabled: (ctx) => Boolean(ctx.status?.sink.running),
      reason: () => 'Sink läuft nicht',
      run: async () => api.system.restartSink(),
      success: () => ({ message: 'YouTube-Sink wird neu gestartet.', kind: 'success' }),
    },
    {
      id: 'source.refresh',
      label: 'Quelle',
      description: 'Quell-URL neu auflösen',
      section: 'system',
      keywords: ['quelle', 'source', 'refresh', 'url', 'tiktok'],
      enabled: (ctx) => Boolean(ctx.status?.active_streamer_id),
      reason: () => 'Kein aktiver Streamer',
      run: async () => api.system.refreshSource(),
      success: () => ({ message: 'Quell-URL wird aktualisiert.', kind: 'success' }),
    },
    {
      id: 'stream.start',
      label: 'Start',
      description: 'Bevorzugten Streamer starten',
      section: 'stream',
      keywords: ['start', 'beginnen', 'los', 'live'],
      enabled: (ctx) => canStart(ctx.status) && ctx.streamers.some((streamer) => streamer.enabled),
      reason: () => 'Kein aktivierter Streamer',
      run: async (input) => {
        const enabled = input.streamers.filter((streamer) => streamer.enabled);
        const candidate =
          enabled.find((streamer) => streamer.preferred && streamer.status.online === true) ??
          enabled.find((streamer) => streamer.status.online === true) ??
          enabled.find((streamer) => streamer.preferred) ??
          enabled[0] ??
          null;
        if (!candidate) throw new Error('Kein aktivierter Streamer vorhanden');
        return api.streamers.start(candidate.id);
      },
      success: (input) => {
        const enabled = input.streamers.filter((streamer) => streamer.enabled);
        const candidate =
          enabled.find((streamer) => streamer.preferred && streamer.status.online === true) ??
          enabled.find((streamer) => streamer.status.online === true) ??
          enabled[0];
        return { message: `${candidate?.name ?? 'Stream'} wird gestartet.`, kind: 'success' };
      },
    },
  ];
}

/** Convenience lookup used by views that need one specific action. */
export function findAction(actions: ActionDef[], id: string): ActionDef | undefined {
  return actions.find((action) => action.id === id);
}
