/**
 * Global navigation structure: four sections, each with its own sub-pages.
 *
 * The bottom navigation shows the sections; pages inside a section share a
 * second-level tab bar (see `SectionTabs.vue`). Routes stay flat so existing
 * deep links keep working; the section is attached via `meta.section`.
 */

import { reactive, ref } from 'vue';

export type DesktopNavSide = 'left' | 'right';

const NAV_SIDE_STORAGE_KEY = 'relay_nav_position';

function readDesktopNavSide(): DesktopNavSide {
  try {
    if (typeof localStorage === 'undefined') return 'left';
    const raw = localStorage.getItem(NAV_SIDE_STORAGE_KEY);
    return raw === 'right' ? 'right' : 'left';
  } catch {
    return 'left';
  }
}

export const desktopNavSide = ref<DesktopNavSide>(readDesktopNavSide());

export function setDesktopNavSide(side: DesktopNavSide): void {
  desktopNavSide.value = side;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(NAV_SIDE_STORAGE_KEY, side);
    }
  } catch {
    // Storage may be unavailable
  }
}

export function toggleDesktopNavSide(): void {
  setDesktopNavSide(desktopNavSide.value === 'left' ? 'right' : 'left');
}

export type SectionId = 'live' | 'inhalte' | 'studio' | 'system';

export interface IconSegment {
  d: string;
  fill?: boolean;
}

export interface SectionTab {
  label: string;
  to: string;
}

export interface NavSection {
  id: SectionId;
  label: string;
  /** Short description for tooltips and assistive tech. */
  description: string;
  /** Destination when the section entry in the bottom nav is tapped. */
  to: string;
  segments: IconSegment[];
  tabs: SectionTab[];
}

export const SECTIONS: NavSection[] = [
  {
    id: 'live',
    label: 'Live',
    description: 'Status, Steuerung und Vorschau',
    to: '/',
    segments: [{ d: 'M3 12h3.5l2.5-7 4 14 2.5-7H21' }],
    tabs: [],
  },
  {
    id: 'inhalte',
    label: 'Inhalte',
    description: 'Streamer, Playlists und Medien',
    to: '/streamers',
    segments: [
      { d: 'M12 3 3 8l9 5 9-5-9-5z' },
      { d: 'M3 12.5l9 5 9-5' },
      { d: 'M3 17l9 5 9-5' },
    ],
    tabs: [
      { label: 'Streamer', to: '/streamers' },
      { label: 'Discovery', to: '/discovery' },
      { label: 'Playlists', to: '/playlists' },
      { label: 'Medien', to: '/media' },
      { label: 'Zeitplan', to: '/schedules' },
    ],
  },
  {
    id: 'studio',
    label: 'Studio',
    description: 'Overlays und YouTube',
    to: '/overlays',
    segments: [
      { d: 'M3 5h18v11H3z' },
      { d: 'M8 20h8M12 16v4' },
      { d: 'm10.5 8.5 4.5 2.5-4.5 2.5z', fill: true },
    ],
    tabs: [
      { label: 'Overlays', to: '/overlays' },
      { label: 'YouTube', to: '/youtube' },
      { label: 'Ausgabe', to: '/output' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    description: 'Einstellungen und Logs',
    to: '/settings',
    segments: [
      { d: 'M4 6h16M4 12h16M4 18h16' },
      { d: 'M8 4v4M16 10v4M7 16v4' },
    ],
    tabs: [
      { label: 'Einstellungen', to: '/settings' },
      { label: 'Logs', to: '/logs' },
      { label: 'Diagnose', to: '/diagnostics' },
    ],
  },
];

export function sectionFor(id: unknown): NavSection | undefined {
  return SECTIONS.find((section) => section.id === id);
}

/* ---------------------------------------------------------------- tab memory */

const STORAGE_KEY = 'relay.nav.section-tab';

function readLastTabs(): Partial<Record<SectionId, string>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<SectionId, string>>) : {};
  } catch {
    return {};
  }
}

const lastTabs = reactive<Partial<Record<SectionId, string>>>(readLastTabs());

/** Entry path for a section: the last visited sub-page, if it still exists. */
export function sectionEntry(section: NavSection): string {
  const path = lastTabs[section.id];
  return path && section.tabs.some((tab) => tab.to === path) ? path : section.to;
}

/** Remember the sub-page so the section tab does not always reset to its first page. */
export function rememberSectionTab(sectionId: SectionId, path: string): void {
  const section = sectionFor(sectionId);
  if (!section || !section.tabs.some((tab) => tab.to === path)) return;
  lastTabs[sectionId] = path;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lastTabs));
  } catch {
    // Storage may be unavailable (private mode); memory-only is fine.
  }
}
