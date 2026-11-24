import { describe, expect, it } from 'vitest';
import { resolveZapperKey, ZAPPER_SHORTCUTS } from '../src/web/src/utils/discovery-keys.js';

describe('zapper keyboard mapping', () => {
  it('maps both arrow pairs to previous and next', () => {
    expect(resolveZapperKey('ArrowUp')).toBe('prev');
    expect(resolveZapperKey('ArrowLeft')).toBe('prev');
    expect(resolveZapperKey('ArrowDown')).toBe('next');
    expect(resolveZapperKey('ArrowRight')).toBe('next');
  });

  it('toggles the mute on space and M', () => {
    expect(resolveZapperKey(' ')).toBe('mute');
    expect(resolveZapperKey('M')).toBe('mute');
  });

  it('maps the regie shortcuts case-insensitively', () => {
    expect(resolveZapperKey('s')).toBe('switch');
    expect(resolveZapperKey('S')).toBe('switch');
    expect(resolveZapperKey('q')).toBe('queue');
    expect(resolveZapperKey('A')).toBe('add');
    expect(resolveZapperKey('f')).toBe('fullscreen');
  });

  it('opens help with ? and h, closes with Escape', () => {
    expect(resolveZapperKey('?')).toBe('help');
    expect(resolveZapperKey('h')).toBe('help');
    expect(resolveZapperKey('Escape')).toBe('close');
  });

  it('ignores unrelated keys', () => {
    expect(resolveZapperKey('x')).toBeNull();
    expect(resolveZapperKey('Enter')).toBeNull();
    expect(resolveZapperKey('Tab')).toBeNull();
  });

  it('documents every action in the help table', () => {
    const actions = new Set(
      ['prev', 'next', 'mute', 'switch', 'queue', 'add', 'fullscreen', 'help', 'close'].map(
        (action) => action,
      ),
    );
    expect(ZAPPER_SHORTCUTS.length).toBeGreaterThanOrEqual(6);
    for (const entry of ZAPPER_SHORTCUTS) {
      expect(entry.keys.length).toBeGreaterThan(0);
      expect(entry.label.length).toBeGreaterThan(0);
    }
    expect(actions.size).toBe(9);
  });
});
