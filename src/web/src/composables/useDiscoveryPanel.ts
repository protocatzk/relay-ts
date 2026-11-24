/**
 * Discovery panel state (#92).
 *
 * Module-level like the feed: the header search, the cockpit action row and the
 * command palette must all open the same panel.
 */
import { ref } from 'vue';
import router from '@/src/router';
import { useDiscoveryFeed } from '@/src/composables/useDiscoveryFeed';

const WIDTH_KEY = 'relay.discovery.width';
export const PANEL_MIN_WIDTH = 320;
export const PANEL_MAX_WIDTH = 560;
export const PANEL_DEFAULT_WIDTH = 440;

function readWidth(): number {
  try {
    const raw = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(raw) && raw >= PANEL_MIN_WIDTH && raw <= PANEL_MAX_WIDTH) return raw;
  } catch {
    /* storage may be unavailable */
  }
  return PANEL_DEFAULT_WIDTH;
}

/** Mirrors the width onto `:root` so the cockpit can reserve space. */
function applyWidthVar(px: number): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--discovery-w', `${px}px`);
}

const open = ref(false);
const width = ref(readWidth());
let returnFocus: HTMLElement | null = null;

applyWidthVar(width.value);

function focusTarget(): void {
  // Two frames: the transition mounts the panel and the workspace renders.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('#discovery-panel-search');
      if (input) {
        input.focus();
        input.select();
      } else {
        document.querySelector<HTMLElement>('.discovery-panel')?.focus();
      }
    });
  });
}

export function openDiscoveryPanel(options: { query?: string; handle?: string } = {}): void {
  const feed = useDiscoveryFeed();
  // The panel is part of the cockpit layout; open it from any route.
  if (router.currentRoute.value.path !== '/') void router.push('/');
  const term = options.handle ?? options.query;
  if (typeof term === 'string' && term.trim()) {
    feed.setQuery(term);
    void feed.runSearch(term);
  } else {
    feed.start();
  }
  if (!open.value) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  open.value = true;
  focusTarget();
}

export function closeDiscoveryPanel(): void {
  if (!open.value) return;
  open.value = false;
  const target = returnFocus;
  returnFocus = null;
  requestAnimationFrame(() => target?.focus?.());
}

export function toggleDiscoveryPanel(): void {
  if (open.value) closeDiscoveryPanel();
  else openDiscoveryPanel();
}

export function setDiscoveryPanelWidth(px: number): void {
  const next = Math.round(Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, px)));
  width.value = next;
  applyWidthVar(next);
  try {
    localStorage.setItem(WIDTH_KEY, String(next));
  } catch {
    /* ignore */
  }
}

export function useDiscoveryPanel() {
  return {
    open,
    width,
    openDiscoveryPanel,
    closeDiscoveryPanel,
    toggleDiscoveryPanel,
    setDiscoveryPanelWidth,
  };
}
