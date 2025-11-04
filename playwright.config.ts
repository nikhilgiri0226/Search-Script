import { defineConfig } from '@playwright/test';
import { loadFrameworkConfig } from './utils/configLoader';

const frameworkConfig = loadFrameworkConfig();
const {
  baseURL,
  timeouts,
  playwright,
} = frameworkConfig;

export default defineConfig({
  testDir: './tests',
  timeout: timeouts.navigation + timeouts.element,
  expect: {
    timeout: timeouts.element,
  },
  workers: typeof playwright.workers === 'number' && playwright.workers > 0 ? playwright.workers : undefined,
  retries: typeof playwright.retries === 'number' && playwright.retries >= 0 ? playwright.retries : undefined,
  reporter: playwright.reporter ?? [['html', { outputFolder: 'playwright-report' }]],
  use: {
    baseURL,
    headless: playwright.headless,
    viewport: playwright.viewport,
    trace: playwright.trace,
    video: playwright.video,
    actionTimeout: timeouts.element,
    navigationTimeout: timeouts.navigation,
  },
});
