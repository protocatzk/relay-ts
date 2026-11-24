import type { Logger } from 'pino';
import type { EventBus, QueueSnapshot, QueueViewEntry, StatusSnapshot } from '../events.js';
import type { LogEntry } from '../../utils/logger.js';
import { TelegramAuthStore } from './auth-store.js';
import {
  type NotifyCategory,
  type TelegramNotifyStore,
  type TelegramNotifySettings,
} from './notify-store.js';
import { ConfirmationStore, type PendingAction } from './confirmations.js';
import { ConversationStore } from './conversations.js';
import { RefStore } from './refs.js';
import { formatBitrate, formatDuration, renderLiveStatusCard } from './views.js';
import { buildActionableAlertKeyboard } from './keyboards.js';

export * from './types.js';
export { TelegramApiClient, TelegramApiError } from './api.js';
export * from './keyboards.js';
export * from './views.js';

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
  quality?: string;
  enabled: boolean;
  youtube_key_set?: boolean;
  status: { online: boolean | null; active: boolean };
}

export interface TelegramPlaylistSummary {
  id: string;
  name: string;
  channels: string[];
  active: boolean;
  index: number | null;
  auto_advance?: boolean;
  wrap?: boolean;
}

export interface TelegramSettingsSummary {
  delay_seconds: number;
  pause_enabled: boolean;
  pause_max_minutes: number;
  pause_grace_seconds: number;
  startup_enabled: boolean;
  startup_seconds: number;
  auto_reconnect: boolean;
  auto_refresh_minutes: number;
  earnings_period: string;
  earnings_view: string;
  youtube_auto_transition: boolean;
  overlay_chat: boolean;
  overlay_clock: boolean;
  overlay_text: boolean;
}

export interface TelegramSessionInfo {
  id: string;
  user: string;
  provider: string;
  last_seen_at: string;
}

export interface TelegramMediaInfo {
  filename: string;
  size: number;
}

export interface TelegramYouTubeBroadcast {
  id: string;
  title: string;
  status: string;
  privacy: string;
  scheduled_start: string | null;
}

export interface TelegramEarnings {
  period_label: string;
  currency: string;
  net: number | null;
  coins: number | null;
  viewers: number | null;
  gifts: number | null;
  updated_at: string | null;
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
  queryLogs?(filter: {
    limit?: number;
    level?: 'debug' | 'info' | 'warn' | 'error';
    q?: string;
  }): LogEntry[];
  mediaDelete?(filename: string): Promise<unknown>;
  settings?(): TelegramSettingsSummary;
  sessions?(): TelegramSessionInfo[];
  revokeSession?(id: string): boolean;
  revokeAllSessions?(): number;
  media?(): TelegramMediaInfo[];
  earnings?(): TelegramEarnings | null;
  youtubeStatus?(): { connected: boolean; channel_title: string };
  youtubeBroadcasts?(): Promise<TelegramYouTubeBroadcast[]>;
  youtubeTransition?(id: string, status: 'live' | 'complete'): Promise<unknown>;
  youtubePublish?(id: string): Promise<unknown>;
  youtubeUpdateTitle?(id: string, title: string): Promise<unknown>;
  titleTemplate?(): string;
  showScreen?(type: 'startup' | 'pause'): Promise<unknown>;
  hideScreen?(): Promise<unknown>;
  toggleOverlay?(key: 'chat' | 'clock' | 'text'): Promise<unknown>;
  setEarningsPeriod?(period: 'today' | '24h' | '7d' | '30d' | 'all'): Promise<unknown>;
  streamerCreate?(input: Record<string, unknown>): unknown | Promise<unknown>;
  streamerUpdate?(id: string, patch: Record<string, unknown>): unknown | Promise<unknown>;
  streamerDelete?(id: string): Promise<unknown>;
  playlistCreate?(input: Record<string, unknown>): unknown | Promise<unknown>;
  playlistUpdate?(id: string, patch: Record<string, unknown>): unknown | Promise<unknown>;
  playlistDelete?(id: string): Promise<unknown>;
  playlistPlay?(id: string): Promise<unknown>;
  settingsUpdate?(patch: Record<string, unknown>): Promise<unknown>;
  youtubeCreate?(input: {
    title: string;
    scheduled_start: string;
    privacy: 'public' | 'unlisted' | 'private';
    streamer_id?: string;
  }): Promise<unknown>;
  youtubeAssign?(id: string, streamerId: string): Promise<unknown>;
  scenes?(): { id: string; name: string; active: boolean }[];
  activateScene?(id: string): Promise<unknown>;
  addMarker?(label?: string): Promise<{ id: string; label: string; offset_seconds: number } | null> | { id: string; label: string; offset_seconds: number } | null;
  previewFrame?(): Promise<Buffer | null> | Buffer | null;
  queue?(): QueueSnapshot | null;
  queuePlay?(index?: number): Promise<unknown>;
  queueNext?(): Promise<unknown>;
  queueStop?(): Promise<unknown>;
  queueRemove?(id: string): Promise<unknown>;
  queueSeek?(seconds: number): Promise<unknown>;
  queuePlayNow?(channel: string): Promise<unknown>;
  queuePrevious?(): Promise<unknown>;
  playbackHold?(): Promise<unknown>;
}

export interface TelegramBotOptions {
  token: string;
  allowedUserIds: number[];
  /** Public dashboard base URL for links (preview, YouTube setup). */
  dashboardUrl?: string;
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

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '–';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}. ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatNumber(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) return '–';
  return value.toLocaleString('de-DE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toLocaleString('de-DE', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} MB`;
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
  private readonly confirmations = new ConfirmationStore();
  private readonly sessionRefs = new Map<string, string>();
  private sessionRefSeq = 0;
  private readonly refs = new RefStore();
  private readonly conversations = new ConversationStore();
  private readonly logFilters = new Map<number, { level?: string; q?: string; page: number }>();
  private readonly youtubeDrafts = new Map<
    number,
    { title: string; start: string; privacy: 'public' | 'unlisted' | 'private' }
  >();
  private pinnedMessage: { chatId: number; messageId: number } | null = null;

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
            { command: 'playlists', description: 'Playlists verwalten' },
            { command: 'stop', description: 'Stream stoppen' },
            { command: 'next', description: 'Playlist: nächster Kanal' },
            { command: 'prev', description: 'Playlist: vorheriger Kanal' },
            { command: 'pause', description: 'Pausenscreen an/aus' },
            { command: 'logs', description: 'Logs mit Filter' },
            { command: 'settings', description: 'Einstellungen anzeigen' },
            { command: 'earnings', description: 'Einnahmen und Zeitraum' },
            { command: 'sessions', description: 'Dashboard-Sessions' },
            { command: 'media', description: 'Lokale Videos' },
            { command: 'youtube', description: 'Streams und Broadcasts' },
            { command: 'screens', description: 'Start-/Pausenscreen' },
            { command: 'overlays', description: 'Overlays umschalten' },
            { command: 'scene', description: 'Overlay-Szene wechseln' },
            { command: 'preview', description: 'Live-Vorschau als Foto' },
            { command: 'queue', description: 'Regie-Queue steuern' },
            { command: 'pin', description: 'Live-Dashboard anpinnen' },
            { command: 'unpin', description: 'Live-Dashboard lösen' },
            { command: 'notify', description: 'Benachrichtigungen' },
            { command: 'id', description: 'Telegram-ID anzeigen' },
          ],
        },
        10_000,
      );

      if (this.options.dashboardUrl) {
        await this.call(
          'setChatMenuButton',
          {
            menu_button: {
              type: 'web_app',
              text: 'RELAY Cockpit',
              web_app: { url: this.options.dashboardUrl },
            },
          },
          10_000,
        );
      }
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

    if (text && !text.startsWith('/')) {
      const handled = await this.handleFlowInput(chatId, user.id, text);
      if (handled) return;
    }

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
      case '/playlists':
        await this.sendPlaylists(chatId);
        return;
      case '/logs':
        await this.sendLogsView(chatId);
        return;
      case '/go':
        await this.startStreamer(chatId, args[0]);
        return;
      case '/stop':
        await this.dispatchAction(chatId, 'stop', user.id);
        return;
      case '/next':
        await this.dispatchAction(chatId, 'next', user.id);
        return;
      case '/prev':
        await this.dispatchAction(chatId, 'prev', user.id);
        return;
      case '/pause':
        await this.dispatchAction(chatId, 'pause', user.id);
        return;
      case '/settings':
        await this.sendSettings(chatId);
        return;
      case '/earnings':
        await this.sendEarnings(chatId, args[0]);
        return;
      case '/title':
        await this.handleTitleCommand(chatId, user.id, text.slice('/title'.length).trim());
        return;
      case '/sessions':
        await this.sendSessions(chatId);
        return;
      case '/media':
        await this.sendMedia(chatId);
        return;
      case '/youtube':
        await this.sendYouTube(chatId);
        return;
      case '/screens':
        await this.sendScreens(chatId);
        return;
      case '/overlays':
        await this.sendOverlays(chatId);
        return;
      case '/scene':
        await this.handleSceneCommand(chatId, text.slice('/scene'.length).trim());
        return;
      case '/preview':
        await this.sendPreview(chatId);
        return;
      case '/queue':
        await this.sendQueue(chatId);
        return;
      case '/pin':
        await this.handlePinCommand(chatId);
        return;
      case '/unpin':
        await this.handleUnpinCommand(chatId);
        return;
      case '/marker':
        await this.handleMarkerCommand(chatId, text.slice('/marker'.length).trim());
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
          { text: '📺 Vorschau', callback_data: 'nav:preview' },
        ],
        [
          { text: '🎛 Streamer', callback_data: 'nav:streamers' },
          { text: '🎬 Playlists', callback_data: 'nav:playlists' },
        ],
        [
          { text: '🎬 Queue', callback_data: 'nav:queue' },
          { text: '🎨 Szenen', callback_data: 'nav:scene' },
        ],
        [
          { text: '🖥 Screens', callback_data: 'nav:screens' },
          { text: '🎚 Overlays', callback_data: 'nav:overlays' },
        ],
        [
          { text: '💰 Einnahmen', callback_data: 'nav:earnings' },
          { text: '📺 YouTube', callback_data: 'nav:youtube' },
        ],
        [
          { text: '⚙️ Einstellungen', callback_data: 'nav:settings' },
          { text: '🔐 Sessions', callback_data: 'nav:sessions' },
        ],
        [
          { text: '🎬 Medien', callback_data: 'nav:media' },
          { text: '📜 Logs', callback_data: 'nav:logs' },
        ],
        [{ text: '🔔 Benachrichtigungen', callback_data: 'cmd:notify' }],
        ...(this.options.dashboardUrl
          ? [[{ text: '🚀 Web Cockpit (Mini App)', web_app: { url: this.options.dashboardUrl } }]]
          : []),
      ],
    };
  }

  private backRow(label = '◀️ Menü', target = 'nav:main'): Record<string, unknown>[] {
    return [{ text: label, callback_data: target }];
  }

  private async showView(
    chatId: number,
    query: TelegramCallbackQuery | null,
    text: string,
    keyboard: Record<string, unknown>,
  ): Promise<void> {
    if (query) {
      await this.editMessage(query, text, keyboard);
    } else {
      await this.sendMessage(chatId, text, keyboard);
    }
  }

  private async sendMenu(chatId: number, query: TelegramCallbackQuery | null = null): Promise<void> {
    await this.showView(
      chatId,
      query,
      [
        '🎛 <b>RELAY STEUERUNG</b>',
        '',
        'Alles direkt aus Telegram. Destruktive Aktionen fragen nach.',
      ].join('\n'),
      this.menuKeyboard(),
    );
  }

  private async sendStreamers(
    chatId: number,
    query: TelegramCallbackQuery | null = null,
  ): Promise<void> {
    const control = this.options.control;
    if (!control) {
      await this.sendMessage(chatId, '⚠️ Steuerung ist nicht verfügbar.');
      return;
    }
    const streamers = control.streamers();
    const lines = ['🎛 <b>STREAMER</b>', ''];
    if (streamers.length === 0) {
      lines.push('Noch keine Streamer angelegt.');
    } else {
      const active = streamers.find((item) => item.status.active);
      lines.push(
        `Aktiv: <b>${active ? escapeHtml(active.name) : '–'}</b>`,
        `Gesamt: ${streamers.length} · aktiviert ${streamers.filter((item) => item.enabled).length}`,
      );
    }
    const rows: Record<string, unknown>[][] = [];
    for (const item of streamers.slice(0, 8)) {
      const ref = this.refs.get('streamer', item.id);
      const online = item.status.online === true ? '🟢' : item.status.online === false ? '⚫' : '⚪';
      rows.push([
        { text: `${online} ${truncate(item.name, 24)}`, callback_data: `str:edit:${ref}` },
        {
          text: item.status.active ? '⏹' : '▶️',
          callback_data: item.status.active ? 'cmd:stop' : `str:start:${ref}`,
        },
        {
          text: item.enabled ? '✅' : '⛔',
          callback_data: `str:toggle:${ref}`,
        },
      ]);
    }
    rows.push([{ text: '➕ Streamer anlegen', callback_data: 'str:new' }]);
    rows.push(this.backRow());
    await this.showView(chatId, query, lines.join('\n'), { inline_keyboard: rows });
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

  private async dispatchAction(chatId: number, action: string, userId = 0): Promise<void> {
    switch (action) {
      case 'status':
        return this.sendStatus(chatId);
      case 'menu':
        return this.sendMenu(chatId);
      case 'streamers':
        return this.sendStreamers(chatId);
      case 'logs':
        return this.sendLogsView(chatId);
      case 'notify':
        return this.sendNotifyMenu(chatId);
      case 'settings':
        return this.sendSettings(chatId);
      case 'earnings':
        return this.sendEarnings(chatId);
      case 'sessions':
        return this.sendSessions(chatId);
      case 'media':
        return this.sendMedia(chatId);
      case 'youtube':
        return this.sendYouTube(chatId);
      case 'screens':
        return this.sendScreens(chatId);
      case 'overlays':
        return this.sendOverlays(chatId);
      case 'stop':
        return this.confirmAction(chatId, userId, 'Stream wirklich stoppen?', { type: 'stop' });
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

  private resolveStreamer(ref: string | undefined): TelegramStreamerSummary | null {
    if (!ref) return null;
    const id = this.refs.resolve(ref, 'streamer');
    if (!id) return null;
    return this.options.control?.streamers().find((item) => item.id === id) ?? null;
  }

  private async sendStreamerDetail(
    chatId: number,
    ref: string,
    query: TelegramCallbackQuery | null = null,
  ): Promise<void> {
    const streamer = this.resolveStreamer(ref);
    if (!streamer) {
      await this.showView(chatId, query, '⚠️ Streamer nicht gefunden.', {
        inline_keyboard: [this.backRow('◀️ Streamer', 'nav:streamers')],
      });
      return;
    }
    const streamRef = this.refs.get('streamer', streamer.id);
    const online =
      streamer.status.online === true ? 'online' : streamer.status.online === false ? 'offline' : 'unbekannt';
    const lines = [
      `🎛 <b>${escapeHtml(streamer.name)}</b>`,
      '',
      `ID: <code>${escapeHtml(streamer.id)}</code>`,
      `HANDLE: ${escapeHtml(streamer.tiktok)}`,
      `QUALITÄT: ${escapeHtml(streamer.quality ?? 'best')}`,
      `STATUS: ${online}${streamer.status.active ? ' · aktiv' : ''}`,
      `AKTIVIERT: ${streamer.enabled ? 'ja' : 'nein'}`,
      `KEY: ${streamer.youtube_key_set ? 'gesetzt' : 'fehlt'}`,
    ];
    await this.showView(chatId, query, lines.join('\n'), {
      inline_keyboard: [
        [
          { text: '✏️ Name', callback_data: `str:rename:${streamRef}` },
          { text: '✏️ Handle', callback_data: `str:rehandle:${streamRef}` },
        ],
        [
          {
            text: `🎚 ${streamer.quality ?? 'best'}`,
            callback_data: `str:q:${streamRef}`,
          },
          {
            text: streamer.enabled ? '⛔ Deaktivieren' : '✅ Aktivieren',
            callback_data: `str:toggle:${streamRef}`,
          },
        ],
        [
          {
            text: streamer.status.active ? '⏹ Stoppen' : '▶️ Starten',
            callback_data: streamer.status.active ? 'cmd:stop' : `str:start:${streamRef}`,
          },
          { text: '🗑 Löschen', callback_data: `str:del:${streamRef}` },
        ],
        this.backRow('◀️ Streamer', 'nav:streamers'),
      ],
    });
  }

  private async sendPlaylists(
    chatId: number,
    query: TelegramCallbackQuery | null = null,
  ): Promise<void> {
    const playlists = this.options.control?.playlists() ?? [];
    const lines = ['🎬 <b>PLAYLISTS</b>', ''];
    if (playlists.length === 0) lines.push('Noch keine Playlists angelegt.');
    const rows: Record<string, unknown>[][] = [];
    for (const playlist of playlists.slice(0, 8)) {
      const ref = this.refs.get('playlist', playlist.id);
      rows.push([
        {
          text: `${playlist.active ? '▶️' : '▫️'} ${truncate(playlist.name, 24)} (${playlist.channels.length})`,
          callback_data: `pl:view:${ref}`,
        },
        { text: '▶️', callback_data: `pl:play:${ref}` },
        { text: '🗑', callback_data: `pl:del:${ref}` },
      ]);
    }
    rows.push([{ text: '➕ Playlist anlegen', callback_data: 'pl:new' }]);
    rows.push(this.backRow());
    await this.showView(chatId, query, lines.join('\n'), { inline_keyboard: rows });
  }

  private async sendPlaylistDetail(
    chatId: number,
    ref: string,
    query: TelegramCallbackQuery | null = null,
  ): Promise<void> {
    const id = this.refs.resolve(ref, 'playlist');
    const playlist = this.options.control?.playlists().find((item) => item.id === id);
    if (!playlist) {
      await this.showView(chatId, query, '⚠️ Playlist nicht gefunden.', {
        inline_keyboard: [this.backRow('◀️ Playlists', 'nav:playlists')],
      });
      return;
    }
    const playlistRef = this.refs.get('playlist', playlist.id);
    const lines = [
      `🎬 <b>${escapeHtml(playlist.name)}</b>`,
      '',
      `ID: <code>${escapeHtml(playlist.id)}</code>`,
      `KANÄLE: ${playlist.channels.length}`,
      `AUTO-ADVANCE: ${playlist.auto_advance ? 'an' : 'aus'} · WRAP: ${playlist.wrap ? 'an' : 'aus'}`,
      playlist.active && playlist.index !== null
        ? `AKTIV: Kanal ${playlist.index + 1}/${playlist.channels.length}`
        : 'AKTIV: nein',
    ];
    if (playlist.channels.length > 0) {
      lines.push('', 'Kanäle:');
      playlist.channels.slice(0, 12).forEach((channel, index) => {
        lines.push(`${index + 1}. ${escapeHtml(channel)}`);
      });
    }
    const rows: Record<string, unknown>[][] = [
      [
        { text: '▶️ Starten', callback_data: `pl:play:${playlistRef}` },
        { text: '🗑 Löschen', callback_data: `pl:del:${playlistRef}` },
      ],
      [
        { text: '➕ Kanal', callback_data: `pl:chan:${playlistRef}` },
        { text: '➕ Video', callback_data: `pl:file:${playlistRef}` },
      ],
      [
        {
          text: `Auto ${playlist.auto_advance ? '✅' : '⛔'}`,
          callback_data: `pl:toggle:auto:${playlistRef}`,
        },
        {
          text: `Wrap ${playlist.wrap ? '✅' : '⛔'}`,
          callback_data: `pl:toggle:wrap:${playlistRef}`,
        },
      ],
    ];
    for (const [index, channel] of playlist.channels.slice(0, 6).entries()) {
      rows.push([
        {
          text: `❌ ${truncate(channel, 28)}`,
          callback_data: `pl:rmchan:${playlistRef}:${index}`,
        },
      ]);
    }
    rows.push(this.backRow('◀️ Playlists', 'nav:playlists'));
    await this.showView(chatId, query, lines.join('\n'), { inline_keyboard: rows });
  }

  private async sendPreview(
    chatId: number,
    query: TelegramCallbackQuery | null = null,
  ): Promise<void> {
    await this.sendChatAction(chatId, 'upload_photo');
    const control = this.options.control;
    let frame: Buffer | null = null;
    try {
      frame = (await control?.previewFrame?.()) ?? null;
    } catch (err) {
      this.logger.warn({ err: errorName(err) }, 'Telegram previewFrame fehlgeschlagen');
    }

    const base = this.options.dashboardUrl;
    const keyboard: Record<string, unknown> = {
      inline_keyboard: [
        [
          { text: '🔄 Neu laden', callback_data: 'act:preview:refresh' },
          ...(base ? [{ text: '🚀 Cockpit öffnen', web_app: { url: base } }] : []),
        ],
        this.backRow(),
      ].filter((row) => row.length > 0),
    };

    const status = control?.status();
    const streamer = status?.active_streamer_name ?? status?.active_streamer_id ?? 'Keiner';
    const bitrate = formatBitrate(status?.sink?.bitrate_kbps ?? status?.source?.bitrate_kbps);
    const caption = [
      `📸 <b>RELAY Live-Vorschau</b>`,
      `👤 <b>${escapeHtml(streamer)}</b> · ${bitrate} · ⏱ <code>${formatDuration(status?.uptime_seconds ?? 0)}</code>`,
    ].join('\n');

    if (frame && Buffer.isBuffer(frame)) {
      if (query) {
        await this.answerCallback(query.id, 'Vorschau geladen');
      }
      await this.sendPhoto(chatId, frame, caption, keyboard);
      return;
    }

    await this.showView(
      chatId,
      query,
      [
        caption,
        '',
        '<i>Kein Live-Frame verfügbar (Stream idle oder Quelle getrennt).</i>',
      ].join('\n'),
      keyboard,
    );
  }

  private async sendQueue(
    chatId: number,
    query: TelegramCallbackQuery | null = null,
  ): Promise<void> {
    const control = this.options.control;
    const queue = control?.queue?.();
    if (!queue || queue.entries.length === 0) {
      await this.showView(
        chatId,
        query,
        '🎬 <b>REGIE-QUEUE</b>\n\nDie Queue ist aktuell leer.',
        {
          inline_keyboard: [
            ...(this.options.dashboardUrl
              ? [[{ text: '🚀 Im Web Cockpit füllen', web_app: { url: `${this.options.dashboardUrl}/#/queue` } }]]
              : []),
            this.backRow(),
          ],
        },
      );
      return;
    }

    const lines: string[] = [
      `🎬 <b>REGIE-QUEUE</b> · ${queue.entries.length} Einträge`,
      queue.playing ? '▶️ <i>Wiedergabe aktiv</i>' : '⏸ <i>Pausiert</i>',
      '',
    ];

    const keyboardRows: Record<string, unknown>[][] = [];

    queue.entries.slice(0, 8).forEach((entry: QueueViewEntry, idx: number) => {
      const isCurrent = queue.index === idx;
      const marker = isCurrent ? '▶️ ' : `${idx + 1}. `;
      const dur = entry.duration_seconds ? ` (${formatDuration(entry.duration_seconds)})` : '';
      lines.push(`${marker}<b>${escapeHtml(entry.label || entry.channel)}</b>${dur}`);

      const ref = this.refs.get('queue', entry.id);
      const actionRow: Record<string, unknown>[] = [
        { text: isCurrent ? '⏹ Stop' : '▶️ Play', callback_data: `queue:${isCurrent ? 'stop' : 'play'}:${idx}` },
        { text: '🗑 Löschen', callback_data: `queue:rm:${ref}` },
      ];
      keyboardRows.push(actionRow);
    });

    if (queue.playing) {
      keyboardRows.unshift([
        { text: '⏮ -30s', callback_data: 'queue:seek:-30' },
        { text: '⏭ +30s', callback_data: 'queue:seek:30' },
        { text: '⏮ Zurück', callback_data: 'queue:prev' },
        { text: '⏭ Nächster', callback_data: 'queue:next' },
      ]);
    }
    keyboardRows.push([
      { text: queue.playing ? '⏸ Hold' : '▶️ Play', callback_data: 'queue:hold' },
    ]);

    keyboardRows.push(this.backRow());

    await this.showView(chatId, query, lines.join('\n'), {
      inline_keyboard: keyboardRows,
    });
  }

  private async sendLogsView(
    chatId: number,
    query: TelegramCallbackQuery | null = null,
    patch: { level?: string; q?: string; page?: number } = {},
  ): Promise<void> {
    const control = this.options.control;
    if (!control) {
      await this.sendMessage(chatId, '⚠️ Logs sind nicht verfügbar.');
      return;
    }
    const current = this.logFilters.get(chatId) ?? { page: 0 };
    const next = {
      level: patch.level !== undefined ? patch.level : current.level,
      q: patch.q !== undefined ? patch.q : current.q,
      page: patch.page !== undefined ? Math.max(0, patch.page) : current.page,
    };
    this.logFilters.set(chatId, next);
    const pageSize = 12;
    const limit = pageSize * (next.page + 1);
    const filter = {
      limit,
      level:
        next.level && next.level !== 'all'
          ? (next.level as 'debug' | 'info' | 'warn' | 'error')
          : undefined,
      q: next.q,
    };
    const entries = control.queryLogs?.(filter) ?? control.logs(limit);
    const visible = entries.slice(-pageSize);
    const body = visible
      .map((entry) => `${entry.time.slice(11, 19)} ${entry.level.toUpperCase()} ${entry.msg}`)
      .join('\n');
    const lines = [
      '📜 <b>LOGS</b>',
      `FILTER: ${next.level ?? 'alle'}${next.q ? ` · "${escapeHtml(next.q)}"` : ''} · SEITE ${next.page + 1}`,
      '',
      `<pre>${escapeHtml(body.slice(-3400) || 'Keine Einträge')}</pre>`,
    ];
    const levelButton = (value: string, label: string): Record<string, unknown> => ({
      text: `${(next.level ?? 'all') === value ? '• ' : ''}${label}`,
      callback_data: `log:lvl:${value}:0`,
    });
    await this.showView(chatId, query, lines.join('\n'), {
      inline_keyboard: [
        [
          levelButton('all', 'Alle'),
          levelButton('info', 'Info'),
          levelButton('warn', 'Warn'),
          levelButton('error', 'Error'),
        ],
        [
          { text: '🔎 Suche', callback_data: 'log:search' },
          { text: '◀️ Neuer', callback_data: `log:page:${Math.max(0, next.page - 1)}` },
          { text: 'Älter ▶️', callback_data: `log:page:${next.page + 1}` },
        ],
        this.backRow(),
      ],
    });
  }

  private async handleFlowInput(chatId: number, userId: number, input: string): Promise<boolean> {
    const conversation = this.conversations.get(chatId, userId);
    if (!conversation) return false;
    const control = this.options.control;
    const value = input.trim();
    if (value.toLowerCase() === 'abbrechen') {
      this.conversations.clear(chatId, userId);
      await this.sendMessage(chatId, '❌ Abgebrochen.');
      return true;
    }
    const data = conversation.data;
    const done = async (message: string): Promise<void> => {
      this.conversations.clear(chatId, userId);
      await this.sendMessage(chatId, message);
    };
    try {
      switch (conversation.flow) {
        case 'streamer-new-id':
          if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)) {
            await this.sendMessage(chatId, '⚠️ ID: nur a-z, 0-9, _ und - (max. 64).');
            return true;
          }
          this.conversations.start(chatId, userId, 'streamer-new-name', { id: value });
          await this.sendMessage(chatId, 'Name des Streamers?');
          return true;
        case 'streamer-new-name':
          this.conversations.start(chatId, userId, 'streamer-new-handle', {
            ...data,
            name: value,
          });
          await this.sendMessage(chatId, 'TikTok-Handle? (@ optional)');
          return true;
        case 'streamer-new-handle':
          await control?.streamerCreate?.({
            id: data.id,
            name: data.name,
            tiktok: value.replace(/^@+/, ''),
            quality: 'best',
            enabled: true,
          });
          await done('✅ Streamer angelegt.');
          await this.sendStreamers(chatId);
          return true;
        case 'streamer-edit-name':
          await control?.streamerUpdate?.(data.id!, { name: value });
          await done('✅ Name gespeichert.');
          await this.sendStreamerDetail(chatId, this.refs.get('streamer', data.id!));
          return true;
        case 'streamer-edit-handle':
          await control?.streamerUpdate?.(data.id!, { tiktok: value.replace(/^@+/, '') });
          await done('✅ Handle gespeichert.');
          await this.sendStreamerDetail(chatId, this.refs.get('streamer', data.id!));
          return true;
        case 'playlist-new-id':
          if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)) {
            await this.sendMessage(chatId, '⚠️ ID: nur a-z, 0-9, _ und - (max. 64).');
            return true;
          }
          this.conversations.start(chatId, userId, 'playlist-new-name', { id: value });
          await this.sendMessage(chatId, 'Name der Playlist?');
          return true;
        case 'playlist-new-name':
          await control?.playlistCreate?.({
            id: data.id,
            name: value,
            channels: [],
            auto_advance: true,
            wrap: false,
          });
          await done('✅ Playlist angelegt.');
          await this.sendPlaylists(chatId);
          return true;
        case 'playlist-add-channel':
          await control?.playlistUpdate?.(data.id!, {
            channels: [...(data.channels ?? '').split('|').filter(Boolean), value],
          });
          await done('✅ Kanal hinzugefügt.');
          await this.sendPlaylistDetail(chatId, this.refs.get('playlist', data.id!));
          return true;
        case 'playlist-add-file':
          if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) {
            await this.sendMessage(chatId, '⚠️ Ungültiger Dateiname.');
            return true;
          }
          await control?.playlistUpdate?.(data.id!, {
            channels: [...(data.channels ?? '').split('|').filter(Boolean), `file:${value}`],
          });
          await done('✅ Video hinzugefügt.');
          await this.sendPlaylistDetail(chatId, this.refs.get('playlist', data.id!));
          return true;
        case 'settings-delay':
        case 'settings-pause':
        case 'settings-startup':
        case 'settings-refresh': {
          const number = Number(value);
          if (!Number.isFinite(number) || number < 0) {
            await this.sendMessage(chatId, '⚠️ Bitte eine Zahl ≥ 0 senden.');
            return true;
          }
          const patch =
            conversation.flow === 'settings-delay'
              ? { delay_buffer: { size: Math.round(number) } }
              : conversation.flow === 'settings-pause'
                ? { pause: { max_minutes: Math.round(number) } }
                : conversation.flow === 'settings-startup'
                  ? { startup: { duration_seconds: Math.round(number) } }
                  : { auto_refresh: { interval: Math.round(number) } };
          await control?.settingsUpdate?.(patch);
          await done('✅ Einstellung gespeichert.');
          await this.sendSettings(chatId);
          return true;
        }
        case 'log-search':
          await done('✅ Filter gesetzt.');
          await this.sendLogsView(chatId, null, { q: value, page: 0 });
          return true;
        case 'youtube-title':
          this.conversations.start(chatId, userId, 'youtube-start', { title: value });
          await this.sendMessage(
            chatId,
            'Startzeit? ISO (2026-11-18T20:00) oder Minuten ab jetzt (+30).',
          );
          return true;
        case 'youtube-start': {
          const date = value.startsWith('+')
            ? new Date(Date.now() + Number(value.slice(1)) * 60_000)
            : new Date(value);
          if (Number.isNaN(date.getTime())) {
            await this.sendMessage(chatId, '⚠️ Startzeit ist ungültig.');
            return true;
          }
          this.youtubeDrafts.set(chatId, {
            title: data.title!,
            start: date.toISOString(),
            privacy: 'unlisted',
          });
          this.conversations.clear(chatId, userId);
          await this.sendYouTubePrivacy(chatId);
          return true;
        }
        default:
          return false;
      }
    } catch (error) {
      await done(`⚠️ ${escapeHtml(errorName(error))}`);
      return true;
    }
  }

  private async sendYouTubePrivacy(chatId: number): Promise<void> {
    await this.sendMessage(
      chatId,
      '🔒 <b>Sichtbarkeit</b>\n\nStandard ist „nicht gelistet“; du kannst später mit einem Klick veröffentlichen.',
      {
        inline_keyboard: [
          [
            { text: 'Nicht gelistet', callback_data: 'yt:privacy:unlisted' },
            { text: 'Privat', callback_data: 'yt:privacy:private' },
            { text: 'Öffentlich', callback_data: 'yt:privacy:public' },
          ],
        ],
      },
    );
  }

  private async sendYouTubeStreamerChoice(chatId: number): Promise<void> {
    const streamers = this.options.control?.streamers() ?? [];
    const rows = streamers.slice(0, 8).map((streamer) => {
      const ref = this.refs.get('streamer', streamer.id);
      return [{ text: `🔗 ${truncate(streamer.name, 30)}`, callback_data: `yt:create:${ref}` }];
    });
    rows.push([{ text: 'Neuen YouTube-Ingest anlegen', callback_data: 'yt:create:none' }]);
    await this.sendMessage(chatId, '🔗 <b>Ingest wählen</b>', { inline_keyboard: rows });
  }

  private async sendSettings(
    chatId: number,
    query: TelegramCallbackQuery | null = null,
  ): Promise<void> {
    const settings = this.options.control?.settings?.();
    if (!settings) {
      await this.sendMessage(chatId, '⚠️ Einstellungen sind nicht verfügbar.');
      return;
    }
    const yes = (value: boolean): string => (value ? 'an' : 'aus');
    await this.showView(
      chatId,
      query,
      [
        '⚙️ <b>EINSTELLUNGEN</b>',
        '',
        `DELAY: ${settings.delay_seconds} s`,
        `PAUSE: ${yes(settings.pause_enabled)} · max ${settings.pause_max_minutes} min · Grace ${settings.pause_grace_seconds} s`,
        `STARTUP: ${yes(settings.startup_enabled)} · ${settings.startup_seconds} s`,
        `AUTO-RECONNECT: ${yes(settings.auto_reconnect)}`,
        `AUTO-REFRESH: ${settings.auto_refresh_minutes} min`,
        `EARNINGS: ${escapeHtml(settings.earnings_period)} · ${escapeHtml(settings.earnings_view)}`,
        `YOUTUBE-AUTO: ${yes(settings.youtube_auto_transition)}`,
        '',
        `Overlays: Chat ${yes(settings.overlay_chat)} · Uhr ${yes(settings.overlay_clock)} · Text ${yes(settings.overlay_text)}`,
      ].join('\n'),
      {
        inline_keyboard: [
          [
            { text: `Delay ${settings.delay_seconds}s`, callback_data: 'set:edit:delay' },
            { text: `Pause ${settings.pause_max_minutes}m`, callback_data: 'set:edit:pause' },
            { text: `Start ${settings.startup_seconds}s`, callback_data: 'set:edit:startup' },
          ],
          [
            { text: 'Auto-Reconnect', callback_data: 'set:toggle:auto_reconnect' },
            { text: 'Pause-Screen', callback_data: 'set:toggle:pause_enabled' },
            { text: 'Start-Screen', callback_data: 'set:toggle:startup_enabled' },
          ],
          [
            { text: 'YouTube-Auto', callback_data: 'set:toggle:youtube_auto' },
            { text: 'Refresh', callback_data: 'set:edit:refresh' },
          ],
          this.backRow(),
        ],
      },
    );
  }

  private async handleTitleCommand(chatId: number, userId: number, newTitle: string): Promise<void> {
    const control = this.options.control;
    if (!control) {
      await this.sendMessage(chatId, '⚠️ Steuerung ist nicht verfügbar.');
      return;
    }
    const ytStatus = control.youtubeStatus?.();
    const template = control.titleTemplate?.() ?? '';
    if (!ytStatus?.connected) {
      const lines = ['🏷 <b>STREAM-TITEL</b>', '', 'YouTube ist nicht verbunden.'];
      if (template) lines.push(`VORLAGE: <code>${escapeHtml(template)}</code>`);
      await this.sendMessage(chatId, lines.join('\n'));
      return;
    }

    let broadcasts: TelegramYouTubeBroadcast[] = [];
    try {
      broadcasts = (await control.youtubeBroadcasts?.()) ?? [];
    } catch (error) {
      await this.sendMessage(chatId, `⚠️ Broadcasts konnten nicht geladen werden: ${escapeHtml(errorName(error))}`);
      return;
    }

    const priority = ['live', 'testing', 'ready', 'created'];
    const target =
      priority
        .map((state) => broadcasts.find((item) => item.status === state))
        .find((item): item is TelegramYouTubeBroadcast => Boolean(item)) ?? null;

    if (!newTitle) {
      const lines = ['🏷 <b>STREAM-TITEL</b>', ''];
      if (target) {
        lines.push(`AKTUELL: <b>${escapeHtml(target.title)}</b>`);
        lines.push(`STATUS: ${escapeHtml(target.status.toUpperCase())}`);
      } else {
        lines.push('Kein aktiver oder geplanter Broadcast gefunden.');
      }
      if (template) lines.push(`VORLAGE: <code>${escapeHtml(template)}</code>`);
      lines.push('', 'Ändern mit: <code>/title Neuer Stream-Titel</code>');
      await this.sendMessage(chatId, lines.join('\n'));
      return;
    }

    if (newTitle.length > 100) {
      await this.sendMessage(chatId, '⚠️ Titel darf maximal 100 Zeichen lang sein.');
      return;
    }
    if (!target) {
      await this.sendMessage(chatId, '⚠️ Kein aktiver oder geplanter Broadcast gefunden.');
      return;
    }
    if (!control.youtubeUpdateTitle) {
      await this.sendMessage(chatId, '⚠️ Titel-Änderung ist nicht verfügbar.');
      return;
    }

    await this.confirmAction(
      chatId,
      userId,
      `Broadcast-Titel von „${truncate(target.title, 40)}“ ändern in „${newTitle}“?`,
      { type: 'youtube-title', id: target.id, title: newTitle },
    );
  }

  private async sendEarnings(
    chatId: number,
    period?: string,
    _query: TelegramCallbackQuery | null = null,
  ): Promise<void> {
    const control = this.options.control;
    if (!control?.earnings) {
      await this.sendMessage(chatId, '⚠️ Einnahmen sind nicht verfügbar.');
      return;
    }
    const periods = ['today', '24h', '7d', '30d', 'all'] as const;
    if (period && (periods as readonly string[]).includes(period)) {
      try {
        await control.setEarningsPeriod?.(period as (typeof periods)[number]);
      } catch (error) {
        await this.sendMessage(chatId, `⚠️ ${escapeHtml(errorName(error))}`);
        return;
      }
    }
    const earnings = control.earnings();
    const active = period && (periods as readonly string[]).includes(period) ? period : null;
    const buttons = periods.map((value) => ({
      text: `${active === value ? '• ' : ''}${value}`,
      callback_data: `earn:${value}`,
    }));
    if (!earnings) {
      await this.sendMessage(
        chatId,
        '💰 <b>EINNAHMEN</b>\n\nNicht konfiguriert. Quelle im Dashboard unter Einstellungen hinterlegen.',
        { inline_keyboard: [buttons.slice(0, 5), this.backRow()] },
      );
      return;
    }
    await this.sendMessage(
      chatId,
      [
        `💰 <b>EINNAHMEN · ${escapeHtml(earnings.period_label.toUpperCase())}</b>`,
        '',
        `NETTO: ${formatNumber(earnings.net, 2)} ${earnings.currency === 'USD' ? '$' : '€'}`,
        `COINS: ${formatNumber(earnings.coins)}`,
        `ZUSCHAUER: ${formatNumber(earnings.viewers)}`,
        `GIFTS: ${formatNumber(earnings.gifts)}`,
        `STAND: ${formatTimestamp(earnings.updated_at)}`,
      ].join('\n'),
      { inline_keyboard: [buttons.slice(0, 5), this.backRow()] },
    );
  }

  private async sendSessions(
    chatId: number,
    query: TelegramCallbackQuery | null = null,
  ): Promise<void> {
    const control = this.options.control;
    const sessions = control?.sessions?.() ?? [];
    if (sessions.length === 0) {
      await this.sendMessage(chatId, '🔐 Keine aktiven Dashboard-Sessions.');
      return;
    }
    const lines = ['🔐 <b>DASHBOARD-SESSIONS</b>', ''];
    sessions.slice(0, 10).forEach((session, index) => {
      lines.push(
        `${index + 1}. ${escapeHtml(session.user)} · ${escapeHtml(session.provider)} · ${formatTimestamp(session.last_seen_at)}`,
      );
    });
    // Session ids are 64 hex chars and would exceed Telegram's 64-byte
    // callback limit, so the buttons reference short-lived local tokens.
    const rows: Record<string, unknown>[][] = sessions.slice(0, 6).map((session) => {
      const ref = `s${++this.sessionRefSeq}`;
      this.sessionRefs.set(ref, session.id);
      return [
        {
          text: `Trennen: ${truncate(session.user, 28)}`,
          callback_data: `revoke:${ref}`,
        },
      ];
    });
    rows.push([{ text: 'Alle anderen trennen', callback_data: 'revokeall' }]);
    rows.push(this.backRow());
    await this.showView(chatId, query, lines.join('\n'), { inline_keyboard: rows });
  }

  private async sendMedia(
    chatId: number,
    query: TelegramCallbackQuery | null = null,
  ): Promise<void> {
    const files = this.options.control?.media?.() ?? [];
    if (files.length === 0) {
      await this.sendMessage(
        chatId,
        '🎬 Keine lokalen Videos in <code>data/media</code>.',
      );
      return;
    }
    const lines = ['🎬 <b>LOKALE VIDEOS</b>', ''];
    for (const file of files.slice(0, 20)) {
      lines.push(`• ${escapeHtml(file.filename)} · ${formatMegabytes(file.size)}`);
    }
    if (files.length > 20) lines.push('', `… und ${files.length - 20} weitere`);
    const rows: Record<string, unknown>[][] = files.slice(0, 8).map((file) => {
      const ref = this.refs.get('media', file.filename);
      return [
        {
          text: `🗑 ${truncate(file.filename, 34)}`,
          callback_data: `media:del:${ref}`,
        },
      ];
    });
    rows.push(this.backRow());
    await this.showView(chatId, query, lines.join('\n'), { inline_keyboard: rows });
  }

  private async sendYouTube(
    chatId: number,
    query: TelegramCallbackQuery | null = null,
  ): Promise<void> {
    const control = this.options.control;
    if (!control?.youtubeStatus) {
      await this.sendMessage(chatId, '⚠️ YouTube-Verwaltung ist nicht verfügbar.');
      return;
    }
    const status = control.youtubeStatus();
    if (!status.connected) {
      await this.sendMessage(
        chatId,
        [
          '📺 <b>YOUTUBE</b>',
          '',
          'Kein Konto verbunden.',
          this.options.dashboardUrl
            ? `Verbinden: ${escapeHtml(this.options.dashboardUrl)}/#/youtube`
            : 'Konto im Dashboard unter YouTube verbinden.',
        ].join('\n'),
      );
      return;
    }
    const broadcasts = (await control.youtubeBroadcasts?.()) ?? [];
    if (broadcasts.length === 0) {
      await this.sendMessage(
        chatId,
        `📺 <b>YOUTUBE</b>\n\nKanal: ${escapeHtml(status.channel_title || '–')}\nKeine Broadcasts gefunden.`,
      );
      return;
    }
    const labels: Record<string, string> = {
      live: 'LIVE',
      ready: 'BEREIT',
      testing: 'TEST',
      created: 'GEPLANT',
      complete: 'BEENDET',
      revoked: 'WIDERRUFEN',
    };
    const rows: Record<string, unknown>[][] = [];
    for (const item of broadcasts.slice(0, 8)) {
      const ref = this.refs.get('broadcast', item.id);
      rows.push([
        {
          text: `${labels[item.status] ?? item.status} · ${truncate(item.title, 26)}`,
          callback_data: 'noop',
        },
      ]);
      const actions: Record<string, unknown>[] = [];
      if (['created', 'ready', 'testing'].includes(item.status)) {
        actions.push({ text: '▶️ Live', callback_data: `ytlive:${item.id}` });
      }
      if (['live', 'testing'].includes(item.status)) {
        actions.push({ text: '⏹ Ende', callback_data: `ytend:${item.id}` });
      }
      if (item.privacy !== 'public' && item.status !== 'complete') {
        actions.push({ text: '🌐 Öffentlich', callback_data: `ytpub:${item.id}` });
      }
      actions.push({ text: '🔗 Ingest', callback_data: `yt:assign:${ref}` });
      rows.push(actions);
    }
    rows.push([{ text: '➕ Broadcast anlegen', callback_data: 'yt:new' }]);
    rows.push(this.backRow());
    await this.showView(
      chatId,
      query,
      [
        '📺 <b>YOUTUBE</b>',
        `Kanal: ${escapeHtml(status.channel_title || '–')}`,
        '',
        'Aktionen werden vor dem Ausführen bestätigt. Details im Dashboard.',
      ].join('\n'),
      { inline_keyboard: rows },
    );
  }

  private async sendScreens(
    chatId: number,
    _query: TelegramCallbackQuery | null = null,
  ): Promise<void> {
    const control = this.options.control;
    if (!control?.showScreen || !control.hideScreen) {
      await this.sendMessage(chatId, '⚠️ Screens sind nicht verfügbar.');
      return;
    }
    const current = control.status().manual_screen;
    await this.sendMessage(
      chatId,
      [
        '🖥 <b>SCREENS</b>',
        '',
        `AKTIV: ${current ? escapeHtml(current) : 'keiner'}`,
        'Pause und Startbildschirm können jederzeit überlagern und unbegrenzt halten.',
      ].join('\n'),
      {
        inline_keyboard: [
          [
            { text: '⏸ Pause an', callback_data: 'screen:pause:on' },
            { text: '▶️ Pause aus', callback_data: 'screen:pause:off' },
          ],
          [
            { text: '🚀 Start an', callback_data: 'screen:startup:on' },
            { text: '⏹ Start aus', callback_data: 'screen:startup:off' },
          ],
          this.backRow(),
        ],
      },
    );
  }

  private async sendOverlays(
    chatId: number,
    _query: TelegramCallbackQuery | null = null,
  ): Promise<void> {
    const settings = this.options.control?.settings?.();
    if (!settings) {
      await this.sendMessage(chatId, '⚠️ Overlays sind nicht verfügbar.');
      return;
    }
    const mark = (enabled: boolean): string => (enabled ? '✅' : '⛔');
    await this.sendMessage(
      chatId,
      [
        '🎚 <b>OVERLAYS</b>',
        '',
        'Änderungen bauen den Sink kurz neu auf (kontrollierter Reconnect).',
        'Positionen und Stile bleiben im Overlay-Studio.',
      ].join('\n'),
      {
        inline_keyboard: [
          [
            { text: `${mark(settings.overlay_chat)} Chat`, callback_data: 'ovl:chat' },
            { text: `${mark(settings.overlay_clock)} Uhr`, callback_data: 'ovl:clock' },
            { text: `${mark(settings.overlay_text)} Text`, callback_data: 'ovl:text' },
          ],
          this.backRow(),
        ],
      },
    );
  }

  private async confirmAction(
    chatId: number,
    userId: number,
    label: string,
    action: PendingAction,
  ): Promise<void> {
    const nonce = this.confirmations.create(chatId, userId, action);
    await this.sendMessage(chatId, `⚠️ <b>BESTÄTIGUNG</b>\n\n${escapeHtml(label)}`, {
      inline_keyboard: [
        [
          { text: '✅ Ja, ausführen', callback_data: `confirm:${nonce}` },
          { text: '❌ Abbrechen', callback_data: `cancel:${nonce}` },
        ],
      ],
    });
  }

  private async runPending(chatId: number, action: PendingAction): Promise<void> {
    const control = this.options.control;
    if (!control) {
      await this.sendMessage(chatId, '⚠️ Steuerung ist nicht verfügbar.');
      return;
    }
    try {
      switch (action.type) {
        case 'stop':
          await control.stop();
          break;
        case 'revoke-session':
          control.revokeSession?.(action.id);
          break;
        case 'revoke-all-sessions':
          control.revokeAllSessions?.();
          break;
        case 'youtube-transition':
          await control.youtubeTransition?.(action.id, action.status);
          break;
        case 'youtube-publish':
          await control.youtubePublish?.(action.id);
          break;
        case 'youtube-title':
          await control.youtubeUpdateTitle?.(action.id, action.title);
          break;
        case 'media-delete':
          await control.mediaDelete?.(action.filename);
          break;
        case 'streamer-delete':
          await control.streamerDelete?.(action.id);
          break;
        case 'playlist-delete':
          await control.playlistDelete?.(action.id);
          break;
        case 'playlist-remove-channel': {
          const playlist = control.playlists().find((item) => item.id === action.id);
          if (playlist) {
            const channels = playlist.channels.filter((_, index) => index !== action.index);
            await control.playlistUpdate?.(action.id, { channels });
          }
          break;
        }
      }
      await this.sendMessage(chatId, '✅ Ausgeführt.');
    } catch (error) {
      await this.sendMessage(chatId, `⚠️ ${escapeHtml(errorName(error))}`);
    }
  }

  private async handleSceneCommand(
    chatId: number,
    arg: string,
    query: TelegramCallbackQuery | null = null,
  ): Promise<void> {
    const control = this.options.control;
    if (!control?.scenes || !control.activateScene) {
      await this.sendMessage(chatId, '⚠️ Szenen sind nicht verfügbar.');
      return;
    }
    const items = control.scenes();
    const trimmed = arg.trim();
    if (trimmed) {
      const match =
        items.find((item) => item.id.toLowerCase() === trimmed.toLowerCase()) ??
        items.find((item) => item.name.toLowerCase() === trimmed.toLowerCase()) ??
        items.find((item) => item.name.toLowerCase().includes(trimmed.toLowerCase()));
      if (!match) {
        await this.sendMessage(chatId, `⚠️ Keine passende Szene für „${escapeHtml(trimmed)}“ gefunden.`);
        return;
      }
      await control.activateScene(match.id);
      await this.sendMessage(chatId, `🎬 Szene <b>${escapeHtml(match.name)}</b> aktiviert.`);
      return;
    }
    if (items.length === 0) {
      await this.sendMessage(
        chatId,
        '🎬 <b>SZENEN</b>\n\nNoch keine Szenen gespeichert. Lege Profile im Overlay-Studio an.',
      );
      return;
    }
    const rows: Record<string, unknown>[][] = [];
    for (let i = 0; i < items.length; i += 2) {
      rows.push(
        items.slice(i, i + 2).map((item) => {
          const ref = this.refs.get('scene', item.id);
          return {
            text: `${item.active ? '✅ ' : ''}${truncate(item.name, 22)}`,
            callback_data: `scn:${ref}`,
          };
        }),
      );
    }
    rows.push(this.backRow());
    await this.showView(
      chatId,
      query,
      [
        '🎬 <b>OVERLAY-SZENEN</b>',
        '',
        'Tippe auf eine Szene zum Aktivieren (inkl. Video-Layout):',
      ].join('\n'),
      { inline_keyboard: rows },
    );
  }

  private async handleMarkerCommand(chatId: number, rawLabel: string): Promise<void> {
    const label = rawLabel.trim() || 'Highlight';
    if (!this.options.control?.addMarker) {
      await this.sendMessage(chatId, '❌ Marker-Funktion nicht verfügbar.');
      return;
    }
    const marker = await this.options.control.addMarker(label);
    if (!marker) {
      await this.sendMessage(chatId, 'ℹ️ Aktuell läuft keine Aufzeichnung.');
      return;
    }
    const minutes = Math.floor(marker.offset_seconds / 60);
    const seconds = Math.floor(marker.offset_seconds % 60);
    const mmss = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    await this.sendMessage(
      chatId,
      `🔖 <b>Marker gesetzt</b>\n„${escapeHtml(marker.label)}“ bei ${mmss}`,
    );
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

  private async handleUiCallback(
    action: string,
    first: string | undefined,
    second: string | undefined,
    third: string | undefined,
    chatId: number,
    userId: number,
    query: TelegramCallbackQuery,
  ): Promise<boolean> {
    if (!['nav', 'str', 'pl', 'set', 'media', 'log', 'yt', 'queue', 'act'].includes(action)) return false;
    await this.answerCallback(query.id, '');
    const control = this.options.control;

    if (action === 'nav') {
      switch (first) {
        case 'main':
          await this.sendMenu(chatId, query);
          break;
        case 'streamers':
          await this.sendStreamers(chatId, query);
          break;
        case 'playlists':
          await this.sendPlaylists(chatId, query);
          break;
        case 'screens':
          await this.sendScreens(chatId, query);
          break;
        case 'overlays':
          await this.sendOverlays(chatId, query);
          break;
        case 'earnings':
          await this.sendEarnings(chatId, undefined, query);
          break;
        case 'youtube':
          await this.sendYouTube(chatId, query);
          break;
        case 'settings':
          await this.sendSettings(chatId, query);
          break;
        case 'sessions':
          await this.sendSessions(chatId, query);
          break;
        case 'media':
          await this.sendMedia(chatId, query);
          break;
        case 'logs':
          await this.sendLogsView(chatId, query);
          break;
        case 'preview':
          await this.sendPreview(chatId, query);
          break;
        case 'queue':
          await this.sendQueue(chatId, query);
          break;
      }
      return true;
    }

    if (action === 'queue') {
      const control = this.options.control;
      if (first === 'play') {
        const index = parseInt(second ?? '0', 10);
        await this.answerCallback(query.id, 'Starte Queue-Eintrag…');
        await control?.queuePlay?.(index);
        await this.sendQueue(chatId, query);
        return true;
      }
      if (first === 'stop') {
        await this.answerCallback(query.id, 'Queue gestoppt');
        await control?.queueStop?.();
        await this.sendQueue(chatId, query);
        return true;
      }
      if (first === 'next') {
        await this.answerCallback(query.id, 'Nächster Eintrag');
        await control?.queueNext?.();
        await this.sendQueue(chatId, query);
        return true;
      }
      if (first === 'prev') {
        await this.answerCallback(query.id, 'Vorheriger Eintrag');
        await control?.queuePrevious?.();
        await this.sendQueue(chatId, query);
        return true;
      }
      if (first === 'hold') {
        await this.answerCallback(query.id, 'Hold umgeschaltet');
        await control?.playbackHold?.();
        await this.sendQueue(chatId, query);
        return true;
      }
      if (first === 'seek' && second) {
        const secs = parseInt(second, 10);
        await this.answerCallback(query.id, `Seek ${secs > 0 ? '+' : ''}${secs}s`);
        await control?.queueSeek?.(secs);
        return true;
      }
      if (first === 'rm' && second) {
        const entryId = this.refs.resolve(second, 'queue');
        if (entryId) {
          await this.answerCallback(query.id, 'Eintrag entfernt');
          await control?.queueRemove?.(entryId);
          await this.sendQueue(chatId, query);
        }
        return true;
      }
    }

    if (action === 'act') {
      if (first === 'screen' && second === 'pause') {
        await this.answerCallback(query.id, 'Pause aktiv');
        await control?.showScreen?.('pause');
        return true;
      }
      if (first === 'streamer' && second === 'next') {
        await this.answerCallback(query.id, 'Nächster Streamer…');
        await control?.playlistNext?.();
        return true;
      }
      if (first === 'stream' && second === 'stop') {
        await this.answerCallback(query.id, 'Stoppe Stream…');
        await control?.stop?.();
        return true;
      }
      if (first === 'source' && second === 'reconnect') {
        await this.answerCallback(query.id, 'Reconnect ausgelöst');
        await control?.resume?.();
        return true;
      }
      if (first === 'sink' && second === 'restart') {
        await this.answerCallback(query.id, 'Neustart Sink…');
        await control?.resume?.();
        return true;
      }
      if (first === 'preview' && second === 'refresh') {
        await this.sendPreview(chatId, query);
        return true;
      }
    }

    if (action === 'str') {
      const id = this.refs.resolve(second ?? '', 'streamer');
      const streamer = id
        ? control?.streamers().find((item) => item.id === id) ?? null
        : null;
      switch (first) {
        case 'new':
          this.conversations.start(chatId, userId, 'streamer-new-id');
          await this.sendMessage(
            chatId,
            '➕ <b>Streamer anlegen</b>\n\n1/3 · ID/Slug senden (a-z, 0-9, _ und -).',
          );
          return true;
        case 'start':
          if (streamer) {
            await this.runAction(
              chatId,
              (service) => service.start(streamer.id),
              `Start: ${streamer.name}`,
            );
          }
          return true;
        case 'toggle':
          if (streamer) {
            await control?.streamerUpdate?.(streamer.id, { enabled: !streamer.enabled });
            await this.sendStreamerDetail(chatId, this.refs.get('streamer', streamer.id));
          }
          return true;
        case 'q': {
          if (!streamer) return true;
          const cycle = ['best', '1080p', '720p', '480p', '360p'];
          const next = cycle[(cycle.indexOf(streamer.quality ?? 'best') + 1) % cycle.length]!;
          await control?.streamerUpdate?.(streamer.id, { quality: next });
          await this.sendStreamerDetail(chatId, this.refs.get('streamer', streamer.id));
          return true;
        }
        case 'edit':
          if (streamer) await this.sendStreamerDetail(chatId, this.refs.get('streamer', streamer.id), query);
          return true;
        case 'rename':
          if (streamer) {
            this.conversations.start(chatId, userId, 'streamer-edit-name', { id: streamer.id });
            await this.sendMessage(chatId, `Neuer Name für <b>${escapeHtml(streamer.name)}</b>?`);
          }
          return true;
        case 'rehandle':
          if (streamer) {
            this.conversations.start(chatId, userId, 'streamer-edit-handle', { id: streamer.id });
            await this.sendMessage(chatId, 'Neuer TikTok-Handle? (@ optional)');
          }
          return true;
        case 'del':
          if (streamer) {
            await this.confirmAction(
              chatId,
              userId,
              `Streamer „${streamer.name}“ löschen?`,
              { type: 'streamer-delete', id: streamer.id },
            );
          }
          return true;
      }
      return true;
    }

    if (action === 'pl') {
      const playlistRefArg = first === 'toggle' ? third : second;
      const playlistId = this.refs.resolve(playlistRefArg ?? '', 'playlist');
      switch (first) {
        case 'new':
          this.conversations.start(chatId, userId, 'playlist-new-id');
          await this.sendMessage(
            chatId,
            '➕ <b>Playlist anlegen</b>\n\n1/2 · ID/Slug senden.',
          );
          return true;
        case 'view':
          await this.sendPlaylistDetail(chatId, second ?? '', query);
          return true;
        case 'play':
          if (playlistId) await control?.playlistPlay?.(playlistId);
          await this.sendPlaylists(chatId, query);
          return true;
        case 'del':
          if (playlistId) {
            const playlist = control?.playlists().find((item) => item.id === playlistId);
            await this.confirmAction(chatId, userId, `Playlist „${playlist?.name ?? playlistId}“ löschen?`, {
              type: 'playlist-delete',
              id: playlistId,
            });
          }
          return true;
        case 'toggle': {
          if (!playlistId || (second !== 'auto' && second !== 'wrap')) return true;
          const playlist = control?.playlists().find((item) => item.id === playlistId);
          if (playlist) {
            await control?.playlistUpdate?.(playlistId, {
              [second === 'auto' ? 'auto_advance' : 'wrap']:
                !(second === 'auto' ? playlist.auto_advance : playlist.wrap),
            });
            await this.sendPlaylistDetail(chatId, this.refs.get('playlist', playlistId));
          }
          return true;
        }
        case 'chan':
        case 'file': {
          if (!playlistId) return true;
          const playlist = control?.playlists().find((item) => item.id === playlistId);
          if (!playlist) return true;
          this.conversations.start(
            chatId,
            userId,
            first === 'chan' ? 'playlist-add-channel' : 'playlist-add-file',
            { id: playlistId, channels: playlist.channels.join('|') },
          );
          await this.sendMessage(
            chatId,
            first === 'chan'
              ? 'TikTok-Handle des Kanals senden:'
              : 'Dateiname aus data/media senden (z. B. intro.mp4):',
          );
          return true;
        }
        case 'rmchan': {
          if (!playlistId) return true;
          const playlist = control?.playlists().find((item) => item.id === playlistId);
          const index = Number(third);
          const channel = playlist?.channels[index];
          if (channel) {
            await this.confirmAction(chatId, userId, `Kanal „${channel}“ entfernen?`, {
              type: 'playlist-remove-channel',
              id: playlistId,
              index,
            });
          }
          return true;
        }
      }
      return true;
    }

    if (action === 'set') {
      const settings = control?.settings?.();
      if (!settings) return true;
      const key = second ?? '';
      const toggles: Record<string, [boolean, Record<string, unknown>]> = {
        auto_reconnect: [settings.auto_reconnect, { watchdog: { auto_reconnect: !settings.auto_reconnect } }],
        pause_enabled: [settings.pause_enabled, { pause: { enabled: !settings.pause_enabled } }],
        startup_enabled: [settings.startup_enabled, { startup: { enabled: !settings.startup_enabled } }],
        youtube_auto: [
          settings.youtube_auto_transition,
          { youtube: { auto_transition: !settings.youtube_auto_transition } },
        ],
      };
      if (first === 'toggle' && toggles[key]) {
        await control?.settingsUpdate?.(toggles[key]![1]);
        await this.sendSettings(chatId, query);
        return true;
      }
      if (first === 'edit') {
        const flows: Record<string, [string, string]> = {
          delay: ['settings-delay', 'Delay in Sekunden (0–300)?'],
          pause: ['settings-pause', 'Maximale Pause in Minuten (0 = unbegrenzt)?'],
          startup: ['settings-startup', 'Startbildschirm-Dauer in Sekunden?'],
          refresh: ['settings-refresh', 'Auto-Refresh-Intervall in Minuten?'],
        };
        const flow = flows[key];
        if (flow) {
          this.conversations.start(chatId, userId, flow[0]);
          await this.sendMessage(chatId, flow[1]!);
        }
        return true;
      }
      return true;
    }

    if (action === 'media') {
      if (first === 'del' && second) {
        const filename = this.refs.resolve(second, 'media');
        if (filename) {
          await this.confirmAction(chatId, userId, `Video „${filename}“ löschen?`, {
            type: 'media-delete',
            filename,
          });
        }
      }
      return true;
    }

    if (action === 'log') {
      if (first === 'lvl') {
        await this.sendLogsView(chatId, query, { level: second ?? 'all', page: 0 });
      } else if (first === 'page') {
        await this.sendLogsView(chatId, query, { page: Number(second ?? 0) });
      } else if (first === 'search') {
        this.conversations.start(chatId, userId, 'log-search');
        await this.sendMessage(chatId, '🔎 Suchbegriff senden (leer = zurücksetzen):');
      }
      return true;
    }

    if (action === 'yt') {
      const draft = this.youtubeDrafts.get(chatId);
      if (first === 'new') {
        if (!control?.youtubeStatus?.().connected) {
          await this.sendYouTube(chatId, query);
          return true;
        }
        this.conversations.start(chatId, userId, 'youtube-title');
        await this.sendMessage(chatId, '➕ <b>Broadcast</b>\n\n1/3 · Titel senden:');
        return true;
      }
      if (first === 'privacy' && draft && second) {
        draft.privacy = second as 'public' | 'unlisted' | 'private';
        await this.sendYouTubeStreamerChoice(chatId);
        return true;
      }
      if (first === 'create') {
        if (!draft) return true;
        const streamerId =
          second && second !== 'none' ? this.refs.resolve(second, 'streamer') : null;
        try {
          await control?.youtubeCreate?.({
            title: draft.title,
            scheduled_start: draft.start,
            privacy: draft.privacy,
            ...(streamerId ? { streamer_id: streamerId } : {}),
          });
          this.youtubeDrafts.delete(chatId);
          await this.sendMessage(chatId, '✅ Broadcast angelegt.');
        } catch (error) {
          await this.sendMessage(chatId, `⚠️ ${escapeHtml(errorName(error))}`);
        }
        await this.sendYouTube(chatId, query);
        return true;
      }
      if (first === 'assign') {
        const streamers = control?.streamers() ?? [];
        const rows = streamers.slice(0, 8).map((streamer) => [
          {
            text: `🔗 ${truncate(streamer.name, 30)}`,
            callback_data: `yt:assigngo:${second ?? ''}:${this.refs.get('streamer', streamer.id)}`,
          },
        ]);
        await this.sendMessage(chatId, '🔗 <b>Ingest zuordnen</b>', {
          inline_keyboard: rows,
        });
        return true;
      }
      if (first === 'assigngo') {
        const broadcastId = this.refs.resolve(second ?? '', 'broadcast');
        const streamerId = this.refs.resolve(third ?? '', 'streamer');
        if (broadcastId && streamerId) {
          try {
            await control?.youtubeAssign?.(broadcastId, streamerId);
            await this.sendMessage(chatId, '✅ Ingest zugeordnet.');
          } catch (error) {
            await this.sendMessage(chatId, `⚠️ ${escapeHtml(errorName(error))}`);
          }
        }
        await this.sendYouTube(chatId, query);
        return true;
      }
      return true;
    }

    return false;
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
        this.notify(
          'reconnect',
          `🟡 <b>PAUSE</b>\n${escapeHtml(name)} – Quelle offline, Pausenscreen läuft.`,
          buildActionableAlertKeyboard('source_offline'),
        );
      } else if (status.state === 'error') {
        this.notify(
          'error',
          `🔴 <b>FEHLER</b>\n${escapeHtml(status.watchdog.last_error ?? 'Unbekannter Fehler')}`,
          buildActionableAlertKeyboard('sink_error'),
        );
      } else if (status.state === 'idle' && previous.state !== 'idle') {
        const category = previous.state === 'paused' ? 'reconnect' : 'live';
        this.notify(category, `⚫ <b>STREAM BEENDET</b>\n${escapeHtml(name)}`);
      }
    }

    const lastError = status.watchdog.last_error;
    if (lastError && lastError !== previous.watchdog.last_error) {
      this.notify(
        'error',
        `⚠️ ${escapeHtml(lastError)}`,
        buildActionableAlertKeyboard('source_stall'),
      );
    }

    if (this.pinnedMessage) {
      const card = renderLiveStatusCard(status, {
        dashboardUrl: this.options.dashboardUrl,
        streamerName: status.active_streamer_name ?? status.active_streamer_id ?? undefined,
      });
      void this.call(
        'editMessageText',
        {
          chat_id: this.pinnedMessage.chatId,
          message_id: this.pinnedMessage.messageId,
          text: card,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        },
        5_000,
      ).catch(() => {});
    }
  }

  private async handlePinCommand(chatId: number): Promise<void> {
    const snap = this.options.control?.status();
    if (!snap) {
      await this.sendMessage(chatId, '⚠️ Kein Status verfügbar.');
      return;
    }
    const text = renderLiveStatusCard(snap, {
      dashboardUrl: this.options.dashboardUrl,
      streamerName: snap.active_streamer_name ?? snap.active_streamer_id ?? undefined,
    });
    try {
      const res = await this.call<{ message_id: number }>(
        'sendMessage',
        {
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        },
        10_000,
      );
      if (res?.message_id) {
        this.pinnedMessage = { chatId, messageId: res.message_id };
        await this.call(
          'pinChatMessage',
          {
            chat_id: chatId,
            message_id: res.message_id,
            disable_notification: true,
          },
          5_000,
        );
        await this.sendMessage(chatId, '📌 Live-Dashboard angepinnt.');
      }
    } catch (err) {
      this.logger.warn({ err: errorName(err) }, 'Telegram pinChatMessage fehlgeschlagen');
    }
  }

  private async handleUnpinCommand(chatId: number): Promise<void> {
    if (!this.pinnedMessage) {
      await this.sendMessage(chatId, '📌 Aktuell ist kein Live-Dashboard angepinnt.');
      return;
    }
    try {
      await this.call(
        'unpinChatMessage',
        {
          chat_id: this.pinnedMessage.chatId,
          message_id: this.pinnedMessage.messageId,
        },
        5_000,
      );
      this.pinnedMessage = null;
      await this.sendMessage(chatId, '✅ Live-Dashboard gelöst.');
    } catch {
      this.pinnedMessage = null;
    }
  }

  private notify(
    category: NotifyCategory,
    text: string,
    replyMarkup?: Record<string, unknown>,
  ): void {
    const settings = this.options.notify?.store.get();
    if (!settings?.enabled || !settings[category]) return;
    const now = Date.now();
    const last = this.lastNotifyAt.get(category) ?? 0;
    if (now - last < 10_000) return;
    this.lastNotifyAt.set(category, now);
    const chatId = this.options.notify?.chatId ?? [...this.allowed][0];
    if (!chatId) return;
    void this.sendMessage(chatId, text, replyMarkup);
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
    const [action, first, second, third] = (query.data ?? '').split(':');
    const chatId = query.message.chat.id;
    if (await this.handleUiCallback(action, first, second, third, chatId, user.id, query)) {
      return;
    }
    if (action === 'cmd' && first) {
      await this.answerCallback(query.id, 'Ausgeführt');
      await this.dispatchAction(chatId, first, user.id);
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
    if (action === 'confirm' && first) {
      const pending = this.confirmations.consume(first, chatId, user.id);
      if (!pending) {
        await this.answerCallback(query.id, 'Abgelaufen');
        await this.editMessage(query, '⚠️ Diese Bestätigung ist abgelaufen.');
        return;
      }
      await this.answerCallback(query.id, 'Ausgeführt');
      await this.editMessage(query, '✅ Bestätigt.');
      await this.runPending(chatId, pending);
      return;
    }
    if (action === 'cancel' && first) {
      const cancelled = this.confirmations.cancel(first, chatId, user.id);
      await this.answerCallback(query.id, cancelled ? 'Abgebrochen' : 'Abgelaufen');
      if (cancelled) await this.editMessage(query, '❌ Abgebrochen.');
      return;
    }
    if (action === 'earn' && first) {
      await this.answerCallback(query.id, 'Zeitraum gesetzt');
      await this.sendEarnings(chatId, first);
      return;
    }
    if (action === 'scn' && first) {
      const sceneId = this.refs.resolve(first, 'scene');
      if (!sceneId || !this.options.control?.activateScene) {
        await this.answerCallback(query.id, 'Nicht gefunden');
        return;
      }
      try {
        await this.options.control.activateScene(sceneId);
        await this.answerCallback(query.id, 'Szene aktiviert');
        await this.handleSceneCommand(chatId, '', query);
      } catch (error) {
        await this.answerCallback(query.id, errorName(error));
      }
      return;
    }
    if (action === 'screen' && first && second) {
      const control = this.options.control;
      await this.answerCallback(query.id, second === 'on' ? 'Startet…' : 'Beendet…');
      try {
        if (second === 'on') {
          await control?.showScreen?.(first === 'startup' ? 'startup' : 'pause');
        } else {
          await control?.hideScreen?.();
        }
      } catch (error) {
        await this.sendMessage(chatId, `⚠️ ${escapeHtml(errorName(error))}`);
      }
      await this.sendScreens(chatId);
      return;
    }
    if (action === 'ovl' && first) {
      await this.answerCallback(query.id, 'Umschalten…');
      try {
        await this.options.control?.toggleOverlay?.(first as 'chat' | 'clock' | 'text');
      } catch (error) {
        await this.sendMessage(chatId, `⚠️ ${escapeHtml(errorName(error))}`);
      }
      await this.sendOverlays(chatId);
      return;
    }
    if (action === 'revoke' && first) {
      const id = this.sessionRefs.get(first) ?? first;
      const session = this.options.control
        ?.sessions?.()
        .find((item) => item.id === id);
      await this.answerCallback(query.id, 'Bitte bestätigen');
      await this.confirmAction(
        chatId,
        user.id,
        `Session von ${session?.user ?? 'Unbekannt'} trennen?`,
        { type: 'revoke-session', id },
      );
      return;
    }
    if (action === 'revokeall') {
      await this.answerCallback(query.id, 'Bitte bestätigen');
      await this.confirmAction(
        chatId,
        user.id,
        'Alle anderen Dashboard-Sessions trennen?',
        { type: 'revoke-all-sessions' },
      );
      return;
    }
    if (action === 'ytlive' && first) {
      await this.answerCallback(query.id, 'Bitte bestätigen');
      await this.confirmAction(chatId, user.id, `Broadcast ${first} live schalten?`, {
        type: 'youtube-transition',
        id: first,
        status: 'live',
      });
      return;
    }
    if (action === 'ytend' && first) {
      await this.answerCallback(query.id, 'Bitte bestätigen');
      await this.confirmAction(chatId, user.id, `Broadcast ${first} beenden?`, {
        type: 'youtube-transition',
        id: first,
        status: 'complete',
      });
      return;
    }
    if (action === 'ytpub' && first) {
      await this.answerCallback(query.id, 'Bitte bestätigen');
      await this.confirmAction(chatId, user.id, `Broadcast ${first} öffentlich stellen?`, {
        type: 'youtube-publish',
        id: first,
      });
      return;
    }
    if (action === 'noop') {
      await this.answerCallback(query.id, '');
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

  private async sendChatAction(chatId: number, action: string): Promise<void> {
    try {
      await this.call('sendChatAction', { chat_id: chatId, action }, 5_000);
    } catch {
      /* action indicator is best-effort */
    }
  }

  private async sendPhoto(
    chatId: number,
    photo: Buffer,
    caption?: string,
    replyMarkup?: Record<string, unknown>,
  ): Promise<void> {
    const formData = new FormData();
    formData.append('chat_id', String(chatId));
    if (caption) {
      formData.append('caption', caption);
      formData.append('parse_mode', 'HTML');
    }
    if (replyMarkup) {
      formData.append('reply_markup', JSON.stringify(replyMarkup));
    }
    const blob = new Blob([photo], { type: 'image/png' });
    formData.append('photo', blob, 'preview.png');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const onStop = () => controller.abort();
    this.stopController.signal.addEventListener('abort', onStop, { once: true });
    try {
      const response = await fetch(`${API_BASE}${this.token}/sendPhoto`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      const data = (await response.json()) as TelegramResponse<unknown>;
      if (!response.ok || !data.ok) {
        throw new Error(data.description ?? response.statusText);
      }
    } catch (error) {
      this.logger.warn({ err: errorName(error) }, 'Telegram sendPhoto fehlgeschlagen');
    } finally {
      clearTimeout(timer);
      this.stopController.signal.removeEventListener('abort', onStop);
    }
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

  private async editMessage(
    query: TelegramCallbackQuery,
    text: string,
    replyMarkup?: Record<string, unknown>,
  ): Promise<void> {
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
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
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
