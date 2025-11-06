import { defineConfig, type ReporterDescription } from '@playwright/test';
import { getActiveEnvironment, resolvePlaywrightSettings, resolveRunnerSettings, type ReporterSetting } from './utils/configLoader';

const environmentConfig = getActiveEnvironment();
const playwrightSettings = resolvePlaywrightSettings();

const normalizeReporter = (setting: ReporterSetting): ReporterDescription[] | string => {
  if (Array.isArray(setting)) {
    return setting.map((entry) =>
      Array.isArray(entry) ? (entry as ReporterDescription) : ([entry] as ReporterDescription)
    );
  }
  return setting;
};

const reporterConfig = normalizeReporter(playwrightSettings.reporter);
const runnerSettings = resolveRunnerSettings();

export default defineConfig({
  timeout: playwrightSettings.timeoutMs,
  expect: {
    timeout: playwrightSettings.expectTimeoutMs
  },
  retries: playwrightSettings.retries,
  reporter: reporterConfig,
  workers: runnerSettings.workers,
  use: {
    headless: playwrightSettings.headless,
    baseURL: environmentConfig.baseUrl
  },
  metadata: {
    environment: environmentConfig.name
  }
});
