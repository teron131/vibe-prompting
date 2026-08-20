/** Translates plain-language evaluation questions into validated read-only queries using the configured helper model. */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { createModel } from "../../clients/llm/langchain.ts";
import { loadRuntimeConfig } from "../../config/index.ts";
import { type EvaluationQueryResponse, evaluationStructuredQuerySchema } from "./schemas.ts";
import type { EvaluationResults } from "./service.ts";

const EXPLORER_TIMEOUT_MS = 20_000;
export const evaluationExplorerQuestionSchema = z.string().trim().min(1).max(1_000);

export type EvaluationExplorerResponse = EvaluationQueryResponse & {
  modelId: string;
  view: {
    kind: "metric" | "table";
    rows: Array<{ label: string; value: number }>;
    title: string;
  };
};

const SYSTEM_PROMPT = `Translate one evaluation-data question into exactly one safe structured query.
The database contains immutable runs, their cases, and typed score facts.
Use count for totals, keyword_count only for case-level phrase totals, group_count for breakdowns, and average only for numeric scores.
When the user asks how many runs or scores mention a phrase, use count with the requested entity and put the phrase and field in filters.search and filters.searchField.
Keyword fields are input, output, comment, evidence, or all.
Available grouping fields are dataType, judge, prompt, revision, status, and targetModel; numeric averages may group by criterion, judge, prompt, revision, or targetModel.
Preserve explicit filters for run, prompt, revision, target model, judge, status, score data type, and date range when they are present.
Never invent identifiers, SQL, fields, operations, joins, or write actions.
When a question cannot be represented exactly, choose the closest conservative read query instead of broadening its scope.
Return one JSON object and no Markdown.
The discriminator property must be named operation, never metric, action, or type.
Valid shapes are {"operation":"count","entity":"runs","filters":{"search":"evidence","searchField":"all"}}, {"operation":"keyword_count","field":"all","keyword":"evidence","filters":{}}, {"operation":"group_count","groupBy":"status","limit":20,"filters":{}}, and {"operation":"average","groupBy":"criterion","limit":20,"filters":{}}.
Omit filters, groupBy, field, and limit when they are not needed.`;

/** Uses the configured low-effort helper model to turn one question into a read-only result query. */
export async function exploreEvaluations(
  evaluationResults: EvaluationResults,
  rawQuestion: unknown,
): Promise<EvaluationExplorerResponse> {
  const question = evaluationExplorerQuestionSchema.parse(rawQuestion);
  const helperModel = loadRuntimeConfig().helperModel;
  const model = createModel({
    maxRetries: 0,
    model: helperModel.id,
    reasoningEffort: "low",
    temperature: 0,
    timeout: EXPLORER_TIMEOUT_MS,
  }).withStructuredOutput(evaluationStructuredQuerySchema, {
    method: "jsonMode",
    name: "evaluationExplorerQuery",
  });
  const query = await model.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(`QUESTION:\n${question}`),
  ]);
  const result = await evaluationResults.query(query);
  const rows = result.rows.length
    ? result.rows.map(({ label, value }) => ({ label, value }))
    : [
        {
          label: result.operation === "average" ? "Average" : "Matching results",
          value: result.value ?? result.matchedCount,
        },
      ];

  return {
    ...result,
    modelId: helperModel.id,
    view: {
      kind: result.rows.length ? "table" : "metric",
      rows,
      title: viewTitle(result),
    },
  };
}

function viewTitle(result: EvaluationQueryResponse): string {
  const { query } = result;
  if (query.operation === "keyword_count") return `Keyword matches: ${query.keyword}`;
  if (query.operation === "group_count") return `Count by ${query.groupBy}`;
  if (query.operation === "average")
    return query.groupBy ? `Numeric average by ${query.groupBy}` : "Numeric score average";
  return `${query.entity[0]?.toLocaleUpperCase()}${query.entity.slice(1)} count`;
}
