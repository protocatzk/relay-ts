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
    },
    earnings: null,
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
    playlists: () => [],
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

  it('stops the stream and lists log lines', async () => {
    const { bot, calls, stopped } = setup();
    const handler = bot as unknown as { handleMessage: (m: unknown) => Promise<void> };
    await handler.handleMessage(message(42, '/stop'));
    expect(stopped).toContain('stop');
    expect(
      calls.some((call) => call.method === 'sendMessage' && String(call.body.text).includes('gestoppt')),
    ).toBe(true);

    await handler.handleMessage(message(42, '/logs 5'));
    expect(
      calls.some((call) => call.method === 'sendMessage' && String(call.body.text).includes('Test log line')),
    ).toBe(true);
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
});
