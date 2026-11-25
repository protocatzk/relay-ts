export type SoundKind = 'sfx' | 'music';
export type MusicLoopMode = 'off' | 'one' | 'all';
export type SoundStopScope = 'sfx' | 'music' | 'all';

export const SOUNDBOARD_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.opus'] as const;
export const MAX_SFX_DURATION_SECONDS = 60;
export const MAX_MUSIC_DURATION_SECONDS = 900;
export const MAX_SOUND_UPLOAD_BYTES = 50 * 1024 * 1024;

export interface SoundEntry {
  id: string;
  name: string;
  file: string;
  kind: SoundKind;
  duration: number;
  gain_db: number;
  color: string;
  hotkey: string;
  created_at: string;
}

export interface SoundPlayingEntry {
  id: string;
  name: string;
  kind: SoundKind;
  started_at: string;
  position: number;
  duration: number;
}

export interface MusicState {
  id: string;
  name: string;
  paused: boolean;
  loop: MusicLoopMode;
  position: number;
  duration: number;
}

export interface SoundboardState {
  enabled: boolean;
  attached: boolean;
  playing: SoundPlayingEntry[];
  music: MusicState | null;
  master_gain_db: number;
  sfx_gain_db: number;
  music_gain_db: number;
  ducking: boolean;
  duck_db: number;
  sounds: SoundEntry[];
}
