import fs from 'fs';
import path from 'path';

export interface TestResultRow {
  testId: string;
  timestamp: string;
  environment: string;
  keyword: string;
  status: 'PASS' | 'FAIL' | 'REVIEW';
  responseTimeMs: number;
  httpStatusCode: number;
  errorMessage: string;
  testDurationSeconds: number;
}

const RESULTS_DIR = path.resolve(__dirname, '..', 'results');

const formatDateComponent = (value: number): string => value.toString().padStart(2, '0');

const RUN_STAMP = (() => {
  const now = new Date();
  const month = formatDateComponent(now.getMonth() + 1);
  const day = formatDateComponent(now.getDate());
  const year = now.getFullYear();
  const hour = formatDateComponent(now.getHours());
  const minute = formatDateComponent(now.getMinutes());
  return `${month}-${day}-${year}_${hour}:${minute}`;
})();

const RESULTS_FILE = path.join(RESULTS_DIR, `result_${RUN_STAMP}.csv`);

const HEADER = [
  'Test ID',
  'Timestamp',
  'Environment',
  'Keyword',
  'Status',
  'Response Time (ms)',
  'HTTP Status Code',
  'Error Message',
  'Test Duration (s)'
].join(',');

const escapeCsv = (value: string | number): string => {
  const strValue = String(value ?? '');
  if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
    return `"${strValue.replace(/"/g, '""')}"`;
  }
  return strValue;
};

let resultsInitialised = false;

const cleanupOldResults = (): void => {
  if (!fs.existsSync(RESULTS_DIR)) {
    return;
  }

  const entries = fs.readdirSync(RESULTS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && /^result_.*\.csv$/i.test(entry.name)) {
      fs.unlinkSync(path.join(RESULTS_DIR, entry.name));
    }
  }
};

const ensureResultsFile = (): void => {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  if (!resultsInitialised) {
    cleanupOldResults();
    resultsInitialised = true;
  }

  if (!fs.existsSync(RESULTS_FILE)) {
    fs.writeFileSync(RESULTS_FILE, `${HEADER}\n`, 'utf-8');
  }
};

export const appendResult = (row: TestResultRow): void => {
  ensureResultsFile();

  const line = [
    row.testId,
    row.timestamp,
    row.environment,
    row.keyword,
    row.status,
    row.responseTimeMs,
    row.httpStatusCode,
    row.errorMessage,
    row.testDurationSeconds
  ]
    .map(escapeCsv)
    .join(',');

  fs.appendFileSync(RESULTS_FILE, `${line}\n`, 'utf-8');
};

export const getResultsFilePath = (): string => RESULTS_FILE;
