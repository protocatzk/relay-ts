import { describe, expect, it, beforeEach } from 'vitest';
import {
  desktopNavSide,
  setDesktopNavSide,
  toggleDesktopNavSide,
  SECTIONS,
  sectionFor,
  sectionEntry,
} from '../src/web/src/navigation.js';

describe('navigation helper', () => {
  beforeEach(() => {
    setDesktopNavSide('left');
  });

  it('exposes four primary sections with labels and valid paths', () => {
    expect(SECTIONS).toHaveLength(4);
    const ids = SECTIONS.map((s) => s.id);
    expect(ids).toEqual(['live', 'inhalte', 'studio', 'system']);
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
});
