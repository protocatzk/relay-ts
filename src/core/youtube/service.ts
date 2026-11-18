import type { Logger } from 'pino';
import { AppError, toErrorMessage } from '../../utils/errors.js';
import type { YouTubeAuthRecord, YouTubeAuthStore } from './auth-store.js';
import { fetchChannelInfo } from './client.js';
import {
  buildAuthorizationUrl,
  createPkcePair,
  createState,
  exchangeCode,
  isRevokedGrant,
  refreshAccessToken,
  revokeToken,
  type OAuthCredentials,
  type TokenResponse,
} from './oauth.js';

const PENDING_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 10;
const REFRESH_MARGIN_MS = 60 * 1000;

export type YouTubeAuthConfig = OAuthCredentials;

export interface YouTubeStatus {
  configured: boolean;
  connected: boolean;
  account: { channel_id: string; channel_title: string };
  scopes: string[];
  connected_at: string | null;
  expires_at: string | null;
}

export type CallbackResult =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'cancelled' | 'state_invalid' | 'exchange_failed' };

interface PendingAuthorization {
  verifier: string;
  createdAt: number;
}

export interface YouTubeAuthServiceOptions {
  config: YouTubeAuthConfig;
  store: YouTubeAuthStore;
  logger: Logger;
  now?: () => number;
}

/**
 * Single-account YouTube OAuth session handling: authorization start, callback
 * exchange, automatic token refresh and disconnect. Tokens never leave the
 * server except as bearer headers towards Google.
 */
export class YouTubeAuthService {
  private readonly pending = new Map<string, PendingAuthorization>();
  private refreshPromise: Promise<string> | null = null;
  private readonly now: () => number;

  constructor(private readonly options: YouTubeAuthServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  get configured(): boolean {
    const { clientId, clientSecret } = this.options.config;
    return Boolean(clientId && clientSecret);
  }

  status(): YouTubeStatus {
    const record = this.options.store.read();
    return {
      configured: this.configured,
      connected: Boolean(record),
      account: record?.account ?? { channel_id: '', channel_title: '' },
      scopes: record?.tokens.scope ? record.tokens.scope.split(/\s+/).filter(Boolean) : [],
      connected_at: record?.connected_at || null,
      expires_at: record ? new Date(record.tokens.expiry_date).toISOString() : null,
    };
  }

  begin(): { url: string } {
    if (!this.configured) {
      throw new AppError(
        'youtube_not_configured',
        'Google-Client-ID oder Client-Secret fehlen in der Konfiguration.',
        409,
      );
    }
    this.cleanupPending();
    if (this.pending.size >= MAX_PENDING) {
      const oldest = [...this.pending.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      if (oldest) this.pending.delete(oldest[0]);
    }
    const state = createState();
    const { verifier, challenge } = createPkcePair();
    this.pending.set(state, { verifier, createdAt: this.now() });
    return { url: buildAuthorizationUrl(this.options.config, state, challenge) };
  }

  async complete(params: {
    code?: string;
    state?: string;
    error?: string;
  }): Promise<CallbackResult> {
    if (!this.configured) return { ok: false, reason: 'not_configured' };
    const state = params.state ?? '';
    const authorization = state ? this.pending.get(state) : undefined;
    if (!authorization) return { ok: false, reason: 'state_invalid' };
    // Single use, even when the exchange fails.
    this.pending.delete(state);

    if (params.error) {
      this.options.logger.warn({ oauth_error: params.error }, 'YouTube-Autorisierung abgebrochen');
      return { ok: false, reason: params.error === 'access_denied' ? 'cancelled' : 'exchange_failed' };
    }
    if (this.now() - authorization.createdAt > PENDING_TTL_MS) {
      return { ok: false, reason: 'state_invalid' };
    }
    if (!params.code) return { ok: false, reason: 'exchange_failed' };

    let tokens: TokenResponse;
    try {
      tokens = await exchangeCode(this.options.config, params.code, authorization.verifier);
    } catch (error) {
      this.options.logger.warn({ err: toErrorMessage(error) }, 'YouTube-Token-Austausch fehlgeschlagen');
      return { ok: false, reason: 'exchange_failed' };
    }
    if (!tokens.refresh_token) {
      this.options.logger.warn('Google hat keinen Refresh-Token geliefert');
      return { ok: false, reason: 'exchange_failed' };
    }

    const account = { channel_id: '', channel_title: '' };
    try {
      const channel = await fetchChannelInfo(tokens.access_token);
      if (channel) {
        account.channel_id = channel.id;
        account.channel_title = channel.title;
      }
    } catch (error) {
      // A missing channel does not invalidate the grant; the dashboard just
      // shows the connection without a channel name.
      this.options.logger.warn(
        { err: toErrorMessage(error) },
        'YouTube-Kanal konnte nicht gelesen werden',
      );
    }

    const timestamp = new Date(this.now()).toISOString();
    const record: YouTubeAuthRecord = {
      version: 1,
      account,
      tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope ?? '',
        token_type: tokens.token_type ?? 'Bearer',
        expiry_date: this.now() + tokens.expires_in * 1000,
      },
      connected_at: timestamp,
      updated_at: timestamp,
    };
    this.options.store.write(record);
    this.options.logger.info(
      { channel: account.channel_title || account.channel_id || 'unbekannt' },
      'YouTube-Konto verbunden',
    );
    return { ok: true };
  }

  async disconnect(): Promise<void> {
    const record = this.options.store.read();
    if (record) {
      const revoked = await revokeToken(record.tokens.refresh_token || record.tokens.access_token);
      if (!revoked) {
        this.options.logger.warn('YouTube-Token konnte nicht widerrufen werden');
      }
    }
    this.options.store.clear();
    this.refreshPromise = null;
    this.options.logger.info('YouTube-Konto getrennt');
  }

  /** Returns a valid access token, refreshing it when it is about to expire. */
  async accessToken(): Promise<string> {
    const record = this.options.store.read();
    if (!record) {
      throw new AppError('youtube_not_connected', 'Es ist kein YouTube-Konto verbunden.', 409);
    }
    if (record.tokens.expiry_date - REFRESH_MARGIN_MS > this.now()) {
      return record.tokens.access_token;
    }
    if (!this.refreshPromise) {
      this.refreshPromise = this.refresh(record).finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async refresh(record: YouTubeAuthRecord): Promise<string> {
    if (!this.configured) {
      throw new AppError(
        'youtube_not_configured',
        'Google-Client-ID oder Client-Secret fehlen in der Konfiguration.',
        409,
      );
    }
    try {
      const tokens = await refreshAccessToken(
        this.options.config,
        record.tokens.refresh_token,
      );
      const updated: YouTubeAuthRecord = {
        ...record,
        tokens: {
          ...record.tokens,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token ?? record.tokens.refresh_token,
          scope: tokens.scope ?? record.tokens.scope,
          token_type: tokens.token_type ?? record.tokens.token_type,
          expiry_date: this.now() + tokens.expires_in * 1000,
        },
        updated_at: new Date(this.now()).toISOString(),
      };
      this.options.store.write(updated);
      return updated.tokens.access_token;
    } catch (error) {
      if (isRevokedGrant(error)) {
        this.options.store.clear();
        this.options.logger.warn('YouTube-Verbindung ist abgelaufen; erneutes Verbinden nötig');
        throw new AppError(
          'youtube_reconnect_required',
          'Die YouTube-Verbindung ist abgelaufen. Bitte das Konto erneut verbinden.',
          409,
        );
      }
      throw error;
    }
  }

  private cleanupPending(): void {
    const cutoff = this.now() - PENDING_TTL_MS;
    for (const [state, entry] of this.pending) {
      if (entry.createdAt < cutoff) this.pending.delete(state);
    }
  }
}
