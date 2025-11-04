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
const RESULTS_FILE = path.join(RESULTS_DIR, 'results.csv');

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

const ensureResultsFile = (): void => {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
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
