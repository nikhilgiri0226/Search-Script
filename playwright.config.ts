import { defineConfig } from '@playwright/test';
import { getActiveEnvironment, resolvePlaywrightSettings } from './utils/configLoader';

const environmentConfig = getActiveEnvironment();
const playwrightSettings = resolvePlaywrightSettings();

export default defineConfig({
  timeout: playwrightSettings.timeoutMs,
  expect: {
    timeout: playwrightSettings.expectTimeoutMs
  },
  retries: playwrightSettings.retries,
  reporter: playwrightSettings.reporter,
  workers: 1,
  use: {
    headless: playwrightSettings.headless,
    baseURL: environmentConfig.baseUrl
  },
  metadata: {
    environment: environmentConfig.name
  }
});
