import { computed, ref } from 'vue';
import { resolveTheme, type Theme, type ThemePreference } from '../utils/theme.js';

export type { Theme, ThemePreference };
export { resolveTheme };

const STORAGE_KEY = 'relay-theme';

const preference = ref<ThemePreference>('auto');
const systemLight = ref(false);
let mediaBound = false;

const theme = computed<Theme>(() => resolveTheme(preference.value, systemLight.value));

function themeColorFor(value: Theme): string {
  return value === 'light' ? '#f4ead8' : '#05070b';
}

function applyMeta(value: Theme): void {
  if (typeof document === 'undefined') return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = themeColorFor(value);
}

function syncDom(): void {
  if (typeof document === 'undefined') return;
  const resolved = theme.value;
  document.documentElement.dataset.theme = resolved;
  applyMeta(resolved);
}

function applyPreference(value: ThemePreference): void {
  preference.value = value;
  syncDom();
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, value);
  }
}

export function initTheme(): void {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    systemLight.value = mq.matches;
    if (!mediaBound) {
      mediaBound = true;
      mq.addEventListener('change', (event) => {
        systemLight.value = event.matches;
        if (preference.value === 'auto') syncDom();
      });
    }
  }
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  const initial: ThemePreference =
    saved === 'light' || saved === 'dark' || saved === 'auto' ? saved : 'auto';
  applyPreference(initial);
}

export function toggleTheme(): Theme {
  const order: ThemePreference[] = ['auto', 'dark', 'light'];
  const next = order[(order.indexOf(preference.value) + 1) % order.length]!;
  applyPreference(next);
  return theme.value;
}

export function useTheme() {
  return {
    theme,
    preference,
    themeLabel: computed(() => {
      if (preference.value === 'auto') {
        return `Auto (${theme.value === 'light' ? 'Amber' : 'Neon'})`;
      }
      return preference.value === 'light' ? 'Amber' : 'Neon';
    }),
    toggleTheme,
    applyTheme: applyPreference,
  };
}
