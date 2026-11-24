import { defineConfig, devices } from '@playwright/test';

const port = 4175;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The PWA service worker reloads the page when a new build is waiting; that
    // races with form edits and makes UI tests flaky (#88). UI behaviour is
    // tested without the worker.
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'sh -c "mkdir -p .playwright && npm run build:web && npm run dev"',
    url: `http://127.0.0.1:${port}/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      SERVER_HOST: '127.0.0.1',
      SERVER_PORT: String(port),
      DASHBOARD_PASSWORD: '',
      API_TOKEN: '',
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_ALLOWED_USER_IDS: '',
      AUTO_START: 'false',
      AUTO_REFRESH: 'false',
      EARNINGS_ENABLED: 'false',
      DELAY_BUFFER_ENABLED: 'false',
      // Keep the internal relay/playback ports away from a local production instance.
      RELAY_PORT: '19360',
      LOG_LEVEL: 'silent',
      DATA_DIR: '.playwright/data',
      LOGS_DIR: '.playwright/logs',
      STREAMERS_FILE: '.playwright/streamers.yml',
      SETTINGS_FILE: '.playwright/settings.yml',
      FFMPEG_BIN: '/bin/false',
      YTDLP_BIN: '/bin/false',
    },
  },
  projects: [
    {
      name: 'mobile-320',
      testMatch: ['**/mobile.spec.ts', '**/a11y.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 320, height: 720 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop',
      testMatch: ['**/a11y.spec.ts'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
});
