import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { MediaConfig } from '../config/loader.js';
import type { Settings } from '../config/schema.js';
import { buildPausePreviewArgs } from '../source/ffmpeg.js';
import { runCommand } from '../../utils/process.js';
import { resolveFont } from './drawtext.js';
import { resolveSlateBackground } from './pause-screen.js';
import { renderSlatePng } from './slate-renderer.js';

export type SlateScreen = 'pause' | 'startup';

export type SlateDraft = Partial<{
  text: string;
  subtext: string;
  color: string;
  background: string;
  font: string;
  text_color: string;
  fit: 'cover' | 'contain' | 'stretch';
}>;

export interface PausePreviewOptions {
  media: MediaConfig;
  settings: Settings;
  overlaysDir: string;
  logger: Logger;
  screen?: SlateScreen;
  draft?: SlateDraft;
}

/**
 * Renders a single PNG frame of the pause/startup slate, including the
 * drawtext layers. Used by the settings UI to show the final design before the
 * values are saved.
 */
export async function renderPausePreview(options: PausePreviewOptions): Promise<Buffer> {
  const screen = options.screen ?? 'pause';
  const base = screen === 'startup' ? options.settings.startup : options.settings.pause;
  const draft = Object.fromEntries(
    Object.entries(options.draft ?? {}).filter(([, value]) => value !== undefined),
  ) as SlateDraft;
  const slate = { ...base, ...draft };
  if (!slate.background?.trim()) {
    const [width, height] = options.settings.video.resolution
      .split('x')
      .map(Number) as [number, number];
    return renderSlatePng({
      screen,
      width,
      height,
      text: slate.text,
      subtext: slate.subtext,
      color: slate.color,
      textColor: slate.text_color,
      layoutMode: options.settings.overlays.chat.layout_mode,
    });
  }
  const background = await resolveSlateBackground(slate.background, options);
  const fontFile = resolveFont(slate.font) ?? resolveFont('');

  const directory = mkdtempSync(join(tmpdir(), 'relay-pause-preview-'));
  const output = join(directory, 'preview.png');
  try {
    const args = buildPausePreviewArgs({
      media: options.media,
      settings: options.settings,
      background,
      text: slate.text,
      subtext: slate.subtext,
      fontFile,
      textColor: slate.text_color,
      color: slate.color,
      fit: slate.fit,
      output,
    });
    const result = await runCommand(options.media.ffmpegBin, args, { timeoutMs: 20_000 });
    if (result.code !== 0) {
      options.logger.warn(
        { code: result.code, stderr: result.stderr.slice(-1000) },
        'Pausen-Vorschau konnte nicht gerendert werden',
      );
      throw new Error('Vorschau konnte nicht erzeugt werden');
    }
    return readFileSync(output);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
