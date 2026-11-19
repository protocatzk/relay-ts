import { z } from 'zod';
import {
  OverlaysSettingsSchema,
  PlaylistSchema,
  PlaylistUpdateSchema,
  SettingsSchema,
  StreamerSchema,
  StreamerUpdateSchema,
} from '../core/config/schema.js';
import { VERSION } from '../version.js';

type Schema = Record<string, unknown>;
type Operation = Record<string, unknown>;

const STATUS_STATES = [
  'idle',
  'starting',
  'live',
  'reconnecting',
  'paused',
  'stopping',
  'error',
] as const;
const PERIODS = ['today', '24h', '7d', '30d', 'all'] as const;

function schemaOf(schema: z.ZodTypeAny): Schema {
  const converted = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
  }) as Record<string, unknown>;
  const { $schema: _schema, ...rest } = converted;
  return rest;
}

function ref(name: string): Schema {
  return { $ref: `#/components/schemas/${name}` };
}

function errorResponse(description: string): Schema {
  return {
    description,
    content: { 'application/json': { schema: ref('Error') } },
  };
}

function jsonResponse(schema: Schema | string, description = 'OK'): Schema {
  return {
    description,
    content: {
      'application/json': { schema: typeof schema === 'string' ? ref(schema) : schema },
    },
  };
}

function binaryResponse(contentType: string, description = 'OK'): Schema {
  return {
    description,
    content: { [contentType]: { schema: { type: 'string', format: 'binary' } } },
  };
}

function body(schema: Schema | string, contentType = 'application/json'): Schema {
  return {
    required: true,
    content: {
      [contentType]: { schema: typeof schema === 'string' ? ref(schema) : schema },
    },
  };
}

function pathParameters(path: string): Schema[] {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => ({
    name: match[1] ?? '',
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
}

const LoginBody = z.object({ password: z.string().min(1) });
const TelegramCheckBody = z.object({ token: z.string().min(1) });
const ChatTestBody = z.object({
  username: z.string().max(40).optional(),
  text: z.string().max(300).optional(),
});
const EarningsPeriodBody = z.object({ period: z.enum(PERIODS) });
const QuickStartBody = z.object({
  tiktok: z.string().min(1),
  youtube_key: z.string().min(1),
  name: z.string().optional(),
  quality: z.enum(['best', '1080p', '720p', '480p', '360p']).optional(),
});
const BulkAddBody = z.object({
  channels: z.array(z.string().min(1)).min(1).max(200),
  playlist_id: z.string().optional(),
});
const PausePreviewBody = z.object({
  screen: z.enum(['pause', 'startup']).optional(),
  text: z.string().max(200).optional(),
  subtext: z.string().max(200).optional(),
  color: z.string().optional(),
  background: z.string().max(500).optional(),
  font: z.string().max(500).optional(),
  text_color: z.string().max(64).optional(),
  fit: z.enum(['cover', 'contain', 'stretch']).optional(),
});
const StudioPreviewBody = z.object({
  overlays: z.unknown(),
  earnings: z.unknown().optional(),
  video_layout: z.unknown().optional(),
  video_aspect: z.enum(['9:16', '16:9', '1:1']).optional(),
  sample: z.boolean().optional(),
  max_dimension: z.number().int().min(120).max(1200).optional(),
});
const OverlaySaveBody = z.object({ overlays: OverlaysSettingsSchema });
const YouTubeAutomationBody = z.object({
  mode: z.enum(['off', 'relay_only', 'all']),
  auto_start: z.boolean().optional(),
  auto_stop: z.boolean().optional(),
});
const CreateBroadcastBody = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(5000).optional(),
  scheduled_start: z.string().min(1),
  privacy: z.enum(['public', 'unlisted', 'private']).optional(),
  enable_dvr: z.boolean().optional(),
  enable_auto_start: z.boolean().optional(),
  enable_auto_stop: z.boolean().optional(),
  streamer_id: z.string().optional(),
});
const UpdateBroadcastBody = z.object({
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(5000).optional(),
  scheduled_start: z.string().min(1).optional(),
  privacy: z.enum(['public', 'unlisted', 'private']).optional(),
});
const TransitionBody = z.object({ status: z.enum(['testing', 'live', 'complete']) });
const AssignBody = z.object({ streamer_id: z.string().min(1) });

const LogQuery = z.object({
  limit: z.number().int().min(1).max(2000).optional(),
  level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  q: z.string().max(200).optional(),
});
const EarningsHistoryQuery = z.object({
  period: z.enum(PERIODS).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

function queryParams(schema: z.ZodObject<z.ZodRawShape>): Schema[] {
  const properties = (z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
  }) as { properties?: Record<string, { type?: string; enum?: unknown[] }> }).properties;
  return Object.entries(properties ?? {}).map(([name, value]) => ({
    name,
    in: 'query',
    required: false,
    schema: {
      type: value.type ?? 'string',
      ...(value.enum ? { enum: value.enum } : {}),
    },
  }));
}

interface RouteDoc {
  method: 'get' | 'post' | 'put' | 'delete';
  path: string;
  tag: string;
  summary: string;
  public?: boolean;
  body?: Schema | string;
  bodyContentType?: string;
  response?: Schema | string;
  responseDescription?: string;
  responseType?: string;
  status?: number;
  query?: Schema[];
  parameters?: Schema[];
}

const routes: RouteDoc[] = [
  // Auth
  {
    method: 'get',
    path: '/api/auth/methods',
    tag: 'auth',
    summary: 'Verfügbare Anmeldemethoden',
    public: true,
    response: ref('AuthMethods'),
  },
  {
    method: 'post',
    path: '/api/auth/login',
    tag: 'auth',
    summary: 'Mit Passwort oder API-Token anmelden',
    public: true,
    body: schemaOf(LoginBody),
  },
  {
    method: 'post',
    path: '/api/auth/telegram/request',
    tag: 'auth',
    summary: 'Telegram-Login anfordern',
    public: true,
    response: ref('TelegramLoginRequest'),
  },
  {
    method: 'post',
    path: '/api/auth/telegram/check',
    tag: 'auth',
    summary: 'Status einer Telegram-Anmeldung prüfen',
    public: true,
    body: schemaOf(TelegramCheckBody),
  },
  { method: 'post', path: '/api/auth/logout', tag: 'auth', summary: 'Sitzung abmelden', response: 'Ok' },
  { method: 'get', path: '/api/auth/sessions', tag: 'auth', summary: 'Aktive Sitzungen auflisten' },
  {
    method: 'post',
    path: '/api/auth/sessions/:id/revoke',
    tag: 'auth',
    summary: 'Einzelne Sitzung widerrufen',
    response: 'Ok',
  },
  {
    method: 'post',
    path: '/api/auth/sessions/revoke-all',
    tag: 'auth',
    summary: 'Alle Sitzungen widerrufen',
  },
  {
    method: 'get',
    path: '/api/auth/me',
    tag: 'auth',
    summary: 'Aktuellen Auth-Status abfragen',
    public: true,
    response: ref('AuthMe'),
  },

  // System
  {
    method: 'get',
    path: '/health',
    tag: 'system',
    summary: 'Health-Check mit Stream-Status',
    public: true,
    response: ref('Health'),
  },
  { method: 'get', path: '/api/status', tag: 'system', summary: 'Vollständiger Stream-Status', response: 'Status' },
  { method: 'get', path: '/api/metrics', tag: 'system', summary: 'JSON-Metriken' },
  {
    method: 'get',
    path: '/api/events',
    tag: 'system',
    summary: 'Server-Sent Events (status, streamers, log)',
    responseType: 'text/event-stream',
    response: { type: 'string' },
  },
  {
    method: 'get',
    path: '/api/logs',
    tag: 'system',
    summary: 'Logzeilen lesen und filtern',
    query: queryParams(LogQuery),
  },
  { method: 'delete', path: '/api/logs', tag: 'system', summary: 'Lokalen Logring leeren', response: 'Ok' },
  { method: 'post', path: '/api/reload', tag: 'system', summary: 'Streamer-YAML neu laden' },
  { method: 'post', path: '/api/online/check', tag: 'system', summary: 'Online-Status sofort prüfen', response: 'Ok' },
  {
    method: 'post',
    path: '/api/system/restart-sink',
    tag: 'system',
    summary: 'YouTube-Sink neu starten',
    response: ref('StatusEnvelope'),
  },
  {
    method: 'post',
    path: '/api/system/refresh',
    tag: 'system',
    summary: 'Quelle sofort neu auflösen',
    response: ref('StatusEnvelope'),
  },
  {
    method: 'get',
    path: '/api/openapi.json',
    tag: 'system',
    summary: 'OpenAPI-Spezifikation dieser API',
    response: { type: 'object' },
  },

  // Streamers
  {
    method: 'get',
    path: '/api/streamers',
    tag: 'streamers',
    summary: 'Streamer inklusive Live-Status auflisten',
    response: ref('StreamerList'),
  },
  {
    method: 'post',
    path: '/api/streamers',
    tag: 'streamers',
    summary: 'Streamer anlegen',
    body: 'Streamer',
    status: 201,
    response: ref('StreamerEnvelope'),
  },
  {
    method: 'get',
    path: '/api/streamers/:id',
    tag: 'streamers',
    summary: 'Einzelnen Streamer lesen',
    response: ref('StreamerEnvelope'),
  },
  {
    method: 'put',
    path: '/api/streamers/:id',
    tag: 'streamers',
    summary: 'Streamer bearbeiten',
    body: 'StreamerUpdate',
    response: ref('StreamerEnvelope'),
  },
  { method: 'delete', path: '/api/streamers/:id', tag: 'streamers', summary: 'Streamer löschen', response: 'Ok' },
  {
    method: 'get',
    path: '/api/streamers/:id/title',
    tag: 'streamers',
    summary: 'Aufgelösten YouTube-Titel anzeigen',
  },
  {
    method: 'post',
    path: '/api/streamers/:id/start',
    tag: 'streamers',
    summary: 'Streamer starten',
    response: ref('StatusEnvelope'),
  },
  {
    method: 'post',
    path: '/api/streamers/:id/stop',
    tag: 'streamers',
    summary: 'Stream stoppen',
    response: ref('StatusEnvelope'),
  },
  {
    method: 'post',
    path: '/api/streamers/:id/switch',
    tag: 'streamers',
    summary: 'Zu einem Streamer wechseln',
    response: ref('StatusEnvelope'),
  },
  {
    method: 'post',
    path: '/api/streamers/bulk',
    tag: 'streamers',
    summary: 'Streamer aus Handles/URLs anlegen',
    body: schemaOf(BulkAddBody),
    status: 201,
  },
  {
    method: 'post',
    path: '/api/quickstart',
    tag: 'streamers',
    summary: 'Streamer anlegen und direkt starten',
    body: schemaOf(QuickStartBody),
    status: 201,
    response: ref('StatusEnvelope'),
  },

  // Playlists
  {
    method: 'get',
    path: '/api/playlists',
    tag: 'playlists',
    summary: 'Playlists auflisten',
    response: ref('PlaylistList'),
  },
  {
    method: 'post',
    path: '/api/playlists',
    tag: 'playlists',
    summary: 'Playlist anlegen',
    body: 'Playlist',
    status: 201,
    response: ref('PlaylistEnvelope'),
  },
  {
    method: 'put',
    path: '/api/playlists/:id',
    tag: 'playlists',
    summary: 'Playlist bearbeiten',
    body: 'PlaylistUpdate',
    response: ref('PlaylistEnvelope'),
  },
  { method: 'delete', path: '/api/playlists/:id', tag: 'playlists', summary: 'Playlist löschen', response: 'Ok' },
  {
    method: 'post',
    path: '/api/playlists/next',
    tag: 'playlists',
    summary: 'Nächsten Playlist-Kanal starten',
    response: ref('StatusEnvelope'),
  },
  {
    method: 'post',
    path: '/api/playlists/previous',
    tag: 'playlists',
    summary: 'Vorherigen Playlist-Kanal starten',
    response: ref('StatusEnvelope'),
  },
  {
    method: 'post',
    path: '/api/playlists/stop',
    tag: 'playlists',
    summary: 'Playlist stoppen',
    response: ref('StatusEnvelope'),
  },
  {
    method: 'post',
    path: '/api/playlists/:id/play',
    tag: 'playlists',
    summary: 'Playlist abspielen',
    response: ref('StatusEnvelope'),
  },
  {
    method: 'post',
    path: '/api/playlists/:id/tune/:streamerId',
    tag: 'playlists',
    summary: 'Playlist auf einen Kanal stimmen',
    response: ref('StatusEnvelope'),
  },

  // Settings & overlays
  { method: 'get', path: '/api/settings', tag: 'settings', summary: 'Einstellungen lesen', response: 'Settings' },
  {
    method: 'put',
    path: '/api/settings',
    tag: 'settings',
    summary: 'Einstellungen aktualisieren',
    body: 'SettingsUpdate',
    response: 'Settings',
  },
  {
    method: 'put',
    path: '/api/overlays',
    tag: 'overlays',
    summary: 'Globale Overlays speichern',
    body: schemaOf(OverlaySaveBody),
    response: 'Settings',
  },
  {
    method: 'get',
    path: '/api/overlays/preview.png',
    tag: 'overlays',
    summary: 'Overlay-Vorschau als PNG',
    responseType: 'image/png',
    response: { type: 'string' },
    query: [
      { name: 'sample', in: 'query', required: false, schema: { type: 'boolean' } },
    ],
  },
  {
    method: 'post',
    path: '/api/overlays/studio.png',
    tag: 'overlays',
    summary: 'Studio-Vorschau aus ungespeicherten Drafts',
    body: schemaOf(StudioPreviewBody),
    responseType: 'image/png',
    response: { type: 'string' },
  },
  {
    method: 'post',
    path: '/api/pause/preview.png',
    tag: 'overlays',
    summary: 'Pause-/Startbildschirm-Vorschau',
    body: schemaOf(PausePreviewBody),
    responseType: 'image/png',
    response: { type: 'string' },
  },

  // Screens & pause assets
  {
    method: 'post',
    path: '/api/pause/start',
    tag: 'screens',
    summary: 'Pausenscreen einspielen',
    response: ref('StatusEnvelope'),
  },
  {
    method: 'post',
    path: '/api/pause/stop',
    tag: 'screens',
    summary: 'Pausenscreen beenden',
    response: ref('StatusEnvelope'),
  },
  {
    method: 'post',
    path: '/api/screens/:type/start',
    tag: 'screens',
    summary: 'Start- oder Pausenscreen einspielen',
    parameters: [
      {
        name: 'type',
        in: 'path',
        required: true,
        schema: { type: 'string', enum: ['startup', 'pause'] },
      },
    ],
    response: ref('StatusEnvelope'),
  },
  {
    method: 'post',
    path: '/api/screens/stop',
    tag: 'screens',
    summary: 'Manuellen Screen beenden',
    response: ref('StatusEnvelope'),
  },
  { method: 'get', path: '/api/pause/assets', tag: 'screens', summary: 'Pause-/Start-Assets auflisten' },
  {
    method: 'post',
    path: '/api/pause/assets',
    tag: 'screens',
    summary: 'Pause-/Start-Asset hochladen',
    body: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
    bodyContentType: 'multipart/form-data',
    responseDescription: 'Asset-Metadaten',
  },
  {
    method: 'get',
    path: '/api/pause/assets/:filename',
    tag: 'screens',
    summary: 'Pause-/Start-Asset herunterladen',
    responseType: 'application/octet-stream',
    response: { type: 'string' },
  },
  {
    method: 'delete',
    path: '/api/pause/assets/:filename',
    tag: 'screens',
    summary: 'Pause-/Start-Asset löschen',
    response: 'Ok',
  },

  // Earnings, chat, media, preview
  { method: 'get', path: '/api/earnings', tag: 'earnings', summary: 'Aktuelle Einnahmen', response: 'Earnings' },
  {
    method: 'get',
    path: '/api/earnings/history',
    tag: 'earnings',
    summary: 'Einnahmen-Verlauf',
    query: queryParams(EarningsHistoryQuery),
  },
  {
    method: 'post',
    path: '/api/earnings/period',
    tag: 'earnings',
    summary: 'Einnahmen-Zeitraum ändern',
    body: schemaOf(EarningsPeriodBody),
  },
  {
    method: 'post',
    path: '/api/earnings/refresh',
    tag: 'earnings',
    summary: 'Einnahmen sofort aktualisieren',
  },
  {
    method: 'post',
    path: '/api/chat/test',
    tag: 'overlays',
    summary: 'Testnachricht an das Chat-Overlay senden',
    body: schemaOf(ChatTestBody),
  },
  { method: 'get', path: '/api/media', tag: 'media', summary: 'Lokale Videos in data/media auflisten' },
  {
    method: 'get',
    path: '/api/media/:filename',
    tag: 'media',
    summary: 'Lokales Video streamen',
    responseType: 'video/mp4',
    response: { type: 'string' },
  },
  {
    method: 'get',
    path: '/api/preview.ts',
    tag: 'preview',
    summary: 'MPEG-TS-Tap der Live-Vorschau',
    responseType: 'video/mp2t',
    response: { type: 'string' },
  },

  // YouTube
  { method: 'get', path: '/api/youtube/status', tag: 'youtube', summary: 'YouTube-Verbindungsstatus' },
  {
    method: 'put',
    path: '/api/youtube/automation',
    tag: 'youtube',
    summary: 'YouTube-Automatik konfigurieren',
    body: schemaOf(YouTubeAutomationBody),
  },
  { method: 'get', path: '/api/youtube/broadcasts', tag: 'youtube', summary: 'Broadcasts auflisten' },
  {
    method: 'post',
    path: '/api/youtube/broadcasts',
    tag: 'youtube',
    summary: 'Broadcast anlegen',
    body: schemaOf(CreateBroadcastBody),
  },
  {
    method: 'put',
    path: '/api/youtube/broadcasts/:id',
    tag: 'youtube',
    summary: 'Broadcast bearbeiten',
    body: schemaOf(UpdateBroadcastBody),
  },
  {
    method: 'post',
    path: '/api/youtube/broadcasts/:id/publish',
    tag: 'youtube',
    summary: 'Broadcast veröffentlichen',
  },
  {
    method: 'post',
    path: '/api/youtube/broadcasts/:id/transition',
    tag: 'youtube',
    summary: 'Broadcast-Status wechseln',
    body: schemaOf(TransitionBody),
  },
  {
    method: 'post',
    path: '/api/youtube/broadcasts/:id/assign',
    tag: 'youtube',
    summary: 'Broadcast einem Streamer zuweisen',
    body: schemaOf(AssignBody),
  },
  {
    method: 'delete',
    path: '/api/youtube/broadcasts/:id',
    tag: 'youtube',
    summary: 'Broadcast löschen',
    response: 'Ok',
  },
  { method: 'get', path: '/api/youtube/oauth/start', tag: 'youtube', summary: 'Google-OAuth starten' },
  {
    method: 'get',
    path: '/api/youtube/oauth/callback',
    tag: 'youtube',
    summary: 'Google-OAuth-Callback (öffentlich, State + PKCE)',
    public: true,
    status: 302,
    responseDescription: 'Weiterleitung zum Dashboard',
  },
  {
    method: 'post',
    path: '/api/youtube/oauth/disconnect',
    tag: 'youtube',
    summary: 'YouTube-Verbindung trennen',
  },
];

const paths: Record<string, Record<string, Operation>> = {};
for (const route of routes) {
  const manualParameters = route.parameters ?? [];
  const manualNames = new Set(manualParameters.map((parameter) => parameter.name));
  const operation: Operation = {
    tags: [route.tag],
    summary: route.summary,
    ...(route.public ? { security: [] } : {}),
    parameters: [
      ...pathParameters(route.path).filter((parameter) => !manualNames.has(parameter.name)),
      ...manualParameters,
      ...(route.query ?? []),
    ],
    ...(route.body
      ? {
          requestBody: body(route.body, route.bodyContentType),
        }
      : {}),
    responses: {
      [route.status ?? 200]: route.responseType
        ? {
            description: route.responseDescription ?? 'OK',
            content: {
              [route.responseType]: {
                schema: route.response ?? { type: 'string' },
              },
            },
          }
        : route.response
          ? jsonResponse(route.response, route.responseDescription)
          : {
              description: route.responseDescription ?? 'OK',
            },
      ...(route.public ? {} : { 401: errorResponse('Nicht authentifiziert') }),
      ...(route.body ? { 400: errorResponse('Ungültige Anfrage') } : {}),
    },
  };
  paths[route.path] ??= {};
  paths[route.path][route.method] = operation;
}

const components = {
  schemas: {
    Error: {
      type: 'object',
      required: ['error'],
      properties: {
        error: {
          type: 'object',
          required: ['code', 'message'],
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
            details: { type: 'array', items: {} },
          },
        },
      },
    },
    Ok: {
      type: 'object',
      properties: { ok: { type: 'boolean', example: true } },
    },
    Status: {
      type: 'object',
      required: ['state', 'version'],
      properties: {
        state: { type: 'string', enum: [...STATUS_STATES] },
        active_streamer_id: { type: ['string', 'null'] },
        active_streamer_name: { type: ['string', 'null'] },
        manual_screen: { type: ['string', 'null'], enum: ['startup', 'pause', null] },
        uptime_seconds: { type: 'number' },
        started_at: { type: ['string', 'null'], format: 'date-time' },
        source: { type: 'object' },
        relay: { type: 'object' },
        sink: { type: 'object' },
        watchdog: { type: 'object' },
        auto_refresh: { type: 'object' },
        chat: { type: 'object' },
        earnings: { type: ['object', 'null'] },
        version: { type: 'string', example: VERSION },
      },
    },
    StatusEnvelope: {
      type: 'object',
      required: ['ok', 'status'],
      properties: { ok: { type: 'boolean' }, status: ref('Status') },
    },
    Health: {
      type: 'object',
      required: ['status', 'version', 'state'],
      properties: {
        status: { type: 'string', example: 'ok' },
        version: { type: 'string', example: VERSION },
        uptime_seconds: { type: 'number' },
        state: { type: 'string', enum: [...STATUS_STATES] },
        source: { type: 'object' },
        relay: { type: 'object' },
        sink: { type: 'object' },
        pause: { type: 'object' },
      },
    },
    AuthMethods: {
      type: 'object',
      properties: {
        auth_required: { type: 'boolean' },
        password_auth: { type: 'boolean' },
        telegram_auth: { type: 'boolean' },
        telegram_bot_username: { type: 'string' },
      },
    },
    AuthMe: {
      type: 'object',
      properties: {
        authenticated: { type: 'boolean' },
        auth_required: { type: 'boolean' },
        version: { type: 'string' },
        user: { type: ['string', 'null'] },
      },
    },
    TelegramLoginRequest: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        bot_username: { type: 'string' },
        deep_link: { type: 'string' },
        expires_in: { type: 'number', example: 600 },
      },
    },
    Streamer: schemaOf(StreamerSchema),
    StreamerUpdate: schemaOf(StreamerUpdateSchema),
    StreamerList: {
      type: 'object',
      required: ['streamers'],
      properties: { streamers: { type: 'array', items: ref('Streamer') } },
    },
    StreamerEnvelope: {
      type: 'object',
      required: ['streamer'],
      properties: { streamer: ref('Streamer') },
    },
    Playlist: schemaOf(PlaylistSchema),
    PlaylistUpdate: schemaOf(PlaylistUpdateSchema),
    PlaylistList: {
      type: 'object',
      required: ['playlists'],
      properties: { playlists: { type: 'array', items: ref('Playlist') } },
    },
    PlaylistEnvelope: {
      type: 'object',
      required: ['playlist'],
      properties: { playlist: ref('Playlist') },
    },
    Settings: schemaOf(SettingsSchema),
    SettingsUpdate: schemaOf(SettingsSchema.partial()),
    Earnings: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        status: { type: 'string' },
        net: { type: ['number', 'null'] },
        gross: { type: ['number', 'null'] },
        coins: { type: ['number', 'null'] },
        currency: { type: 'string' },
      },
    },
  },
  securitySchemes: {
    cookieAuth: {
      type: 'apiKey',
      in: 'cookie',
      name: 'relay_session',
    },
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'API-Token',
    },
    basicAuth: {
      type: 'http',
      scheme: 'basic',
    },
  },
  responses: {
    Unauthorized: errorResponse('Nicht authentifiziert'),
    BadRequest: errorResponse('Ungültige Anfrage'),
  },
};

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'RELAY Restreamer API',
    version: VERSION,
    description:
      'HTTP-API des RELAY-Restreamers. Authentifizierung per Session-Cookie, ' +
      'Bearer-API-Token oder Basic Auth. Secrets werden in Antworten durch *_set-Flags ersetzt.',
  },
  servers: [{ url: '/', description: 'Aktuelle Instanz' }],
  tags: [
    { name: 'auth', description: 'Anmeldung und Sitzungen' },
    { name: 'system', description: 'Status, Logs, Metriken und Systemaktionen' },
    { name: 'streamers', description: 'Streamer-Verwaltung und Steuerung' },
    { name: 'playlists', description: 'Playlist-Verwaltung und Steuerung' },
    { name: 'settings', description: 'Globale Einstellungen' },
    { name: 'overlays', description: 'Overlays, Vorschauen und Chat-Test' },
    { name: 'screens', description: 'Pause-/Startbildschirme und Assets' },
    { name: 'earnings', description: 'Einnahmen und Verlauf' },
    { name: 'media', description: 'Lokale Videos' },
    { name: 'preview', description: 'Live-Vorschau' },
    { name: 'youtube', description: 'YouTube-Verbindung und Broadcasts' },
  ],
  security: [{ cookieAuth: [] }, { bearerAuth: [] }, { basicAuth: [] }],
  paths,
  components,
};
