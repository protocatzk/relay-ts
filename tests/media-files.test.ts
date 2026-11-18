import { describe, expect, it } from 'vitest';
import { isSafeMediaFilename, mediaFilePath } from '../src/core/media/media-files.js';

describe('media files', () => {
  it('accepts safe video filenames and rejects traversal', () => {
    expect(isSafeMediaFilename('intro-01.mp4')).toBe(true);
    expect(isSafeMediaFilename('clip.webm')).toBe(true);
    expect(isSafeMediaFilename('../secret.mp4')).toBe(false);
    expect(isSafeMediaFilename('nested/clip.mp4')).toBe(false);
    expect(isSafeMediaFilename('clip.txt')).toBe(false);
    expect(mediaFilePath('/app/data', '../secret.mp4')).toBeNull();
    expect(mediaFilePath('/app/data', 'clip.mp4')).toBe('/app/data/media/clip.mp4');
  });
});
