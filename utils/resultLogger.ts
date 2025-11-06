import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

import { StatusCategory } from './configLoader';

export interface TestResultRow {
  testId: string;
  timestamp: string;
  environment: string;
  keyword: string;
  status: string;
  statusCategory: StatusCategory;
  passPercentage: number | null;
  matchedCount: number;
  totalCount: number;
  statusColor?: string;
  responseTimeMs: number;
  httpStatusCode: number;
  errorMessage: string;
  testDurationSeconds: number;
}

const RESULTS_DIR = path.resolve(__dirname, '..', 'results');

const formatDateComponent = (value: number): string => value.toString().padStart(2, '0');

const deriveRunStamp = (): string => {
  const now = new Date();
  const month = formatDateComponent(now.getMonth() + 1);
  const day = formatDateComponent(now.getDate());
  const year = now.getFullYear();
  const hour = formatDateComponent(now.getHours());
  const minute = formatDateComponent(now.getMinutes());
  return `${month}-${day}-${year}_${hour}:${minute}`;
};

const RUN_STAMP = (process.env.RESULT_RUN_STAMP?.trim() || '') || deriveRunStamp();

const RESULTS_FILE = path.join(RESULTS_DIR, `result_${RUN_STAMP}.csv`);
const RESULTS_XLSX_FILE = path.join(RESULTS_DIR, `result_${RUN_STAMP}.xlsx`);

const HEADER = [
  'Test ID',
  'Timestamp',
  'Environment',
  'Keyword',
  'Status',
  'Pass Percentage (%)',
  'Matched/Total',
  'Status Color',
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

const toExcelArgb = (hex: string): string => {
  const normalized = hex.replace('#', '').padStart(6, '0').slice(0, 6).toUpperCase();
  return `FF${normalized}`;
};

const rows: TestResultRow[] = [];

let resultsInitialised = false;
let workbookWritePromise: Promise<void> = Promise.resolve();

const ensureResultsFile = (): void => {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  if (!resultsInitialised) {
    resultsInitialised = true;
  }

  if (!fs.existsSync(RESULTS_FILE)) {
    fs.writeFileSync(RESULTS_FILE, `${HEADER}\n`, 'utf-8');
  }
};

const writeWorkbook = async (): Promise<void> => {
  if (rows.length === 0) {
    return;
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Results');

  worksheet.columns = [
    { header: 'Test ID', key: 'testId', width: 12 },
    { header: 'Timestamp', key: 'timestamp', width: 25 },
    { header: 'Environment', key: 'environment', width: 15 },
    { header: 'Keyword', key: 'keyword', width: 45 },
    { header: 'Status', key: 'status', width: 20 },
    { header: 'Pass Percentage', key: 'passPercentage', width: 18, style: { numFmt: '0.00%' } },
    { header: 'Matched/Total', key: 'matchRatio', width: 15 },
    { header: 'Response Time (ms)', key: 'responseTimeMs', width: 18 },
    { header: 'HTTP Status Code', key: 'httpStatusCode', width: 18 },
    { header: 'Error Message', key: 'errorMessage', width: 60 },
    { header: 'Test Duration (s)', key: 'testDurationSeconds', width: 18 }
  ];

  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  rows.forEach((row) => {
    const excelRow = worksheet.addRow({
      testId: row.testId,
      timestamp: row.timestamp,
      environment: row.environment,
      keyword: row.keyword,
      status: row.status,
      passPercentage: row.passPercentage === null ? null : row.passPercentage / 100,
      matchRatio: `${row.matchedCount}/${row.totalCount}`,
      responseTimeMs: row.responseTimeMs,
      httpStatusCode: row.httpStatusCode,
      errorMessage: row.errorMessage,
      testDurationSeconds: row.testDurationSeconds
    });

    const statusCell = excelRow.getCell(5);
    statusCell.font = { bold: true };
    if (row.statusColor) {
      statusCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: toExcelArgb(row.statusColor) }
      };
    }
  });

  worksheet.getColumn(6).alignment = { horizontal: 'right' };

  await workbook.xlsx.writeFile(RESULTS_XLSX_FILE);
};

const queueWorkbookWrite = (): void => {
  workbookWritePromise = workbookWritePromise
    .then(() => writeWorkbook())
    .catch((error) => {
      console.error('Failed to write XLSX results', error);
    });
};

export const appendResult = (row: TestResultRow): void => {
  ensureResultsFile();

  rows.push(row);

  const passPercentageDisplay =
    row.passPercentage === null || Number.isNaN(row.passPercentage)
      ? 'N/A'
      : `${row.passPercentage.toFixed(2)}%`;
  const matchDisplay = `${row.matchedCount}/${row.totalCount}`;

  const line = [
    row.testId,
    row.timestamp,
    row.environment,
    row.keyword,
    row.status,
    passPercentageDisplay,
    matchDisplay,
    row.statusColor ?? '',
    row.responseTimeMs,
    row.httpStatusCode,
    row.errorMessage,
    row.testDurationSeconds
  ]
    .map(escapeCsv)
    .join(',');

  fs.appendFileSync(RESULTS_FILE, `${line}\n`, 'utf-8');

  queueWorkbookWrite();
};

export const getResultsFilePath = (): string => RESULTS_FILE;

export const getResultsWorkbookPath = (): string => RESULTS_XLSX_FILE;
