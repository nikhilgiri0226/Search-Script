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

let resultsInitialised = false;
let workbookWritePromise: Promise<void> = Promise.resolve();

const ensureResultsDirectory = (): void => {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
};

const ensureResultsFile = (): void => {
  ensureResultsDirectory();

  if (!resultsInitialised) {
    resultsInitialised = true;
  }

  if (!fs.existsSync(RESULTS_FILE)) {
    fs.writeFileSync(RESULTS_FILE, `${HEADER}\n`, 'utf-8');
  }
};

const parsePassPercentage = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const strValue = String(value).replace('%', '').trim();
  if (!strValue) {
    return null;
  }

  const numeric = Number(strValue);
  return Number.isFinite(numeric) ? numeric / 100 : null;
};

const parseNumber = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const rebuildWorkbookFromCsv = async (): Promise<void> => {
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

  if (fs.existsSync(RESULTS_FILE)) {
    const csvWorkbook = new ExcelJS.Workbook();
    await csvWorkbook.csv.readFile(RESULTS_FILE);
    const csvWorksheet = csvWorkbook.worksheets[0];

    csvWorksheet?.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        return;
      }

      const values = row.values as Array<string | number | null | undefined>;
      const [
        ,
        testId,
        timestamp,
        environment,
        keyword,
        status,
        passPercentageDisplay,
        matchDisplay,
        statusColor,
        responseTimeMs,
        httpStatusCode,
        errorMessage,
        testDurationSeconds
      ] = values;

      const excelRow = worksheet.addRow({
        testId,
        timestamp,
        environment,
        keyword,
        status,
        passPercentage: parsePassPercentage(passPercentageDisplay),
        matchRatio: matchDisplay ?? '',
        responseTimeMs: parseNumber(responseTimeMs),
        httpStatusCode: parseNumber(httpStatusCode),
        errorMessage: (errorMessage ?? '') as string,
        testDurationSeconds: parseNumber(testDurationSeconds)
      });

      const statusCell = excelRow.getCell('E');
      statusCell.font = { bold: true };
      if (typeof statusColor === 'string' && statusColor.trim()) {
        statusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: toExcelArgb(statusColor.trim()) }
        };
      }
    });
  }

  worksheet.getColumn(6).alignment = { horizontal: 'right' };

  ensureResultsDirectory();
  await workbook.xlsx.writeFile(RESULTS_XLSX_FILE);
};

const queueWorkbookRebuild = (): Promise<void> => {
  workbookWritePromise = workbookWritePromise.then(() => rebuildWorkbookFromCsv());
  workbookWritePromise = workbookWritePromise.catch((error) => {
    console.error('Failed to rebuild XLSX results', error);
    throw error;
  });
  return workbookWritePromise;
};

export const appendResult = async (row: TestResultRow): Promise<void> => {
  ensureResultsFile();

  const passPercentageDisplay =
    row.passPercentage === null || Number.isNaN(row.passPercentage)
      ? 'N/A'
      : `${(row.passPercentage * 100).toFixed(2)}%`;
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

  await queueWorkbookRebuild();
};

export const getResultsFilePath = (): string => RESULTS_FILE;

export const getResultsWorkbookPath = (): string => RESULTS_XLSX_FILE;
