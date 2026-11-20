import { describe, expect, it } from 'vitest';
import {
  escapeDrawtext,
  chatFilter,
  clockFilter,
  earningsFilter,
  positionExpressions,
  remainingTimeFilter,
  textFilter,
  wrapChatLine,
} from '../src/core/overlays/drawtext.js';
import { DEFAULT_SETTINGS } from '../src/core/config/schema.js';
import { extractMessages } from '../src/core/overlays/chat-service.js';
import {
  isTokTrackerUrl,
  parseOnlineStatuses,
  parseTokTrackerStatuses,
} from '../src/core/online/monitor.js';
import { FfmpegProgress } from '../src/utils/ffmpeg-progress.js';

const settings = {
  ...DEFAULT_SETTINGS,
  overlays: {
    chat: { ...DEFAULT_SETTINGS.overlays.chat, enabled: true, max_lines: 5 },
    clock: { ...DEFAULT_SETTINGS.overlays.clock, enabled: true, format: '%H:%M:%S' },
    text: { ...DEFAULT_SETTINGS.overlays.text, enabled: true, text: 'Hallo', marquee: true },
    logo: DEFAULT_SETTINGS.overlays.logo,
  },
};
const font = '/usr/share/fonts/dejavu/DejaVuSans.ttf';

describe('drawtext overlays', () => {
  it('escapes drawtext special characters', () => {
    expect(escapeDrawtext("a:b,c%d'e")).toBe("a\\:b\\,c\\%d\\'e");
    expect(escapeDrawtext('back\\slash')).toBe('back\\\\slash');
  });

  it('maps positions to ffmpeg expressions', () => {
    expect(positionExpressions('top-left')).toEqual({ x: '32', y: '32' });
    expect(positionExpressions('bottom-right')).toEqual({ x: 'w-tw-32', y: 'h-th-32' });
  });

  it('applies studio offsets to ffmpeg expressions', () => {
    expect(positionExpressions('top-left', 32, 100, -40)).toEqual({
      x: '32+100',
      y: '32-40',
    });
    const movedSettings = {
      ...DEFAULT_SETTINGS,
      overlays: {
        ...DEFAULT_SETTINGS.overlays,
        clock: {
          ...DEFAULT_SETTINGS.overlays.clock,
          enabled: true,
          position: 'top-right' as const,
          offset_x: 50,
          offset_y: 20,
        },
      },
    };
    expect(clockFilter(movedSettings, font)).toContain('x=w-tw-32+50:y=32+20');
  });

  it('builds clock, text and chat filters', () => {
    const clock = clockFilter(settings, font);
    expect(clock).toContain('localtime');
    expect(clock).toMatch(/%H\\{3}:%M\\{3}:%S/);
    const text = textFilter(settings, font, '/tmp/text.txt');
    expect(text).toContain("textfile='/tmp/text.txt'");
    expect(text).toContain('reload=1');
    expect(text).toContain('w-mod(t*120\\,w+tw)');
    const chat = chatFilter(settings, font, '/tmp/chat.txt');
    expect(chat).toContain('line_spacing=6');
    expect(chat).toContain("textfile='/tmp/chat.txt'");
  });

  it('applies earnings overlay position, offsets, colors and box toggle', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      earnings: {
        ...DEFAULT_SETTINGS.earnings,
        overlay_enabled: true,
        overlay_position: 'bottom-right' as const,
        overlay_font_size: 30,
        overlay_margin: 40,
        overlay_offset_x: 10,
        overlay_offset_y: -5,
        overlay_font_color: '#ff0000',
        overlay_box_color: 'black@0.5',
        overlay_show_box: false,
      },
    };
    const filter = earningsFilter(settings, font, '/tmp/earnings.txt');
    expect(filter).toContain('fontsize=30');
    expect(filter).toContain('fontcolor=#ff0000');
    expect(filter).toContain('box=0');
    expect(filter).toContain('boxcolor=black@0.5');
    expect(filter).toContain('line_spacing=6');
    expect(filter).toContain('x=w-tw-40+10:y=h-th-40-5');
    expect(earningsFilter({ ...settings, earnings: { ...settings.earnings, overlay_enabled: false } }, font, '/tmp/e.txt')).toBeNull();
  });

  it('builds a remaining-time countdown for local videos', () => {
    const filter = remainingTimeFilter(DEFAULT_SETTINGS, font, 125.4);
    expect(filter).toContain('drawtext=');
    expect(filter).toContain("text='Noch ");
    expect(filter).toContain('125.400');
    expect(filter).toContain('%{eif\\:trunc(');
    expect(filter).toContain('box=1');
    expect(filter).toContain('x=w-tw-24:y=h-th-24');
    expect(filter).not.toContain('/3600');

    const long = remainingTimeFilter(DEFAULT_SETTINGS, font, 3661);
    expect(long).toContain('/3600');

    const sought = remainingTimeFilter(DEFAULT_SETTINGS, font, 125.4, 25.4);
    expect(sought).toContain('100.000');

    expect(remainingTimeFilter(DEFAULT_SETTINGS, font, 0)).toBeNull();
  });

  it('wraps long chat lines and hard-breaks long tokens', () => {
    expect(wrapChatLine('Hallo Welt', 20)).toEqual(['Hallo Welt']);
    const wrapped = wrapChatLine('Hallo Welt wie geht es dir heute so', 15);
    expect(wrapped.every((line) => line.length <= 15)).toBe(true);
    const longToken = 'x'.repeat(40);
    expect(wrapChatLine(longToken, 10).join('')).toHaveLength(40);
  });
});

describe('chat parser', () => {
  it('extracts messages from common API shapes', () => {
    const messages = extractMessages({
      data: {
        messages: [
          { id: 1, username: 'Alice', comment: 'Hallo' },
          { id: 2, user: { uniqueId: 'bob' }, text: 'Hi' },
        ],
      },
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ user: 'Alice', text: 'Hallo' });
    expect(messages[1]).toMatchObject({ user: 'bob', text: 'Hi' });
  });

  it('ignores entries without text', () => {
    expect(extractMessages({ messages: [{ username: 'x' }] })).toEqual([]);
  });

  it('supports TokTracker-style field aliases', () => {
    const messages = extractMessages({
      data: [
        {
          id: 42,
          unique_id: 'alice',
          display_name: 'Alice A.',
          comment: 'Hallo',
          created_at: '2026-01-01T12:00:00Z',
        },
      ],
    });
    expect(messages[0]).toMatchObject({ id: '42', user: 'alice', text: 'Hallo' });
  });

  it('keeps the source streamer for filtering', () => {
    const messages = extractMessages({
      results: [
        { id: 1, username: 'alice', comment: 'A', streamer_username: 'alpha' },
        { id: 2, username: 'bob', comment: 'B', channel: 'beta' },
      ],
    });
    expect(messages[0]?.streamer).toBe('alpha');
    expect(messages[1]?.streamer).toBe('beta');
  });
});

describe('online status parser', () => {
  it('parses handle maps and arrays', () => {
    const statuses = parseOnlineStatuses({
      data: [
        { tiktok: 'Alpha', live: true },
        { username: '@beta', is_live: false },
      ],
      gamma: true,
    });
    expect(statuses.get('alpha')).toBe(true);
    expect(statuses.get('beta')).toBe(false);
    expect(statuses.get('gamma')).toBe(true);
  });

  it('parses nested overview objects', () => {
    const statuses = parseOnlineStatuses({
      streamers: {
        '@alpha': { status: 'live' },
        beta: { online: false },
      },
    });
    expect(statuses.get('alpha')).toBe(true);
    expect(statuses.get('beta')).toBe(false);
  });

  it('ignores metadata booleans and uses the streamers array', () => {
    const statuses = parseOnlineStatuses({
      ok: true,
      enabled: true,
      streamer_count: 2,
      streamers: [
        { username: 'alpha', is_live: true, current_viewers: 10 },
        { username: 'beta', is_live: false, current_viewers: 0 },
      ],
    });
    expect(statuses.get('alpha')).toBe(true);
    expect(statuses.get('beta')).toBe(false);
    expect(statuses.has('enabled')).toBe(false);
    expect(statuses.has('ok')).toBe(false);
  });

  it('parses the TokTracker overview format explicitly', () => {
    const statuses = parseTokTrackerStatuses({
      ok: true,
      streamer_count: 2,
      streamers: [
        { id: 1, username: 'Alpha', display_name: 'Alpha', is_live: true },
        { id: 2, username: 'beta', display_name: 'Beta', is_live: false },
        { id: 3, username: 'gamma', display_name: 'Gamma', is_tracking_active: true },
      ],
    });
    expect(statuses.get('alpha')).toBe(true);
    expect(statuses.get('beta')).toBe(false);
    expect(statuses.has('gamma')).toBe(false);
    expect(isTokTrackerUrl('https://positronium.dev/track/api/public/overview')).toBe(true);
    expect(isTokTrackerUrl('https://example.com/overview')).toBe(false);
  });
});

describe('ffmpeg progress parser', () => {
  it('parses bitrate, fps and dropped frames', () => {
    const progress = new FfmpegProgress();
    for (const line of [
      'frame=120',
      'fps=25.0',
      'bitrate=4021.5kbits/s',
      'drop_frames=3',
      'speed=1.01x',
      'progress=continue',
    ]) {
      progress.push(line);
    }
    expect(progress.frame).toBe(120);
    expect(progress.fps).toBe(25);
    expect(progress.bitrateKbps).toBe(4021.5);
    expect(progress.droppedFrames).toBe(3);
    expect(progress.speed).toBe('1.01x');
    expect(progress.lastUpdate).toBeInstanceOf(Date);
  });
});
