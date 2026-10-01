import { defineConfig } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is required in .env to run the E2E suite`);
  }
  return value;
}

const port = process.env.E2E_PORT ?? '3799';
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/globalSetup.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx tsx tests/e2e/serve.ts',
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: port,
      REMINDER_TICK_MS: '0',
      LOG_LEVEL: 'warn',
      DB_HOST: required('TEST_DB_HOST'),
      DB_PORT: process.env.TEST_DB_PORT ?? '3306',
      DB_USER: process.env.TEST_DB_USER ?? 'root',
      DB_PASSWORD: process.env.TEST_DB_PASSWORD ?? '',
      DB_NAME: process.env.TEST_DB_NAME ?? 'dentalistics_test',
      MIGRATIONS_DIR: './migrations',
    },
  },
});
