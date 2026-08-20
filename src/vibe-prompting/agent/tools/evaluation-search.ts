/** Adapts persisted evaluation records and aggregates into one agent-facing evaluation data toolkit. */

import { tool, type Tool } from "@openai/agents";
import { z } from "zod";

import {
  evaluationFiltersSchema,
  evaluationResultListInputSchema,
  type EvaluationResults,
  type ResultFilters,
} from "../../evaluation/results/index.ts";

const evaluationSearchSchema = evaluationResultListInputSchema.safeExtend({
  caseId: z.uuid().optional().describe("Exact case ID; when supplied, other inputs are ignored."),
  limit: z.number().int().min(1).max(25).default(10).describe("Maximum cases to return."),
});

/** Exposes record retrieval and aggregate analysis as distinct choices while sharing one filter vocabulary. */
export function createEvaluationDataTools(evaluationResults: EvaluationResults): Tool[] {
  return [
    tool({
      name: "search_evaluations",
      description:
        "Find persisted evaluation cases and their complete judge-attributed scores. Supply caseId for one exact case; otherwise use search text, filters, cursor, and limit.",
      parameters: evaluationSearchSchema,
      async execute({ caseId, ...input }) {
        if (caseId) {
          const item = await evaluationResults.getResult(caseId);
          return {
            artifact: { href: resultHref({ runId: item.runId }), kind: "evaluation-search" },
            item,
            summary: `Found evaluation case ${caseId} with ${item.scores.length} scores.`,
          };
        }
        const result = await evaluationResults.listResults(input);
        const { facets: _facets, ...searchResult } = result;
        return {
          artifact: { href: resultHref(result.appliedFilters), kind: "evaluation-search" },
          result: searchResult,
          summary: `Found ${result.total} matching evaluation cases and returned ${result.items.length}.`,
        };
      },
    }),
    tool({
      name: "get_evaluation_analytics",
      description:
        "Get aggregate evaluation totals, score distributions, numeric statistics, execution timing, judge agreement, timeline, and facets for the supplied filters.",
      parameters: evaluationFiltersSchema,
      async execute(filters) {
        const result = await evaluationResults.getAnalytics(filters);
        return {
          artifact: { href: analyticsHref(result.appliedFilters), kind: "evaluation-analytics" },
          result,
          summary: `${result.totals.cases} cases, ${result.totals.scores} scores, and ${result.totals.runs} runs match the current filters.`,
        };
      },
    }),
  ];
}

function analyticsHref(filters: ResultFilters): string {
  const search = filterParams(filters);
  return `/evaluations/analytics${search.size ? `?${search}` : ""}`;
}

function resultHref(filters: ResultFilters): string {
  const search = filterParams(filters);
  return `/evaluations/results${search.size ? `?${search}` : ""}`;
}

function filterParams(filters: ResultFilters): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) search.set(key, value);
  return search;
}
