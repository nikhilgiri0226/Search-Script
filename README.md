# Playwright Search API Test Suite

## Overview
- Validates the search/filter API for a configurable e-commerce service using Playwright + TypeScript
- Reads runtime configuration from JSON files, including environment-specific URLs, query parameters, and execution settings
- Consumes search keywords and categories from external test data without touching the test code
- Persists keyword-level results, timings, and diagnostics to timestamped CSV files under `results/`

## Prerequisites
- Node.js 18+
- npm (bundled with Node)
- Network access to the configured API endpoints

## Initial Setup
- `npm install`
- `npx playwright install` (installs Playwright browsers/drivers; safe in CI too)
- Verify or edit `config/config.json` to point to the desired environment(s)
- Populate `test-data/search_queries.json` with the categories/keywords to validate

## Configuration Files
- `config/config.json`
  - `environment`: active environment key (overridable via `TEST_ENVIRONMENT` env var)
  - `environments.*.baseUrl`: base URL per environment (e.g., prod, nonProd)
  - `environments.*.defaultParams.limit`: limit per request
  - `api.endpoint`: route appended to the base URL
  - `api.timeoutMs`: request timeout (10s default)
  - `api.delayBetweenCallsMs`: enforced pause between calls (500 ms default)
  - `api.expectedStatusCodes`: accepted HTTP status codes (e.g., 200, 201)
  - `playwright.*`: headless mode, timeouts, retries, reporter
- `test-data/search_queries.json`
  - `id`: optional custom test identifier; fallback uses `TST_###`
  - `category`: friendly category name used for validation
  - `keyword`: search keyword applied to the API call
- `results/result_YYYYMMDD_HHMMSS.csv`
  - Per-run log (one row per keyword) with execution metadata and outcome (PASS / FAIL / REVIEW)

## Running Tests Locally
- `npm test`
- Optional headed run: `npm run test:headed`
- Override environment without editing JSON: `TEST_ENVIRONMENT=nonProd npm test`

## CI/CD Usage
- Install dependencies (`npm ci` preferred) and Playwright binaries (`npx playwright install --with-deps` for Debian-based runners)
- Set `TEST_ENVIRONMENT`, `PW_HEADLESS`, or other env vars as needed for the pipeline
- Collect run-specific CSV logs from `results/result_*.csv` as artifacts for reporting

## Result Evaluation Logic
- Ensures HTTP status is in the configured allow-list (200/201 by default)
- Confirms payload structure (`success`, `msg`, `category`, `data[]`)
- Validates each returned item contains at least one category word within `categoryName` or `productName`
- Marks empty result sets as `REVIEW` (skips the test after logging) to highlight manual follow-up
- Records response time, total test duration, and any failure messages in CSV output

## Extending the Framework
- Add new environments by extending `environments` in `config/config.json`
- Introduce new queries by editing `test-data/search_queries.json`
- Integrate into Jenkins/GitHub Actions by copying the npm + Playwright commands above and exporting `TEST_ENVIRONMENT`
- Enhance validations or response parsing by updating `tests/searchApi.spec.ts`