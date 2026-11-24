/**
 * Keyboard mapping for the discovery zapper (#92).
 *
 * Pure so the shortcut table can be unit-tested without a browser.
 */
export type ZapperKeyAction =
  | 'prev'
  | 'next'
  | 'mute'
  | 'switch'
  | 'queue'
  | 'add'
  | 'fullscreen'
  | 'help'
  | 'close';

/** Resolves a `KeyboardEvent.key` to a zapper action. */
export function resolveZapperKey(key: string): ZapperKeyAction | null {
  switch (key) {
    case 'ArrowUp':
    case 'ArrowLeft':
      return 'prev';
    case 'ArrowDown':
    case 'ArrowRight':
      return 'next';
    case ' ':
    case 'Spacebar':
    case 'm':
    case 'M':
      return 'mute';
    case 's':
    case 'S':
      return 'switch';
    case 'q':
    case 'Q':
      return 'queue';
    case 'a':
    case 'A':
      return 'add';
    case 'f':
    case 'F':
      return 'fullscreen';
    case '?':
    case 'h':
    case 'H':
      return 'help';
    case 'Escape':
      return 'close';
    default:
      return null;
  }
}

/** Shortcut table rendered in the help overlay. */
export const ZAPPER_SHORTCUTS: { keys: string; label: string }[] = [
  { keys: '← / →', label: 'Vorheriger / nächster Raum' },
  { keys: 'Leertaste', label: 'Ton ein / aus' },
  { keys: 'S', label: 'Sofort auf YouTube schalten' },
  { keys: 'Q', label: 'In die Regie-Queue' },
  { keys: 'A', label: 'Als Streamer speichern' },
  { keys: 'F', label: 'Vollbild' },
  { keys: '?', label: 'Diese Hilfe' },
  { keys: 'Esc', label: 'Zurück zur Liste' },
];
