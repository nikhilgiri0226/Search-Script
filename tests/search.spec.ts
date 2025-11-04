import { test, expect } from '@playwright/test';
import type { Response } from '@playwright/test';
import { loadFrameworkConfig, loadSearchQueries } from '../utils/configLoader';
import { getValueByPath, objectMatchesKeyword } from '../utils/jsonUtils';
import { appendResult, initializeResultsFile } from '../utils/resultWriter';

const frameworkConfig = loadFrameworkConfig();
const searchQueries = loadSearchQueries();

const {
  baseURL,
  selectors,
  api,
  validation,
  timeouts,
  results,
  environment,
} = frameworkConfig;

const searchEndpointMatcher = (response: Response): boolean => {
  const endpoint = api.searchEndpoint;
  if (!endpoint) {
    return false;
  }
  const expectedMethod = (api.method ?? 'GET').toUpperCase();
  const requestMethod = response.request().method().toUpperCase();
  if (requestMethod !== expectedMethod) {
    return false;
  }

  const url = response.url();
  if (endpoint.startsWith('http')) {
    return url.startsWith(endpoint);
  }

  return url.includes(endpoint);
};

let testCounter = 0;

test.beforeAll(() => {
  initializeResultsFile(results.outputPath);
});

test.describe('Search functionality validation', () => {
  for (const keyword of searchQueries) {
    test(`should return matching results for "${keyword}"`, async ({ page }, testInfo) => {
      testCounter += 1;

      const normalizedKeyword = keyword.trim();

      let statusCode = 0;
      let responseTimeMs = 0;
      let actualResults = 0;
      let validationPassed = false;

      try {
        await page.goto(baseURL, { waitUntil: 'load', timeout: timeouts.navigation });

        const searchInput = page.locator(selectors.searchInput);
        await searchInput.waitFor({ state: 'visible', timeout: timeouts.element });
        await searchInput.fill('');
        await searchInput.fill(normalizedKeyword, { timeout: timeouts.element });

        const responsePromise = page.waitForResponse(
          (response) => searchEndpointMatcher(response),
          { timeout: api.waitForResponseTimeout ?? timeouts.navigation }
        );

        const start = Date.now();

        if (selectors.searchSubmit && selectors.searchSubmit.trim().length > 0) {
          await page.locator(selectors.searchSubmit).click({ timeout: timeouts.element });
        } else {
          await page.keyboard.press('Enter');
        }

        const response = await responsePromise;
        responseTimeMs = Date.now() - start;
        statusCode = response.status();
        expect(statusCode, 'API response status should be 200').toBe(200);

        const responseBody = await response.json();
        const listPath = api.responseListPath ?? '';
        const resultsPayload = getValueByPath<unknown>(responseBody, listPath);

        expect(Array.isArray(resultsPayload), `Response payload at path "${listPath}" should be an array`).toBeTruthy();

        const responseResults = Array.isArray(resultsPayload) ? resultsPayload : [];
        actualResults = responseResults.length;

        expect(actualResults, 'API should return at least the configured minimum results').toBeGreaterThanOrEqual(
          validation.expectedMinResults
        );

        const apiKeywordValidation =
          actualResults === 0 ||
          responseResults.every((item) =>
            typeof item === 'object' && item != null
              ? objectMatchesKeyword(item as Record<string, unknown>, normalizedKeyword, validation.resultFieldsToCheck)
              : String(item).toLowerCase().includes(normalizedKeyword.toLowerCase())
          );

        expect(apiKeywordValidation, 'Every API result should match the keyword in one of the configured fields').toBeTruthy();

        const resultItems = page.locator(selectors.searchResultItems);
        await expect(resultItems.first()).toBeVisible({ timeout: timeouts.element });

        const uiCount = await resultItems.count();
        expect(uiCount, 'UI should display at least the configured minimum results').toBeGreaterThanOrEqual(
          validation.expectedMinResults
        );

        const uiKeywordChecks: boolean[] = [];
        for (let index = 0; index < uiCount; index += 1) {
          const item = resultItems.nth(index);
          const titleText = selectors.productTitle
            ? await item.locator(selectors.productTitle).first().innerText({ timeout: timeouts.element }).catch(() => '')
            : await item.innerText({ timeout: timeouts.element }).catch(() => '');
          const descriptionText = selectors.productDescription
            ? await item.locator(selectors.productDescription).first().innerText({ timeout: timeouts.element }).catch(() => '')
            : '';
          const combinedText = `${titleText} ${descriptionText}`.toLowerCase();
          uiKeywordChecks.push(combinedText.includes(normalizedKeyword.toLowerCase()));
        }

        expect(uiKeywordChecks.every(Boolean), 'Every UI item should include the keyword in title or description').toBeTruthy();

        validationPassed = true;
      } finally {
        appendResult(results.outputPath, {
          testId: testCounter,
          keyword: normalizedKeyword,
          statusCode,
          responseTimeMs,
          expectedMinResults: validation.expectedMinResults,
          actualResults,
          validationPassed,
          environment,
        });

        if (!validationPassed) {
          await testInfo.attach('search-debug', {
            body: JSON.stringify(
              {
                keyword: normalizedKeyword,
                statusCode,
                responseTimeMs,
                actualResults,
                environment,
              },
              null,
              2
            ),
            contentType: 'application/json',
          });
        }
      }
    });
  }
});
