import type { Logger } from 'pino';
import { AppError, NotFoundError, ValidationError, toErrorMessage } from '../../utils/errors.js';
import type { YouTubeAuthRecord, YouTubeAuthStore } from './auth-store.js';
import {
  bindBroadcast,
  deleteBroadcast,
  fetchChannelInfo,
  getBroadcast,
  insertBroadcast,
  insertLiveStream,
  listBroadcasts,
  listLiveStreams,
  transitionBroadcast,
  updateBroadcast,
  type BroadcastUpdateBody,
  type LiveBroadcastResource,
  type LiveStreamResource,
} from './client.js';
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

export interface BroadcastSummary {
  id: string;
  title: string;
  description: string;
  status: string;
  privacy: string;
  scheduled_start: string | null;
  actual_start: string | null;
  actual_end: string | null;
  bound_stream_id: string | null;
  stream_status: string | null;
  stream_health: string | null;
  thumbnail_url: string | null;
  watch_url: string;
}

export interface BroadcastList {
  items: BroadcastSummary[];
  fetched_at: string;
}

export interface CreateBroadcastInput {
  title: string;
  description?: string;
  scheduled_start: string;
  privacy: 'public' | 'unlisted' | 'private';
  enable_dvr?: boolean;
  enable_auto_start?: boolean;
  enable_auto_stop?: boolean;
}

export interface UpdateBroadcastInput {
  title?: string;
  description?: string;
  scheduled_start?: string;
  privacy?: 'public' | 'unlisted' | 'private';
}

export type BroadcastTransition = 'testing' | 'live' | 'complete';

const BROADCAST_STATUS_ORDER: Record<string, number> = {
  live: 0,
  testing: 1,
  ready: 2,
  created: 3,
  complete: 4,
  revoked: 5,
};
const BROADCAST_CACHE_MS = 20_000;

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
  private broadcastsCache: { at: number; data: BroadcastList } | null = null;
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
    this.broadcastsCache = null;
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
    this.broadcastsCache = null;
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

  /**
   * Lists scheduled, live and completed broadcasts of the connected channel.
   * Responses are cached briefly because every call costs API quota.
   */
  async broadcasts(): Promise<BroadcastList> {
    if (this.broadcastsCache && this.now() - this.broadcastsCache.at < BROADCAST_CACHE_MS) {
      return this.broadcastsCache.data;
    }
    const token = await this.accessToken();
    const [broadcasts, streams] = await Promise.all([
      listBroadcasts(token),
      listLiveStreams(token).catch((error) => {
        this.options.logger.warn(
          { err: toErrorMessage(error) },
          'YouTube-Streams konnten nicht geladen werden',
        );
        return [] as LiveStreamResource[];
      }),
    ]);
    const data: BroadcastList = {
      items: broadcasts
        .map((broadcast) => mapBroadcast(broadcast, streams))
        .sort(compareBroadcasts),
      fetched_at: new Date(this.now()).toISOString(),
    };
    this.broadcastsCache = { at: this.now(), data };
    return data;
  }

  async createBroadcast(
    input: CreateBroadcastInput,
    streamerKey?: string,
  ): Promise<BroadcastSummary> {
    const token = await this.accessToken();
    const scheduledStartTime = normalizeScheduled(input.scheduled_start);
    const stream = streamerKey
      ? await this.findStreamForKey(token, streamerKey)
      : await insertLiveStream(token, `${input.title} (RELAY)`);
    if (!stream) {
      throw new ValidationError(
        'Für den Stream-Key existiert kein YouTube-Ingest. Bitte zuerst in YouTube Studio einen Stream anlegen.',
      );
    }

    const created = await insertBroadcast(token, {
      snippet: {
        title: input.title,
        description: input.description ?? '',
        scheduledStartTime,
      },
      status: {
        privacyStatus: input.privacy,
      },
      contentDetails: {
        enableDvr: input.enable_dvr ?? true,
        enableAutoStart: input.enable_auto_start ?? false,
        enableAutoStop: input.enable_auto_stop ?? false,
        recordFromStart: true,
      },
    });

    try {
      await bindBroadcast(token, created.id, stream.id);
    } catch (error) {
      await deleteBroadcast(token, created.id).catch(() => undefined);
      throw error;
    }

    this.broadcastsCache = null;
    this.options.logger.info(
      { broadcast: created.id, stream: stream.id, privacy: input.privacy },
      'YouTube-Broadcast angelegt',
    );
    return mapBroadcast(
      { ...created, contentDetails: { boundStreamId: stream.id } },
      [stream],
    );
  }

  async updateBroadcastById(
    id: string,
    patch: UpdateBroadcastInput,
  ): Promise<BroadcastSummary> {
    const token = await this.accessToken();
    const current = await getBroadcast(token, id);
    if (!current) throw new NotFoundError('Broadcast wurde nicht gefunden');

    const body: BroadcastUpdateBody = {};
    const snippet: NonNullable<BroadcastUpdateBody['snippet']> = {};
    if (patch.title !== undefined) snippet.title = patch.title;
    if (patch.description !== undefined) snippet.description = patch.description;
    if (patch.scheduled_start !== undefined) {
      snippet.scheduledStartTime = normalizeScheduled(patch.scheduled_start);
    }
    if (Object.keys(snippet).length > 0) body.snippet = snippet;
    if (patch.privacy !== undefined) body.status = { privacyStatus: patch.privacy };

    if (!body.snippet && !body.status) {
      return mapBroadcast(current, []);
    }

    const updated = await updateBroadcast(token, id, body);
    this.broadcastsCache = null;
    this.options.logger.info({ broadcast: id }, 'YouTube-Broadcast aktualisiert');
    return mapBroadcast(
      {
        ...updated,
        contentDetails: updated.contentDetails ?? current.contentDetails,
      },
      [],
    );
  }

  /** Makes a previously unlisted broadcast public; one write costs ~50 quota units. */
  async publishBroadcast(id: string): Promise<BroadcastSummary> {
    return this.updateBroadcastById(id, { privacy: 'public' });
  }

  async transitionBroadcastById(
    id: string,
    status: BroadcastTransition,
  ): Promise<{ ok: true; status: BroadcastTransition }> {
    const token = await this.accessToken();
    try {
      await transitionBroadcast(token, id, status);
    } catch (error) {
      if (error instanceof AppError && /invalidTransition|not.*ready|state/i.test(error.message)) {
        throw new ValidationError(
          `Der Broadcast kann aktuell nicht auf "${status}" gesetzt werden. Prüfe Ingest und Status in YouTube Studio.`,
        );
      }
      throw error;
    }
    this.broadcastsCache = null;
    this.options.logger.info({ broadcast: id, status }, 'YouTube-Broadcast-Status gesetzt');
    return { ok: true, status };
  }

  async deleteBroadcastById(id: string): Promise<void> {
    const token = await this.accessToken();
    await deleteBroadcast(token, id);
    this.broadcastsCache = null;
    this.options.logger.info({ broadcast: id }, 'YouTube-Broadcast gelöscht');
  }

  async assignBroadcast(
    id: string,
    streamerKey: string,
  ): Promise<{ ok: true; stream_status: string | null }> {
    const token = await this.accessToken();
    const stream = await this.findStreamForKey(token, streamerKey);
    if (!stream) {
      throw new ValidationError(
        'Für den Stream-Key existiert kein YouTube-Ingest. Bitte zuerst in YouTube Studio einen Stream anlegen.',
      );
    }
    await bindBroadcast(token, id, stream.id);
    this.broadcastsCache = null;
    this.options.logger.info({ broadcast: id, stream: stream.id }, 'YouTube-Broadcast zugeordnet');
    return { ok: true, stream_status: stream.status?.streamStatus ?? null };
  }

  /** Best-effort: brings the broadcast bound to this key live. Never throws. */
  async onStreamStarted(streamKey: string): Promise<void> {
    if (!streamKey || !this.configured || !this.options.store.read()) return;
    try {
      const token = await this.accessToken();
      const stream = await this.findStreamForKey(token, streamKey);
      if (!stream) return;
      const broadcasts = await listBroadcasts(token);
      const candidate = broadcasts
        .filter((item) => item.contentDetails?.boundStreamId === stream.id)
        .filter((item) =>
          ['created', 'ready', 'testing'].includes(item.status?.lifeCycleStatus ?? ''),
        )
        .sort((a, b) =>
          (a.snippet?.scheduledStartTime ?? '').localeCompare(
            b.snippet?.scheduledStartTime ?? '',
          ),
        )[0];
      if (!candidate) return;
      const status = candidate.status?.lifeCycleStatus;
      if (status === 'created') {
        await transitionBroadcast(token, candidate.id, 'testing').catch(() => undefined);
      }
      await transitionBroadcast(token, candidate.id, 'live');
      this.broadcastsCache = null;
      this.options.logger.info(
        { broadcast: candidate.id },
        'YouTube-Broadcast automatisch live geschaltet',
      );
    } catch (error) {
      this.options.logger.warn(
        { err: toErrorMessage(error) },
        'YouTube-Broadcast konnte nicht automatisch gestartet werden',
      );
    }
  }

  /** Best-effort: completes live broadcasts bound to a key that is no longer used. */
  async onStreamStopped(streamKey: string): Promise<void> {
    if (!streamKey || !this.configured || !this.options.store.read()) return;
    try {
      const token = await this.accessToken();
      const stream = await this.findStreamForKey(token, streamKey);
      if (!stream) return;
      const broadcasts = await listBroadcasts(token);
      const live = broadcasts.filter(
        (item) =>
          item.contentDetails?.boundStreamId === stream.id &&
          ['live', 'testing'].includes(item.status?.lifeCycleStatus ?? ''),
      );
      for (const item of live) {
        await transitionBroadcast(token, item.id, 'complete').catch(() => undefined);
      }
      if (live.length > 0) this.broadcastsCache = null;
    } catch (error) {
      this.options.logger.warn(
        { err: toErrorMessage(error) },
        'YouTube-Broadcast konnte nicht automatisch beendet werden',
      );
    }
  }

  private async findStreamForKey(
    accessToken: string,
    streamKey: string,
  ): Promise<LiveStreamResource | null> {
    const streams = await listLiveStreams(accessToken);
    return streams.find((item) => item.cdn?.ingestionInfo?.streamName === streamKey) ?? null;
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

function normalizeScheduled(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError('Die Startzeit ist ungültig');
  }
  return date.toISOString();
}

function mapBroadcast(
  broadcast: LiveBroadcastResource,
  streams: LiveStreamResource[],
): BroadcastSummary {
  const boundStreamId = broadcast.contentDetails?.boundStreamId ?? null;
  const stream = boundStreamId ? streams.find((item) => item.id === boundStreamId) : undefined;
  return {
    id: broadcast.id,
    title: broadcast.snippet?.title ?? '',
    description: broadcast.snippet?.description ?? '',
    status: broadcast.status?.lifeCycleStatus ?? 'created',
    privacy: broadcast.status?.privacyStatus ?? 'private',
    scheduled_start: broadcast.snippet?.scheduledStartTime ?? null,
    actual_start: broadcast.snippet?.actualStartTime ?? null,
    actual_end: broadcast.snippet?.actualEndTime ?? null,
    bound_stream_id: boundStreamId,
    stream_status: stream?.status?.streamStatus ?? null,
    stream_health: stream?.status?.healthStatus?.status ?? null,
    thumbnail_url: broadcast.snippet?.thumbnails?.default?.url ?? null,
    watch_url: `https://www.youtube.com/watch?v=${broadcast.id}`,
  };
}

function compareBroadcasts(a: BroadcastSummary, b: BroadcastSummary): number {
  const rank = (BROADCAST_STATUS_ORDER[a.status] ?? 9) - (BROADCAST_STATUS_ORDER[b.status] ?? 9);
  if (rank !== 0) return rank;
  const time = (item: BroadcastSummary): string =>
    item.actual_start ?? item.scheduled_start ?? '';
  return time(b).localeCompare(time(a));
}
