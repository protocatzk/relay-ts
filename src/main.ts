import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { loadConfig } from './core/config/loader.js';
import { resolveStreamKey } from './core/config/schema.js';
import { EventBus } from './core/events.js';
import { StreamerStore } from './core/store/streamer-store.js';
import { SettingsService } from './core/store/settings-service.js';
import { Supervisor } from './core/supervisor/supervisor.js';
import { buildServer } from './api/server.js';
import { AuthSessionStore } from './api/session-store.js';
import { TotpStore } from './api/totp-store.js';
import { AuditLogStore } from './core/audit-log.js';
import { SceneStore } from './core/overlays/scene-store.js';
import { StreamScheduler } from './core/scheduler/scheduler.js';
import { WebhookDispatcher } from './core/notifications/webhooks.js';
import { TelegramAuthStore } from './core/telegram/auth-store.js';
import { TelegramBot } from './core/telegram/bot.js';
import { TelegramNotifyStore } from './core/telegram/notify-store.js';
import { existsSync, unlinkSync } from 'node:fs';
import { listMediaFiles, mediaFilePath } from './core/media/media-files.js';
import { ValidationError } from './utils/errors.js';
import { YouTubeAuthStore } from './core/youtube/auth-store.js';
import { YouTubeAuthService } from './core/youtube/service.js';
import { resolveRelayIngestKey } from './core/youtube/ingest.js';
import { YouTubeBroadcastStore } from './core/youtube/broadcast-store.js';
import { createLogger, type LogEntry, secretRedactor } from './utils/logger.js';
import { toErrorMessage } from './utils/errors.js';
import {
  configureVideoEncoder,
  probeVideoEncoders,
  setAvailableVideoEncoders,
} from './core/media/encoders.js';
import { VERSION } from './version.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(`Konfiguration ungültig: ${toErrorMessage(error)}`);
    process.exitCode = 1;
    return;
  }

  const bus = new EventBus();
  const { logger, ring, flush } = createLogger({
    level: config.server.logLevel,
    logFile: config.paths.logFile,
    onEntry: (entry: LogEntry) => bus.emit({ type: 'log', data: entry }),
  });

  // Probe once at startup: listing is cheap, but the short test encode with the
  // real argument set catches missing drivers/options before the first stream.
  setAvailableVideoEncoders(
    await probeVideoEncoders({
      ffmpegBin: config.media.ffmpegBin,
      preferred: config.settings.video.encoder,
      logger,
    }),
  );
  configureVideoEncoder(config.settings.video.encoder, logger);

  const redactor = secretRedactor();
  redactor.add(config.server.password);
  redactor.add(config.server.apiToken);
  redactor.add(config.telegram.botToken);
  redactor.add(config.youtube.clientSecret);
  redactor.add(config.media.tiktokSessionId);
  redactor.add(config.settings.online.api_key);
  redactor.add(config.settings.chat.api_key);
  redactor.add(config.settings.webhooks.url);
  redactor.add(config.settings.webhooks.secret);

  const store = new StreamerStore(
    config.paths.streamersFile,
    { streamers: config.streamers, playlists: config.playlists },
    logger,
  );
  for (const streamer of store.list()) {
    redactor.add(resolveStreamKey(streamer).key);
  }
  for (const playlist of store.playlists()) {
    redactor.add(resolveStreamKey(playlist).key);
  }

  const settingsService = new SettingsService(config.paths.settingsFile, config.settings, logger);
  const scenes = new SceneStore(join(config.paths.dataDir, 'scenes.json'));
  const webhooks = new WebhookDispatcher({
    getSettings: () => settingsService.get().webhooks,
    logger,
    version: VERSION,
  });
  const authSessions = new AuthSessionStore(join(config.paths.dataDir, 'sessions.json'));
  const totp = new TotpStore(join(config.paths.dataDir, 'totp.json'), {
    onSecret: (secret) => redactor.add(secret),
  });
  const audit = new AuditLogStore(join(config.paths.dataDir, 'audit.jsonl'), {
    redact: redactor.apply,
  });
  const telegramAuth = new TelegramAuthStore();
  const youtubeAuth = new YouTubeAuthService({
    config: config.youtube,
    store: new YouTubeAuthStore(join(config.paths.dataDir, 'youtube-auth.json'), logger),
    broadcasts: new YouTubeBroadcastStore(
      join(config.paths.dataDir, 'youtube-broadcasts.json'),
      logger,
    ),
    logger,
    automation: () => settingsService.get().youtube,
    onReconnectRequired: () => {
      webhooks.notify(
        'youtube_auth_required',
        'YouTube-Verbindung abgelaufen',
        'Das Google-Refresh-Token wurde widerrufen oder ist abgelaufen. Bitte im Dashboard neu verbinden.',
      );
    },
  });
  if (config.youtube.clientId) {
    logger.info(
      { connected: youtubeAuth.status().connected },
      'YouTube-Verwaltung konfiguriert',
    );
  }
  const supervisor = new Supervisor({
    config,
    settingsService,
    store,
    logger,
    bus,
    redact: redactor.apply,
    registerSecret: (secret) => redactor.add(secret),
    scenes,
    webhooks,
    youtube: {
      streamStarted: (key) => youtubeAuth.onStreamStarted(key),
      streamStopped: (key) => youtubeAuth.onStreamStopped(key),
    },
  });
  const scheduler = new StreamScheduler({
    path: join(config.paths.dataDir, 'schedules.json'),
    logger,
    audit,
    executor: {
      execute: async (rule) => {
        switch (rule.action) {
          case 'start_streamer':
            if (!rule.target_id) throw new ValidationError('Streamer-ID fehlt');
            await supervisor.start(rule.target_id);
            break;
          case 'start_playlist':
            if (!rule.target_id) throw new ValidationError('Playlist-ID fehlt');
            await supervisor.playPlaylist(rule.target_id);
            break;
          case 'start_queue':
            await supervisor.queuePlay(0);
            break;
          case 'start_screen':
            await supervisor.showScreen(rule.target_id === 'startup' ? 'startup' : 'pause');
            break;
          case 'stop':
            await supervisor.stop();
            break;
        }
      },
    },
  });
  const auditTelegram = async <T>(
    action: string,
    target: string | null,
    fn: () => Promise<T> | T,
  ): Promise<T> => {
    try {
      const value = await fn();
      audit.record({ actor: 'telegram:bot', source: 'telegram', action, target, result: 'ok' });
      return value;
    } catch (error) {
      audit.record({
        actor: 'telegram:bot',
        source: 'telegram',
        action,
        target,
        result: 'error',
        detail: toErrorMessage(error),
      });
      throw error;
    }
  };

  const telegramBot = config.server.telegramAuth
    ? new TelegramBot({
        token: config.telegram.botToken,
        allowedUserIds: config.telegram.allowedUserIds,
        dashboardUrl: config.server.publicUrl || undefined,
        auth: telegramAuth,
        logger,
        bus,
        control: {
          status: () => supervisor.buildStatus(),
          streamers: () => supervisor.streamersView(),
          playlists: () => supervisor.playlistsView(),
          start: (streamerId) => auditTelegram('stream.start', streamerId, () => supervisor.start(streamerId)),
          stop: () => auditTelegram('stream.stop', null, () => supervisor.stop()),
          playlistNext: () => auditTelegram('playlist.next', null, () => supervisor.playlistNext()),
          playlistPrevious: () => auditTelegram('playlist.previous', null, () => supervisor.playlistPrevious()),
          pause: () => auditTelegram('screen.start', 'pause', () => supervisor.pause()),
          resume: () => auditTelegram('screen.stop', null, () => supervisor.hideScreen()),
          logs: (limit) => ring.list({ limit }),
          queryLogs: (filter) => ring.list(filter),
          streamerCreate: (input) => {
            const streamer = store.create(input);
            supervisor.notifyStreamersChanged();
            return streamer;
          },
          streamerUpdate: (id, patch) => {
            const streamer = store.update(id, patch);
            supervisor.notifyStreamersChanged();
            return streamer;
          },
          streamerDelete: async (id) => {
            if (supervisor.buildStatus().active_streamer_id === id) {
              await supervisor.stop();
            }
            store.remove(id);
            supervisor.notifyStreamersChanged();
          },
          playlistCreate: (input) => {
            const playlist = store.createPlaylist(input);
            supervisor.notifyStreamersChanged();
            return playlist;
          },
          playlistUpdate: (id, patch) => {
            const playlist = store.updatePlaylist(id, patch);
            supervisor.notifyStreamersChanged();
            return playlist;
          },
          playlistDelete: async (id) => {
            if (supervisor.buildStatus().active_playlist?.id === id) {
              await supervisor.stop();
            }
            store.removePlaylist(id);
            supervisor.notifyStreamersChanged();
          },
          playlistPlay: (id) => auditTelegram('playlist.play', id, () => supervisor.playPlaylist(id)),
          settingsUpdate: async (patch) =>
            auditTelegram('settings.update', 'settings', async () => {
              const { previous, next } = settingsService.update(patch);
              await supervisor.applySettings(next, previous);
              return next;
            }),
          mediaDelete: async (filename) => {
            const path = mediaFilePath(config.paths.dataDir, filename);
            if (!path) throw new ValidationError('Ungültiger Dateiname');
            if (existsSync(path)) unlinkSync(path);
          },
          youtubeCreate: async (input) => {
            const key = input.streamer_id
              ? resolveStreamKey(store.require(input.streamer_id)).key
              : resolveRelayIngestKey(store, supervisor.buildStatus().active_streamer_id);
            if (input.streamer_id && !key) {
              throw new ValidationError('Für diesen Streamer ist kein YouTube-Key hinterlegt');
            }
            return youtubeAuth.createBroadcast(
              {
                title: input.title,
                scheduled_start: input.scheduled_start,
                privacy: input.privacy,
              },
              key,
            );
          },
          youtubeAssign: async (id, streamerId) => {
            const key = resolveStreamKey(store.require(streamerId)).key;
            if (!key) {
              throw new ValidationError('Für diesen Streamer ist kein YouTube-Key hinterlegt');
            }
            return youtubeAuth.assignBroadcast(id, key);
          },
          settings: () => {
            const current = settingsService.get();
            return {
              delay_seconds: current.delay_buffer.enabled ? current.delay_buffer.size : 0,
              pause_enabled: current.pause.enabled,
              pause_max_minutes: current.pause.max_minutes,
              pause_grace_seconds: current.pause.grace_seconds,
              startup_enabled: current.startup.enabled,
              startup_seconds: current.startup.duration_seconds,
              auto_reconnect: current.watchdog.auto_reconnect,
              auto_refresh_minutes: current.auto_refresh.interval,
              earnings_period: current.earnings.period,
              earnings_view: current.earnings.view,
              youtube_auto_transition: current.youtube.auto_transition,
              overlay_chat: current.overlays.chat.enabled,
              overlay_clock: current.overlays.clock.enabled,
              overlay_text: current.overlays.text.enabled,
            };
          },
          sessions: () =>
            authSessions.list().map((session) => ({
              id: session.id,
              user: session.user,
              provider: session.provider === 'telegram' ? 'Telegram' : 'Passwort',
              last_seen_at: new Date(session.lastSeenAt).toISOString(),
            })),
          revokeSession: (id) => authSessions.revoke(id),
          revokeAllSessions: () => authSessions.revokeAll(),
          media: () =>
            listMediaFiles(config.paths.dataDir).map((file) => ({
              filename: file.filename,
              size: file.size,
            })),
          earnings: () => {
            const snapshot = supervisor.earningsStatus();
            if (!snapshot) return null;
            return {
              period_label: snapshot.period_label,
              currency: snapshot.currency,
              net: snapshot.net,
              coins: snapshot.coins,
              viewers: snapshot.viewers,
              gifts: snapshot.gifts,
              updated_at: snapshot.last_seen_at,
            };
          },
          youtubeStatus: () => {
            const status = youtubeAuth.status();
            return {
              connected: status.connected,
              channel_title: status.account.channel_title,
            };
          },
          youtubeBroadcasts: async () =>
            (await youtubeAuth.broadcasts()).items.map((item) => ({
              id: item.id,
              title: item.title,
              status: item.status,
              privacy: item.privacy,
              scheduled_start: item.scheduled_start,
            })),
          youtubeTransition: (id, status) =>
            youtubeAuth.transitionBroadcastById(id, status),
          youtubePublish: (id) => youtubeAuth.publishBroadcast(id),
          youtubeUpdateTitle: (id, title) =>
            auditTelegram('youtube.title', id, () => youtubeAuth.updateBroadcastById(id, { title })),
          titleTemplate: () => settingsService.get().streaming.title_template,
          showScreen: (type) => auditTelegram('screen.start', type, () => supervisor.showScreen(type)),
          hideScreen: () => auditTelegram('screen.stop', null, () => supervisor.hideScreen()),
          toggleOverlay: async (key) => {
            const current = settingsService.get();
            const overlays = structuredClone(current.overlays);
            overlays[key].enabled = !overlays[key].enabled;
            const { previous, next } = settingsService.update({ overlays });
            await supervisor.applySettings(next, previous);
          },
          setEarningsPeriod: async (period) => {
            const { previous, next } = settingsService.update({ earnings: { period } });
            await supervisor.applySettings(next, previous);
          },
          scenes: () => {
            const activeId = scenes.activeId();
            return scenes.list().map((scene) => ({
              id: scene.id,
              name: scene.name,
              active: scene.id === activeId,
            }));
          },
          activateScene: (id) => auditTelegram('scene.activate', id, () => supervisor.activateScene(id)),
        },
        notify: {
          chatId: config.telegram.notifyChatId,
          store: new TelegramNotifyStore(
            join(config.paths.dataDir, 'telegram-notify.json'),
            {
              enabled: config.telegram.notifications,
              live: true,
              reconnect: true,
              error: true,
            },
            logger,
          ),
        },
      })
    : null;

  try {
    await supervisor.init();
  } catch (error) {
    logger.fatal({ err: toErrorMessage(error) }, 'Supervisor konnte nicht starten');
    await flush();
    process.exitCode = 1;
    return;
  }

  const app = await buildServer({
    config,
    logger,
    store,
    settingsService,
    supervisor,
    bus,
    ring,
    version: VERSION,
    authSessions,
    totp,
    audit,
    telegramAuth,
    telegramBot,
    youtubeAuth,
    scenes,
    scheduler,
    webhooks,
  });

  scheduler.start();
  telegramBot?.start();

  try {
    await app.listen({ host: config.server.host, port: config.server.port });
  } catch (error) {
    logger.fatal({ err: toErrorMessage(error) }, 'HTTP-Server konnte nicht starten');
    await telegramBot?.stop();
    await supervisor.shutdown();
    await flush();
    process.exitCode = 1;
    return;
  }

  logger.info(
    {
      version: VERSION,
      url: `http://${config.server.host === '0.0.0.0' ? '127.0.0.1' : config.server.host}:${config.server.port}`,
      relay: `${config.media.relayHost}:${config.media.relayPort}`,
      auth: Boolean(config.server.password || config.server.apiToken || config.server.telegramAuth),
      telegram: config.server.telegramAuth,
      config: config.paths.streamersFile,
    },
    'Restreamer TS läuft',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Dienst wird beendet');
    const hardExit = setTimeout(() => {
      logger.warn('Shutdown-Timeout – erzwinge Beenden');
      process.exit(1);
    }, 20_000);
    try {
      await app.close();
      scheduler.stop();
      await telegramBot?.stop();
      await supervisor.shutdown();
      await flush();
      clearTimeout(hardExit);
      process.exit(0);
    } catch (error) {
      logger.error({ err: toErrorMessage(error) }, 'Fehler beim Beenden');
      clearTimeout(hardExit);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (error) => {
    logger.error({ err: toErrorMessage(error) }, 'Unbehandelte Promise-Ablehnung');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error.stack ?? error.message }, 'Unbehandelte Ausnahme');
    void shutdown('uncaughtException');
  });
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entry) {
  void main();
}
