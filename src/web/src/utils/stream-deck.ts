import type { Router } from 'vue-router';

export type DeckActionId = 'start' | 'stop' | 'pause' | 'startup';

export interface DeckActionConfig {
  id: DeckActionId;
  visible: boolean;
}

export const DEFAULT_DECK_ACTIONS: readonly DeckActionConfig[] = [
  { id: 'start', visible: true },
  { id: 'stop', visible: true },
  { id: 'pause', visible: true },
  { id: 'startup', visible: true },
];

export const DECK_ACTION_LABELS: Record<DeckActionId, string> = {
  start: 'Start',
  stop: 'Stop',
  pause: 'Pause / Resume',
  startup: 'Startbildschirm',
};

const STORAGE_KEY = 'relay.deck.layout.v1';

export function loadDeckLayout(): DeckActionConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DECK_ACTIONS.map((item) => ({ ...item }));
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_DECK_ACTIONS.map((item) => ({ ...item }));
    const validIds = new Set<DeckActionId>(['start', 'stop', 'pause', 'startup']);
    const seen = new Set<DeckActionId>();
    const result: DeckActionConfig[] = [];
    for (const candidate of parsed) {
      if (!candidate || typeof candidate !== 'object') continue;
      const item = candidate as Partial<DeckActionConfig>;
      if (!item.id || !validIds.has(item.id) || seen.has(item.id)) continue;
      seen.add(item.id);
      result.push({ id: item.id, visible: item.visible !== false });
    }
    for (const fallback of DEFAULT_DECK_ACTIONS) {
      if (!seen.has(fallback.id)) result.push({ ...fallback });
    }
    return result;
  } catch {
    return DEFAULT_DECK_ACTIONS.map((item) => ({ ...item }));
  }
}

export function saveDeckLayout(layout: readonly DeckActionConfig[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    /* ignore private-mode storage errors */
  }
}

/**
 * Open the Stream-Deck in a screen-sized popup window without forcing Fullscreen API.
 * Falls back to navigating inside the current tab when popups are blocked.
 */
export function openStreamDeckWindow(router: Router): boolean {
  const width = window.screen?.availWidth || window.innerWidth || 1280;
  const height = window.screen?.availHeight || window.innerHeight || 800;
  const features = `popup=yes,width=${width},height=${height},left=0,top=0,resizable=yes,scrollbars=yes`;
  const url = `${window.location.origin}${window.location.pathname}#/deck`;
  const opened = window.open(url, 'relay-stream-deck', features);
  if (opened) {
    opened.focus();
    return true;
  }
  void router.push('/deck');
  return false;
}
