import { computed, ref } from 'vue';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'relay-theme';

const theme = ref<Theme>('dark');

function themeColorFor(value: Theme): string {
  return value === 'light' ? '#f4ead8' : '#05070b';
}

function applyMeta(value: Theme): void {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = themeColorFor(value);
}

function apply(value: Theme): void {
  theme.value = value;
  document.documentElement.dataset.theme = value;
  applyMeta(value);
  localStorage.setItem(STORAGE_KEY, value);
}

export function initTheme(): void {
  const saved = localStorage.getItem(STORAGE_KEY);
  apply(saved === 'light' ? 'light' : 'dark');
}

export function toggleTheme(): Theme {
  apply(theme.value === 'light' ? 'dark' : 'light');
  return theme.value;
}

export function useTheme() {
  return {
    theme,
    themeLabel: computed(() => (theme.value === 'light' ? 'Amber' : 'Neon')),
    toggleTheme,
    applyTheme: apply,
  };
}
