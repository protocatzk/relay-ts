import type { Logger } from 'pino';
import type { StreamerConfig } from '../config/schema.js';
import { readCookieHeader } from '../source/resolver.js';
import type { TikTokAccountStore } from './tiktok-account-store.js';

/** TikTok session used for one streamer (#95). */
export interface StreamerSession {
  /** Netscape cookie file for ffmpeg/yt-dlp; null when no session is configured. */
  cookieFile: string | null;
  /** Cookie header for TikTok API calls; null when no session is configured. */
  cookieHeader: string | null;
  /** Account the session came from; null for the global file/active account. */
  accountId: string | null;
  /** Label of the account (empty when the global file is used). */
  accountLabel: string;
  /** The streamer references an account that no longer exists. */
  missing: boolean;
}

export interface StreamerSessionOptions {
  accounts?: TikTokAccountStore;
  /** Global file written from the active account (`data/cookies.txt`). */
  fallbackCookieFile: string;
  logger?: Logger;
  /** Deduplicates the "account missing" warning per streamer and account. */
  warned?: Set<string>;
}

function fallbackSession(
  options: StreamerSessionOptions,
  missing: boolean,
): StreamerSession {
  return {
    cookieFile: options.fallbackCookieFile,
    cookieHeader: readCookieHeader(options.fallbackCookieFile),
    accountId: options.accounts?.getActive()?.id ?? null,
    accountLabel: '',
    missing,
  };
}

/**
 * Resolves the TikTok session for a streamer. An explicit `tiktok_account`
 * wins; everything else keeps using the active account file. A dangling
 * account reference falls back with a one-time warning so the stream keeps
 * starting (issue #95).
 */
export function resolveStreamerSession(
  streamer: Pick<StreamerConfig, 'id' | 'tiktok_account'>,
  options: StreamerSessionOptions,
): StreamerSession {
  const accountId = (streamer.tiktok_account ?? '').trim();
  if (!accountId) return fallbackSession(options, false);

  const account = options.accounts?.getById(accountId);
  if (!account) {
    const key = `${streamer.id}:${accountId}`;
    if (!options.warned || !options.warned.has(key)) {
      options.warned?.add(key);
      options.logger?.warn(
        { streamer: streamer.id, account: accountId },
        'TikTok-Konto des Streamers nicht gefunden – nutze das aktive Konto',
      );
    }
    return fallbackSession(options, true);
  }

  return {
    cookieFile: options.accounts!.cookieFileFor(account),
    cookieHeader: options.accounts!.cookieHeaderFor(account),
    accountId: account.id,
    accountLabel: account.label,
    missing: false,
  };
}
