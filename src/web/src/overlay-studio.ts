import type { OverlayPosition } from '@/src/api/types';

export type { OverlayPosition };
export type Section = 'video' | 'chat' | 'clock' | 'text' | 'logo' | 'earnings';
export type PreviewAspect = '9:16' | '16:9' | '1:1';

export interface OverlayGeometry {
  position: OverlayPosition;
  font_size: number;
  offset_x: number;
  offset_y: number;
  margin: number;
  width?: number;
}

export const SECTIONS: { id: Section; label: string }[] = [
  { id: 'video', label: 'Video' },
  { id: 'chat', label: 'Chat' },
  { id: 'clock', label: 'Uhrzeit' },
  { id: 'text', label: 'Text' },
  { id: 'logo', label: 'Logo' },
  { id: 'earnings', label: 'Einnahmen' },
];

export const PREVIEW_ASPECTS: { value: PreviewAspect; label: string }[] = [
  { value: '9:16', label: '9:16 (TikTok)' },
  { value: '16:9', label: '16:9' },
  { value: '1:1', label: '1:1' },
];

export const POSITIONS: { value: OverlayPosition; label: string; glyph: string }[] = [
  { value: 'top-left', label: 'Oben links', glyph: '◤' },
  { value: 'top-right', label: 'Oben rechts', glyph: '◥' },
  { value: 'bottom-left', label: 'Unten links', glyph: '◣' },
  { value: 'bottom-right', label: 'Unten rechts', glyph: '◢' },
];
