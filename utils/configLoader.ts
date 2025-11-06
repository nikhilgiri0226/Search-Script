import fs from 'fs';
import path from 'path';

export interface EnvironmentConfig {
  name: string;
  baseUrl: string;
  defaultParams: Record<string, string | number | boolean>;
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

export interface PaginationResponseFieldConfig {
  currentPage?: string;
  totalPages?: string;
  hasNextPage?: string;
  totalCount?: string;
}

export interface PaginationConfig {
  mode: 'firstPage' | 'allPages';
  pageParam?: string;
  startPage?: number;
  maxPages?: number;
  pageSizeParam?: string;
  pageSize?: number | null;
  pauseBetweenPagesMs?: number;
  responseFields?: PaginationResponseFieldConfig;
}

export interface ApiConfig {
  endpoint: string;
  timeoutMs: number;
  delayBetweenCallsMs: number;
  expectedStatusCodes: number[];
  pagination?: PaginationConfig;
}

export interface QualityConfig {
  partialPassPercentage: number;
  fullPassPercentage: number;
  statusColors: Record<StatusCategory, string>;
  failStrategy?: 'always' | 'fail-fast' | 'threshold' | 'continue';
  failThresholdPercent?: number;
}

export interface RunnerConfig {
  workers: number;
  maxInFlightRequests: number;
  batchSize: number;
  batchPauseMs: number;
  queryLimit?: number | null;
}

export interface ResultsConfig {
  retainDays?: number;
  retainRuns?: number;
}

export interface EmailAlertConfig {
  enabled: boolean;
  recipients: string[];
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  from?: string;
  subject?: string;
}

export interface SlackAlertConfig {
  enabled: boolean;
  webhookUrl?: string;
  channel?: string;
}

export interface AlertsConfig {
  email?: EmailAlertConfig;
  slack?: SlackAlertConfig;
}

export interface AliasGroup {
  words: string[];
}

export interface AliasesConfig {
  aliases: AliasGroup[];
}

export interface ProjectConfig {
  environment: string;
  environments: Record<string, EnvironmentConfig>;
  api: ApiConfig;
  playwright: PlaywrightConfigSettings;
  quality: QualityConfig;
  runner?: RunnerConfig;
  results?: ResultsConfig;
  alerts?: AlertsConfig;
}

const DEFAULT_QUALITY: QualityConfig = {
  partialPassPercentage: 90,
  fullPassPercentage: 100,
  statusColors: {
    PASS: '#C8E6C9',
    PASS_REVIEW: '#FFF9C4',
    FAIL: '#FFCDD2',
    REVIEW: '#FFE0B2'
  },
  failStrategy: 'always',
  failThresholdPercent: 10
};

const DEFAULT_RUNNER: RunnerConfig = {
  workers: 1,
  maxInFlightRequests: 5,
  batchSize: 100,
  batchPauseMs: 60000,
  queryLimit: null
};

const DEFAULT_PAGINATION: PaginationConfig = {
  mode: 'firstPage',
  pageParam: 'page',
  startPage: 1,
  maxPages: 5,
  pageSizeParam: undefined,
  pageSize: null,
  pauseBetweenPagesMs: 0,
  responseFields: {
    currentPage: 'pagination.currentPage',
    totalPages: 'pagination.totalPages',
    hasNextPage: 'pagination.hasNextPage',
    totalCount: 'pagination.totalCount'
  }
};

const DEFAULT_RESULTS: ResultsConfig = {
  retainDays: 0,
  retainRuns: 20
};

const DEFAULT_ALERTS: AlertsConfig = {
  email: {
    enabled: false,
    recipients: [],
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpPassword: '',
    from: '',
    subject: 'Search API Test Summary'
  },
  slack: {
    enabled: false,
    webhookUrl: '',
    channel: ''
  }
};

let cachedConfig: ProjectConfig | null = null;

export const loadConfig = (configPath = path.resolve(__dirname, '..', 'config', 'config.json')): ProjectConfig => {
  if (cachedConfig) {
    return cachedConfig;
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw) as ProjectConfig;

  const envOverride = process.env.TEST_ENVIRONMENT;
  if (envOverride) {
    if (!parsed.environments?.[envOverride]) {
      throw new Error(`Environment override '${envOverride}' not found in configuration.`);
    }
    parsed.environment = envOverride;
  }

  if (!parsed.quality) {
    parsed.quality = DEFAULT_QUALITY;
  } else {
    parsed.quality = {
      partialPassPercentage: parsed.quality.partialPassPercentage ?? DEFAULT_QUALITY.partialPassPercentage,
      fullPassPercentage: parsed.quality.fullPassPercentage ?? DEFAULT_QUALITY.fullPassPercentage,
      statusColors: {
        ...DEFAULT_QUALITY.statusColors,
        ...(parsed.quality.statusColors ?? {})
      },
      failStrategy: parsed.quality.failStrategy ?? DEFAULT_QUALITY.failStrategy,
      failThresholdPercent: parsed.quality.failThresholdPercent ?? DEFAULT_QUALITY.failThresholdPercent
    };
  }

  if (!parsed.runner) {
    parsed.runner = DEFAULT_RUNNER;
  } else {
    parsed.runner = {
      workers: parsed.runner.workers ?? DEFAULT_RUNNER.workers,
      maxInFlightRequests: parsed.runner.maxInFlightRequests ?? DEFAULT_RUNNER.maxInFlightRequests,
      batchSize: parsed.runner.batchSize ?? DEFAULT_RUNNER.batchSize,
      batchPauseMs: parsed.runner.batchPauseMs ?? DEFAULT_RUNNER.batchPauseMs,
      queryLimit:
        parsed.runner.queryLimit !== undefined
          ? parsed.runner.queryLimit
          : DEFAULT_RUNNER.queryLimit
    };
  }

  parsed.api.pagination = {
    mode: parsed.api.pagination?.mode ?? DEFAULT_PAGINATION.mode,
    pageParam: parsed.api.pagination?.pageParam ?? DEFAULT_PAGINATION.pageParam,
    startPage: parsed.api.pagination?.startPage ?? DEFAULT_PAGINATION.startPage,
    maxPages: parsed.api.pagination?.maxPages ?? DEFAULT_PAGINATION.maxPages,
    pageSizeParam: parsed.api.pagination?.pageSizeParam ?? DEFAULT_PAGINATION.pageSizeParam,
    pageSize:
      parsed.api.pagination?.pageSize !== undefined
        ? parsed.api.pagination?.pageSize
        : DEFAULT_PAGINATION.pageSize,
    pauseBetweenPagesMs:
      parsed.api.pagination?.pauseBetweenPagesMs ?? DEFAULT_PAGINATION.pauseBetweenPagesMs,
    responseFields: {
      ...DEFAULT_PAGINATION.responseFields,
      ...(parsed.api.pagination?.responseFields ?? {})
    }
  };

  parsed.results = {
    retainDays: parsed.results?.retainDays ?? DEFAULT_RESULTS.retainDays,
    retainRuns: parsed.results?.retainRuns ?? DEFAULT_RESULTS.retainRuns
  };

  parsed.alerts = {
    email: {
      enabled: parsed.alerts?.email?.enabled ?? DEFAULT_ALERTS.email?.enabled ?? false,
      recipients: parsed.alerts?.email?.recipients ?? DEFAULT_ALERTS.email?.recipients ?? [],
      smtpHost: parsed.alerts?.email?.smtpHost ?? DEFAULT_ALERTS.email?.smtpHost,
      smtpPort: parsed.alerts?.email?.smtpPort ?? DEFAULT_ALERTS.email?.smtpPort,
      smtpUser: parsed.alerts?.email?.smtpUser ?? DEFAULT_ALERTS.email?.smtpUser,
      smtpPassword: parsed.alerts?.email?.smtpPassword ?? DEFAULT_ALERTS.email?.smtpPassword,
      from: parsed.alerts?.email?.from ?? DEFAULT_ALERTS.email?.from,
      subject: parsed.alerts?.email?.subject ?? DEFAULT_ALERTS.email?.subject
    },
    slack: {
      enabled: parsed.alerts?.slack?.enabled ?? DEFAULT_ALERTS.slack?.enabled ?? false,
      webhookUrl: parsed.alerts?.slack?.webhookUrl ?? DEFAULT_ALERTS.slack?.webhookUrl,
      channel: parsed.alerts?.slack?.channel ?? DEFAULT_ALERTS.slack?.channel
    }
  };

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
  return config.environments[config.environment];
};

export const resolvePlaywrightSettings = (): PlaywrightConfigSettings => {
  const config = loadConfig();
  return config.playwright;
};

export const resolveRunnerSettings = (): RunnerConfig => {
  const config = loadConfig();
  return config.runner ?? DEFAULT_RUNNER;
};

export const resolveResultsSettings = (): ResultsConfig => {
  const config = loadConfig();
  return config.results ?? DEFAULT_RESULTS;
};

export const resolveAlertSettings = (): AlertsConfig => {
  const config = loadConfig();
  return config.alerts ?? DEFAULT_ALERTS;
};

export const resolvePaginationSettings = (): PaginationConfig => {
  const config = loadConfig();
  return config.api.pagination ?? DEFAULT_PAGINATION;
};

export const loadAliasesConfig = (
  aliasesPath = path.resolve(__dirname, "..", "config", "aliases.json"),
): AliasesConfig => {
  if (!fs.existsSync(aliasesPath)) {
    return { aliases: [] };
  }

  try {
    const raw = fs.readFileSync(aliasesPath, "utf-8");
    const parsed = JSON.parse(raw) as AliasesConfig;
    if (!Array.isArray(parsed.aliases)) {
      return { aliases: [] };
    }
    return parsed;
  } catch (error) {
    console.warn(`Failed to read aliases configuration from ${aliasesPath}:`, error);
    return { aliases: [] };
  }
};
