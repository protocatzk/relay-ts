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
import { TelegramAuthStore } from './core/telegram/auth-store.js';
import { TelegramBot } from './core/telegram/bot.js';
import { TelegramNotifyStore } from './core/telegram/notify-store.js';
import { createLogger, type LogEntry, secretRedactor } from './utils/logger.js';
import { toErrorMessage } from './utils/errors.js';
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

  const redactor = secretRedactor();
  redactor.add(config.server.password);
  redactor.add(config.server.apiToken);
  redactor.add(config.telegram.botToken);
  redactor.add(config.media.tiktokSessionId);
  redactor.add(config.settings.online.api_key);
  redactor.add(config.settings.chat.api_key);

  const store = new StreamerStore(
    config.paths.streamersFile,
    { streamers: config.streamers, playlists: config.playlists },
    logger,
  );
  for (const streamer of store.list()) {
    redactor.add(resolveStreamKey(streamer).key);
    redactor.add(streamer.overlays.chat.api_key);
  }
  for (const playlist of store.playlists()) {
    redactor.add(resolveStreamKey(playlist).key);
  }

  const settingsService = new SettingsService(config.paths.settingsFile, config.settings, logger);
  const authSessions = new AuthSessionStore(join(config.paths.dataDir, 'sessions.json'));
  const telegramAuth = new TelegramAuthStore();
  const supervisor = new Supervisor({
    config,
    settingsService,
    store,
    logger,
    bus,
    redact: redactor.apply,
    registerSecret: (secret) => redactor.add(secret),
  });
  const telegramBot = config.server.telegramAuth
    ? new TelegramBot({
        token: config.telegram.botToken,
        allowedUserIds: config.telegram.allowedUserIds,
        auth: telegramAuth,
        logger,
        bus,
        control: {
          status: () => supervisor.buildStatus(),
          streamers: () => supervisor.streamersView(),
          playlists: () => supervisor.playlistsView(),
          start: (streamerId) => supervisor.start(streamerId),
          stop: () => supervisor.stop(),
          playlistNext: () => supervisor.playlistNext(),
          playlistPrevious: () => supervisor.playlistPrevious(),
          pause: () => supervisor.pause(),
          resume: () => supervisor.hideScreen(),
          logs: (limit) => ring.list({ limit }),
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
    telegramAuth,
    telegramBot,
  });

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
