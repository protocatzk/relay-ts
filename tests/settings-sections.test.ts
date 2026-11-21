import { describe, expect, it } from 'vitest';
import type { Settings } from '../src/web/src/api/types.js';
import {
  applySavedSection,
  buildAllSectionsPayload,
  buildSectionPayload,
  isSectionDirty,
  type SettingsSecretsDraft,
} from '../src/web/src/utils/settings-sections.js';

function makeSettings(): Settings {
  return {
    delay_buffer: { enabled: true, size: 30 },
    video: {
      resolution: '720x1280',
      fps: 30,
      video_bitrate: 4000,
      audio_bitrate: 128,
      preset: 'veryfast',
      encoder: 'auto',
      layout: { enabled: false, scale: 100, position_x: 50, position_y: 50 },
    },
    source: { reencode: 'on_reconnect' },
    watchdog: {
      stall_timeout: 30,
      min_bitrate: 500,
      min_source_rate_percent: 85,
      interval: 5,
      auto_reconnect: true,
    },
    auto_refresh: { enabled: true, interval: 20 },
    pause: {
      enabled: true,
      text: 'Stream pausiert',
      subtext: 'Gleich zurück',
      max_minutes: 15,
      grace_seconds: 2,
      color: '0x101820',
      background: '',
      font: '',
      text_color: 'white',
      fit: 'cover',
    },
    startup: {
      enabled: false,
      duration_seconds: 10,
      text: 'Gleich geht es los',
      subtext: '',
      color: '0x101820',
      background: '',
      font: '',
      text_color: 'white',
      fit: 'cover',
    },
    online: {
      enabled: false,
      source_url: 'https://example.test/online',
      api_key_set: true,
      interval: 30,
      auto_switch_preferred: false,
    },
    chat: {
      api_url: 'https://example.test/chat',
      api_key_set: false,
    },
    streaming: {
      title_template: '{name} live',
    },
    earnings: {
      enabled: false,
      source_url: 'https://example.test/earnings',
      api_key_set: true,
      interval: 300,
      period: 'today',
      view: 'standard',
      overlay_enabled: false,
      overlay_position: 'top-right',
      overlay_template: '{net} €',
      overlay_font_size: 22,
      overlay_margin: 32,
      overlay_offset_x: 0,
      overlay_offset_y: 0,
      overlay_font_color: '#ffffff',
      overlay_box_color: 'rgba(0,0,0,0.5)',
      overlay_show_box: true,
    },
    overlays: {
      chat: {
        enabled: false,
        engine: 'canvas',
        style: 'bubbles',
        api_url: '',
        api_key_set: false,
        poll_interval: 2,
        delay: 0,
        max_lines: 8,
        max_messages: 30,
        max_age_seconds: 0,
        panel_width: 0,
        panel_height: 0,
        render_fps: 10,
        bubble_opacity: 0.7,
        position: 'bottom-left',
        font_size: 20,
        font_color: '#ffffff',
        box_color: 'rgba(0,0,0,0.5)',
        show_timestamps: false,
        show_badges: true,
        show_tiers: true,
        show_stats: false,
        name_colors: true,
        offset_x: 0,
        offset_y: 0,
      },
      clock: {
        enabled: false,
        format: '%H:%M',
        position: 'top-left',
        font_size: 24,
        margin: 32,
        font_color: '#ffffff',
        box_color: 'rgba(0,0,0,0.5)',
        show_box: true,
        offset_x: 0,
        offset_y: 0,
      },
      text: {
        enabled: false,
        text: '',
        position: 'bottom-left',
        font_size: 24,
        margin: 32,
        marquee: false,
        speed: 80,
        font_color: '#ffffff',
        box_color: 'rgba(0,0,0,0.5)',
        show_box: true,
        offset_x: 0,
        offset_y: 0,
      },
      logo: {
        enabled: false,
        position: 'top-left',
        width: 160,
        opacity: 1,
        margin: 32,
        offset_x: 0,
        offset_y: 0,
      },
    },
  };
}

const emptySecrets: SettingsSecretsDraft = {
  onlineApiKey: '',
  chatApiKey: '',
  earningsApiKey: '',
};

describe('settings sections partial updates', () => {
  it('builds isolated payloads containing only the target section keys', () => {
    const settings = makeSettings();

    const delayPayload = buildSectionPayload('delay', settings, emptySecrets);
    expect(delayPayload.delay_buffer).toEqual({
      enabled: true,
      size: 30,
      catchup_rate: 1.01,
    });

    const watchdogPayload = buildSectionPayload('watchdog', settings, emptySecrets);
    expect(Object.keys(watchdogPayload)).toEqual(['watchdog']);

    const videoPayload = buildSectionPayload('video', settings, emptySecrets);
    expect(Object.keys(videoPayload).sort()).toEqual(['source', 'video']);

    const titlePayload = buildSectionPayload('title', settings, emptySecrets);
    expect(Object.keys(titlePayload)).toEqual(['streaming']);
  });

  it('includes secrets only when non-empty', () => {
    const settings = makeSettings();

    const withoutSecrets = buildSectionPayload('monitor', settings, emptySecrets);
    expect(withoutSecrets.online).not.toHaveProperty('api_key');

    const withOnlineSecret = buildSectionPayload('monitor', settings, {
      ...emptySecrets,
      onlineApiKey: '  new-secret  ',
    });
    expect(withOnlineSecret.online?.api_key).toBe('new-secret');

    const withChatSecret = buildSectionPayload('chat', settings, {
      ...emptySecrets,
      chatApiKey: 'chat-secret',
    });
    expect(withChatSecret.chat?.api_key).toBe('chat-secret');

    const withEarningsSecret = buildSectionPayload('earnings', settings, {
      ...emptySecrets,
      earningsApiKey: 'earnings-secret',
    });
    expect(withEarningsSecret.earnings?.api_key).toBe('earnings-secret');
  });

  it('tracks dirty state per section independently', () => {
    const baseline = makeSettings();
    const current = makeSettings();
    current.watchdog.stall_timeout = 45;
    current.source.reencode = 'always';

    expect(isSectionDirty('watchdog', current, baseline, emptySecrets)).toBe(true);
    expect(isSectionDirty('video', current, baseline, emptySecrets)).toBe(true);
    expect(isSectionDirty('delay', current, baseline, emptySecrets)).toBe(false);
    expect(isSectionDirty('title', current, baseline, emptySecrets)).toBe(false);
    expect(
      isSectionDirty('monitor', current, baseline, {
        ...emptySecrets,
        onlineApiKey: 'typed-key',
      }),
    ).toBe(true);
  });

  it('applies a saved section without overwriting unsaved edits in other sections', () => {
    const form = makeSettings();
    const saved = makeSettings();

    form.watchdog.stall_timeout = 55;
    form.streaming.title_template = 'Unsaved Title';
    saved.watchdog.stall_timeout = 55;
    saved.streaming.title_template = '{name} live';

    applySavedSection('watchdog', form, saved);

    expect(form.watchdog.stall_timeout).toBe(55);
    expect(form.streaming.title_template).toBe('Unsaved Title');
  });

  it('combines all editable sections for global save', () => {
    const settings = makeSettings();
    const payload = buildAllSectionsPayload(settings, emptySecrets);
    expect(Object.keys(payload).sort()).toEqual([
      'auto_refresh',
      'chat',
      'delay_buffer',
      'earnings',
      'online',
      'pause',
      'source',
      'startup',
      'streaming',
      'video',
      'watchdog',
    ]);
  });
});
