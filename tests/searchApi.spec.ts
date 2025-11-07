/**
 * Primary Playwright specification for validating the configurable search API.
 *
 * Each keyword/category pair from `test-data/search_queries.json` is executed as an individual Playwright
 * test. The suite performs the following high-level steps:
 *   1. Read configuration and supporting datasets (stopwords, aliases, relevance map).
 *   2. Issue API requests (with optional pagination) respecting concurrency limits/backpressure.
 *   3. Evaluate each response against quality rules (token matching + relevance expansion).
 *   4. Record a summary row to both CSV and XLSX and apply the configured fail strategy.
 *
 * The goal is to keep the implementation entirely data driven so QA engineers can adjust behaviour
 * by editing JSON rather than code.
 */

import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { performance } from "perf_hooks";
import { appendResult, flushResults } from "../utils/resultLogger";
import {
  loadConfig,
  getActiveEnvironment,
  StatusCategory,
  resolveRunnerSettings,
  resolvePaginationSettings,
  loadAliasesConfig,
  AliasGroup,
} from "../utils/configLoader";

// Shape of a single entry in `test-data/search_queries.json`.
interface SearchQuery {
  id?: string;
  category: string;
  keyword: string;
}

// Sub-structure used inside the relevance map for category-specific boosters.
interface RelevanceEntry {
  synonyms?: string[];
  related?: string[];
  brands?: string[];
  form_factors?: string[];
  misspellings?: string[];
}

type RelevanceMap = Record<string, RelevanceEntry>;

// Loaded configuration snapshots – kept at module scope so every Playwright test can read them.
const projectConfig = loadConfig();
const environmentConfig = getActiveEnvironment();
const runnerSettings = resolveRunnerSettings();
const paginationSettings = resolvePaginationSettings();
// Location of the master keyword list.
const queriesPath = path.resolve(
  __dirname,
  "..",
  "test-data",
  "search_queries.json",
);

// Fail fast if the dataset is missing – running an empty suite would be misleading.
if (!fs.existsSync(queriesPath)) {
  throw new Error(`Search queries file not found at ${queriesPath}`);
}

const searchQueriesRaw = fs.readFileSync(queriesPath, "utf-8");
const searchQueriesJson = JSON.parse(searchQueriesRaw) as {
  queries: SearchQuery[];
};
const allSearchQueries = searchQueriesJson.queries ?? [];

// Provide a clear error when the dataset is empty – likely misconfiguration.
if (allSearchQueries.length === 0) {
  throw new Error("No search queries defined in test-data/search_queries.json");
}

// Convert the optional query limit into a positive integer (null means “no limit”).
const resolveQueryLimit = (limit: unknown): number | null => {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return null;
  }
  const integer = Math.trunc(limit);
  return integer > 0 ? integer : null;
};

const effectiveQueryLimit = resolveQueryLimit(runnerSettings.queryLimit);

// Honour the derived limit so long suites can be pared down for smoke runs.
const searchQueries = (() => {
  if (effectiveQueryLimit === null) {
    return allSearchQueries;
  }

  const limited = allSearchQueries.slice(
    0,
    Math.min(effectiveQueryLimit, allSearchQueries.length),
  );

  if (limited.length < allSearchQueries.length) {
    console.info(
      `[runner] queryLimit applied: processing first ${limited.length} of ${allSearchQueries.length} queries.`,
    );
  }

  return limited;
})();

// Enriched vocabulary per category/keyword.
const relevanceMapPath = path.resolve(
  __dirname,
  "..",
  "config",
  "relevanceMap.json",
);
const relevanceMap: RelevanceMap = fs.existsSync(relevanceMapPath)
  ? Object.fromEntries(
      Object.entries(
        JSON.parse(fs.readFileSync(relevanceMapPath, "utf-8")) as RelevanceMap,
      ).map(([key, value]) => [key.toLowerCase(), value]),
    )
  : {};

const stopwordsPath = path.resolve(__dirname, "..", "config", "stopwords.json");
const stopwords: Set<string> = (() => {
  if (!fs.existsSync(stopwordsPath)) {
    return new Set();
  }

  try {
    // The file is a simple `{ "words": [...] }` payload; tolerate missing/invalid data.
    const parsed = JSON.parse(fs.readFileSync(stopwordsPath, "utf-8")) as {
      words?: string[];
    };
    if (!Array.isArray(parsed.words)) {
      return new Set();
    }

    return new Set(
      parsed.words.map((w) => w.trim().toLowerCase()).filter(Boolean),
    );
  } catch (error) {
    console.warn(`Failed to read stopwords from ${stopwordsPath}:`, error);
    return new Set();
  }
})();

// Lowercase and split text into alphanumeric tokens.
const normaliseToWords = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((word) => word.trim())
    .filter(Boolean);

// Remove helper words (e.g. "the", "in") so they do not interfere with matching.
const filterStopwords = (words: string[]): string[] =>
  words.filter((word) => !stopwords.has(word));

// Aliases are cross-cutting synonym groups that complement the per-category relevance map.
const aliasesConfig = loadAliasesConfig();

const aliasMap: Map<string, Set<string>> = (() => {
  const map = new Map<string, Set<string>>();
  const groups: AliasGroup[] = Array.isArray(aliasesConfig.aliases)
    ? aliasesConfig.aliases
    : [];

  for (const group of groups) {
    if (!Array.isArray(group.words)) {
      continue;
    }
    const normalizedWords = group.words
      .flatMap((word) => filterStopwords(normaliseToWords(word)))
      .filter(Boolean);

    for (const word of normalizedWords) {
      if (!map.has(word)) {
        map.set(word, new Set<string>());
      }
      const set = map.get(word)!;
      // Ensure each word in the group points to every other word (bidirectional synonyms).
      for (const other of normalizedWords) {
        if (other !== word) {
          set.add(other);
        }
      }
    }
  }

  return map;
})();

// Utility helper to avoid sprinkling setTimeout boilerplate.
const sleep = (ms: number): Promise<void> =>
  ms > 0
    ? new Promise((resolve) => setTimeout(resolve, ms))
    : Promise.resolve();

// Safely walk a dotted path (e.g. "pagination.totalPages") within a response object.
const getValueByPath = (source: unknown, path?: string): unknown => {
  if (!path) {
    return undefined;
  }

  const segments = path.split(".").filter(Boolean);
  let current: unknown = source;

  for (const segment of segments) {
    if (
      current &&
      typeof current === "object" &&
      segment in (current as Record<string, unknown>)
    ) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }

  return current;
};

// Normalise values extracted from CSV/JSON into finite numbers (or null when unsuitable).
const parseNumberValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return null;
};

// Similar helper for boolean metadata (supports string "true"/"false").
const parseBooleanValue = (value: unknown): boolean | null => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "true") {
      return true;
    }
    if (trimmed === "false") {
      return false;
    }
  }

  return null;
};

/**
 * Lightweight async semaphore used to throttle the number of concurrent API calls.
 * Playwright workers run in parallel, so we share a single semaphore instance to keep
 * the aggregate request count below `runner.maxInFlightRequests`.
 */
class AsyncSemaphore {
  private readonly limit: number;
  private active = 0;
  private readonly queue: Array<(release: () => void) => void> = [];

  constructor(limit: number) {
    this.limit = Math.max(limit, 1);
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.active = Math.max(this.active - 1, 0);
      const waiter = this.queue.shift();
      if (waiter) {
        this.active += 1;
        waiter(this.createRelease());
      }
    };
  }

  acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.createRelease());
    }

    return new Promise((resolve) => {
      this.queue.push((release) => {
        resolve(release);
      });
    });
  }
}

// Generate a minimal set of plural/singular variants for fuzzy matching (fridge <-> fridges).
const expandWordForms = (word: string): string[] => {
  const forms = new Set<string>();
  const trimmed = word.trim().toLowerCase();
  if (!trimmed) {
    return [];
  }

  forms.add(trimmed);

  if (trimmed.endsWith("ies") && trimmed.length > 3) {
    forms.add(`${trimmed.slice(0, -3)}y`);
  }

  if (trimmed.endsWith("es") && trimmed.length > 2) {
    forms.add(trimmed.slice(0, -2));
  }

  if (trimmed.endsWith("s") && trimmed.length > 1) {
    forms.add(trimmed.slice(0, -1));
  }

  return [...forms];
};

// Decide whether two words should be considered equivalent, honouring pluralisation and alias groups.
const wordsMatch = (a: string, b: string): boolean => {
  const formsA = expandWordForms(a);
  const formsB = expandWordForms(b);

  if (formsA.some((form) => formsB.includes(form))) {
    return true;
  }

  for (const form of formsA) {
    const aliasSet = aliasMap.get(form);
    if (aliasSet) {
      for (const alias of aliasSet) {
        if (formsB.includes(alias)) {
          return true;
        }
      }
    }
  }

  for (const form of formsB) {
    const aliasSet = aliasMap.get(form);
    if (aliasSet) {
      for (const alias of aliasSet) {
        if (formsA.includes(alias)) {
          return true;
        }
      }
    }
  }

  return false;
};

const collectRelevanceWords = (word: string): string[] => {
  const collected = new Set<string>();

  for (const form of expandWordForms(word)) {
    // Start with global aliases so every category benefits from the shared vocabulary.
    const aliasMatches = aliasMap.get(form);
    if (aliasMatches) {
      for (const alias of aliasMatches) {
        collected.add(alias);
      }
    }

    const entry = relevanceMap[form];
    if (!entry) {
      continue;
    }

    const categories = Object.values(entry).filter(Array.isArray) as string[][];

    for (const list of categories) {
      for (const term of list) {
        for (const normalised of filterStopwords(normaliseToWords(term))) {
          if (!collected.has(normalised)) {
            collected.add(normalised);
          }
        }
      }
    }
  }

  return [...collected];
};

// Shared semaphore that enforces `runner.maxInFlightRequests` across all workers.
const requestSemaphore = new AsyncSemaphore(
  Math.max(runnerSettings.maxInFlightRequests ?? 1, 1),
);
// Counters updated as the suite progresses; used for logging and fail-strategy calculations.
const totalKeywords = searchQueries.length;
let executedKeywords = 0;
let failedKeywords = 0;
let abortRun = false;
let abortReason: string | null = null;
let reviewKeywords = 0;

// Quality configuration affects how we assign statuses and whether we abort early.
const failStrategy = projectConfig.quality.failStrategy ?? "always";
const failThresholdPercent = projectConfig.quality.failThresholdPercent ?? 10;

test.describe("Search API validation", () => {
  test.afterAll(async () => {
    const processedKeywords = executedKeywords + reviewKeywords;
    const workerLabel =
      typeof process.env.TEST_WORKER_INDEX === "string"
        ? `worker ${process.env.TEST_WORKER_INDEX}`
        : "worker";
    // Log per-worker stats so we can correlate with the aggregated CSV.
    console.info(
      `[runner][${workerLabel}] Keywords processed: ${processedKeywords} ` +
        `(quality failures: ${failedKeywords}, review required: ${reviewKeywords}).`,
    );

    try {
      await flushResults();
    } catch (error) {
      console.warn("Failed to flush result workbooks:", error);
    }
  });

  // Impose the configured delay between keywords to avoid overwhelming the API.
  test.afterEach(async () => {
    const delay = projectConfig.api.delayBetweenCallsMs;
    await sleep(delay);
  });

  // Dynamically build one Playwright test per keyword.
  for (const [index, query] of searchQueries.entries()) {
    const testId = query.id ?? `TST_${String(index + 1).padStart(3, "0")}`;

    test(`[${testId}] should validate API search results for keyword "${query.keyword}"`, async ({
      request,
    }, testInfo) => {
      // Honour fail-fast/threshold decisions from earlier keywords.
      if (abortRun) {
        test.skip(true, abortReason ?? "Aborted by fail strategy.");
      }

      // Capture timings for response and full test duration metrics.
      const testStart = Date.now();
      // Combine the environment base URL with the configured endpoint.
      const url = `${environmentConfig.baseUrl}${projectConfig.api.endpoint}`;

      // Build request parameters from environment defaults + the active keyword.
      const baseParams = {
        ...environmentConfig.defaultParams,
        keyword: query.keyword,
      } as Record<string, string | number | boolean>;

      // Aggregate items across pages so quality checks see the full dataset.
      const aggregatedData: Array<Record<string, unknown>> = [];
      let httpStatus = 0;
      let responseTimeMs = 0;
      let pagesFetched = 0;
      // Track API-reported total counts so we can surface discrepancies in error messages.
      let expectedTotalCountFromPagination: number | null = null;

      // These variables accumulate outcome details that will eventually be logged to CSV/XLSX.
      let statusCategory: StatusCategory = "FAIL";
      let statusDisplay = "FAIL";
      let errorMessage = "";
      let totalCount = 0;
      let matchedCount = 0;
      let passPercentage: number | null = null;
      // Indicates whether this keyword should fail the Playwright test (per fail strategy).
      let shouldFailThisTest = false;
      let failureRatio = 0;

      try {
        const pagination = paginationSettings;
        const pageMode = pagination.mode ?? "firstPage";
        const pageParam = pagination.pageParam;
        const pageSizeParam = pagination.pageSizeParam;
        const pageSizeValue = pagination.pageSize ?? null;
        const pauseBetweenPagesMs = pagination.pauseBetweenPagesMs ?? 0;
        const maxPages = pagination.maxPages ?? 0;
        const responseFields = pagination.responseFields ?? {};

        let currentPage = pagination.startPage ?? 1;

        // Keep fetching pages until the configured mode/metadata says to stop.
        while (true) {
          const paramsForRequest: Record<string, string | number | boolean> = {
            ...baseParams,
          };

          if (pageParam) {
            paramsForRequest[pageParam] = currentPage;
          }

          if (
            pageSizeParam &&
            pageSizeValue !== null &&
            pageSizeValue !== undefined
          ) {
            paramsForRequest[pageSizeParam] = pageSizeValue;
          }

          const releaseSemaphore = await requestSemaphore.acquire();
          let response: Awaited<ReturnType<typeof request.get>>;
          try {
            const responseStart = performance.now();
            response = await request.get(url, {
              params: paramsForRequest,
              timeout: projectConfig.api.timeoutMs,
            });
            responseTimeMs += Math.round(performance.now() - responseStart);
          } finally {
            releaseSemaphore();
          }

          httpStatus = response.status();
          expect(projectConfig.api.expectedStatusCodes).toContain(httpStatus);

          const body = (await response.json()) as Record<string, unknown>;

          if (pagesFetched === 0) {
            // Only validate the envelope once; subsequent pages may omit ancillary fields.
            expect(body).toHaveProperty("data");
            expect(typeof body.success).toBe("boolean");
            expect(typeof body.msg).toBe("string");
            expect(typeof body.category).toBe("object");
          } else if (!("data" in body)) {
            throw new Error("Pagination response missing data array.");
          }

          const dataRaw = body.data;
          if (!Array.isArray(dataRaw)) {
            throw new Error("Response data is not an array.");
          }

          aggregatedData.push(...(dataRaw as Array<Record<string, unknown>>));

          const pageCurrent = parseNumberValue(
            getValueByPath(body, responseFields.currentPage),
          );
          const totalPages = parseNumberValue(
            getValueByPath(body, responseFields.totalPages),
          );
          const hasNextPage = parseBooleanValue(
            getValueByPath(body, responseFields.hasNextPage),
          );
          const totalCountValue = parseNumberValue(
            getValueByPath(body, responseFields.totalCount),
          );

          if (totalCountValue !== null && totalCountValue >= 0) {
            expectedTotalCountFromPagination = totalCountValue;
          }

          pagesFetched += 1;

          if (pageMode !== "allPages") {
            break;
          }

          // Determine whether a follow-up page should be requested.
          let shouldContinue = false;
          const resolvedCurrentPage = pageCurrent ?? currentPage;
          const nextPageCandidate = resolvedCurrentPage + 1;

          if (hasNextPage !== null) {
            shouldContinue = hasNextPage;
          } else if (totalPages !== null) {
            shouldContinue = nextPageCandidate <= totalPages;
          }

          if (maxPages && maxPages > 0 && pagesFetched >= maxPages) {
            shouldContinue = false;
          }

          if (!shouldContinue) {
            break;
          }

          currentPage = nextPageCandidate;

          if (pauseBetweenPagesMs > 0) {
            await sleep(pauseBetweenPagesMs);
          }
        }

        const data = aggregatedData;
        totalCount = data.length;

        if (data.length === 0) {
          statusCategory = "REVIEW";
          statusDisplay = "REVIEW";
          errorMessage = "No results returned; requires manual review.";
        } else {
          const referenceWords = new Set<string>([
            ...filterStopwords(normaliseToWords(query.category)),
            ...filterStopwords(normaliseToWords(query.keyword)),
          ]);

          // Expand the vocabulary breadth-first so relevance additions cascade.
          const processedReferenceWords = new Set<string>();
          const queue: string[] = [...referenceWords];

          while (queue.length > 0) {
            const current = queue.pop();
            if (!current || processedReferenceWords.has(current)) {
              continue;
            }

            processedReferenceWords.add(current);

            for (const relatedWord of collectRelevanceWords(current)) {
              if (!referenceWords.has(relatedWord)) {
                referenceWords.add(relatedWord);
                queue.push(relatedWord);
              }
            }
          }

          const itemMatchesCategory = (
            item: Record<string, unknown>,
          ): boolean => {
            const categoryName = String(item.categoryName ?? "");
            const productName = String(item.productName ?? "");
            const itemWords = filterStopwords([
              ...normaliseToWords(categoryName),
              ...normaliseToWords(productName),
            ]);

            return Array.from(referenceWords).some((categoryWord) =>
              itemWords.some((itemWord) => wordsMatch(categoryWord, itemWord)),
            );
          };

          const mismatches = data.filter((item) => !itemMatchesCategory(item));
          matchedCount = data.length - mismatches.length;
          passPercentage = Number(
            ((matchedCount / data.length) * 100).toFixed(2),
          );

          const { partialPassPercentage, fullPassPercentage } =
            projectConfig.quality;

          if (passPercentage <= partialPassPercentage) {
            statusCategory = "FAIL";
            statusDisplay = "FAIL";
          } else if (passPercentage < fullPassPercentage) {
            statusCategory = "PASS_REVIEW";
            statusDisplay = "PASS (Need Review)";
          } else {
            statusCategory = "PASS";
            statusDisplay = "PASS";
          }

          if (statusCategory === "FAIL" || statusCategory === "PASS_REVIEW") {
            const sample = mismatches.slice(0, 3).map((item) => {
              const categoryName = String(item.categoryName ?? "");
              const productName = String(item.productName ?? "");
              return `{categoryName: "${categoryName}", productName: "${productName}"}`;
            });
            // Include a short mismatch sample to aid downstream triage.
            const baseMessage = `Matched ${matchedCount} of ${data.length} item(s). Sample mismatches: ${sample.join(", ")}`;
            if (
              expectedTotalCountFromPagination !== null &&
              expectedTotalCountFromPagination > data.length
            ) {
              errorMessage = `${baseMessage}. Pagination reported ${expectedTotalCountFromPagination} total items.`;
            } else {
              errorMessage = baseMessage;
            }
          }
        }
      } catch (error) {
        statusCategory = statusCategory === "REVIEW" ? statusCategory : "FAIL";
        statusDisplay = statusCategory === "REVIEW" ? statusDisplay : "FAIL";
        errorMessage =
          error instanceof Error ? error.message : JSON.stringify(error);
      }

      const testDurationSeconds = Number(
        ((Date.now() - testStart) / 1000).toFixed(2),
      );

      // Track whether this keyword contributes to aggregate statistics (review cases are omitted).
      let countedTowardsStats = false;
      if (statusCategory !== "REVIEW") {
        countedTowardsStats = true;
        executedKeywords += 1;
      }

      if (statusCategory === "FAIL") {
        failedKeywords += 1;
        // Maintain the running failure percentage so threshold/fail-fast logic can act on it.
        failureRatio =
          executedKeywords > 0 ? (failedKeywords / executedKeywords) * 100 : 0;
        const passRateDisplay =
          passPercentage === null || Number.isNaN(passPercentage)
            ? "N/A"
            : passPercentage.toFixed(2);
        // Soft-assert so Playwright records the failure but the suite continues (matching CSV output).
        const failMessage =
          errorMessage ||
          `Keyword '${query.keyword}' failed quality checks (${passRateDisplay}% pass rate).`;
        expect.soft(statusCategory, failMessage).toBe("PASS");

        // Fail strategy controls how aggressively the suite reacts to a failed keyword.
        switch (failStrategy) {
          case "fail-fast":
            abortRun = true;
            abortReason = `Fail-fast triggered by ${testId}`;
            shouldFailThisTest = true;
            break;
          case "always":
            shouldFailThisTest = true;
            break;
          case "threshold":
            if (failureRatio >= failThresholdPercent) {
              abortRun = true;
              abortReason = `Failure threshold ${failThresholdPercent}% reached (${failureRatio.toFixed(2)}%)`;
              shouldFailThisTest = true;
            } else {
              testInfo.annotations.push({
                type: "warning",
                description:
                  errorMessage ||
                  `Keyword '${query.keyword}' failed but below threshold (${failureRatio.toFixed(2)}% so far).`,
              });
            }
            break;
          case "continue":
          default:
            testInfo.annotations.push({
              type: "warning",
              description:
                errorMessage ||
                `Keyword '${query.keyword}' failed quality checks (continue mode).`,
            });
            break;
        }
      }

      // Append a row to the CSV immediately; XLSX rebuild is deferred in the logger.
      await appendResult({
        testId,
        timestamp: new Date().toISOString(),
        environment: environmentConfig.name,
        keyword: `${query.keyword} (${query.category})`,
        status: statusDisplay,
        statusCategory,
        passPercentage,
        matchedCount,
        totalCount,
        statusColor: projectConfig.quality.statusColors[statusCategory] ?? "",
        responseTimeMs,
        httpStatusCode: httpStatus,
        errorMessage,
        testDurationSeconds,
      });

      if (
        countedTowardsStats &&
        runnerSettings.batchSize > 0 &&
        runnerSettings.batchPauseMs > 0 &&
        executedKeywords % runnerSettings.batchSize === 0 &&
        executedKeywords < totalKeywords
      ) {
        // Optional batch pause provides extra backpressure for large suites.
        await new Promise((resolve) =>
          setTimeout(resolve, runnerSettings.batchPauseMs),
        );
      }

      if (statusCategory === "REVIEW") {
        // Playwright will register this test as skipped while still logging the outcome.
        reviewKeywords += 1;
        test.skip(
          true,
          `Keyword '${query.keyword}' returned no results. Marked for review.`,
        );
      }

      // If the active fail strategy dictates a hard failure, surface it to Playwright now.
      if (shouldFailThisTest) {
        throw new Error(
          errorMessage ||
            `Pass percentage ${passPercentage ?? 0}% below threshold for keyword '${query.keyword}'.`,
        );
      }
    });
  }
});
