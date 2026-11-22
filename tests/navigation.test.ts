import { describe, expect, it, beforeEach } from 'vitest';
import {
  desktopNavSide,
  setDesktopNavSide,
  toggleDesktopNavSide,
  SECTIONS,
  sectionFor,
  sectionEntry,
} from '../src/web/src/navigation.js';
import {
  DEFAULT_AVATAR_SVG_URL,
  RELAY_LOGO_AVATAR_URL,
  avatarFallbackMode,
  resolveAvatarSrc,
  setAvatarFallbackCustomUrl,
  setAvatarFallbackMode,
} from '../src/web/src/composables/useAvatarFallback.js';

describe('navigation helper', () => {
  beforeEach(() => {
    setDesktopNavSide('left');
    setAvatarFallbackMode('svg');
    setAvatarFallbackCustomUrl('');
  });

  it('exposes five primary sections with labels and valid paths', () => {
    expect(SECTIONS).toHaveLength(5);
    const ids = SECTIONS.map((s) => s.id);
    expect(ids).toEqual(['live', 'discovery', 'inhalte', 'studio', 'system']);
    for (const section of SECTIONS) {
      expect(section.label).toBeTruthy();
      expect(section.to).toBeTruthy();
      expect(sectionFor(section.id)).toBe(section);
      expect(sectionEntry(section)).toBeTruthy();
    }
  });

  it('manages desktop nav side with toggle capability', () => {
    expect(desktopNavSide.value).toBe('left');
    setDesktopNavSide('right');
    expect(desktopNavSide.value).toBe('right');
    toggleDesktopNavSide();
    expect(desktopNavSide.value).toBe('left');
    toggleDesktopNavSide();
    expect(desktopNavSide.value).toBe('right');
  });

  it('resolves configurable fallback avatar strictly as fallback when primary url is missing or failed', () => {
    expect(avatarFallbackMode.value).toBe('svg');
    expect(resolveAvatarSrc('https://cdn.example.com/avatar.webp', false)).toBe(
      'https://cdn.example.com/avatar.webp',
    );
    expect(resolveAvatarSrc('https://cdn.example.com/avatar.webp', true)).toBe(
      DEFAULT_AVATAR_SVG_URL,
    );
    expect(resolveAvatarSrc(null, false)).toBe(DEFAULT_AVATAR_SVG_URL);

    setAvatarFallbackMode('logo');
    expect(resolveAvatarSrc('', false)).toBe(RELAY_LOGO_AVATAR_URL);
    expect(resolveAvatarSrc('https://cdn.example.com/avatar.webp', true)).toBe(
      RELAY_LOGO_AVATAR_URL,
    );

    setAvatarFallbackMode('custom');
    setAvatarFallbackCustomUrl('/custom-avatar.svg');
    expect(resolveAvatarSrc(null, false)).toBe('/custom-avatar.svg');

    setAvatarFallbackMode('initials');
    expect(resolveAvatarSrc(null, false)).toBeNull();
    expect(resolveAvatarSrc('https://cdn.example.com/avatar.webp', false)).toBe(
      'https://cdn.example.com/avatar.webp',
    );
  });
});
