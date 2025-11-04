import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { appendResult } from '../utils/resultLogger';
import { loadConfig, getActiveEnvironment } from '../utils/configLoader';

interface SearchQuery {
  id?: string;
  category: string;
  keyword: string;
}

const projectConfig = loadConfig();
const environmentConfig = getActiveEnvironment();
const queriesPath = path.resolve(__dirname, '..', 'test-data', 'search_queries.json');

if (!fs.existsSync(queriesPath)) {
  throw new Error(`Search queries file not found at ${queriesPath}`);
}

const searchQueriesRaw = fs.readFileSync(queriesPath, 'utf-8');
const searchQueriesJson = JSON.parse(searchQueriesRaw) as { queries: SearchQuery[] };
const searchQueries = searchQueriesJson.queries ?? [];

if (searchQueries.length === 0) {
  throw new Error('No search queries defined in test-data/search_queries.json');
}

test.describe('Search API validation', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterEach(async () => {
    const delay = projectConfig.api.delayBetweenCallsMs;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  });

  for (const [index, query] of searchQueries.entries()) {
    const testId = query.id ?? `TST_${String(index + 1).padStart(3, '0')}`;

    test(`should validate API search results for keyword "${query.keyword}"`, async ({ request }) => {
      const testStart = Date.now();
      const url = `${environmentConfig.baseUrl}${projectConfig.api.endpoint}`;

      const params = {
        ...environmentConfig.defaultParams,
        keyword: query.keyword
      } as Record<string, string | number | boolean>;

      const responseStart = performance.now();
      const response = await request.get(url, {
        params,
        timeout: projectConfig.api.timeoutMs
      });
      const responseTimeMs = Math.round(performance.now() - responseStart);
      const httpStatus = response.status();

      let status: 'PASS' | 'FAIL' | 'REVIEW' = 'FAIL';
      let errorMessage = '';

      try {
        expect(projectConfig.api.expectedStatusCodes).toContain(httpStatus);

        const body = await response.json();

        expect(body).toHaveProperty('data');
        expect(typeof body.success).toBe('boolean');
        expect(typeof body.msg).toBe('string');
        expect(typeof body.category).toBe('object');
        expect(Array.isArray(body.data)).toBeTruthy();

        const data = body.data as Array<Record<string, unknown>>;

        if (data.length === 0) {
          status = 'REVIEW';
          errorMessage = 'No results returned; requires manual review.';
        } else {
          const categoryWords = query.category
            .split(/\s+/)
            .map((word) => word.trim().toLowerCase())
            .filter(Boolean);

          const itemMatchesCategory = (item: Record<string, unknown>): boolean => {
            const categoryName = String(item.categoryName ?? '').toLowerCase();
            const productName = String(item.productName ?? '').toLowerCase();
            const tokenise = (value: string) => value.split(/\s+/).filter(Boolean);
            const itemWordSet = new Set<string>([...tokenise(categoryName), ...tokenise(productName)]);
            return categoryWords.some((word) => itemWordSet.has(word));
          };

          const mismatches = data.filter((item) => !itemMatchesCategory(item));

          if (mismatches.length > 0) {
            status = 'FAIL';
            errorMessage = `Found ${mismatches.length} item(s) without category word match.`;
          } else {
            status = 'PASS';
          }
        }
      } catch (error) {
        status = status === 'REVIEW' ? status : 'FAIL';
        errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      }

      const testDurationSeconds = Number(((Date.now() - testStart) / 1000).toFixed(2));

      appendResult({
        testId,
        timestamp: new Date().toISOString(),
        environment: environmentConfig.name,
        keyword: `${query.keyword} (${query.category})`,
        status,
        responseTimeMs,
        httpStatusCode: httpStatus,
        errorMessage,
        testDurationSeconds
      });

      if (status === 'REVIEW') {
        test.skip(`Keyword '${query.keyword}' returned no results. Marked for review.`);
      }

      expect(status).toBe('PASS');
    });
  }
});
