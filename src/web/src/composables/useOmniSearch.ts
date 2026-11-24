import { computed, ref } from 'vue';
import type { Router } from 'vue-router';
import { SETTINGS_SECTIONS } from '@/src/utils/settings-sections';
import { SECTIONS } from '@/src/navigation';
import { store } from '@/src/composables/useStore';
import { buildActions } from '@/src/actions';
import { runRegistryAction } from '@/src/composables/useActions';

export type OmniSearchCategory =
  | 'settings'
  | 'streamers'
  | 'playlists'
  | 'scenes'
  | 'navigation'
  | 'actions';

export interface OmniSearchItem {
  id: string;
  title: string;
  subtitle?: string;
  category: OmniSearchCategory;
  categoryLabel: string;
  keywords: string[];
  icon?: string;
  badge?: string;
  /** Set when the entry cannot run right now (guard failed). */
  disabledReason?: string;
  action: (router: Router) => void | Promise<void>;
}

export const isOmniSearchOpen = ref(false);

export function openOmniSearch(): void {
  isOmniSearchOpen.value = true;
}

export function closeOmniSearch(): void {
  isOmniSearchOpen.value = false;
}

export function toggleOmniSearch(): void {
  isOmniSearchOpen.value = !isOmniSearchOpen.value;
}

export function buildOmniSearchIndex(
  streamersList = store.streamers,
  playlistsList = store.playlists,
): OmniSearchItem[] {
  const items: OmniSearchItem[] = [];

  // 1. Navigation & Views
  for (const sec of SECTIONS) {
    items.push({
      id: `nav-${sec.id}`,
      title: sec.label,
      subtitle: sec.description,
      category: 'navigation',
      categoryLabel: 'Navigation',
      keywords: [sec.label.toLowerCase(), sec.description.toLowerCase(), sec.id],
      icon: '🧭',
      action: (router) => {
        void router.push(sec.to);
      },
    });

    for (const tab of sec.tabs) {
      items.push({
        id: `tab-${tab.to}`,
        title: `${sec.label} → ${tab.label}`,
        subtitle: `Öffnet die Ansicht ${tab.label}`,
        category: 'navigation',
        categoryLabel: 'Navigation',
        keywords: [sec.label.toLowerCase(), tab.label.toLowerCase()],
        icon: '📄',
        action: (router) => {
          void router.push(tab.to);
        },
      });
    }
  }

  // 2. Regie actions from the shared registry (#88)
  const actionIcons: Record<string, string> = {
    'stream.start': '▶',
    'stream.switch': '⇄',
    'stream.stop': '■',
    'screen.pause': '❚❚',
    'screen.startup': '▣',
    'queue.next': '≫',
    'queue.nextEntry': '≫',
    'queue.now': '⚡',
    'sink.restart': '↻',
    'source.refresh': '↻',
  };
  const actionContext = { status: store.status, streamers: store.streamers };
  for (const action of buildActions()) {
    const disabledReason = action.enabled(actionContext)
      ? undefined
      : (action.reason?.(actionContext) ?? 'Gerade nicht verfügbar');
    items.push({
      id: `action-${action.id}`,
      title: `Aktion: ${action.label}`,
      subtitle: disabledReason ?? action.description,
      category: 'actions',
      categoryLabel: 'Aktionen',
      keywords: [...action.keywords, action.id],
      icon: actionIcons[action.id] ?? '▶',
      badge: disabledReason ? 'gesperrt' : undefined,
      disabledReason,
      action: () => {
        void runRegistryAction(action.id);
      },
    });
  }

  // Stream-Deck & Login
  items.push({
    id: 'nav-deck',
    title: 'Stream-Deck',
    subtitle: 'Vollbild-Regiepult mit Touch-Buttons',
    category: 'navigation',
    categoryLabel: 'Navigation',
    keywords: ['deck', 'streamdeck', 'vollbild', 'regie', 'knöpfe'],
    icon: '🎛',
    action: (router) => {
      void router.push('/deck');
    },
  });

  // 2. All Settings Sections & Options
  const settingsKeywordMap: Record<string, string[]> = {
    'settings-delay': ['verzögerung', 'delay', 'puffer', 'buffer', 'catchup', 'latenz', 'sekunden'],
    'settings-video': ['video', 'encoder', 'nvenc', 'qsv', 'amf', 'x264', 'preset', 'fps', 'auflösung', 'resolution', 'bitrate', 'tune'],
    'settings-audio': ['audio', 'loudnorm', 'dynaudnorm', 'gain', 'lautstärke', 'normalisierung', 'stille', 'silence', 'aac'],
    'settings-watchdog': ['watchdog', 'stall', 'bitrate', 'überwachung', 'timeout', 'ausfall', 'reconnect'],
    'settings-refresh': ['auto-refresh', 'aktualisierung', 'refresh', 'intervall', 'minuten'],
    'settings-startup': ['startbildschirm', 'startup', 'countdown', 'intro', 'start-video', 'dauer'],
    'settings-pause': ['pause', 'pausenbildschirm', 'hintergrund', 'grace', 'max_minutes', 'svg', 'assets'],
    'settings-monitor': ['online-monitor', 'monitor', 'check', 'intervall', 'status'],
    'settings-earnings': ['einnahmen', 'earnings', 'coins', 'geld', 'toktracker', 'zeitraum', 'template'],
    'settings-chat': ['chat', 'chat-overlay', 'live-chat', 'kommentare', 'schriftgröße', 'transparenz', 'filter'],
    'settings-title': ['youtube', 'stream-key', 'titel', 'ingest', 'rtmp', 'global_youtube_key', 'live-stream'],
    'settings-webhooks': ['webhooks', 'discord', 'slack', 'benachrichtigung', 'alert', 'signature', 'hmac'],
    'settings-tiktok-accounts': ['tiktok', 'account', 'konto', 'cookie', 'sessionid', 'wechseln', 'multi-account'],
    'settings-appearance': ['erscheinungsbild', 'theme', 'dunkel', 'neon', 'amber', 'design', 'farbe'],
    'settings-totp': ['2fa', 'totp', 'zwei-faktor', 'authentifizierung', 'sicherheit', 'code', 'qr'],
    'settings-sessions': ['sessions', 'anmeldungen', 'geräte', 'login', 'abmelden', 'widerrufen'],
  };

  for (const sec of SETTINGS_SECTIONS) {
    const extraKeywords = settingsKeywordMap[sec.domId] ?? [];
    items.push({
      id: `setting-${sec.id}`,
      title: `Einstellung: ${sec.label}`,
      subtitle: `Direktsprung zur Sektion ${sec.label} (${sec.domId})`,
      category: 'settings',
      categoryLabel: 'Einstellungen',
      keywords: [sec.label.toLowerCase(), ...extraKeywords, sec.id],
      icon: '⚙️',
      badge: sec.restartRequired ? 'Neustart nötig' : undefined,
      action: (router) => {
        void router.push('/settings').then(() => {
          if (typeof window !== 'undefined' && typeof document !== 'undefined') {
            setTimeout(() => {
              const el = document.getElementById(sec.domId);
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                el.focus();
              }
            }, 100);
          }
        });
      },
    });
  }

  // 3. Streamers
  if (streamersList && streamersList.length > 0) {
    for (const s of streamersList) {
      items.push({
        id: `streamer-${s.id}`,
        title: `Streamer: ${s.name}`,
        subtitle: `@${s.tiktok} · Prio ${s.priority}${s.group ? ` · Gruppe: ${s.group}` : ''}`,
        category: 'streamers',
        categoryLabel: 'Streamer',
        keywords: [s.name.toLowerCase(), s.tiktok.toLowerCase(), s.group?.toLowerCase() ?? '', 'streamer'],
        icon: '👤',
        badge: s.enabled ? 'Aktiviert' : 'Deaktiviert',
        action: (router) => {
          void router.push('/streamers');
        },
      });
    }
  }

  // 4. Playlists
  if (playlistsList && playlistsList.length > 0) {
    for (const p of playlistsList) {
      items.push({
        id: `playlist-${p.id}`,
        title: `Playlist: ${p.name}`,
        subtitle: `${p.channels.length} Kanäle/Dateien · ${p.auto_advance ? 'Auto-Advance' : 'Manuell'}`,
        category: 'playlists',
        categoryLabel: 'Playlists',
        keywords: [p.name.toLowerCase(), p.id.toLowerCase(), 'playlist'],
        icon: '🎬',
        action: (router) => {
          void router.push('/playlists');
        },
      });
    }
  }

  // 5. Scenes & Overlays
  items.push({
    id: 'nav-scenes',
    title: 'Szenen-Verwaltung',
    subtitle: 'Szenen-Presets für Overlays und Layouts anlegen oder wechseln',
    category: 'scenes',
    categoryLabel: 'Szenen',
    keywords: ['szene', 'szenen', 'preset', 'profil', 'layout', 'overlay'],
    icon: '🎨',
    action: (router) => {
      void router.push('/overlays');
    },
  });

  // 6. Direct Studio & Live Actions
  items.push({
    id: 'act-discovery-zapper',
    title: 'TikTok Live-Zapper starten',
    subtitle: 'Wechselt zu Discovery im Zapper-Modus',
    category: 'actions',
    categoryLabel: 'Aktionen',
    keywords: ['zapper', 'tiktok', 'durchzappen', 'live', 'discovery'],
    icon: '⚡',
    action: (router) => {
      void router.push('/discovery');
    },
  });

  items.push({
    id: 'act-view-logs',
    title: 'Live-Logs durchsuchen',
    subtitle: 'System- und FFmpeg-Logausgaben anzeigen',
    category: 'actions',
    categoryLabel: 'Aktionen',
    keywords: ['logs', 'fehler', 'debug', 'meldungen', 'ffmpeg', 'audit'],
    icon: '📜',
    action: (router) => {
      void router.push('/logs');
    },
  });

  items.push({
    id: 'act-diagnostics-specs',
    title: 'Hardware- & System-Diagnose',
    subtitle: 'CPU, RAM, Festplatte und Encoder-Empfehlungen einsehen',
    category: 'actions',
    categoryLabel: 'Aktionen',
    keywords: ['diagnose', 'hardware', 'specs', 'cpu', 'ram', 'disk', 'nvenc', 'qsv'],
    icon: '🩺',
    action: (router) => {
      void router.push('/diagnostics');
    },
  });

  return items;
}

export function useOmniSearchRegistry() {
  const allItems = computed<OmniSearchItem[]>(() => buildOmniSearchIndex());
  return { allItems };
}
