# Playwright Search API Test Suite

## Overview
- Validates the search/filter API for a configurable e-commerce service using Playwright + TypeScript
- Reads runtime configuration from JSON files, including environment-specific URLs, query parameters, relevance rules, execution settings, and quality thresholds
- Consumes search keywords and categories from external test data without touching the test code
- Persists keyword-level results, timings, diagnostics, pass-rate statistics, and color-coded status styling to timestamped CSV/XLSX files under `results/`

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
  - `quality.partialPassPercentage`: minimum pass-rate (%) required to avoid failure (default 90)
  - `quality.fullPassPercentage`: pass-rate (%) required for a full pass classification (default 100)
  - `quality.statusColors`: hex colors used for XLSX status highlighting (`PASS`, `PASS_REVIEW`, `FAIL`, `REVIEW`)
- `test-data/search_queries.json`
  - `id`: optional custom test identifier; fallback uses `TST_###`
  - `category`: friendly category name used for validation
  - `keyword`: search keyword applied to the API call
- `config/relevanceMap.json`
  - Synonyms, related terms, and brand cues used to infer relevance when direct word matches are missing
- `config/stopwords.json`
  - Common helper words (e.g., “the”, “in”, “over”) filtered out before matching keywords/categories to API text
- `results/result_MM-DD-YYYY_HH:MM.csv`
  - Per-run log (one row per keyword) with execution metadata, pass percentage, and match counts; prior CSVs remain untouched for historical review
- `results/result_MM-DD-YYYY_HH:MM.xlsx`
  - Mirror of the CSV content with status cells pre-colored (light green/yellow/red) for quick review

## Running Tests Locally
- `npm test` (wraps Playwright via `scripts/run-tests.js`, stamping each run with a shared `RESULT_RUN_STAMP`)
- Optional headed run: `npm run test:headed`
- Override environment without editing JSON: `TEST_ENVIRONMENT=nonProd npm test`

## CI/CD Usage
- Install dependencies (`npm ci` preferred) and Playwright binaries (`npx playwright install --with-deps` for Debian-based runners)
- Set `TEST_ENVIRONMENT`, `PW_HEADLESS`, or other env vars as needed for the pipeline
- Collect run-specific CSV/XLSX logs from `results/result_*` as artifacts for reporting

## Result Evaluation Logic
- Ensures HTTP status is in the configured allow-list (200/201 by default)
- Confirms payload structure (`success`, `msg`, `category`, `data[]`)
- Validates each returned item contains at least one category/keyword word (case/number insensitive), or a relevance-map synonym/related term, within `categoryName` or `productName`
- Ignores configurable stop words (e.g., “the”, “in”, “over”) when building match tokens on both the configuration and API response sides
- Computes per-keyword pass percentage and classifies outcomes as:
  - `FAIL` when the pass-rate is at or below the configured partial threshold (default ≤90%)
  - `PASS (Need Review)` when the pass-rate falls between the partial and full thresholds (default 90–<100%), logging sample mismatches
  - `PASS` when every item matches (100%)
- Marks empty result sets as `REVIEW` (skips the test after logging) to highlight manual follow-up
- Records response time, total test duration, pass percentage, matched/total counts, status color, and any failure messages in CSV/XLSX output

## Extending the Framework
- Add new environments by extending `environments` in `config/config.json`
- Introduce new queries by editing `test-data/search_queries.json`
- Integrate into Jenkins/GitHub Actions by copying the npm + Playwright commands above and exporting `TEST_ENVIRONMENT`
- Enhance validations or response parsing by updating `tests/searchApi.spec.ts`