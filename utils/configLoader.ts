import fs from 'fs';
import path from 'path';

export interface FrameworkConfig {
  environment: string;
  baseURL: string;
  api: {
    searchEndpoint: string;
    queryParamKey?: string;
    responseListPath?: string;
    waitForResponseTimeout?: number;
  };
  selectors: {
    searchInput: string;
    searchSubmit?: string;
    searchResultItems: string;
    productTitle?: string;
    productDescription?: string;
  };
  timeouts: {
    navigation: number;
    element: number;
  };
  validation: {
    expectedMinResults: number;
    resultFieldsToCheck: string[];
  };
  playwright: {
    headless: boolean;
    viewport?: {
      width: number;
      height: number;
    };
    retries?: number;
    workers?: number;
    reporter?: string | string[];
    video?: 'on' | 'off' | 'retain-on-failure' | 'on-first-retry';
    trace?: 'on' | 'off' | 'retain-on-failure' | 'on-first-retry';
  };
  results: {
    outputPath: string;
  };
}

export interface SearchQueriesConfig {
  queries: string[];
}

const CONFIG_ROOT = path.resolve(__dirname, '..');

const DEFAULT_CONFIG_PATH = process.env.FRAMEWORK_CONFIG_PATH
  ? path.resolve(process.cwd(), process.env.FRAMEWORK_CONFIG_PATH)
  : path.join(CONFIG_ROOT, 'config', 'config.json');

const DEFAULT_SEARCH_QUERIES_PATH = process.env.SEARCH_QUERIES_PATH
  ? path.resolve(process.cwd(), process.env.SEARCH_QUERIES_PATH)
  : path.join(CONFIG_ROOT, 'test-data', 'search_queries.json');

let cachedConfig: FrameworkConfig | null = null;
let cachedQueries: SearchQueriesConfig | null = null;

function readJsonFile<T>(filePath: string): T {
  const file = path.isAbsolute(filePath) ? filePath : path.resolve(CONFIG_ROOT, filePath);
  if (!fs.existsSync(file)) {
    throw new Error(`Configuration file not found at ${file}`);
  }
  const content = fs.readFileSync(file, { encoding: 'utf-8' });
  try {
    return JSON.parse(content) as T;
  } catch (error) {
    throw new Error(`Unable to parse JSON file at ${file}: ${(error as Error).message}`);
  }
}

export function loadFrameworkConfig(configPath: string = DEFAULT_CONFIG_PATH): FrameworkConfig {
  if (!cachedConfig) {
    cachedConfig = readJsonFile<FrameworkConfig>(configPath);
  }
  return cachedConfig;
}

export function loadSearchQueries(queriesPath: string = DEFAULT_SEARCH_QUERIES_PATH): string[] {
  if (!cachedQueries) {
    cachedQueries = readJsonFile<SearchQueriesConfig>(queriesPath);
    if (!Array.isArray(cachedQueries.queries)) {
      throw new Error(`Invalid search queries file at ${queriesPath}: missing "queries" array.`);
    }
  }
  return cachedQueries.queries;
}

export function resetCachedConfigs(): void {
  cachedConfig = null;
  cachedQueries = null;
}
