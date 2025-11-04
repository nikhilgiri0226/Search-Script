import fs from 'fs';
import path from 'path';

export interface ResultRecord {
  testId: number;
  keyword: string;
  statusCode: number;
  responseTimeMs: number;
  expectedMinResults: number;
  actualResults: number;
  validationPassed: boolean;
  environment: string;
  timestamp?: string;
}

const CSV_HEADER = [
  'timestamp',
  'test_id',
  'keyword',
  'status_code',
  'response_time_ms',
  'expected_min_results',
  'actual_results',
  'validation_passed',
  'environment'
];

function ensureDirectoryExists(filePath: string): void {
  const directory = path.dirname(filePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

export function initializeResultsFile(filePath: string): void {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  ensureDirectoryExists(absolutePath);
  fs.writeFileSync(absolutePath, `${CSV_HEADER.join(',')}\n`, { encoding: 'utf-8' });
}

function escapeCsvValue(value: string | number | boolean): string {
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

export function appendResult(filePath: string, record: ResultRecord): void {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  ensureDirectoryExists(absolutePath);
  if (!fs.existsSync(absolutePath)) {
    initializeResultsFile(absolutePath);
  }

  const timestamp = record.timestamp ?? new Date().toISOString();
  const row = [
    timestamp,
    record.testId,
    record.keyword,
    record.statusCode,
    record.responseTimeMs,
    record.expectedMinResults,
    record.actualResults,
    record.validationPassed,
    record.environment
  ]
    .map(escapeCsvValue)
    .join(',');

  fs.appendFileSync(absolutePath, `${row}\n`, { encoding: 'utf-8' });
}
