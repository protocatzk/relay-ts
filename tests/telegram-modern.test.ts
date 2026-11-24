import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { TelegramApiClient, TelegramApiError } from '../src/core/telegram/api.js';
import {
  buildActionableAlertKeyboard,
  buildConfirmationKeyboard,
  buildMainMenuKeyboard,
  chunkButtons,
  makeCallbackButton,
  makeUrlButton,
  makeWebAppButton,
} from '../src/core/telegram/keyboards.js';
import {
  escapeHtml,
  formatBitrate,
  formatBytes,
  formatDuration,
  formatExpandableQuote,
  formatProgressBar,
  renderLiveStatusCard,
} from '../src/core/telegram/views.js';
import type { StatusSnapshot } from '../src/core/events.js';

const logger = pino({ level: 'silent' });

describe('TelegramApiClient', () => {
  it('calls standard JSON API method with correct headers and payload', async () => {
    let capturedUrl = '';
    let capturedBody: Record<string, unknown> = {};

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const client = new TelegramApiClient('123456:ABC-DEF', logger);
    const msg = await client.sendMessage({ chat_id: 123, text: 'Hello World' });

    expect(capturedUrl).toBe('https://api.telegram.org/bot123456:ABC-DEF/sendMessage');
    expect(capturedBody).toEqual({ chat_id: 123, text: 'Hello World' });
    expect(msg.message_id).toBe(42);
  });

  it('configures chat menu button with web app payload', async () => {
    let capturedUrl = '';
    let capturedBody: Record<string, unknown> = {};

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const client = new TelegramApiClient('TOKEN', logger);
    const ok = await client.setChatMenuButton({
      menu_button: {
        type: 'web_app',
        text: 'RELAY Cockpit',
        web_app: { url: 'https://relay.test' },
      },
    });

    expect(ok).toBe(true);
    expect(capturedUrl).toContain('/setChatMenuButton');
    expect(capturedBody).toEqual({
      menu_button: {
        type: 'web_app',
        text: 'RELAY Cockpit',
        web_app: { url: 'https://relay.test' },
      },
    });
  });

  it('sends photo using multipart FormData when buffer is passed', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedInit = init;
        return new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const client = new TelegramApiClient('TOKEN', logger);
    const fakeJpg = Buffer.from('fake-jpeg-data');
    const res = await client.sendPhoto({
      chat_id: 456,
      photo: fakeJpg,
      caption: 'Live snapshot',
    });

    expect(res.message_id).toBe(99);
    expect(capturedUrl).toContain('/sendPhoto');
    expect(capturedInit?.body).toBeInstanceOf(FormData);
  });

  it('handles 429 rate limit error gracefully and extracts retry_after', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            ok: false,
            error_code: 429,
            description: 'Too Many Requests: retry after 5',
            parameters: { retry_after: 5 },
          }),
          { status: 429, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    const client = new TelegramApiClient('TOKEN', logger);
    await expect(client.sendMessage({ chat_id: 1, text: 'Hi' })).rejects.toThrow(
      TelegramApiError,
    );
  });
});

describe('Telegram Keyboards', () => {
  it('creates callback and web_app buttons correctly', () => {
    const cb = makeCallbackButton('Label', 'cmd:run');
    expect(cb).toEqual({ text: 'Label', callback_data: 'cmd:run' });

    const web = makeWebAppButton('Open Cockpit', 'https://relay.test');
    expect(web).toEqual({ text: 'Open Cockpit', web_app: { url: 'https://relay.test' } });

    const link = makeUrlButton('Web', 'https://relay.test');
    expect(link).toEqual({ text: 'Web', url: 'https://relay.test' });
  });

  it('builds main menu with Web App button when dashboardUrl is present', () => {
    const kb = buildMainMenuKeyboard('https://relay.positronium.dev');
    const flat = kb.inline_keyboard.flat();
    const webAppBtn = flat.find((btn) => btn.web_app?.url === 'https://relay.positronium.dev');
    expect(webAppBtn).toBeDefined();
    expect(webAppBtn?.text).toContain('Web Cockpit');
  });

  it('builds actionable alert keyboard for source_offline', () => {
    const kb = buildActionableAlertKeyboard('source_offline');
    const flat = kb.inline_keyboard.flat();
    const pauseBtn = flat.find((btn) => btn.callback_data === 'act:screen:pause');
    const stopBtn = flat.find((btn) => btn.callback_data === 'act:stream:stop');
    expect(pauseBtn).toBeDefined();
    expect(stopBtn).toBeDefined();
  });

  it('chunks buttons into rows of specified size', () => {
    const items = [1, 2, 3, 4, 5];
    const chunks = chunkButtons(items, 2);
    expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('builds confirmation keyboard with custom labels', () => {
    const kb = buildConfirmationKeyboard('yes_ref', 'no_ref', 'Bestätigen', 'Abbruch');
    expect(kb.inline_keyboard[0]).toEqual([
      { text: 'Bestätigen', callback_data: 'yes_ref' },
      { text: 'Abbruch', callback_data: 'no_ref' },
    ]);
  });
});

describe('Telegram Views', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml('<script>alert("x & y")</script>')).toBe(
      '&lt;script&gt;alert("x &amp; y")&lt;/script&gt;',
    );
  });

  it('renders Unicode progress bars correctly', () => {
    expect(formatProgressBar(50, 100, 10)).toBe('[█████░░░░░] 50%');
    expect(formatProgressBar(100, 100, 10)).toBe('[██████████] 100%');
    expect(formatProgressBar(0, 100, 10)).toBe('[░░░░░░░░░░] 0%');
    expect(formatProgressBar(5, 0, 10)).toBe('[░░░░░░░░░░] 0%');
  });

  it('formats expandable quote tags', () => {
    const block = formatExpandableQuote('Line 1\nLine 2');
    expect(block).toBe('<blockquote expandable>Line 1\nLine 2</blockquote>');
  });

  it('formats bitrates, durations and bytes', () => {
    expect(formatBitrate(2400)).toBe('2.4 Mbps');
    expect(formatBitrate(450)).toBe('450 kbps');
    expect(formatDuration(3665)).toBe('1:01:05');
    expect(formatDuration(125)).toBe('2:05');
    expect(formatBytes(1048576)).toBe('1.0 MB');
  });

  it('renders complete live status card with progress bars', () => {
    const snap: StatusSnapshot = {
      state: 'live',
      active_streamer_id: 'alpha',
      active_streamer_name: 'Streamer Alpha',
      active_playlist: null,
      active_scene_id: 'sci_fi',
      active_scene_name: 'Sci-Fi HUD',
      manual_screen: null,
      started_at: '2026-11-22T10:00:00Z',
      uptime_seconds: 3600,
      source: {
        online: true,
        resolving: false,
        connected: true,
        pid: 10,
        last_data_at: '2026-11-22T10:00:00Z',
        bitrate_kbps: 4500,
        reconnects: 0,
      },
      relay: {
        ingest_clients: 1,
        output_connected: true,
        buffer_seconds: 15,
        excess_seconds: 0,
        catching_up: false,
        pacing_multiplier: 1,
        buffered_bytes: 1024,
        dropped_bytes: 0,
        delay_seconds: 20,
        pacing_kbps: 4500,
        total_bytes: 1024,
      },
      sink: {
        running: true,
        pid: 20,
        bitrate_kbps: 4500,
        target_bitrate_kbps: 4500,
        fps: 60,
        dropped_frames: 0,
        speed: '1x',
        last_progress_at: '2026-11-22T10:00:00Z',
        restarts: 0,
        dts_errors: 0,
        silence_active: false,
        silence_since: null,
        last_error: null,
      },
      watchdog: {
        stall_timeout: 30,
        stall_count: 0,
        last_stall_at: null,
        last_error: null,
        reconnecting: false,
      },
      auto_refresh: {
        enabled: false,
        interval_minutes: 20,
        next_refresh_in_seconds: null,
        last_refresh_at: null,
        count: 0,
      },
      chat: {
        enabled: true,
        engine: 'canvas',
        messages: 100,
        last_message_at: null,
        api_configured: true,
        canvas_active: true,
        viewers: null,
      },
      media: null,
      version: '0.26.0',
    };

    const card = renderLiveStatusCard(snap, {
      dashboardUrl: 'https://relay.positronium.dev',
    });

    expect(card).toContain('LIVE');
    expect(card).toContain('Streamer Alpha');
    expect(card).toContain('Sci-Fi HUD');
    expect(card).toContain('4.5 Mbps');
    expect(card).toContain('Puffer:');
    expect(card).toContain('Web-Cockpit öffnen');
  });
});

describe('TelegramBot integration with modern API', () => {
  it('registers commands and sets chat menu button when dashboardUrl is configured', async () => {
    const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        const method = url.split('/').pop() ?? '';
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        calls.push({ method, body });
        if (method === 'getMe') {
          return new Response(JSON.stringify({ ok: true, result: { id: 1, username: 'relay_bot' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const { TelegramBot } = await import('../src/core/telegram/bot.js');
    const { TelegramAuthStore } = await import('../src/core/telegram/auth-store.js');
    const { EventBus } = await import('../src/core/events.js');

    const bot = new TelegramBot({
      token: '123:abc',
      allowedUserIds: [42],
      dashboardUrl: 'https://relay.positronium.dev',
      auth: new TelegramAuthStore(),
      logger,
      control: {
        status: () => ({ state: 'idle' } as any),
        streamers: () => [],
        playlists: () => [],
        start: async () => {},
        stop: async () => {},
        playlistNext: async () => {},
        playlistPrevious: async () => {},
        pause: async () => {},
        resume: async () => {},
        logs: () => [],
      },
      bus: new EventBus(),
    });

    // Emulate update handling or menu dispatch
    const updateHandler = (bot as any).handleUpdate.bind(bot);
    await updateHandler({
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 42, type: 'private' },
        from: { id: 42, first_name: 'Admin' },
        text: '/menu',
      },
    });

    // Check menu call
    const sendMsg = calls.find((c) => c.method === 'sendMessage');
    expect(sendMsg).toBeDefined();
    const replyMarkup = sendMsg?.body.reply_markup as any;
    const flatButtons = replyMarkup?.inline_keyboard?.flat() ?? [];
    const webAppBtn = flatButtons.find((b: any) => b.web_app?.url === 'https://relay.positronium.dev');
    expect(webAppBtn).toBeDefined();
    expect(webAppBtn?.text).toContain('Web Cockpit');
  });

  it('handles /preview by sending live snapshot photo', async () => {
    const calls: Array<{ method: string; body: any }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        const method = url.split('/').pop() ?? '';
        let body: any = {};
        if (init?.body instanceof FormData) {
          body = { isFormData: true, chat_id: init.body.get('chat_id'), caption: init.body.get('caption') };
        } else if (init?.body) {
          body = JSON.parse(String(init.body));
        }
        calls.push({ method, body });
        return new Response(JSON.stringify({ ok: true, result: { message_id: 88 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const { TelegramBot } = await import('../src/core/telegram/bot.js');
    const { TelegramAuthStore } = await import('../src/core/telegram/auth-store.js');
    const { EventBus } = await import('../src/core/events.js');

    const fakePng = Buffer.from('fake-png-preview-stream');
    let previewCalled = false;

    const bot = new TelegramBot({
      token: '123:abc',
      allowedUserIds: [42],
      auth: new TelegramAuthStore(),
      logger,
      control: {
        status: () => ({ state: 'live', active_streamer_name: 'GamerX', uptime_seconds: 500 } as any),
        streamers: () => [],
        playlists: () => [],
        start: async () => {},
        stop: async () => {},
        playlistNext: async () => {},
        playlistPrevious: async () => {},
        pause: async () => {},
        resume: async () => {},
        logs: () => [],
        previewFrame: async () => {
          previewCalled = true;
          return fakePng;
        },
      },
      bus: new EventBus(),
    });

    const updateHandler = (bot as any).handleUpdate.bind(bot);
    await updateHandler({
      update_id: 2,
      message: {
        message_id: 2,
        chat: { id: 42, type: 'private' },
        from: { id: 42, first_name: 'Admin' },
        text: '/preview',
      },
    });

    expect(previewCalled).toBe(true);
    const photoCall = calls.find((c) => c.method === 'sendPhoto');
    expect(photoCall).toBeDefined();
    expect(photoCall?.body.caption).toContain('GamerX');
    expect(photoCall?.body.caption).toContain('RELAY Live-Vorschau');
  });

  it('handles /queue command and allows controlling queue playback', async () => {
    const calls: Array<{ method: string; body: any }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        const method = url.split('/').pop() ?? '';
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        calls.push({ method, body });
        return new Response(JSON.stringify({ ok: true, result: { message_id: 101 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const { TelegramBot } = await import('../src/core/telegram/bot.js');
    const { TelegramAuthStore } = await import('../src/core/telegram/auth-store.js');
    const { EventBus } = await import('../src/core/events.js');

    let nextCalled = false;
    let seekSeconds: number | null = null;

    const bot = new TelegramBot({
      token: '123:abc',
      allowedUserIds: [42],
      auth: new TelegramAuthStore(),
      logger,
      control: {
        status: () => ({ state: 'live' } as any),
        streamers: () => [],
        playlists: () => [],
        start: async () => {},
        stop: async () => {},
        playlistNext: async () => {},
        playlistPrevious: async () => {},
        pause: async () => {},
        resume: async () => {},
        logs: () => [],
        queue: () => ({
          entries: [
            { id: 'q1', type: 'file', label: 'Intro Video', channel: 'file:intro.mp4', duration_seconds: 60, kind: 'file' },
            { id: 'q2', type: 'streamer', label: 'Streamer Y', channel: 'streamer_y', duration_seconds: null, kind: 'streamer' },
          ],
          playing: true,
          index: 0,
          loop: false,
        }),
        queueNext: async () => {
          nextCalled = true;
        },
        queueSeek: async (sec: number) => {
          seekSeconds = sec;
        },
      },
      bus: new EventBus(),
    });

    const updateHandler = (bot as any).handleUpdate.bind(bot);
    await updateHandler({
      update_id: 3,
      message: {
        message_id: 3,
        chat: { id: 42, type: 'private' },
        from: { id: 42, first_name: 'Admin' },
        text: '/queue',
      },
    });

    const sendMsg = calls.find((c) => c.method === 'sendMessage');
    expect(sendMsg?.body.text).toContain('Intro Video');
    expect(sendMsg?.body.text).toContain('Wiedergabe aktiv');

    // Emulate clicking "Nächster"
    await updateHandler({
      update_id: 4,
      callback_query: {
        id: 'cb1',
        from: { id: 42, first_name: 'Admin' },
        message: { message_id: 101, chat: { id: 42, type: 'private' } },
        data: 'queue:next',
      },
    });
    expect(nextCalled).toBe(true);

    // Emulate clicking "Seek +30"
    await updateHandler({
      update_id: 5,
      callback_query: {
        id: 'cb2',
        from: { id: 42, first_name: 'Admin' },
        message: { message_id: 101, chat: { id: 42, type: 'private' } },
        data: 'queue:seek:30',
      },
    });
    expect(seekSeconds).toBe(30);
  });
});
