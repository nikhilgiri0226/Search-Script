# Playwright Search Validation Framework

End-to-end Playwright + TypeScript framework for validating configurable e-commerce search flows. Tests read runtime settings and data from JSON, validate both API and UI responses, and write execution metrics to CSV for reporting.

## Project Structure

- `config/config.json` – Global framework settings (base URL, selectors, API metadata, timeouts, Playwright options, output paths).
- `test-data/search_queries.json` – List of `{ category, keyword }` pairs to exercise search; add/remove items to update coverage.
- `tests/search.spec.ts` – Main test spec iterating over configured keywords, validating API and UI responses, exporting results to CSV.
- `utils/` – Shared helpers for loading configuration (`configLoader.ts`), JSON traversal (`jsonUtils.ts`), and CSV results management (`resultWriter.ts`).
- `results/results.csv` – Generated per test run; contains timestamped execution summary for each keyword.
- `playwright.config.ts` – Playwright runner configuration derived from `config/config.json`.
- `package.json` / `tsconfig.json` – Node project scaffolding and TypeScript compiler options.

## Configuration

### Base URL, API, and selectors

Update `config/config.json` to point at any deployed environment:

- `environment` – Free-form label written to CSV (e.g., `staging`, `production`).
- `baseURL` – Root application URL under test.
- `api` – Search endpoint metadata.
  - `searchEndpoint` – Partial URL string Playwright waits for (e.g., `/products`).
  - `method` – HTTP verb to match when waiting for the API response (defaults to `GET`).
  - `responseListPath` – Dot-delimited path to the result array inside the JSON payload (e.g., `data.items`).
  - `queryParamKey` – Query string key for the keyword (informational).
  - `waitForResponseTimeout` – Max wait (ms) for the API response.
  - `delayBetweenRequestsMs` – Optional throttle (ms) injected between searches to avoid overwhelming the endpoint.
- `selectors` – CSS selectors for search input, optional submit button, result cards, title, and description. Adjust these when markup changes or to add filter elements.
- `timeouts` – Navigation / element wait thresholds used across the suite.
- `validation` – Expectations for minimum result count and which JSON fields should contain the keyword.
- `playwright` – Runner options (headless, viewport, retries, reporter, etc.). Adjust to tune local vs. CI behaviour.
- `results.outputPath` – Where `results.csv` is written (directories are created on demand).

### Test data (search terms)

Add, remove, or reorder category-keyword pairs within `test-data/search_queries.json`:

```json
{
  "queries": [
    { "category": "Refrigerators", "keyword": "refrigerator" },
    { "category": "Dishwasher", "keyword": "bosch dishwasher" }
  ]
}
```

No code changes are required; the test spec reads this file at runtime. Each run enforces that at least one word from the configured category appears in every API result’s `productName` or `categoryName`, and in the UI tile text, alongside the keyword validation.

### Filters and UI variations

- To introduce additional filters or different interaction patterns, extend the selectors block with any new controls (e.g., `searchSubmit`, filter dropdowns) and update the spec to reference new selectors if needed.
- Because selectors are centralized in `config.json`, QA engineers can re-point to new widgets without modifying TypeScript.

## Running the Tests

### 1. Install dependencies

```bash
npm install
npx playwright install
```

### 2. Execute the suite

- Headless (default): `npm test`
- Headed debug mode: `npm run test:headed`
- View last HTML report: `npm run test:report`

Each run recreates `results/results.csv` with the latest metrics (timestamp, test id, category, keyword, status code, response time, expected vs. actual counts, pass/fail, environment).

## CI/CD Integration

This project is CI friendly—commit the repo and call `npm ci` + `npx playwright install --with-deps` followed by `npm test`. Example GitHub Actions step:

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with:
    node-version: 20
- run: npm ci
- run: npx playwright install --with-deps
- run: npm test
```

Override configuration per environment by checking in additional JSON files and pointing to them via environment variables before running tests:

```bash
export FRAMEWORK_CONFIG_PATH=./config/staging.config.json
export SEARCH_QUERIES_PATH=./test-data/high-priority.json
npm test
```

## Output & Reporting

- `results/results.csv` captures key metrics per keyword (timestamp, category, status, response time, expected/actual counts, validation outcome, environment).
- Additional artifacts (trace/video) can be enabled via the `playwright.trace` / `playwright.video` settings in `config.json` without modifying code.

## Extending the Framework

- Add more specs under `tests/` to cover related flows (e.g., filtered search, pagination). Shared helpers already handle configuration access and CSV logging.
- Expand `validation.resultFieldsToCheck` to match API schema changes or include additional nested properties.
- Introduce new result exporters by reusing `utils/resultWriter.ts` or swapping the output path to an alternative location.