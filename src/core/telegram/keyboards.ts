import type {
  TelegramInlineKeyboardButton,
  TelegramInlineKeyboardMarkup,
} from './types.js';

export function makeCallbackButton(
  text: string,
  callback_data: string,
): TelegramInlineKeyboardButton {
  return { text, callback_data };
}

export function makeUrlButton(
  text: string,
  url: string,
): TelegramInlineKeyboardButton {
  return { text, url };
}

export function makeWebAppButton(
  text: string,
  url: string,
): TelegramInlineKeyboardButton {
  return { text, web_app: { url } };
}

export function makeInlineKeyboard(
  rows: TelegramInlineKeyboardButton[][],
): TelegramInlineKeyboardMarkup {
  return { inline_keyboard: rows };
}

export function chunkButtons<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

/**
 * Builds the top-level main menu keyboard with quick navigation,
 * including a Telegram Web App button if a dashboard URL is available.
 */
export function buildMainMenuKeyboard(
  dashboardUrl?: string,
): TelegramInlineKeyboardMarkup {
  const rows: TelegramInlineKeyboardButton[][] = [
    [
      makeCallbackButton('📡 Status', 'menu:status'),
      makeCallbackButton('📸 Vorschau', 'menu:preview'),
    ],
    [
      makeCallbackButton('📺 Sender', 'menu:streamers'),
      makeCallbackButton('📋 Playlists', 'menu:playlists'),
    ],
    [
      makeCallbackButton('🎬 Regie-Queue', 'menu:queue'),
      makeCallbackButton('🎨 Szenen', 'menu:scenes'),
    ],
    [
      makeCallbackButton('💰 Einnahmen', 'menu:earnings'),
      makeCallbackButton('⚙️ Settings', 'menu:settings'),
    ],
  ];

  if (dashboardUrl) {
    rows.push([
      makeWebAppButton('🚀 Web Cockpit öffnen', dashboardUrl),
      makeUrlButton('🌐 Im Browser', dashboardUrl),
    ]);
  }

  return makeInlineKeyboard(rows);
}

/**
 * Builds actionable recovery buttons for stream alerts (e.g. source stalls/offline).
 */
export function buildActionableAlertKeyboard(
  alertType: 'source_offline' | 'source_stall' | 'sink_error' | 'dts_errors',
): TelegramInlineKeyboardMarkup {
  const rows: TelegramInlineKeyboardButton[][] = [];

  if (alertType === 'source_offline' || alertType === 'source_stall') {
    rows.push([
      makeCallbackButton('⏸ Pause halten', 'act:screen:pause'),
      makeCallbackButton('⏭ Nächster Sender', 'act:streamer:next'),
    ]);
    rows.push([
      makeCallbackButton('🔄 Reconnect', 'act:source:reconnect'),
      makeCallbackButton('⏹ Stream stoppen', 'act:stream:stop'),
    ]);
  } else if (alertType === 'sink_error' || alertType === 'dts_errors') {
    rows.push([
      makeCallbackButton('🔄 Sink neustarten', 'act:sink:restart'),
      makeCallbackButton('⏸ Pause schalten', 'act:screen:pause'),
    ]);
    rows.push([
      makeCallbackButton('⏹ Not-Stopp', 'act:stream:stop'),
    ]);
  }

  return makeInlineKeyboard(rows);
}

/**
 * Builds interactive confirmation dialog keyboard.
 */
export function buildConfirmationKeyboard(
  confirmRef: string,
  cancelRef: string,
  confirmLabel = '✅ Ja, ausführen',
  cancelLabel = '❌ Abbrechen',
): TelegramInlineKeyboardMarkup {
  return makeInlineKeyboard([
    [
      makeCallbackButton(confirmLabel, confirmRef),
      makeCallbackButton(cancelLabel, cancelRef),
    ],
  ]);
}
