import { join } from 'node:path';
import type { Logger } from 'pino';
import type { MediaConfig } from '../config/loader.js';
import type { Settings } from '../config/schema.js';
import { ensureDir, writeFileAtomic } from '../../utils/fs.js';
import { chatFilter, clockFilter, earningsFilter, resolveFont, textFilter, wrapChatLine } from './drawtext.js';

export interface OverlayManagerOptions {
  media: MediaConfig;
  overlaysDir: string;
  logger: Logger;
}

export interface PreparedOverlays {
  filters: string[];
  fontFile: string | null;
}

/**
 * Prepares drawtext overlays and owns the text files they reload from.
 * Chat messages are written to a text file with reload=1, so new chat lines
 * appear without restarting the encoder (and without breaking RTMP).
 */
export class OverlayManager {
  private readonly options: OverlayManagerOptions;
  private fontFile: string | null;
  private directory: string | null = null;
  private chatFile: string | null = null;
  private textFile: string | null = null;
  private earningsFile: string | null = null;
  private lastEarningsText = '';
  private warnedFont = false;
  private settings: Settings;

  constructor(options: OverlayManagerOptions, settings: Settings) {
    this.options = options;
    this.settings = settings;
    this.fontFile = resolveFont(options.media.overlayFont);
    if (!this.fontFile && !this.warnedFont) {
      this.warnedFont = true;
      this.options.logger.warn(
        { candidates: options.media.overlayFont || 'auto' },
        'Keine Overlay-Schrift gefunden – Uhr/Text/Chat-Overlays werden deaktiviert',
      );
    }
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
  }

  prepare(): PreparedOverlays {
    if (!this.fontFile) return { filters: [], fontFile: null };
    this.directory = join(this.options.overlaysDir, 'active');
    ensureDir(this.directory);
    this.chatFile = join(this.directory, 'chat.txt');
    this.textFile = join(this.directory, 'text.txt');
    this.earningsFile = join(this.directory, 'earnings.txt');
    writeFileAtomic(this.chatFile, '', 0o600);
    writeFileAtomic(this.textFile, this.settings.overlays.text.text || '', 0o600);
    writeFileAtomic(this.earningsFile, this.lastEarningsText, 0o600);

    const filters: string[] = [];
    const clock = clockFilter(this.settings, this.fontFile);
    if (clock) filters.push(clock);
    const text = textFilter(this.settings, this.fontFile, this.textFile);
    if (text) filters.push(text);
    const earnings = earningsFilter(this.settings, this.fontFile, this.earningsFile);
    if (earnings) filters.push(earnings);
    if (this.settings.overlays.chat.engine === 'drawtext') {
      const chat = chatFilter(this.settings, this.fontFile, this.chatFile);
      if (chat) filters.push(chat);
    }
    return { filters, fontFile: this.fontFile };
  }

  updateEarnings(text: string): void {
    this.lastEarningsText = text;
    if (this.earningsFile) writeFileAtomic(this.earningsFile, text, 0o600);
  }

  updateChat(messages: string[]): void {
    if (!this.chatFile) return;
    const config = this.settings.overlays.chat;
    if (!config.enabled) return;
    const [width] = this.settings.video.resolution.split('x').map(Number) as [number, number];
    const maxChars = Math.max(12, Math.floor((width * 0.9) / (config.font_size * 0.56)));
    const lines: string[] = [];
    for (const message of messages.slice(-config.max_lines * 3)) {
      for (const line of wrapChatLine(message, maxChars)) {
        lines.push(line);
        if (lines.length >= config.max_lines) break;
      }
      if (lines.length >= config.max_lines) break;
    }
    writeFileAtomic(this.chatFile, lines.join('\n'), 0o600);
  }

  updateText(text: string): void {
    if (!this.textFile) return;
    writeFileAtomic(this.textFile, text, 0o600);
  }

  get font(): string | null {
    return this.fontFile;
  }

  clear(): void {
    if (this.chatFile) writeFileAtomic(this.chatFile, '', 0o600);
  }
}
