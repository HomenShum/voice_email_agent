import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

/**
 * Playwright E2E configuration for voice email agent
 * Covers UI flows (connect, text input) and API endpoints
 *
 * Environment Variables:
 * - OPENAI_API_KEY: Required for voice agent connection tests
 * - TEST_ENV: 'local' (default) or 'deployed' to test against Azure
 * - VITE_STATIC_WEB_APP_URL: Azure Static Web App URL (for deployed tests)
 * - VITE_API_BASE: Azure Functions URL (for API tests)
 */

const isDeployedTest = process.env.TEST_ENV === 'deployed';
const baseURL = isDeployedTest
  ? process.env.VITE_STATIC_WEB_APP_URL || 'https://orange-mud-087b3a60f.3.azurestaticapps.net'
  : 'http://localhost:5175';

export default defineConfig({
  testDir: './tests/playwright',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: isDeployedTest ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:5175',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});

