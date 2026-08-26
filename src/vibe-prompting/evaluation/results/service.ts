/** Owns validated evaluation query orchestration while keeping PostgreSQL projections behind a private implementation. */

import { z } from "zod";

import type { Database } from "../../database/index.ts";
import type { HybridSearch } from "../../search.ts";
import {
  countFilteredCases,
  projectCaseResults,
  selectBooleanAggregates,
  selectCategoricalAggregates,
  selectExecutionSummary,
  selectFacets,
  selectGroupedRows,
  selectNumericAggregates,
  selectNumericQueryRows,
  selectReliabilitySummary,
  selectResultById,
  selectResultRows,
  selectScoresForCases,
  selectSearchDocuments,
  selectTimeline,
  selectTotals,
} from "./queries.ts";
import {
  decodeResultCursor,
  encodeResultCursor,
  type EvaluationAnalyticsResponse,
  evaluationFiltersSchema,
  type EvaluationQueryResponse,
  evaluationResultListInputSchema,
  EvaluationResultNotFoundError,
  type EvaluationResultsResponse,
  type EvaluationStructuredQuery,
  evaluationStructuredQuerySchema,
  type EvaluationWorkspaceProvenance,
  type NormalizedFilters,
  normalizeFilters,
  parseQueryInput,
  projectEvaluationQueryFilters,
  projectFilters,
  type ResultFilters,
  type ResultListItem,
} from "./schemas.ts";

/** Reads result cases and score facts while applying one consistent filter set to every view. */
export class EvaluationResults {
  readonly #database: Database;
  readonly #search: HybridSearch;

  constructor(database: Database, search: HybridSearch) {
    this.#database = database;
    this.#search = search;
  }

  /** Lists cases in chronological keyset order, preserving the same search membership used by facets and totals. */
  async listResults(rawInput: unknown = {}): Promise<EvaluationResultsResponse> {
    const input = parseQueryInput(evaluationResultListInputSchema, rawInput);
    const appliedFilters = projectFilters(input);
    const filters = await this.#resolveFilters(appliedFilters);
    const cursor = input.cursor ? decodeResultCursor(input.cursor) : null;
    return this.#database.run(async (sql) => {
      const rows = await selectResultRows(sql, filters, cursor, input.limit + 1);
      const page = rows.slice(0, input.limit);
      const [scores, [count], facets] = await Promise.all([
        selectScoresForCases(
          sql,
          page.map(({ caseId }) => caseId),
        ),
        countFilteredCases(sql, filters),
        selectFacets(sql, filters),
      ]);
      const items = projectCaseResults(page, scores);
      const last = page.at(-1);
      return {
        items,
        total: count?.count ?? 0,
        nextCursor:
          rows.length > input.limit && last
            ? encodeResultCursor({
                runId: last.runId,
                position: last.position,
                createdAt: last.createdAt.toISOString(),
              })
            : null,
        facets,
        appliedFilters,
        provenance: provenance(),
      };
    });
  }

  /** Loads one case with its score facts and raises a typed not-found error for unknown IDs. */
  async getResult(caseId: string): Promise<ResultListItem> {
    const parsedId = parseQueryInput(z.uuid(), caseId);
    return this.#database.run(async (sql) => {
      const rows = await selectResultById(sql, parsedId);
      const row = rows[0];
      if (!row) throw new EvaluationResultNotFoundError(parsedId);
      const scores = await selectScoresForCases(sql, [parsedId]);
      return projectCaseResults([row], scores)[0]!;
    });
  }

  /** Aggregates score facts and facets over exactly the cases visible to the supplied filters. */
  async getAnalytics(rawFilters: unknown = {}): Promise<EvaluationAnalyticsResponse> {
    const appliedFilters = parseQueryInput(evaluationFiltersSchema, rawFilters);
    const filters = await this.#resolveFilters(appliedFilters);
    return this.#database.run(async (sql) => {
      const [totals, boolean, categorical, numeric, execution, reliability, timeline, facets] =
        await Promise.all([
          selectTotals(sql, filters),
          selectBooleanAggregates(sql, filters),
          selectCategoricalAggregates(sql, filters),
          selectNumericAggregates(sql, filters),
          selectExecutionSummary(sql, filters),
          selectReliabilitySummary(sql, filters),
          selectTimeline(sql, filters),
          selectFacets(sql, filters),
        ]);
      return {
        totals: totals[0] ?? { runs: 0, cases: 0, scores: 0 },
        boolean: boolean.map((row) => ({
          ...row,
          passRate: row.total ? row.passed / row.total : 0,
        })),
        categorical,
        numeric,
        execution: execution[0] ?? {
          completedRuns: 0,
          failedRuns: 0,
          interruptedRuns: 0,
          runningRuns: 0,
          totalRuns: 0,
          durationMeasuredRuns: 0,
          medianDurationMs: null,
        },
        reliability: reliability[0] ?? {
          agreedJudgeGroups: 0,
          comparableJudgeGroups: 0,
          judgeAgreementRate: null,
        },
        timeline,
        facets,
        appliedFilters,
        provenance: provenance(),
      };
    });
  }

  /** Executes only the allowlisted aggregate operations represented by the structured-query schema. */
  async query(rawQuery: unknown): Promise<EvaluationQueryResponse> {
    const query = parseQueryInput(
      evaluationStructuredQuerySchema,
      rawQuery,
    ) as EvaluationStructuredQuery;
    const appliedFilters = projectEvaluationQueryFilters(query);
    if (query.operation === "count") {
      const analytics = await this.getAnalytics(appliedFilters);
      const value = analytics.totals[query.entity];
      return buildQueryResponse(
        query,
        appliedFilters,
        value,
        [],
        `${value} ${query.entity} match the current filters.`,
      );
    }
    if (query.operation === "keyword_count") {
      const keywordFilters = {
        ...appliedFilters,
        search: query.keyword,
        searchField: query.field ?? "all",
      } satisfies ResultFilters;
      const filters = await this.#resolveFilters(keywordFilters);
      const [count] = await this.#database.run(async (sql) => countFilteredCases(sql, filters));
      const value = count?.count ?? 0;
      return buildQueryResponse(
        query,
        keywordFilters,
        value,
        [],
        `${value} cases match “${query.keyword}” in ${query.field ?? "all searchable fields"}.`,
      );
    }
    if (query.operation === "group_count") {
      const analytics = await this.getAnalytics(appliedFilters);
      const rows = selectGroupedRows(analytics.facets, query.groupBy).slice(0, query.limit ?? 20);
      const matchedCount = rows.reduce((sum, row) => sum + row.value, 0);
      return buildQueryResponse(
        query,
        appliedFilters,
        matchedCount,
        rows,
        `${rows.length} ${query.groupBy} groups summarize ${matchedCount} matching case memberships.`,
      );
    }
    const filters = await this.#resolveFilters(appliedFilters);
    const rows = await this.#database.run(async (sql) =>
      selectNumericQueryRows(sql, filters, query.groupBy, query.limit ?? 20),
    );
    const value = query.groupBy ? null : (rows[0]?.value ?? null);
    return buildQueryResponse(
      query,
      appliedFilters,
      value,
      rows,
      value === null
        ? `${rows.length} numeric-score groups are available.`
        : `The average numeric score is ${formatNumber(value)}.`,
    );
  }

  /** Resolves keyword-first search with semantic fallback to case membership before SQL pagination and aggregation run. */
  async #resolveFilters(appliedFilters: ResultFilters): Promise<NormalizedFilters> {
    const filters = normalizeFilters(appliedFilters);
    if (!filters.search) return filters;
    const documents = await this.#database.run(async (sql) =>
      selectSearchDocuments(
        sql,
        {
          ...filters,
          caseIds: null,
          dataType: null,
          judgeModels: null,
          promptId: null,
          promptRevisionId: null,
          status: null,
          targetModels: null,
        },
        filters.searchField,
      ),
    );
    const matches = await this.#search.findMatches(
      `evaluation:${filters.searchField}`,
      filters.search,
      documents,
    );
    return { ...filters, caseIds: matches.map(({ value }) => value) };
  }
}

function provenance(): EvaluationWorkspaceProvenance {
  return {
    source: "evaluation_storage",
    generatedAt: new Date().toISOString(),
    syntheticExamplesIncluded: true,
  };
}

function buildQueryResponse(
  query: EvaluationStructuredQuery,
  appliedFilters: ResultFilters,
  value: number | null,
  rows: Array<{ count?: number; label: string; value: number }>,
  answer: string,
): EvaluationQueryResponse {
  const search = new URLSearchParams();
  for (const [key, filter] of Object.entries(appliedFilters)) {
    if (!filter) continue;
    if (Array.isArray(filter)) {
      const parameter = key === "targetModels" ? "targetModel" : "judgeModel";
      for (const item of filter) search.append(parameter, item);
      continue;
    }
    search.set(key, filter);
  }
  const suffix = search.toString();
  return {
    operation: query.operation,
    query,
    answer,
    value,
    matchedCount: value ?? rows.reduce((sum, row) => sum + (row.count ?? 1), 0),
    rows,
    href: `/evaluations/results${suffix ? `?${suffix}` : ""}`,
    appliedFilters,
    provenance: provenance(),
  };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value);
}
