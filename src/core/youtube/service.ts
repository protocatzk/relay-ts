import type { Logger } from 'pino';
import { AppError, NotFoundError, ValidationError, toErrorMessage } from '../../utils/errors.js';
import type { YouTubeAuthRecord, YouTubeAuthStore } from './auth-store.js';
import type { YouTubeBroadcastStore } from './broadcast-store.js';
import {
  automationPolicy,
  pickBroadcastToStart,
  pickBroadcastsToComplete,
  type AutomationPolicy,
  type AutomationSettings,
} from './automation.js';
import {
  bindBroadcast,
  deleteBroadcast,
  fetchActiveLiveChatId,
  fetchChannelInfo,
  getBroadcast,
  insertBroadcast,
  insertLiveStream,
  listBroadcasts,
  listLiveChatMessages,
  listLiveStreams,
  setBroadcastThumbnail,
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
  automation: YouTubeAutomationStatus;
}

export interface YouTubeAutomationStatus {
  mode: 'off' | 'relay_only' | 'all';
  auto_transition: boolean;
  auto_start: boolean;
  auto_stop: boolean;
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
  /** True when RELAY created this broadcast and may automate it. */
  relay_managed: boolean;
}

export interface BroadcastList {
  items: BroadcastSummary[];
  fetched_at: string;
}

export interface CreateBroadcastInput {
  title: string;
  description?: string;
  scheduled_start: string;
  privacy?: 'public' | 'unlisted' | 'private';
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

export interface YouTubeLiveChatMessage {
  id: string;
  author: string;
  avatar_url: string | null;
  is_moderator: boolean;
  is_owner: boolean;
  is_sponsor: boolean;
  text: string;
  published_at: string;
}

export interface YouTubeLiveChatPage {
  broadcast_id: string;
  live_chat_id: string | null;
  next_page_token: string | null;
  polling_interval_ms: number;
  offline: boolean;
  messages: YouTubeLiveChatMessage[];
}

const MIN_CHAT_POLLING_MS = 10_000;

const BROADCAST_STATUS_ORDER: Record<string, number> = {
  live: 0,
  testing: 1,
  ready: 2,
  created: 3,
  complete: 4,
  revoked: 5,
};
const BROADCAST_CACHE_MS = 20_000;
const RECENT_BROADCAST_HOLD_MS = 90_000;

interface PendingAuthorization {
  verifier: string;
  createdAt: number;
}

export interface YouTubeAuthServiceOptions {
  config: YouTubeAuthConfig;
  store: YouTubeAuthStore;
  logger: Logger;
  now?: () => number;
  /** Global automation defaults; per-broadcast overrides can be layered later. */
  automation?: () => AutomationSettings;
  /** Registry of broadcasts created through RELAY. */
  broadcasts?: YouTubeBroadcastStore;
  /** Invoked when a revoked refresh token clears the stored auth. */
  onReconnectRequired?: () => void;
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
  private readonly recentBroadcasts = new Map<string, { summary: BroadcastSummary; at: number }>();
  private readonly recentTransitions = new Map<string, { status: BroadcastTransition; at: number }>();
  private readonly liveChatIdCache = new Map<string, string>();
  private readonly now: () => number;

  constructor(private readonly options: YouTubeAuthServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  get configured(): boolean {
    const { clientId, clientSecret } = this.options.config;
    return Boolean(clientId && clientSecret);
  }

  private policy(): AutomationPolicy {
    return automationPolicy(
      this.options.automation?.() ?? {
        auto_transition: true,
        auto_mode: 'relay_only',
        auto_start: true,
        auto_stop: true,
        default_privacy: 'unlisted',
        default_dvr: true,
      },
    );
  }

  private get defaults(): { privacy: 'public' | 'unlisted' | 'private'; dvr: boolean } {
    const settings = this.options.automation?.();
    return {
      privacy: settings?.default_privacy ?? 'unlisted',
      dvr: settings?.default_dvr ?? true,
    };
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
      automation: this.automationStatus(),
    };
  }

  automationStatus(): YouTubeAutomationStatus {
    const settings = this.options.automation?.() ?? {
      auto_transition: true,
      auto_mode: 'relay_only' as const,
      auto_start: true,
      auto_stop: true,
      default_privacy: 'unlisted' as const,
      default_dvr: true,
    };
    return {
      mode: settings.auto_transition ? (settings.auto_mode ?? 'relay_only') : 'off',
      auto_transition: settings.auto_transition,
      auto_start: settings.auto_start,
      auto_stop: settings.auto_stop,
    };
  }

  begin(redirectUriOverride?: string): { url: string } {
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
    const configured = this.options.config.redirectUri;
    const isLocalDefault = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(configured);
    const redirectUri = redirectUriOverride && isLocalDefault ? redirectUriOverride : configured;
    const state = createState();
    const { verifier, challenge } = createPkcePair();
    this.pending.set(state, { verifier, createdAt: this.now(), redirectUri } as {
      verifier: string;
      createdAt: number;
      redirectUri?: string;
    });
    return {
      url: buildAuthorizationUrl({ ...this.options.config, redirectUri }, state, challenge),
    };
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
      const redirectUri =
        (authorization as { redirectUri?: string }).redirectUri ?? this.options.config.redirectUri;
      tokens = await exchangeCode(
        { ...this.options.config, redirectUri },
        params.code,
        authorization.verifier,
      );
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
    this.recentBroadcasts.clear();
    this.recentTransitions.clear();
    this.liveChatIdCache.clear();
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
    const now = this.now();
    this.pruneRecentBroadcasts(now);
    const managed = this.options.broadcasts?.ids();
    const byId = new Map<string, BroadcastSummary>();

    for (const broadcast of broadcasts) {
      const recentTransition = this.recentTransitions.get(broadcast.id);
      const mapped = mapBroadcast(broadcast, streams);
      const summary: BroadcastSummary = {
        ...mapped,
        status:
          recentTransition && now - recentTransition.at < RECENT_BROADCAST_HOLD_MS
            ? recentTransition.status
            : mapped.status,
        relay_managed: managed?.has(broadcast.id) ?? false,
      };
      byId.set(summary.id, summary);
      this.recentBroadcasts.set(summary.id, { summary, at: now });
    }

    // YouTube's mine=true broadcast list has eventual consistency right after a
    // state transition (created/ready -> testing -> live) or creation and can
    // briefly omit the broadcast. Preserve recently known broadcasts so they do
    // not disappear from the dashboard while transitioning.
    for (const [id, entry] of this.recentBroadcasts) {
      if (byId.has(id) || now - entry.at >= RECENT_BROADCAST_HOLD_MS) continue;
      const recentTransition = this.recentTransitions.get(id);
      byId.set(id, {
        ...entry.summary,
        status:
          recentTransition && now - recentTransition.at < RECENT_BROADCAST_HOLD_MS
            ? recentTransition.status
            : entry.summary.status,
        relay_managed: managed?.has(id) ?? entry.summary.relay_managed,
      });
    }

    const data: BroadcastList = {
      items: Array.from(byId.values()).sort(compareBroadcasts),
      fetched_at: new Date(now).toISOString(),
    };
    this.broadcastsCache = { at: now, data };
    return data;
  }

  private rememberCachedBroadcasts(now = this.now()): void {
    if (!this.broadcastsCache) return;
    for (const item of this.broadcastsCache.data.items) {
      this.recentBroadcasts.set(item.id, { summary: item, at: now });
    }
  }

  private pruneRecentBroadcasts(now = this.now()): void {
    for (const [id, entry] of this.recentBroadcasts) {
      if (now - entry.at >= RECENT_BROADCAST_HOLD_MS) {
        this.recentBroadcasts.delete(id);
      }
    }
    for (const [id, entry] of this.recentTransitions) {
      if (now - entry.at >= RECENT_BROADCAST_HOLD_MS) {
        this.recentTransitions.delete(id);
      }
    }
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
        privacyStatus: input.privacy ?? this.defaults.privacy,
      },
      contentDetails: {
        enableDvr: input.enable_dvr ?? this.defaults.dvr,
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

    this.rememberCachedBroadcasts();
    this.broadcastsCache = null;
    this.options.broadcasts?.upsert({
      id: created.id,
      stream_id: stream.id,
      title: created.snippet?.title ?? input.title,
      scheduled_start: scheduledStartTime,
      created_at: new Date(this.now()).toISOString(),
      status: created.status?.lifeCycleStatus ?? 'created',
    });
    this.options.logger.info(
      {
        broadcast: created.id,
        stream: stream.id,
        privacy: input.privacy ?? this.defaults.privacy,
      },
      'YouTube-Broadcast angelegt',
    );
    const summary: BroadcastSummary = {
      ...mapBroadcast({ ...created, contentDetails: { boundStreamId: stream.id } }, [stream]),
      relay_managed: true,
    };
    this.recentBroadcasts.set(summary.id, { summary, at: this.now() });
    return summary;
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
      return {
        ...mapBroadcast(current, []),
        relay_managed: this.options.broadcasts?.ids().has(id) ?? false,
      };
    }

    const updated = await updateBroadcast(token, id, body);
    this.rememberCachedBroadcasts();
    this.broadcastsCache = null;
    this.options.logger.info({ broadcast: id }, 'YouTube-Broadcast aktualisiert');
    const summary: BroadcastSummary = {
      ...mapBroadcast(
        {
          ...updated,
          contentDetails: updated.contentDetails ?? current.contentDetails,
        },
        [],
      ),
      relay_managed: this.options.broadcasts?.ids().has(id) ?? false,
    };
    this.recentBroadcasts.set(id, { summary, at: this.now() });
    return summary;
  }

  /** Makes a previously unlisted broadcast public; one write costs ~50 quota units. */
  async publishBroadcast(id: string): Promise<BroadcastSummary> {
    return this.updateBroadcastById(id, { privacy: 'public' });
  }

  async setBroadcastThumbnail(
    id: string,
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<{ ok: boolean; thumbnail_url: string | null }> {
    const token = await this.accessToken();
    const result = await setBroadcastThumbnail(token, id, imageBuffer, mimeType);
    this.broadcastsCache = null;
    const thumbItem = result.items?.[0];
    const thumbnailUrl =
      thumbItem?.default?.url ??
      thumbItem?.medium?.url ??
      thumbItem?.high?.url ??
      thumbItem?.standard?.url ??
      thumbItem?.maxres?.url ??
      null;

    const existing = this.recentBroadcasts.get(id);
    if (existing) {
      existing.summary.thumbnail_url = thumbnailUrl;
      this.recentBroadcasts.set(id, { ...existing, at: this.now() });
    }
    this.options.logger.info({ broadcast: id }, 'YouTube-Broadcast-Thumbnail aktualisiert');
    return { ok: true, thumbnail_url: thumbnailUrl };
  }

  async transitionBroadcastById(
    id: string,
    status: BroadcastTransition,
  ): Promise<{ ok: true; status: BroadcastTransition }> {
    const token = await this.accessToken();
    try {
      // YouTube rejects created -> live in many channel states. Going through
      // testing first mirrors the automatic start hook and is harmless if the
      // broadcast is already past that state.
      if (status === 'live') {
        await transitionBroadcast(token, id, 'testing').catch(() => undefined);
      }
      await transitionBroadcast(token, id, status);
    } catch (error) {
      if (error instanceof AppError && /invalidTransition|not.*ready|state/i.test(error.message)) {
        throw new ValidationError(
          `Der Broadcast kann aktuell nicht auf "${status}" gesetzt werden. Prüfe Ingest und Status in YouTube Studio.`,
        );
      }
      throw error;
    }
    const now = this.now();
    this.rememberCachedBroadcasts(now);
    const existing = this.recentBroadcasts.get(id);
    if (existing) {
      this.recentBroadcasts.set(id, {
        summary: {
          ...existing.summary,
          status,
          ...(status === 'live' && !existing.summary.actual_start
            ? { actual_start: new Date(now).toISOString() }
            : {}),
        },
        at: now,
      });
    } else {
      const fetched = await getBroadcast(token, id).catch(() => null);
      if (fetched) {
        this.recentBroadcasts.set(id, {
          summary: {
            ...mapBroadcast(fetched, []),
            status,
            relay_managed: this.options.broadcasts?.ids().has(id) ?? false,
          },
          at: now,
        });
      }
    }
    this.recentTransitions.set(id, { status, at: now });
    this.broadcastsCache = null;
    this.options.broadcasts?.updateStatus(id, status);
    this.options.logger.info({ broadcast: id, status }, 'YouTube-Broadcast-Status gesetzt');
    return { ok: true, status };
  }

  async deleteBroadcastById(id: string): Promise<void> {
    const token = await this.accessToken();
    await deleteBroadcast(token, id);
    this.options.broadcasts?.remove(id);
    this.recentBroadcasts.delete(id);
    this.recentTransitions.delete(id);
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
    this.options.broadcasts?.updateStream(id, stream.id);
    this.broadcastsCache = null;
    this.options.logger.info({ broadcast: id, stream: stream.id }, 'YouTube-Broadcast zugeordnet');
    return { ok: true, stream_status: stream.status?.streamStatus ?? null };
  }

  /**
   * Fetches a page of YouTube Live Chat messages for a broadcast.
   * Caches `activeLiveChatId` per broadcast and enforces a minimum polling interval
   * to keep YouTube Data API quota usage predictable.
   */
  async liveChatMessages(broadcastId: string, pageToken?: string): Promise<YouTubeLiveChatPage> {
    const token = await this.accessToken();
    let liveChatId: string | null = this.liveChatIdCache.get(broadcastId) ?? null;
    if (!liveChatId) {
      liveChatId = await fetchActiveLiveChatId(token, broadcastId);
      if (liveChatId) {
        this.liveChatIdCache.set(broadcastId, liveChatId);
      }
    }
    if (!liveChatId) {
      return {
        broadcast_id: broadcastId,
        live_chat_id: null,
        next_page_token: null,
        polling_interval_ms: 15_000,
        offline: true,
        messages: [],
      };
    }

    const page = await listLiveChatMessages(token, liveChatId, pageToken);
    const offline = Boolean(page.offlineAt);
    if (offline) {
      this.liveChatIdCache.delete(broadcastId);
    }

    const messages: YouTubeLiveChatMessage[] = [];
    for (const item of page.items ?? []) {
      const text =
        item.snippet?.displayMessage ?? item.snippet?.textMessageDetails?.messageText ?? '';
      if (!text) continue;
      messages.push({
        id: item.id,
        author: item.authorDetails?.displayName ?? 'YouTube',
        avatar_url: item.authorDetails?.profileImageUrl ?? null,
        is_moderator: Boolean(item.authorDetails?.isChatModerator),
        is_owner: Boolean(item.authorDetails?.isChatOwner),
        is_sponsor: Boolean(item.authorDetails?.isChatSponsor),
        text,
        published_at: item.snippet?.publishedAt ?? new Date(this.now()).toISOString(),
      });
    }

    return {
      broadcast_id: broadcastId,
      live_chat_id: liveChatId,
      next_page_token: page.nextPageToken ?? null,
      polling_interval_ms: Math.max(MIN_CHAT_POLLING_MS, page.pollingIntervalMillis ?? MIN_CHAT_POLLING_MS),
      offline,
      messages,
    };
  }

  /** Best-effort: brings a RELAY-managed broadcast live. Never throws. */
  async onStreamStarted(streamKey: string): Promise<void> {
    if (!streamKey || !this.configured || !this.options.store.read()) return;
    const policy = this.policy();
    if (!policy.autoTransition || !policy.autoStart) return;

    const managedIds =
      policy.mode === 'relay_only' ? (this.options.broadcasts?.ids() ?? new Set<string>()) : undefined;
    if (policy.mode === 'relay_only' && (!managedIds || managedIds.size === 0)) return;

    try {
      const token = await this.accessToken();
      const stream = await this.findStreamForKey(token, streamKey);
      if (!stream) return;
      const broadcasts = await listBroadcasts(token);

      const active = broadcasts.find(
        (item) =>
          item.contentDetails?.boundStreamId === stream.id &&
          ['live', 'testing'].includes(item.status?.lifeCycleStatus ?? ''),
      );
      if (active) return;

      const candidate = pickBroadcastToStart(broadcasts, stream.id, policy, undefined, {
        managedIds,
        now: this.now(),
      });
      if (!candidate) return;

      if (candidate.status?.lifeCycleStatus === 'created') {
        await transitionBroadcast(token, candidate.id, 'testing').catch(() => undefined);
      }
      await transitionBroadcast(token, candidate.id, 'live');
      const now = this.now();
      this.rememberCachedBroadcasts(now);
      this.recentBroadcasts.set(candidate.id, {
        summary: {
          ...mapBroadcast(candidate, [stream]),
          status: 'live',
          actual_start: candidate.snippet?.actualStartTime ?? new Date(now).toISOString(),
          relay_managed: managedIds ? managedIds.has(candidate.id) : true,
        },
        at: now,
      });
      this.recentTransitions.set(candidate.id, { status: 'live', at: now });
      this.options.broadcasts?.updateStatus(candidate.id, 'live');
      this.broadcastsCache = null;
      this.options.logger.info(
        { broadcast: candidate.id, mode: policy.mode },
        'YouTube-Broadcast automatisch live geschaltet',
      );
    } catch (error) {
      this.options.logger.warn(
        { err: toErrorMessage(error) },
        'YouTube-Broadcast konnte nicht automatisch gestartet werden',
      );
    }
  }

  /** Best-effort: completes only the broadcasts RELAY is allowed to manage. */
  async onStreamStopped(streamKey: string): Promise<void> {
    if (!streamKey || !this.configured || !this.options.store.read()) return;
    const policy = this.policy();
    if (!policy.autoTransition || !policy.autoStop) return;

    const managedIds =
      policy.mode === 'relay_only' ? (this.options.broadcasts?.ids() ?? new Set<string>()) : undefined;
    if (policy.mode === 'relay_only' && (!managedIds || managedIds.size === 0)) return;

    try {
      const token = await this.accessToken();
      const stream = await this.findStreamForKey(token, streamKey);
      if (!stream) return;
      const broadcasts = await listBroadcasts(token);
      const live = pickBroadcastsToComplete(broadcasts, stream.id, policy, undefined, {
        managedIds,
      });
      const now = this.now();
      if (live.length > 0) this.rememberCachedBroadcasts(now);
      for (const item of live) {
        await transitionBroadcast(token, item.id, 'complete')
          .then(() => {
            this.options.broadcasts?.updateStatus(item.id, 'complete');
            this.recentTransitions.set(item.id, { status: 'complete', at: now });
            const existing = this.recentBroadcasts.get(item.id);
            if (existing) {
              this.recentBroadcasts.set(item.id, {
                summary: { ...existing.summary, status: 'complete' },
                at: now,
              });
            }
          })
          .catch(() => undefined);
      }
      if (live.length > 0) this.broadcastsCache = null;
      if (live.length > 0) {
        this.options.logger.info(
          { broadcasts: live.map((item) => item.id), mode: policy.mode },
          'YouTube-Broadcasts automatisch beendet',
        );
      }
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
        this.options.onReconnectRequired?.();
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
    relay_managed: false,
  };
}

function compareBroadcasts(a: BroadcastSummary, b: BroadcastSummary): number {
  const rank = (BROADCAST_STATUS_ORDER[a.status] ?? 9) - (BROADCAST_STATUS_ORDER[b.status] ?? 9);
  if (rank !== 0) return rank;
  const time = (item: BroadcastSummary): string =>
    item.actual_start ?? item.scheduled_start ?? '';
  return time(b).localeCompare(time(a));
}
