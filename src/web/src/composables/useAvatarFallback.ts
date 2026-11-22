import { computed, ref } from 'vue';

export type AvatarFallbackMode = 'svg' | 'logo' | 'initials' | 'custom';

const MODE_STORAGE_KEY = 'relay.appearance.avatar_fallback_mode';
const CUSTOM_URL_STORAGE_KEY = 'relay.appearance.avatar_fallback_url';

export const DEFAULT_AVATAR_SVG_URL = '/avatar-fallback.svg';
export const RELAY_LOGO_AVATAR_URL = '/logo.svg';

function readMode(): AvatarFallbackMode {
  try {
    if (typeof localStorage === 'undefined') return 'svg';
    const raw = localStorage.getItem(MODE_STORAGE_KEY);
    if (raw === 'svg' || raw === 'logo' || raw === 'initials' || raw === 'custom') {
      return raw;
    }
    return 'svg';
  } catch {
    return 'svg';
  }
}

function readCustomUrl(): string {
  try {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem(CUSTOM_URL_STORAGE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

export const avatarFallbackMode = ref<AvatarFallbackMode>(readMode());
export const avatarFallbackCustomUrl = ref<string>(readCustomUrl());

export function setAvatarFallbackMode(mode: AvatarFallbackMode): void {
  avatarFallbackMode.value = mode;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MODE_STORAGE_KEY, mode);
    }
  } catch {
    /* ignore storage errors */
  }
}

export function setAvatarFallbackCustomUrl(url: string): void {
  const trimmed = url.trim();
  avatarFallbackCustomUrl.value = trimmed;
  try {
    if (typeof localStorage !== 'undefined') {
      if (trimmed) {
        localStorage.setItem(CUSTOM_URL_STORAGE_KEY, trimmed);
      } else {
        localStorage.removeItem(CUSTOM_URL_STORAGE_KEY);
      }
    }
  } catch {
    /* ignore storage errors */
  }
}

export const resolvedFallbackAvatarUrl = computed<string | null>(() => {
  switch (avatarFallbackMode.value) {
    case 'logo':
      return RELAY_LOGO_AVATAR_URL;
    case 'initials':
      return null;
    case 'custom':
      return avatarFallbackCustomUrl.value || DEFAULT_AVATAR_SVG_URL;
    case 'svg':
    default:
      return DEFAULT_AVATAR_SVG_URL;
  }
});

/**
 * Returns the primary avatar URL if present and not marked as failed,
 * otherwise returns the configured fallback image URL (or null when mode === 'initials').
 */
export function resolveAvatarSrc(
  primaryUrl: string | null | undefined,
  failed = false,
): string | null {
  const cleaned = primaryUrl?.trim();
  if (cleaned && !failed) {
    return cleaned;
  }
  return resolvedFallbackAvatarUrl.value;
}
