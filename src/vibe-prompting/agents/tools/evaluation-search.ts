/** Owns the toolkit for persisted evaluation records and aggregate analysis. */

import { z } from "zod";

import {
  evaluationFiltersSchema,
  evaluationResultListInputSchema,
  type EvaluationResults,
  type ResultFilters,
} from "../../evaluation/results/index.ts";
import { AgentToolkit, defineAgentTool } from "./api.ts";

const evaluationSearchSchema = evaluationResultListInputSchema.safeExtend({
  caseId: z.uuid().optional().describe("Exact case ID; when supplied, other inputs are ignored."),
  limit: z.number().int().min(1).max(25).default(10).describe("Maximum cases to return."),
});

/** Exposes record retrieval and aggregate analysis as distinct choices while sharing one filter vocabulary. */
export class EvaluationResultsToolkit extends AgentToolkit {
  constructor(evaluationResults: EvaluationResults) {
    super("evaluation-results", [
      defineAgentTool({
        name: "search_evaluations",
        title: "Search evaluation results",
        description:
          "Read one exact persisted evaluation case by ID or search paginated cases by text and shared result filters, including complete judge-attributed scores.",
        parameters: evaluationSearchSchema,
        annotations: { readOnlyHint: true, openWorldHint: false },
        async execute({ caseId, ...input }) {
          if (caseId) {
            const item = await evaluationResults.getResult(caseId);
            return {
              artifact: { kind: "evaluation-search", href: resultHref({ runId: item.runId }) },
              item,
              summary: `Found evaluation case ${caseId} with ${item.scores.length} scores.`,
            };
          }
          const result = await evaluationResults.listResults(input);
          const { facets: _facets, ...searchResult } = result;
          return {
            artifact: { kind: "evaluation-search", href: resultHref(result.appliedFilters) },
            result: searchResult,
            summary: `Found ${result.total} matching evaluation cases and returned ${result.items.length}.`,
          };
        },
      }),
      defineAgentTool({
        name: "get_evaluation_analytics",
        title: "Get evaluation analytics",
        description:
          "Aggregate persisted evaluation cases under shared result filters, returning totals, score distributions, numeric statistics, execution timing, judge agreement, timelines, and facets.",
        parameters: evaluationFiltersSchema,
        annotations: { readOnlyHint: true, openWorldHint: false },
        async execute(filters) {
          const result = await evaluationResults.getAnalytics(filters);
          return {
            artifact: { kind: "evaluation-analytics", href: analyticsHref(result.appliedFilters) },
            result,
            summary: `${result.totals.cases} cases, ${result.totals.scores} scores, and ${result.totals.runs} runs match the current filters.`,
          };
        },
      }),
    ]);
  }
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
  for (const [key, value] of Object.entries(filters)) {
    if (!value) continue;
    if (Array.isArray(value)) {
      const parameter = key === "targetModelIds" ? "targetModelId" : "judgeModelId";
      for (const item of value) search.append(parameter, item);
      continue;
    }
    search.set(key, value);
  }
  return search;
}
