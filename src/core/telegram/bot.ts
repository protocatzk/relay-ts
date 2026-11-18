import type { Logger } from 'pino';
import type { EventBus, StatusSnapshot } from '../events.js';
import type { LogEntry } from '../../utils/logger.js';
import { TelegramAuthStore } from './auth-store.js';
import {
  type NotifyCategory,
  type TelegramNotifyStore,
  type TelegramNotifySettings,
} from './notify-store.js';

interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: string;
}

interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: TelegramMessage;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export interface TelegramStreamerSummary {
  id: string;
  name: string;
  tiktok: string;
  enabled: boolean;
  status: { online: boolean | null; active: boolean };
}

export interface TelegramPlaylistSummary {
  id: string;
  name: string;
  channels: string[];
  active: boolean;
  index: number | null;
}

/** Everything the bot needs from the supervisor/log ring, without a hard import cycle. */
export interface TelegramControl {
  status(): StatusSnapshot;
  streamers(): TelegramStreamerSummary[];
  playlists(): TelegramPlaylistSummary[];
  start(streamerId: string): Promise<unknown>;
  stop(): Promise<unknown>;
  playlistNext(): Promise<unknown>;
  playlistPrevious(): Promise<unknown>;
  pause(): Promise<unknown>;
  resume(): Promise<unknown>;
  logs(limit: number): LogEntry[];
}

export interface TelegramBotOptions {
  token: string;
  allowedUserIds: number[];
  auth: TelegramAuthStore;
  logger: Logger;
  control?: TelegramControl;
  bus?: EventBus;
  notify?: {
    chatId: number | null;
    store: TelegramNotifyStore;
  };
}

const API_BASE = 'https://api.telegram.org/bot';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(1, max - 1))}…`;
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

function isNotifyCategory(value: string): value is NotifyCategory {
  return value === 'live' || value === 'reconnect' || value === 'error';
}

function errorName(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'timeout';
    return error.message.slice(0, 160);
  }
  return String(error).slice(0, 160);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Minimal Telegram long-polling bot for dashboard login approvals.
 *
 * It intentionally only handles private chats from numeric IDs in the
 * allow-list. The bot token never reaches the browser.
 */
export class TelegramBot {
  private readonly token: string;
  private readonly allowed: Set<number>;
  private readonly auth: TelegramAuthStore;
  private readonly logger: Logger;
  private username = '';
  private offset = 0;
  private stopped = true;
  private loopPromise: Promise<void> | null = null;
  private stopController = new AbortController();
  private options: TelegramBotOptions;
  private subscription?: { unsubscribe(): void };
  private lastStatus: StatusSnapshot | null = null;
  private lastNotifyAt = new Map<string, number>();

  constructor(options: TelegramBotOptions) {
    this.options = options;
    this.token = options.token;
    this.allowed = new Set(options.allowedUserIds);
    this.auth = options.auth;
    this.logger = options.logger;
  }

  get botUsername(): string {
    return this.username;
  }

  get connected(): boolean {
    return Boolean(this.username);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.stopController = new AbortController();
    this.subscription = this.options.bus?.observe().subscribe((event) => {
      if (event.type === 'status') this.handleStatusEvent(event.data);
    });
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.stopController.abort();
    this.subscription?.unsubscribe();
    this.subscription = undefined;
    const loop = this.loopPromise;
    this.loopPromise = null;
    if (loop) await loop.catch(() => undefined);
  }

  private async loop(): Promise<void> {
    let backoff = 2000;
    while (!this.stopped) {
      try {
        if (!this.username) await this.loadIdentity();
        const updates = await this.call<TelegramUpdate[]>(
          'getUpdates',
          {
            offset: this.offset,
            timeout: 25,
            allowed_updates: ['message', 'callback_query'],
          },
          35_000,
        );
        backoff = 2000;
        if (Array.isArray(updates)) {
          for (const update of updates) {
            this.offset = Math.max(this.offset, update.update_id + 1);
            await this.handleUpdate(update);
          }
        }
      } catch (error) {
        if (this.stopped) break;
        this.logger.warn({ err: errorName(error) }, 'Telegram-Bot: Abruf fehlgeschlagen');
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  }

  private async loadIdentity(): Promise<void> {
    const me = await this.call<TelegramUser>('getMe', {}, 15_000);
    if (!me?.username) throw new Error('Bot hat keinen Benutzernamen');
    this.username = me.username;
    this.logger.info(
      { bot: `@${this.username}`, allowedUsers: this.allowed.size },
      'Telegram-Bot verbunden',
    );
    try {
      await this.call(
        'setMyCommands',
        {
          commands: [
            { command: 'start', description: 'Login freigeben' },
            { command: 'status', description: 'Stream-Status anzeigen' },
            { command: 'menu', description: 'Steuerung öffnen' },
            { command: 'streamers', description: 'Streamer starten/wechseln' },
            { command: 'stop', description: 'Stream stoppen' },
            { command: 'next', description: 'Playlist: nächster Kanal' },
            { command: 'prev', description: 'Playlist: vorheriger Kanal' },
            { command: 'pause', description: 'Pausenscreen an/aus' },
            { command: 'logs', description: 'Letzte Logzeilen' },
            { command: 'notify', description: 'Benachrichtigungen' },
            { command: 'id', description: 'Telegram-ID anzeigen' },
          ],
        },
        10_000,
      );
    } catch {
      /* command setup is optional */
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.message) {
      await this.handleMessage(update.message);
      return;
    }
    if (update.callback_query) {
      await this.handleCallback(update.callback_query);
    }
  }

  private async handleMessage(message: TelegramMessage): Promise<void> {
    const user = message.from;
    if (!user || message.chat.type !== 'private' || !this.isAllowed(user)) {
      if (user) this.logger.warn({ userId: user.id }, 'Telegram: unbefugter Zugriff ignoriert');
      return;
    }
    const text = (message.text ?? '').trim();
    const [command, ...args] = text.split(/\s+/);
    const chatId = message.chat.id;

    switch (command) {
      case '/id':
        await this.sendMessage(chatId, `Deine Telegram-ID: <code>${user.id}</code>`);
        return;
      case '/status':
        await this.sendStatus(chatId);
        return;
      case '/menu':
        await this.sendMenu(chatId);
        return;
      case '/streamers':
        await this.sendStreamers(chatId);
        return;
      case '/logs':
        await this.sendLogs(chatId, Number(args[0]));
        return;
      case '/go':
        await this.startStreamer(chatId, args[0]);
        return;
      case '/stop':
        await this.dispatchAction(chatId, 'stop');
        return;
      case '/next':
        await this.dispatchAction(chatId, 'next');
        return;
      case '/prev':
        await this.dispatchAction(chatId, 'prev');
        return;
      case '/pause':
        await this.dispatchAction(chatId, 'pause');
        return;
      case '/notify':
        await this.handleNotifyCommand(chatId, args);
        return;
      case '/start':
        await this.handleStartCommand(chatId, user, args);
        return;
      default:
        await this.sendMessage(
          chatId,
          'Nutze <b>/menu</b> für die Steuerung oder öffne das Dashboard für die Telegram-Anmeldung.',
        );
    }
  }

  private async handleStartCommand(
    chatId: number,
    user: TelegramUser,
    args: string[],
  ): Promise<void> {
    const argument = args[0] ?? '';
    if (argument.startsWith('login_')) {
      await this.handleLoginRequest(chatId, user, argument.slice('login_'.length));
      return;
    }
    await this.sendMessage(
      chatId,
      [
        '🔐 <b>RELAY DASHBOARD</b>',
        '',
        'Mit <b>/menu</b> steuerst du den Stream direkt aus Telegram.',
        'Für die Anmeldung öffne die Website und wähle <b>Mit Telegram anmelden</b>.',
        '',
        `Deine ID: <code>${user.id}</code>`,
      ].join('\n'),
      this.menuKeyboard(),
    );
  }

  private async sendStatus(chatId: number): Promise<void> {
    const control = this.options.control;
    if (!control) {
      await this.sendMessage(chatId, '⚠️ Steuerung ist nicht verfügbar.');
      return;
    }
    const status = control.status();
    const labels: Record<string, string> = {
      idle: 'BEREIT',
      starting: 'STARTET',
      live: 'LIVE',
      reconnecting: 'VERBINDE',
      paused: 'PAUSE',
      stopping: 'STOPPT',
      error: 'FEHLER',
    };
    const lines = [
      '🛰 <b>RELAY STATUS</b>',
      '',
      `STATE: <b>${labels[status.state] ?? status.state}</b>`,
      status.active_streamer_name
        ? `STREAMER: ${escapeHtml(status.active_streamer_name)}`
        : 'STREAMER: –',
    ];
    if (status.active_playlist) {
      lines.push(
        `PLAYLIST: ${escapeHtml(status.active_playlist.name)} · ${status.active_playlist.index + 1}/${status.active_playlist.total}`,
      );
    }
    lines.push(
      `QUELLE: ${status.source.connected ? 'verbunden' : 'getrennt'}${
        status.source.bitrate_kbps ? ` · ${Math.round(status.source.bitrate_kbps)} kbit/s` : ''
      }`,
      `SINK: ${status.sink.running ? 'läuft' : 'aus'}${
        status.sink.fps ? ` · ${Math.round(status.sink.fps)} fps` : ''
      }`,
      `UPTIME: ${formatUptime(status.uptime_seconds)}`,
    );
    if (status.watchdog.last_error) {
      lines.push('', `⚠️ ${escapeHtml(status.watchdog.last_error)}`);
    }
    await this.sendMessage(chatId, lines.join('\n'), this.menuKeyboard());
  }

  private menuKeyboard(): Record<string, unknown> {
    return {
      inline_keyboard: [
        [
          { text: '📊 Status', callback_data: 'cmd:status' },
          { text: '🎛 Streamer', callback_data: 'cmd:streamers' },
        ],
        [
          { text: '⏹ Stop', callback_data: 'cmd:stop' },
          { text: '⏭ Weiter', callback_data: 'cmd:next' },
          { text: '⏮ Zurück', callback_data: 'cmd:prev' },
        ],
        [
          { text: '⏸ Pause', callback_data: 'cmd:pause' },
          { text: '📜 Logs', callback_data: 'cmd:logs' },
          { text: '🔔 Benachrichtigungen', callback_data: 'cmd:notify' },
        ],
      ],
    };
  }

  private async sendMenu(chatId: number): Promise<void> {
    await this.sendMessage(
      chatId,
      [
        '🎛 <b>RELAY STEUERUNG</b>',
        '',
        'Wähle eine Aktion oder nutze /streamers, /stop, /next, /prev, /logs.',
      ].join('\n'),
      this.menuKeyboard(),
    );
  }

  private async sendStreamers(chatId: number): Promise<void> {
    const control = this.options.control;
    if (!control) {
      await this.sendMessage(chatId, '⚠️ Steuerung ist nicht verfügbar.');
      return;
    }
    const streamers = control.streamers();
    if (streamers.length === 0) {
      await this.sendMessage(chatId, 'Keine Streamer konfiguriert.');
      return;
    }
    const rows = streamers.slice(0, 24).map((item) => {
      const online =
        item.status.online === true ? 'online' : item.status.online === false ? 'offline' : 'unbekannt';
      const label = `${item.status.active ? '▶️' : '▫️'} ${item.name} · ${online}`;
      return [{ text: truncate(label, 60), callback_data: `start:${item.id}` }];
    });
    await this.sendMessage(chatId, '▶️ <b>Streamer / Playlist starten</b>', {
      inline_keyboard: rows,
    });
  }

  private async sendLogs(chatId: number, requested = 10): Promise<void> {
    const control = this.options.control;
    if (!control) {
      await this.sendMessage(chatId, '⚠️ Steuerung ist nicht verfügbar.');
      return;
    }
    const limit = Number.isFinite(requested)
      ? Math.min(50, Math.max(1, Math.trunc(requested)))
      : 10;
    const text = control
      .logs(limit)
      .map((entry) => `${entry.time.slice(11, 19)} ${entry.level.toUpperCase()} ${entry.msg}`)
      .join('\n');
    await this.sendMessage(
      chatId,
      `<b>Letzte ${limit} Logzeilen</b>\n<pre>${escapeHtml(text.slice(-3400) || 'Keine Logs')}</pre>`,
    );
  }

  private async startStreamer(chatId: number, streamerId: string | undefined): Promise<void> {
    if (!streamerId) {
      await this.sendStreamers(chatId);
      return;
    }
    await this.runAction(
      chatId,
      (control) => control.start(streamerId),
      `Start angefordert: ${streamerId}`,
    );
  }

  private async dispatchAction(chatId: number, action: string): Promise<void> {
    switch (action) {
      case 'status':
        return this.sendStatus(chatId);
      case 'menu':
        return this.sendMenu(chatId);
      case 'streamers':
        return this.sendStreamers(chatId);
      case 'logs':
        return this.sendLogs(chatId, 10);
      case 'notify':
        return this.sendNotifyMenu(chatId);
      case 'stop':
        return this.runAction(chatId, (control) => control.stop(), 'Stream gestoppt.');
      case 'next':
        return this.runAction(chatId, (control) => control.playlistNext(), 'Nächster Kanal.');
      case 'prev':
        return this.runAction(chatId, (control) => control.playlistPrevious(), 'Vorheriger Kanal.');
      case 'pause':
        return this.runAction(
          chatId,
          (control) => (control.status().state === 'paused' ? control.resume() : control.pause()),
          'Pause umgeschaltet.',
        );
      default:
        await this.sendMessage(chatId, 'Unbekannte Aktion.');
    }
  }

  private async runAction(
    chatId: number,
    action: (control: TelegramControl) => Promise<unknown>,
    success: string,
  ): Promise<void> {
    const control = this.options.control;
    if (!control) {
      await this.sendMessage(chatId, '⚠️ Steuerung ist nicht verfügbar.');
      return;
    }
    try {
      await action(control);
      await this.sendMessage(chatId, `✅ ${escapeHtml(success)}`);
      await this.sendStatus(chatId);
    } catch (error) {
      await this.sendMessage(chatId, `⚠️ ${escapeHtml(errorName(error))}`);
    }
  }

  private async handleNotifyCommand(chatId: number, args: string[]): Promise<void> {
    const store = this.options.notify?.store;
    if (!store) {
      await this.sendMessage(chatId, '⚠️ Benachrichtigungen sind nicht konfiguriert.');
      return;
    }
    const verb = (args[0] ?? '').toLowerCase();
    const value = (args[1] ?? '').toLowerCase();
    if (verb === 'on' || verb === 'off') {
      store.update({ enabled: verb === 'on' });
    } else if (isNotifyCategory(verb) && (value === 'on' || value === 'off')) {
      store.update({ [verb]: value === 'on' } as Partial<TelegramNotifySettings>);
    }
    await this.sendNotifyMenu(chatId);
  }

  private async handleNotifyToggle(
    chatId: number,
    category: string,
    value: string | undefined,
  ): Promise<void> {
    const store = this.options.notify?.store;
    if (!store) return;
    const enabled = value === 'on';
    if (category === 'enabled') {
      store.update({ enabled });
    } else if (isNotifyCategory(category)) {
      store.update({ [category]: enabled } as Partial<TelegramNotifySettings>);
    }
    await this.sendNotifyMenu(chatId);
  }

  private async sendNotifyMenu(chatId: number): Promise<void> {
    const store = this.options.notify?.store;
    if (!store) {
      await this.sendMessage(chatId, '⚠️ Benachrichtigungen sind nicht konfiguriert.');
      return;
    }
    const settings = store.get();
    const line = (label: string, key: NotifyCategory): string =>
      `${settings[key] ? '✅' : '⛔'} ${label}`;
    await this.sendMessage(
      chatId,
      [
        '🔔 <b>BENACHRICHTIGUNGEN</b>',
        '',
        `Gesamt: <b>${settings.enabled ? 'AN' : 'AUS'}</b>`,
        line('LIVE / Offline', 'live'),
        line('Reconnect / Pause', 'reconnect'),
        line('Fehler', 'error'),
        '',
        'Tippe zum Umschalten oder nutze /notify live on|off.',
      ].join('\n'),
      {
        inline_keyboard: [
          [
            {
              text: `${settings.enabled ? '🔕 Alle aus' : '🔔 Alle an'}`,
              callback_data: `notify:enabled:${settings.enabled ? 'off' : 'on'}`,
            },
          ],
          [
            {
              text: line('LIVE', 'live'),
              callback_data: `notify:live:${settings.live ? 'off' : 'on'}`,
            },
            {
              text: line('Reconnect', 'reconnect'),
              callback_data: `notify:reconnect:${settings.reconnect ? 'off' : 'on'}`,
            },
            {
              text: line('Fehler', 'error'),
              callback_data: `notify:error:${settings.error ? 'off' : 'on'}`,
            },
          ],
        ],
      },
    );
  }

  private handleStatusEvent(status: StatusSnapshot): void {
    const previous = this.lastStatus;
    this.lastStatus = status;
    const settings = this.options.notify?.store.get();
    if (!previous || !settings?.enabled) return;

    if (status.state !== previous.state) {
      const name = status.active_streamer_name ?? status.active_streamer_id ?? 'Stream';
      if (status.state === 'live') {
        this.notify('live', `🟢 <b>LIVE</b>\n${escapeHtml(name)} ist jetzt live.`);
      } else if (status.state === 'reconnecting') {
        this.notify('reconnect', `🔄 <b>RECONNECT</b>\n${escapeHtml(name)} – Verbindung wird wiederhergestellt.`);
      } else if (status.state === 'paused' && previous.state !== 'paused') {
        this.notify('reconnect', `🟡 <b>PAUSE</b>\n${escapeHtml(name)} – Quelle offline, Pausenscreen läuft.`);
      } else if (status.state === 'error') {
        this.notify(
          'error',
          `🔴 <b>FEHLER</b>\n${escapeHtml(status.watchdog.last_error ?? 'Unbekannter Fehler')}`,
        );
      } else if (status.state === 'idle' && previous.state !== 'idle') {
        const category = previous.state === 'paused' ? 'reconnect' : 'live';
        this.notify(category, `⚫ <b>STREAM BEENDET</b>\n${escapeHtml(name)}`);
      }
    }

    const lastError = status.watchdog.last_error;
    if (lastError && lastError !== previous.watchdog.last_error) {
      this.notify('error', `⚠️ ${escapeHtml(lastError)}`);
    }
  }

  private notify(category: NotifyCategory, text: string): void {
    const settings = this.options.notify?.store.get();
    if (!settings?.enabled || !settings[category]) return;
    const now = Date.now();
    const last = this.lastNotifyAt.get(category) ?? 0;
    if (now - last < 10_000) return;
    this.lastNotifyAt.set(category, now);
    const chatId = this.options.notify?.chatId ?? [...this.allowed][0];
    if (!chatId) return;
    void this.sendMessage(chatId, text);
  }

  private async handleLoginRequest(chatId: number, user: TelegramUser, token: string): Promise<void> {
    const info = this.auth.get(token);
    if (!info || info.status !== 'pending') {
      await this.sendMessage(
        chatId,
        '⚠️ Diese Login-Anfrage ist abgelaufen oder ungültig.',
      );
      return;
    }
    const text = [
      '🔐 <b>LOGIN-ANFRAGE</b>',
      '',
      '<b>RELAY DASHBOARD</b>',
      `USER: ${escapeHtml(this.userLabel(user))}`,
      `ID: <code>${user.id}</code>`,
      `ANFRAGE: ${escapeHtml(info.clientInfo || 'Web-Browser')}`,
      'GÜLTIG: 10 MINUTEN',
      '',
      'Möchtest du diese Anmeldung freigeben?',
    ].join('\n');
    await this.sendMessage(chatId, text, {
      inline_keyboard: [
        [
          { text: '✅ ANMELDEN FREIGEBEN', callback_data: `auth_ok:${token}` },
          { text: '❌ ABLEHNEN', callback_data: `auth_no:${token}` },
        ],
      ],
    });
  }

  private async handleCallback(query: TelegramCallbackQuery): Promise<void> {
    const user = query.from;
    if (query.message?.chat.type !== 'private' || !this.isAllowed(user)) {
      await this.answerCallback(query.id, 'Nicht autorisiert');
      this.logger.warn({ userId: user.id }, 'Telegram: unbefugter Callback ignoriert');
      return;
    }
    const [action, first, second] = (query.data ?? '').split(':');
    const chatId = query.message.chat.id;
    if (action === 'cmd' && first) {
      await this.answerCallback(query.id, 'Ausgeführt');
      await this.dispatchAction(chatId, first);
      return;
    }
    if (action === 'start' && first) {
      await this.answerCallback(query.id, 'Starte…');
      await this.startStreamer(chatId, first);
      return;
    }
    if (action === 'notify' && first) {
      await this.answerCallback(query.id, 'Gespeichert');
      await this.handleNotifyToggle(chatId, first, second);
      return;
    }
    const token = first ?? '';
    if (!token || (action !== 'auth_ok' && action !== 'auth_no')) {
      await this.answerCallback(query.id, 'Ungültige Anfrage');
      return;
    }
    const info = this.auth.get(token);
    if (!info) {
      await this.answerCallback(query.id, 'Abgelaufen');
      await this.editMessage(query, '⚠️ Diese Login-Anfrage ist abgelaufen oder ungültig.');
      return;
    }

    if (action === 'auth_ok') {
      const approved = this.auth.approve(token, this.userLabel(user));
      if (!approved) {
        await this.answerCallback(query.id, 'Nicht mehr gültig');
        await this.editMessage(query, '⚠️ Diese Anfrage ist nicht mehr gültig.');
        return;
      }
      this.logger.info({ userId: user.id }, 'Telegram-Login freigegeben');
      await this.answerCallback(query.id, 'Freigegeben');
      await this.editMessage(
        query,
        '✅ <b>Anmeldung freigegeben.</b>\nDu kannst zum Browser zurückkehren.',
      );
      return;
    }

    this.auth.deny(token);
    this.logger.info({ userId: user.id }, 'Telegram-Login abgelehnt');
    await this.answerCallback(query.id, 'Abgelehnt');
    await this.editMessage(query, '❌ <b>Anmeldung abgelehnt.</b>');
  }

  private isAllowed(user: TelegramUser): boolean {
    return !user.is_bot && this.allowed.has(user.id);
  }

  private userLabel(user: TelegramUser): string {
    if (user.username) return `@${user.username}`;
    return [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Telegram';
  }

  private async sendMessage(
    chatId: number,
    text: string,
    replyMarkup?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.call(
        'sendMessage',
        {
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        },
        15_000,
      );
    } catch (error) {
      this.logger.warn({ err: errorName(error) }, 'Telegram-Nachricht fehlgeschlagen');
    }
  }

  private async answerCallback(id: string, text: string): Promise<void> {
    try {
      await this.call('answerCallbackQuery', { callback_query_id: id, text }, 10_000);
    } catch {
      /* callback answer is best-effort */
    }
  }

  private async editMessage(query: TelegramCallbackQuery, text: string): Promise<void> {
    const message = query.message;
    if (!message) return;
    try {
      await this.call(
        'editMessageText',
        {
          chat_id: message.chat.id,
          message_id: message.message_id,
          text,
          parse_mode: 'HTML',
        },
        10_000,
      );
    } catch (error) {
      this.logger.warn({ err: errorName(error) }, 'Telegram-Login-Nachricht nicht bearbeitet');
    }
  }

  private async call<T = unknown>(
    method: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onStop = () => controller.abort();
    this.stopController.signal.addEventListener('abort', onStop, { once: true });
    try {
      const response = await fetch(`${API_BASE}${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = (await response.json()) as TelegramResponse<T>;
      if (!response.ok || !data.ok) {
        throw new Error(data.description ?? `HTTP ${response.status}`);
      }
      return data.result as T;
    } finally {
      clearTimeout(timer);
      this.stopController.signal.removeEventListener('abort', onStop);
    }
  }
}
