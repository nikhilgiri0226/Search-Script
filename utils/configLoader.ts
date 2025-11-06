import fs from 'fs';
import path from 'path';

export interface EnvironmentConfig {
  name: string;
  baseUrl: string;
  defaultParams: Record<string, string | number | boolean>;
}

export interface ApiConfig {
  endpoint: string;
  timeoutMs: number;
  delayBetweenCallsMs: number;
  expectedStatusCodes: number[];
}

export type ReporterSetting = string | Array<string | [string, Record<string, unknown>]>;

export interface PlaywrightConfigSettings {
  headless: boolean;
  timeoutMs: number;
  expectTimeoutMs: number;
  retries: number;
  reporter: ReporterSetting;
}

export type StatusCategory = 'PASS' | 'PASS_REVIEW' | 'FAIL' | 'REVIEW';

export interface QualityConfig {
  partialPassPercentage: number;
  fullPassPercentage: number;
  statusColors: Record<StatusCategory, string>;
}

export interface ProjectConfig {
  environment: string;
  environments: Record<string, EnvironmentConfig>;
  api: ApiConfig;
  playwright: PlaywrightConfigSettings;
  quality: QualityConfig;
}

let cachedConfig: ProjectConfig | null = null;

export const loadConfig = (configPath = path.resolve(__dirname, '..', 'config', 'config.json')): ProjectConfig => {
  if (cachedConfig) {
    return cachedConfig;
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw) as ProjectConfig;

  const defaultQuality: QualityConfig = {
    partialPassPercentage: 90,
    fullPassPercentage: 100,
    statusColors: {
      PASS: '#C8E6C9',
      PASS_REVIEW: '#FFF9C4',
      FAIL: '#FFCDD2',
      REVIEW: '#FFE0B2'
    }
  };

  const envOverride = process.env.TEST_ENVIRONMENT;
  if (envOverride) {
    if (!parsed.environments?.[envOverride]) {
      throw new Error(`Environment override '${envOverride}' not found in configuration.`);
    }
    parsed.environment = envOverride;
  }

  if (!parsed.quality) {
    parsed.quality = defaultQuality;
  } else {
    parsed.quality = {
      partialPassPercentage: parsed.quality.partialPassPercentage ?? defaultQuality.partialPassPercentage,
      fullPassPercentage: parsed.quality.fullPassPercentage ?? defaultQuality.fullPassPercentage,
      statusColors: {
        ...defaultQuality.statusColors,
        ...(parsed.quality.statusColors ?? {})
      }
    };
  }

  if (!parsed.environment) {
    throw new Error('environment not defined in config');
  }

  if (!parsed.environments?.[parsed.environment]) {
    throw new Error(`environment configuration missing for key: ${parsed.environment}`);
  }

  cachedConfig = parsed;
  return parsed;
};

export const getActiveEnvironment = (): EnvironmentConfig => {
  const config = loadConfig();
  const env = config.environments[config.environment];
  return env;
};

export const resolvePlaywrightSettings = (): PlaywrightConfigSettings => {
  const config = loadConfig();
  return config.playwright;
};
