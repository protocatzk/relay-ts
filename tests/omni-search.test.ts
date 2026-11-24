import { describe, expect, it } from 'vitest';
import { SETTINGS_SECTIONS } from '../src/web/src/utils/settings-sections.js';
import { SECTIONS } from '../src/web/src/navigation.js';

describe('OmniSearch Navigation & Settings coverage', () => {
  it('covers all primary navigation sections', () => {
    expect(SECTIONS.length).toBeGreaterThanOrEqual(4);
    const sectionLabels = SECTIONS.map((s) => s.label);
    expect(sectionLabels).toContain('Live');
    expect(sectionLabels).toContain('Inhalte');
    expect(sectionLabels).toContain('Studio');
    expect(sectionLabels).toContain('System');
    // Discovery moved into the Live section as a sub-tab (#88).
    const live = SECTIONS.find((section) => section.id === 'live');
    expect(live?.tabs.map((tab) => tab.to)).toContain('/discovery');
  });

  it('covers all defined settings sections with labels and DOM IDs', () => {
    expect(SETTINGS_SECTIONS.length).toBeGreaterThanOrEqual(14);
    const domIds = SETTINGS_SECTIONS.map((s) => s.domId);
    expect(domIds).toContain('settings-delay');
    expect(domIds).toContain('settings-video');
    expect(domIds).toContain('settings-audio');
    expect(domIds).toContain('settings-watchdog');
    expect(domIds).toContain('settings-tiktok-accounts');
    expect(domIds).toContain('settings-appearance');
    expect(domIds).toContain('settings-totp');
    expect(domIds).toContain('settings-sessions');
  });

  it('maps sections to restart requirement flags appropriately', () => {
    const delay = SETTINGS_SECTIONS.find((s) => s.id === 'delay');
    expect(delay?.restartRequired).toBe(true);
    const watchdog = SETTINGS_SECTIONS.find((s) => s.id === 'watchdog');
    expect(watchdog?.restartRequired).toBeFalsy();
  });
});
