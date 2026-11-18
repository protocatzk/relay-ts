import type { Logger } from 'pino';
import { TelegramAuthStore } from './auth-store.js';

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

export interface TelegramBotOptions {
  token: string;
  allowedUserIds: number[];
  auth: TelegramAuthStore;
  logger: Logger;
}

const API_BASE = 'https://api.telegram.org/bot';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
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

  constructor(options: TelegramBotOptions) {
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
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.stopController.abort();
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
    if (command === '/id') {
      await this.sendMessage(
        message.chat.id,
        `Deine Telegram-ID: <code>${user.id}</code>`,
      );
      return;
    }
    if (command !== '/start') {
      await this.sendMessage(
        message.chat.id,
        'Öffne das Dashboard und wähle <b>Mit Telegram anmelden</b>.',
      );
      return;
    }
    const argument = args[0] ?? '';
    if (argument.startsWith('login_')) {
      await this.handleLoginRequest(message.chat.id, user, argument.slice('login_'.length));
      return;
    }
    await this.sendMessage(
      message.chat.id,
      [
        '🔐 <b>RELAY DASHBOARD</b>',
        '',
        'Dieser Bot bestätigt Anmeldungen am Dashboard.',
        'Öffne die Website und wähle <b>Mit Telegram anmelden</b>.',
        '',
        `Deine ID: <code>${user.id}</code>`,
      ].join('\n'),
    );
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
    const [action, token] = (query.data ?? '').split(':', 2);
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
