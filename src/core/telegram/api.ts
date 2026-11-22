import type { Logger } from 'pino';
import type {
  TelegramBotCommand,
  TelegramChatAction,
  TelegramInlineKeyboardMarkup,
  TelegramMenuButton,
  TelegramMessage,
  TelegramReplyKeyboardMarkup,
  TelegramReplyKeyboardRemove,
  TelegramResponse,
  TelegramUpdate,
} from './types.js';

export class TelegramApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly errorCode: number,
    public readonly description: string,
    public readonly retryAfter?: number,
  ) {
    super(`Telegram API ${method} failed (${errorCode}): ${description}`);
    this.name = 'TelegramApiError';
  }
}

export class TelegramApiClient {
  private readonly baseUrl: string;

  constructor(
    token: string,
    private readonly logger: Logger,
  ) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async call<T>(
    method: string,
    body?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = `${this.baseUrl}/${method}`;
    const init: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    };

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new Error(`Telegram network request to ${method} failed: ${(err as Error).message}`, { cause: err });
    }

    const payload = (await response.json()) as TelegramResponse<T>;
    if (!response.ok || !payload.ok) {
      const code = payload.error_code ?? response.status;
      const desc = payload.description ?? response.statusText;
      const retryAfter = payload.parameters?.retry_after;
      if (code === 429) {
        this.logger.warn(
          { method, retryAfter },
          'telegram rate-limited (429): retry_after=%ds',
          retryAfter ?? 0,
        );
      }
      throw new TelegramApiError(method, code, desc, retryAfter);
    }

    return payload.result as T;
  }

  async callMultipart<T>(
    method: string,
    fields: Record<string, unknown>,
    file: { fieldName: string; filename: string; buffer: Buffer; contentType?: string },
    signal?: AbortSignal,
  ): Promise<T> {
    const url = `${this.baseUrl}/${method}`;
    const formData = new FormData();

    for (const [key, val] of Object.entries(fields)) {
      if (val === undefined || val === null) continue;
      if (typeof val === 'object') {
        formData.append(key, JSON.stringify(val));
      } else {
        formData.append(key, String(val));
      }
    }

    const blob = new Blob([file.buffer], {
      type: file.contentType ?? 'application/octet-stream',
    });
    formData.append(file.fieldName, blob, file.filename);

    const init: RequestInit = {
      method: 'POST',
      body: formData,
      signal,
    };

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new Error(`Telegram multipart request to ${method} failed: ${(err as Error).message}`, { cause: err });
    }

    const payload = (await response.json()) as TelegramResponse<T>;
    if (!response.ok || !payload.ok) {
      const code = payload.error_code ?? response.status;
      const desc = payload.description ?? response.statusText;
      const retryAfter = payload.parameters?.retry_after;
      throw new TelegramApiError(method, code, desc, retryAfter);
    }

    return payload.result as T;
  }

  async sendMessage(params: {
    chat_id: number;
    text: string;
    parse_mode?: 'HTML' | 'MarkdownV2';
    reply_markup?:
      | TelegramInlineKeyboardMarkup
      | TelegramReplyKeyboardMarkup
      | TelegramReplyKeyboardRemove;
    disable_notification?: boolean;
    link_preview_options?: { is_disabled?: boolean };
  }): Promise<TelegramMessage> {
    return this.call<TelegramMessage>('sendMessage', params);
  }

  async editMessageText(params: {
    chat_id?: number;
    message_id?: number;
    inline_message_id?: string;
    text: string;
    parse_mode?: 'HTML' | 'MarkdownV2';
    reply_markup?: TelegramInlineKeyboardMarkup;
  }): Promise<TelegramMessage | boolean> {
    return this.call<TelegramMessage | boolean>('editMessageText', params);
  }

  async sendPhoto(params: {
    chat_id: number;
    photo: Buffer | string;
    filename?: string;
    caption?: string;
    parse_mode?: 'HTML' | 'MarkdownV2';
    reply_markup?: TelegramInlineKeyboardMarkup;
    disable_notification?: boolean;
  }): Promise<TelegramMessage> {
    if (Buffer.isBuffer(params.photo)) {
      const { photo, filename, ...rest } = params;
      return this.callMultipart<TelegramMessage>(
        'sendPhoto',
        rest,
        {
          fieldName: 'photo',
          filename: filename ?? 'preview.jpg',
          buffer: photo,
          contentType: 'image/jpeg',
        },
      );
    }
    return this.call<TelegramMessage>('sendPhoto', params as Record<string, unknown>);
  }

  async editMessageMedia(params: {
    chat_id?: number;
    message_id?: number;
    inline_message_id?: string;
    media: {
      type: 'photo';
      media: Buffer | string;
      filename?: string;
      caption?: string;
      parse_mode?: 'HTML' | 'MarkdownV2';
    };
    reply_markup?: TelegramInlineKeyboardMarkup;
  }): Promise<TelegramMessage | boolean> {
    if (Buffer.isBuffer(params.media.media)) {
      const attachName = 'attach://media_file';
      const fileBuffer = params.media.media;
      const filename = params.media.filename ?? 'preview.jpg';

      const mediaPayload = {
        type: params.media.type,
        media: attachName,
        caption: params.media.caption,
        parse_mode: params.media.parse_mode,
      };

      const fields: Record<string, unknown> = {
        chat_id: params.chat_id,
        message_id: params.message_id,
        inline_message_id: params.inline_message_id,
        media: mediaPayload,
        reply_markup: params.reply_markup,
      };

      return this.callMultipart<TelegramMessage | boolean>(
        'editMessageMedia',
        fields,
        {
          fieldName: 'media_file',
          filename,
          buffer: fileBuffer,
          contentType: 'image/jpeg',
        },
      );
    }

    return this.call<TelegramMessage | boolean>('editMessageMedia', params as Record<string, unknown>);
  }

  async sendChatAction(params: {
    chat_id: number;
    action: TelegramChatAction;
  }): Promise<boolean> {
    return this.call<boolean>('sendChatAction', params);
  }

  async answerCallbackQuery(params: {
    callback_query_id: string;
    text?: string;
    show_alert?: boolean;
  }): Promise<boolean> {
    return this.call<boolean>('answerCallbackQuery', params);
  }

  async setMyCommands(params: {
    commands: TelegramBotCommand[];
    scope?: Record<string, unknown>;
  }): Promise<boolean> {
    return this.call<boolean>('setMyCommands', params);
  }

  async setChatMenuButton(params: {
    chat_id?: number;
    menu_button: TelegramMenuButton;
  }): Promise<boolean> {
    return this.call<boolean>('setChatMenuButton', params);
  }

  async pinChatMessage(params: {
    chat_id: number;
    message_id: number;
    disable_notification?: boolean;
  }): Promise<boolean> {
    return this.call<boolean>('pinChatMessage', params);
  }

  async unpinChatMessage(params: {
    chat_id: number;
    message_id?: number;
  }): Promise<boolean> {
    return this.call<boolean>('unpinChatMessage', params);
  }

  async getUpdates(
    params: { offset?: number; timeout?: number; allowed_updates?: string[] },
    signal?: AbortSignal,
  ): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>('getUpdates', params, signal);
  }
}
