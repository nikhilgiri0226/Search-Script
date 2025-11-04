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

const toTokens = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);

const recordContainsToken = (record: Record<string, unknown>, token: string): boolean => {
  const productName = typeof record.productName === 'string' ? record.productName.toLowerCase() : '';
  const categoryName = typeof record.categoryName === 'string' ? record.categoryName.toLowerCase() : '';

  if (productName.includes(token) || categoryName.includes(token)) {
    return true;
  }

  return false;
};

const itemMatchesCategoryTokens = (item: unknown, tokens: string[]): boolean => {
  if (tokens.length === 0) {
    return true;
  }

  if (typeof item === 'string') {
    const normalized = item.toLowerCase();
    return tokens.some((token) => normalized.includes(token));
  }

  if (item && typeof item === 'object') {
    const record = item as Record<string, unknown>;
    if (tokens.some((token) => recordContainsToken(record, token))) {
      return true;
    }
  }

  return false;
};

test.beforeAll(() => {
  initializeResultsFile(results.outputPath);
});

test.describe('Search functionality validation', () => {
  for (const [index, { category, keyword }] of searchQueries.entries()) {
    const title = `[${index + 1}] ${category} → ${keyword}`;
    test(title, async ({ page }, testInfo) => {
      testCounter += 1;

      const normalizedKeyword = keyword.trim();
      const normalizedCategory = category.trim();
      const categoryTokens = toTokens(normalizedCategory);

      let statusCode = 0;
      let responseTimeMs = 0;
      let actualResults = 0;
      let validationPassed = false;

      try {
        await page.goto(baseURL, { waitUntil: 'load', timeout: timeouts.navigation });

        const searchInput = page.locator(selectors.searchInput);
        await searchInput.waitFor({ state: 'visible', timeout: timeouts.element });
        await searchInput.click({ timeout: timeouts.element });
        await searchInput.fill('');

        const endpointPredicate = (response: Response): boolean => {
          if (!searchEndpointMatcher(response)) {
            return false;
          }

          const urlString = response.url();
          try {
            const parsedUrl = new URL(urlString);
            const paramKey = api.queryParamKey ?? 'keyword';
            const paramValue = parsedUrl.searchParams.get(paramKey);
            if (paramValue && paramValue.toLowerCase().includes(normalizedKeyword.toLowerCase())) {
              return true;
            }
          } catch (error) {
            // Ignore URL parsing errors for non-HTTP(s) URLs.
          }

          const postData = response.request().postData();
          if (postData) {
            try {
              const parsedBody = JSON.parse(postData);
              const paramKey = api.queryParamKey ?? 'keyword';
              const value = parsedBody?.[paramKey];
              if (typeof value === 'string' && value.toLowerCase().includes(normalizedKeyword.toLowerCase())) {
                return true;
              }
            } catch (error) {
              // Non-JSON bodies are ignored.
            }
          }

          return !api.queryParamKey;
        };

        const responsePromise = page.waitForResponse(endpointPredicate, {
          timeout: api.waitForResponseTimeout ?? timeouts.navigation,
        });

        await searchInput.type(normalizedKeyword, { delay: 15, timeout: timeouts.element });

        const start = Date.now();
        let response: Response;

        if (selectors.searchSubmit && selectors.searchSubmit.trim().length > 0) {
          [response] = await Promise.all([
            responsePromise,
            page.locator(selectors.searchSubmit).click({ timeout: timeouts.element }),
          ]);
        } else {
          [response] = await Promise.all([
            responsePromise,
            searchInput.press('Enter'),
          ]);
        }
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

        const apiCategoryValidation =
          actualResults === 0 || responseResults.every((item) => itemMatchesCategoryTokens(item, categoryTokens));

        expect(apiCategoryValidation, 'Every API result should align with the configured category tokens').toBeTruthy();

        const resultItems = page.locator(selectors.searchResultItems);
        await expect(resultItems.first()).toBeVisible({ timeout: timeouts.element });

        const uiCount = await resultItems.count();
        expect(uiCount, 'UI should display at least the configured minimum results').toBeGreaterThanOrEqual(
          validation.expectedMinResults
        );

        const uiKeywordChecks: boolean[] = [];
        const uiCategoryChecks: boolean[] = [];
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
          uiCategoryChecks.push(categoryTokens.length === 0 || categoryTokens.some((token) => combinedText.includes(token)));
        }

        expect(uiKeywordChecks.every(Boolean), 'Every UI item should include the keyword in title or description').toBeTruthy();
        expect(uiCategoryChecks.every(Boolean), 'Every UI item should align with the configured category tokens').toBeTruthy();

        validationPassed = true;
      } finally {
        appendResult(results.outputPath, {
          testId: testCounter,
          category: normalizedCategory,
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
                category: normalizedCategory,
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

        const delay = api.delayBetweenRequestsMs ?? 500;
        if (delay > 0) {
          await page.waitForTimeout(delay);
        }
      }
    });
  }
});
