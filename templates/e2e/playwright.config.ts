import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.E2E_PORT ?? '8001';

// Isolated database and environment: the E2E run never touches the development data.
Object.assign(process.env, {
  APP_ENV: 'testing',
  APP_DEBUG: 'false',
  DB_CONNECTION: 'sqlite',
  DB_DATABASE: 'database/e2e.sqlite',
  SESSION_DRIVER: 'file',
  CACHE_STORE: 'file',
  QUEUE_CONNECTION: 'sync',
  MAIL_MAILER: 'log',
});

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['line']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `php artisan serve --host=127.0.0.1 --port=${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
