export type Theme = 'dark' | 'light';
export type ThemePreference = 'auto' | 'dark' | 'light';

export function resolveTheme(pref: ThemePreference, isSystemLight: boolean): Theme {
  if (pref === 'auto') return isSystemLight ? 'light' : 'dark';
  return pref;
}
