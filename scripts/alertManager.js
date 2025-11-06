const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const buildSummary = async (config, runStamp, exitCode) => {
  const baseName = `result_${runStamp}`;
  const csvPath = path.resolve(__dirname, '..', 'results', `${baseName}.csv`);
  const xlsxPath = path.resolve(__dirname, '..', 'results', `${baseName}.xlsx`);

  const summary = {
    runStamp,
    exitCode,
    csvPath,
    xlsxPath,
    total: 0,
    passed: 0,
    passReview: 0,
    failed: 0,
    review: 0
  };

  if (!fs.existsSync(csvPath)) {
    return summary;
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.csv.readFile(csvPath);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return summary;
  }

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    const statusCell = row.getCell(5);
    const statusText = String(statusCell.value ?? '').trim().toUpperCase();
    summary.total += 1;
    if (statusText === 'PASS') {
      summary.passed += 1;
    } else if (statusText.startsWith('PASS')) {
      summary.passReview += 1;
    } else if (statusText === 'REVIEW') {
      summary.review += 1;
    } else if (statusText === 'FAIL') {
      summary.failed += 1;
    }
  });

  return summary;
};

const formatSummaryMessage = (summary) => {
  return [
    `Run: ${summary.runStamp}`,
    `Exit code: ${summary.exitCode}`,
    `Total keywords: ${summary.total}`,
    `Passed: ${summary.passed}`,
    `Pass (Need Review): ${summary.passReview}`,
    `Review: ${summary.review}`,
    `Failed: ${summary.failed}`,
    `CSV: ${summary.csvPath}`,
    `XLSX: ${summary.xlsxPath}`
  ].join('\n');
};

const sendAlertsIfConfigured = async (config, summary) => {
  const alerts = config.alerts || {};
  const message = formatSummaryMessage(summary);

  if (alerts.email?.enabled) {
    if (!alerts.email.smtpHost || !alerts.email.recipients || alerts.email.recipients.length === 0) {
      console.warn('[Alerts] Email enabled but SMTP host or recipients not configured. Skipping email send.');
      console.warn(message);
    } else {
      console.log('[Alerts] Email alerts would be sent to:', alerts.email.recipients.join(', '));
      console.log('[Alerts] Summary:\n', message);
      console.log('[Alerts] Attachments:', summary.csvPath, summary.xlsxPath);
    }
  }

  if (alerts.slack?.enabled) {
    if (!alerts.slack.webhookUrl) {
      console.warn('[Alerts] Slack enabled but webhookUrl not configured. Skipping Slack send.');
      console.warn(message);
    } else {
      console.log('[Alerts] Slack message would be posted to webhook:', alerts.slack.webhookUrl);
      console.log('[Alerts] Summary:\n', message);
      if (alerts.slack.channel) {
        console.log('[Alerts] Target channel:', alerts.slack.channel);
      }
    }
  }
};

module.exports = {
  buildSummary,
  sendAlertsIfConfigured
};
