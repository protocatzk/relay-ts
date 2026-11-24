import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus, type StatusSnapshot } from '../src/core/events.js';
import { TelegramAuthStore } from '../src/core/telegram/auth-store.js';
import { TelegramBot, type TelegramControl } from '../src/core/telegram/bot.js';
import { TelegramNotifyStore } from '../src/core/telegram/notify-store.js';

const logger = pino({ level: 'silent' });

function status(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    state: 'live',
    active_streamer_id: 'alpha',
    active_streamer_name: 'Alpha',
    active_playlist: null,
    active_scene_id: null,
    active_scene_name: null,
    manual_screen: null,
    started_at: new Date().toISOString(),
    uptime_seconds: 125,
    source: {
      online: true,
      resolving: false,
      connected: true,
      pid: 1,
      last_data_at: new Date().toISOString(),
      bitrate_kbps: 2400,
      reconnects: 0,
    },
    relay: {
      ingest_clients: 1,
      output_connected: true,
      buffer_seconds: 0,
      excess_seconds: 0,
      catching_up: false,
      pacing_multiplier: 1,
      buffered_bytes: 0,
      dropped_bytes: 0,
      delay_seconds: 0,
      pacing_kbps: null,
      total_bytes: 0,
    },
    sink: {
      running: true,
      pid: 2,
      bitrate_kbps: 2400,
      target_bitrate_kbps: 2400,
      fps: 30,
      dropped_frames: 0,
      speed: '1x',
      last_progress_at: new Date().toISOString(),
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
      messages: 0,
      last_message_at: null,
      api_configured: true,
      canvas_active: true,
      viewers: null,
    },
    media: null,
    version: '0.4.0',
    ...overrides,
  };
}

function setup() {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = url.split('/').pop() ?? '';
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      calls.push({ method, body });
      return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );

  const stopped: string[] = [];
  const control: TelegramControl = {
    status: () => status(),
    streamers: () => [
      {
        id: 'alpha',
        name: 'Alpha',
        tiktok: 'alpha',
        enabled: true,
        status: { online: true, active: true },
      },
    ],
    playlists: () => [
      {
        id: 'pl-alpha',
        name: 'Alpha Liste',
        channels: ['alpha'],
        active: false,
        index: null,
        auto_advance: true,
        wrap: false,
      },
    ],
    start: async (id) => {
      stopped.push(`start:${id}`);
      return {};
    },
    stop: async () => {
      stopped.push('stop');
      return {};
    },
    playlistNext: async () => {
      stopped.push('next');
      return {};
    },
    playlistPrevious: async () => {
      stopped.push('prev');
      return {};
    },
    pause: async () => {
      stopped.push('pause');
      return {};
    },
    resume: async () => {
      stopped.push('resume');
      return {};
    },
    logs: () => [
      { time: '2026-11-18T10:00:00.000Z', level: 'info', msg: 'Test log line' },
    ],
    settings: () => ({
      delay_seconds: 20,
      pause_enabled: true,
      pause_max_minutes: 15,
      pause_grace_seconds: 2,
      startup_enabled: true,
      startup_seconds: 10,
      auto_reconnect: true,
      auto_refresh_minutes: 20,
      earnings_period: 'today',
      earnings_view: 'standard',
      youtube_auto_transition: true,
      overlay_chat: true,
      overlay_clock: false,
      overlay_text: false,
    }),
    sessions: () => [
      {
        id: 'session-1',
        user: '@tester',
        provider: 'Telegram',
        last_seen_at: '2026-11-18T10:00:00.000Z',
      },
    ],
    revokeSession: (id) => {
      stopped.push(`revoke:${id}`);
      return true;
    },
    revokeAllSessions: () => {
      stopped.push('revoke-all');
      return 1;
    },
    media: () => [{ filename: 'intro.mp4', size: 5 * 1024 * 1024 }],
    earnings: () => ({
      period_label: 'Heute',
      currency: 'EUR',
      net: 12.34,
      coins: 1200,
      viewers: 42,
      gifts: 7,
      updated_at: '2026-11-18T10:00:00.000Z',
    }),
    youtubeStatus: () => ({ connected: true, channel_title: 'Testkanal' }),
    youtubeBroadcasts: async () => [
      {
        id: 'bc-1',
        title: 'Test Broadcast',
        status: 'ready',
        privacy: 'unlisted',
        scheduled_start: '2026-11-18T12:00:00.000Z',
      },
    ],
    youtubeTransition: async (id, state) => {
      stopped.push(`youtube:${state}:${id}`);
      return {};
    },
    youtubePublish: async (id) => {
      stopped.push(`youtube:publish:${id}`);
      return {};
    },
    youtubeUpdateTitle: async (id, title) => {
      stopped.push(`youtube:title:${id}:${title}`);
      return {};
    },
    titleTemplate: () => '{streamer} LIVE',
    showScreen: async (type) => {
      stopped.push(`screen:${type}`);
      return {};
    },
    hideScreen: async () => {
      stopped.push('screen:off');
      return {};
    },
    toggleOverlay: async (key) => {
      stopped.push(`overlay:${key}`);
      return {};
    },
    setEarningsPeriod: async (period) => {
      stopped.push(`earnings:${period}`);
      return {};
    },
    queryLogs: (filter) => [
      {
        time: '2026-11-18T10:00:00.000Z',
        level: filter.level ?? 'info',
        msg: `Test log line${filter.q ? ` ${filter.q}` : ''}`,
      },
    ],
    streamerCreate: async (input) => {
      stopped.push(`create:${String(input.id)}`);
      return {};
    },
    streamerUpdate: async (id, patch) => {
      stopped.push(`update:${id}:${JSON.stringify(patch)}`);
      return {};
    },
    streamerDelete: async (id) => {
      stopped.push(`delete:${id}`);
      return {};
    },
    playlistCreate: async (input) => {
      stopped.push(`pl-create:${String(input.id)}`);
      return {};
    },
    playlistUpdate: async (id, patch) => {
      stopped.push(`pl-update:${id}:${JSON.stringify(patch)}`);
      return {};
    },
    playlistDelete: async (id) => {
      stopped.push(`pl-delete:${id}`);
      return {};
    },
    playlistPlay: async (id) => {
      stopped.push(`pl-play:${id}`);
      return {};
    },
    settingsUpdate: async (patch) => {
      stopped.push(`settings:${JSON.stringify(patch)}`);
      return {};
    },
    mediaDelete: async (filename) => {
      stopped.push(`media-del:${filename}`);
      return {};
    },
    youtubeCreate: async (input) => {
      stopped.push(`yt-create:${input.title}`);
      return {};
    },
    youtubeAssign: async (id, streamerId) => {
      stopped.push(`yt-assign:${id}:${streamerId}`);
      return {};
    },
    scenes: () => [{ id: 'gaming', name: 'Gaming 16:9', active: false }],
    activateScene: async (id) => {
      stopped.push(`scene:${id}`);
      return {};
    },
  };
  const notifications = new TelegramNotifyStore(null, {
    enabled: true,
    live: true,
    reconnect: true,
    error: true,
  }, logger);
  const bot = new TelegramBot({
    token: '123:abc',
    allowedUserIds: [42],
    auth: new TelegramAuthStore(),
    logger,
    control,
    bus: new EventBus(),
    notify: { chatId: 42, store: notifications },
  });
  return { bot, calls, stopped, notifications };
}

function findCallback(
  calls: Array<{ method: string; body: Record<string, unknown> }>,
  snippet: string,
): string {
  for (const call of calls) {
    const markup = call.body.reply_markup as
      | { inline_keyboard?: { text?: string; callback_data?: string }[][] }
      | undefined;
    for (const row of markup?.inline_keyboard ?? []) {
      for (const button of row) {
        if (String(button.text ?? '').includes(snippet) && button.callback_data) {
          return button.callback_data;
        }
      }
    }
  }
  throw new Error(`callback not found: ${snippet}`);
}

function message(userId: number, text: string) {
  return {
    message_id: 1,
    chat: { id: userId, type: 'private' },
    from: { id: userId, username: 'tester' },
    text,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Telegram bot control', () => {
  it('ignores unauthorized users', async () => {
    const { bot, calls } = setup();
    await (bot as unknown as { handleMessage: (m: unknown) => Promise<void> }).handleMessage(
      message(99, '/status'),
    );
    expect(calls).toHaveLength(0);
  });

  it('reports status to allowed users', async () => {
    const { bot, calls } = setup();
    await (bot as unknown as { handleMessage: (m: unknown) => Promise<void> }).handleMessage(
      message(42, '/status'),
    );
    const send = calls.find((call) => call.method === 'sendMessage');
    expect(String(send?.body.text)).toContain('RELAY STATUS');
    expect(String(send?.body.text)).toContain('LIVE');
    expect(String(send?.body.text)).toContain('Alpha');
  });

  it('confirms destructive actions before stopping and lists log lines', async () => {
    const { bot, calls, stopped } = setup();
    const handler = bot as unknown as { handleMessage: (m: unknown) => Promise<void> };
    await handler.handleMessage(message(42, '/stop'));
    expect(stopped).not.toContain('stop');
    const confirm = calls.find(
      (call) => call.method === 'sendMessage' && String(call.body.text).includes('BESTÄTIGUNG'),
    );
    expect(confirm).toBeTruthy();

    const markup = confirm!.body.reply_markup as {
      inline_keyboard: { callback_data: string }[][];
    };
    const nonce = markup.inline_keyboard[0]![0]!.callback_data.split(':')[1]!;
    await (
      bot as unknown as { handleCallback: (q: unknown) => Promise<void> }
    ).handleCallback({
      id: 'cb',
      from: { id: 42, username: 'tester' },
      data: `confirm:${nonce}`,
      message: message(42, ''),
    });
    expect(stopped).toContain('stop');

    await handler.handleMessage(message(42, '/logs 5'));
    expect(
      calls.some((call) => call.method === 'sendMessage' && String(call.body.text).includes('Test log line')),
    ).toBe(true);
  });

  it('rejects confirmations from other users', async () => {
    const { bot, calls, stopped } = setup();
    await (
      bot as unknown as { handleMessage: (m: unknown) => Promise<void> }
    ).handleMessage(message(42, '/stop'));
    const confirm = calls.find(
      (call) => call.method === 'sendMessage' && String(call.body.text).includes('BESTÄTIGUNG'),
    );
    const markup = confirm!.body.reply_markup as {
      inline_keyboard: { callback_data: string }[][];
    };
    const nonce = markup.inline_keyboard[0]![0]!.callback_data.split(':')[1]!;
    await (
      bot as unknown as { handleCallback: (q: unknown) => Promise<void> }
    ).handleCallback({
      id: 'cb',
      from: { id: 99, username: 'intruder' },
      data: `confirm:${nonce}`,
      message: message(99, ''),
    });
    expect(stopped).not.toContain('stop');
  });

  it('shows settings, earnings and media for allowed users', async () => {
    const { bot, calls } = setup();
    const handler = bot as unknown as { handleMessage: (m: unknown) => Promise<void> };
    await handler.handleMessage(message(42, '/settings'));
    expect(
      calls.some((call) => call.method === 'sendMessage' && String(call.body.text).includes('DELAY: 20 s')),
    ).toBe(true);

    await handler.handleMessage(message(42, '/earnings 7d'));
    expect(
      calls.some(
        (call) =>
          call.method === 'sendMessage' &&
          String(call.body.text).includes('EINNAHMEN') &&
          String(call.body.text).includes('12,34'),
      ),
    ).toBe(true);

    await handler.handleMessage(message(42, '/media'));
    expect(
      calls.some(
        (call) => call.method === 'sendMessage' && String(call.body.text).includes('intro.mp4'),
      ),
    ).toBe(true);
  });

  it('requires a confirmation for YouTube actions', async () => {
    const { bot, calls, stopped } = setup();
    await (
      bot as unknown as { handleCallback: (q: unknown) => Promise<void> }
    ).handleCallback({
      id: 'cb',
      from: { id: 42, username: 'tester' },
      data: 'ytlive:bc-1',
      message: message(42, ''),
    });
    expect(stopped).not.toContain('youtube:live:bc-1');
    const confirm = calls.find(
      (call) => call.method === 'sendMessage' && String(call.body.text).includes('BESTÄTIGUNG'),
    );
    const markup = confirm!.body.reply_markup as {
      inline_keyboard: { callback_data: string }[][];
    };
    const nonce = markup.inline_keyboard[0]![0]!.callback_data.split(':')[1]!;
    await (
      bot as unknown as { handleCallback: (q: unknown) => Promise<void> }
    ).handleCallback({
      id: 'cb2',
      from: { id: 42, username: 'tester' },
      data: `confirm:${nonce}`,
      message: message(42, ''),
    });
    expect(stopped).toContain('youtube:live:bc-1');
  });

  it('revokes a session only after confirmation', async () => {
    const { bot, calls, stopped } = setup();
    await (
      bot as unknown as { handleCallback: (q: unknown) => Promise<void> }
    ).handleCallback({
      id: 'cb',
      from: { id: 42, username: 'tester' },
      data: 'revoke:session-1',
      message: message(42, ''),
    });
    const confirm = calls.find(
      (call) => call.method === 'sendMessage' && String(call.body.text).includes('BESTÄTIGUNG'),
    );
    const markup = confirm!.body.reply_markup as {
      inline_keyboard: { callback_data: string }[][];
    };
    const nonce = markup.inline_keyboard[0]![0]!.callback_data.split(':')[1]!;
    await (
      bot as unknown as { handleCallback: (q: unknown) => Promise<void> }
    ).handleCallback({
      id: 'cb2',
      from: { id: 42, username: 'tester' },
      data: `confirm:${nonce}`,
      message: message(42, ''),
    });
    expect(stopped).toContain('revoke:session-1');
  });

  it('starts a streamer from a callback button', async () => {
    const { bot, stopped } = setup();
    const handler = bot as unknown as {
      handleCallback: (q: unknown) => Promise<void>;
    };
    await handler.handleCallback({
      id: 'cb1',
      from: { id: 42, username: 'tester' },
      data: 'start:alpha',
      message: message(42, ''),
    });
    expect(stopped).toContain('start:alpha');
  });

  it('toggles notification categories and persists them', async () => {
    const { bot, notifications } = setup();
    const handler = bot as unknown as { handleMessage: (m: unknown) => Promise<void> };
    await handler.handleMessage(message(42, '/notify live off'));
    expect(notifications.get().live).toBe(false);
    await handler.handleMessage(message(42, '/notify live on'));
    expect(notifications.get().live).toBe(true);
  });

  it('renders an inline menu with all sections', async () => {
    const { bot, calls } = setup();
    await (
      bot as unknown as { handleCallback: (q: unknown) => Promise<void> }
    ).handleCallback({
      id: 'cb',
      from: { id: 42, username: 'tester' },
      data: 'nav:main',
      message: message(42, ''),
    });
    const edit = calls.find((call) => call.method === 'editMessageText');
    const markup = edit?.body.reply_markup as { inline_keyboard: unknown[][] };
    expect(markup.inline_keyboard.length).toBeGreaterThanOrEqual(7);
  });

  it('creates a streamer through the guided flow', async () => {
    const { bot, stopped } = setup();
    const handler = bot as unknown as {
      handleCallback: (q: unknown) => Promise<void>;
      handleMessage: (m: unknown) => Promise<void>;
    };
    await handler.handleCallback({
      id: 'cb',
      from: { id: 42, username: 'tester' },
      data: 'str:new',
      message: message(42, ''),
    });
    await handler.handleMessage(message(42, 'neuer-streamer'));
    await handler.handleMessage(message(42, 'Neuer Streamer'));
    await handler.handleMessage(message(42, '@neuerhandle'));
    expect(stopped).toContain('create:neuer-streamer');
  });

  it('toggles settings inline and edits values through a flow', async () => {
    const { bot, stopped } = setup();
    const handler = bot as unknown as {
      handleCallback: (q: unknown) => Promise<void>;
      handleMessage: (m: unknown) => Promise<void>;
    };
    await handler.handleCallback({
      id: 'cb',
      from: { id: 42, username: 'tester' },
      data: 'set:toggle:pause_enabled',
      message: message(42, ''),
    });
    expect(stopped).toContain('settings:{"pause":{"enabled":false}}');

    await handler.handleCallback({
      id: 'cb2',
      from: { id: 42, username: 'tester' },
      data: 'set:edit:pause',
      message: message(42, ''),
    });
    await handler.handleMessage(message(42, '25'));
    expect(stopped).toContain('settings:{"pause":{"max_minutes":25}}');
  });

  it('adds a channel to a playlist through the flow', async () => {
    const { bot, calls, stopped } = setup();
    const handler = bot as unknown as {
      handleCallback: (q: unknown) => Promise<void>;
      handleMessage: (m: unknown) => Promise<void>;
    };
    await handler.handleCallback({
      id: 'cb',
      from: { id: 42, username: 'tester' },
      data: 'nav:playlists',
      message: message(42, ''),
    });
    const view = findCallback(calls, 'Alpha Liste');
    await handler.handleCallback({
      id: 'cb2',
      from: { id: 42, username: 'tester' },
      data: view,
      message: message(42, ''),
    });
    const addChannel = findCallback(calls, 'Kanal');
    await handler.handleCallback({
      id: 'cb3',
      from: { id: 42, username: 'tester' },
      data: addChannel,
      message: message(42, ''),
    });
    await handler.handleMessage(message(42, 'neuerkanal'));
    expect(stopped.some((entry) => entry.startsWith('pl-update:pl-alpha:'))).toBe(true);
  });

  it('deletes media only after confirmation', async () => {
    const { bot, calls, stopped } = setup();
    const handler = bot as unknown as {
      handleCallback: (q: unknown) => Promise<void>;
    };
    await handler.handleCallback({
      id: 'cb',
      from: { id: 42, username: 'tester' },
      data: 'nav:media',
      message: message(42, ''),
    });
    const remove = findCallback(calls, 'intro.mp4');
    await handler.handleCallback({
      id: 'cb2',
      from: { id: 42, username: 'tester' },
      data: remove,
      message: message(42, ''),
    });
    expect(stopped).not.toContain('media-del:intro.mp4');
    const nonce = findCallback(calls, 'Ja, ausführen');
    await handler.handleCallback({
      id: 'cb3',
      from: { id: 42, username: 'tester' },
      data: nonce,
      message: message(42, ''),
    });
    expect(stopped).toContain('media-del:intro.mp4');
  });

  it('creates a YouTube broadcast through the wizard', async () => {
    const { bot, stopped } = setup();
    const handler = bot as unknown as {
      handleCallback: (q: unknown) => Promise<void>;
      handleMessage: (m: unknown) => Promise<void>;
    };
    await handler.handleCallback({
      id: 'cb',
      from: { id: 42, username: 'tester' },
      data: 'yt:new',
      message: message(42, ''),
    });
    await handler.handleMessage(message(42, 'Mein Stream'));
    await handler.handleMessage(message(42, '+30'));
    await handler.handleCallback({
      id: 'cb2',
      from: { id: 42, username: 'tester' },
      data: 'yt:privacy:public',
      message: message(42, ''),
    });
    await handler.handleCallback({
      id: 'cb3',
      from: { id: 42, username: 'tester' },
      data: 'yt:create:none',
      message: message(42, ''),
    });
    expect(stopped).toContain('yt-create:Mein Stream');
  });

  it('sends transition notifications to the configured chat', async () => {
    const { bot, calls, notifications } = setup();
    const handler = bot as unknown as {
      handleStatusEvent: (status: StatusSnapshot) => void;
    };
    handler.handleStatusEvent(status({ state: 'live' }));
    expect(calls).toHaveLength(0);

    handler.handleStatusEvent(status({ state: 'paused' }));
    expect(
      calls.some(
        (call) =>
          call.method === 'sendMessage' &&
          String(call.body.text).includes('PAUSE') &&
          call.body.chat_id === 42,
      ),
    ).toBe(true);

    notifications.update({ reconnect: false });
    calls.length = 0;
    handler.handleStatusEvent(status({ state: 'reconnecting' }));
    expect(calls).toHaveLength(0);
  });

  it('shows current YouTube title and requires confirmation before updating (/title, #39)', async () => {
    const { bot, calls, stopped } = setup();
    const handler = bot as unknown as {
      handleMessage: (m: unknown) => Promise<void>;
      handleCallback: (q: unknown) => Promise<void>;
    };

    await handler.handleMessage(message(42, '/title'));
    expect(
      calls.some(
        (call) =>
          call.method === 'sendMessage' &&
          String(call.body.text).includes('Test Broadcast') &&
          String(call.body.text).includes('{streamer} LIVE'),
      ),
    ).toBe(true);

    calls.length = 0;
    await handler.handleMessage(message(42, '/title Neuer Abendstream'));
    expect(stopped).not.toContain('youtube:title:bc-1:Neuer Abendstream');

    const confirm = findCallback(calls, 'Ja, ausführen');
    await handler.handleCallback({
      id: 'cb-title',
      from: { id: 42, username: 'tester' },
      data: confirm,
      message: message(42, ''),
    });
    expect(stopped).toContain('youtube:title:bc-1:Neuer Abendstream');
  });

  it('rejects overly long /title values without calling YouTube', async () => {
    const { bot, calls, stopped } = setup();
    const handler = bot as unknown as {
      handleMessage: (m: unknown) => Promise<void>;
    };
    await handler.handleMessage(message(42, `/title ${'A'.repeat(105)}`));
    expect(
      calls.some(
        (call) =>
          call.method === 'sendMessage' && String(call.body.text).includes('maximal 100 Zeichen'),
      ),
    ).toBe(true);
    expect(stopped.filter((s) => s.startsWith('youtube:title:'))).toHaveLength(0);
  });

  it('lists overlay scenes via /scene and activates one by callback or name', async () => {
    const { bot, calls, stopped } = setup();
    const handler = bot as unknown as {
      handleMessage: (m: unknown) => Promise<void>;
      handleCallback: (q: unknown) => Promise<void>;
    };

    await handler.handleMessage(message(42, '/scene'));
    const cbData = findCallback(calls, 'Gaming 16:9');
    expect(cbData).toMatch(/^scn:/);

    await handler.handleCallback({
      id: 'cb-scene',
      from: { id: 42, username: 'tester' },
      data: cbData,
      message: message(42, ''),
    });
    expect(stopped).toContain('scene:gaming');

    stopped.length = 0;
    await handler.handleMessage(message(42, '/scene Gaming 16:9'));
    expect(stopped).toContain('scene:gaming');
  });
});
