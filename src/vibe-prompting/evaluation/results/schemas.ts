/** Owns the public evaluation result contracts and the validation and normalization rules shared by result workflows. */

import { z } from "zod";

import type { Criterion } from "../api.ts";
import type { EvaluationRunStatus, StoredEvaluationScore } from "../runs/index.ts";

export type EvaluationDataType = StoredEvaluationScore["dataType"];

export type ResultFilters = {
  search?: string;
  searchField?: "all" | "comment" | "evidence" | "input" | "output";
  criterion?: string;
  runId?: string;
  promptId?: string;
  promptRevisionId?: string;
  targetModelId?: string;
  judgeModelId?: string;
  status?: EvaluationRunStatus;
  dataType?: EvaluationDataType;
  from?: string;
  to?: string;
};

export type ResultScore = {
  id: string;
  criterionPosition: number;
  criterion: Criterion;
  dataType: EvaluationDataType;
  judgeModelId: string;
  value: boolean | number | string;
  comment: string;
  evidence: string[];
};

export type ResultListItem = {
  caseId: string;
  runId: string;
  position: number;
  promptId: string;
  promptRevisionId: string;
  promptRevisionNumber: number;
  promptTitle: string;
  targetProfileId: string | null;
  targetProfileRevisionId: string | null;
  targetProfileName: string | null;
  targetModelId: string;
  judgeModelIds: string[];
  source: "ai" | "human";
  status: EvaluationRunStatus;
  input: unknown;
  output: unknown | null;
  scores: ResultScore[];
  configurationFingerprint: string;
  effectiveInstructionsHash: string | null;
  isSyntheticExample: boolean;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type ResultDetail = ResultListItem;

export type EvaluationWorkspaceFacets = {
  prompts: Array<{ count: number; id: string; label: string }>;
  revisions: Array<{ count: number; value: string }>;
  targetModels: Array<{ count: number; value: string }>;
  judges: Array<{ count: number; value: string }>;
  statuses: Array<{ count: number; value: EvaluationRunStatus }>;
  dataTypes: Array<{ count: number; value: EvaluationDataType }>;
};

export type EvaluationWorkspaceProvenance = {
  source: "evaluation_storage";
  generatedAt: string;
  syntheticExamplesIncluded: boolean;
};

export type EvaluationResultsResponse = {
  items: ResultListItem[];
  total: number;
  nextCursor: string | null;
  facets: EvaluationWorkspaceFacets;
  appliedFilters: ResultFilters;
  provenance: EvaluationWorkspaceProvenance;
};

export type EvaluationAnalyticsResponse = {
  totals: { runs: number; cases: number; scores: number };
  boolean: Array<{
    criterionPosition: number;
    criterion: string;
    total: number;
    passed: number;
    failed: number;
    passRate: number;
  }>;
  categorical: Array<{
    criterionPosition: number;
    criterion: string;
    category: string;
    count: number;
  }>;
  numeric: Array<{
    criterionPosition: number;
    criterion: string;
    count: number;
    minimum: number;
    maximum: number;
    average: number;
    median: number;
    p10: number;
    p90: number;
    standardDeviation: number;
  }>;
  execution: {
    completedRuns: number;
    failedRuns: number;
    interruptedRuns: number;
    runningRuns: number;
    totalRuns: number;
    durationMeasuredRuns: number;
    medianDurationMs: number | null;
    p95DurationMs: number | null;
  };
  reliability: {
    agreedJudgeGroups: number;
    comparableJudgeGroups: number;
    judgeAgreementRate: number | null;
  };
  timeline: Array<{ date: string; runs: number; cases: number; scores: number }>;
  facets: EvaluationWorkspaceFacets;
  appliedFilters: ResultFilters;
  provenance: EvaluationWorkspaceProvenance;
};

export type EvaluationStructuredQuery =
  | { operation: "count"; entity: "cases" | "runs" | "scores"; filters?: ResultFilters }
  | {
      operation: "keyword_count";
      keyword: string;
      field?: "all" | "comment" | "evidence" | "input" | "output";
      filters?: ResultFilters;
    }
  | {
      operation: "group_count";
      groupBy: "dataType" | "judge" | "prompt" | "revision" | "status" | "targetModel";
      limit?: number;
      filters?: ResultFilters;
    }
  | {
      operation: "average";
      groupBy?: "criterion" | "judge" | "prompt" | "revision" | "targetModel";
      limit?: number;
      filters?: ResultFilters;
    };

export type EvaluationQueryResponse = {
  operation: EvaluationStructuredQuery["operation"];
  query: EvaluationStructuredQuery;
  answer: string;
  value: number | null;
  matchedCount: number;
  rows: Array<{ label: string; value: number; count?: number }>;
  href: string;
  appliedFilters: ResultFilters;
  provenance: EvaluationWorkspaceProvenance;
};

export type NormalizedFilters = {
  search: string | null;
  searchField: "all" | "comment" | "evidence" | "input" | "output";
  caseIds: string[] | null;
  criterion: string | null;
  runId: string | null;
  promptId: string | null;
  promptRevisionId: string | null;
  targetModelId: string | null;
  judgeModelId: string | null;
  status: EvaluationRunStatus | null;
  dataType: EvaluationDataType | null;
  from: Date | null;
  to: Date | null;
};

export type ResultCursor = { runId: string; position: number; createdAt: string };

const dataTypeSchema = z.enum(["BOOLEAN", "CATEGORICAL", "CORRECTION", "NUMERIC", "TEXT"]);
const statusSchema = z.enum(["completed", "failed", "interrupted", "running"]);
const optionalDateSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Date filters must be ISO timestamps.")
  .optional();
export const evaluationFiltersSchema = z
  .object({
    search: z.string().trim().min(1).max(200).optional(),
    searchField: z.enum(["all", "comment", "evidence", "input", "output"]).optional(),
    criterion: z.string().trim().min(1).max(1_000).optional(),
    runId: z.uuid().optional(),
    promptId: z.uuid().optional(),
    promptRevisionId: z.uuid().optional(),
    targetModelId: z.string().trim().min(1).max(200).optional(),
    judgeModelId: z.string().trim().min(1).max(200).optional(),
    status: statusSchema.optional(),
    dataType: dataTypeSchema.optional(),
    from: optionalDateSchema,
    to: optionalDateSchema,
  })
  .strict()
  .refine(
    ({ from, to }) => !from || !to || Date.parse(from) <= Date.parse(to),
    "The from date must not be after the to date.",
  );
const cursorSchema = z.object({
  runId: z.uuid(),
  position: z.number().int().nonnegative(),
  createdAt: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), "Result cursor timestamp is invalid."),
});
export const evaluationResultListInputSchema = evaluationFiltersSchema.extend({
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const evaluationStructuredQuerySchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("count"),
    entity: z.enum(["cases", "runs", "scores"]),
    filters: evaluationFiltersSchema.optional(),
  }),
  z.object({
    operation: z.literal("keyword_count"),
    keyword: z.string().trim().min(1).max(200),
    field: z.enum(["all", "comment", "evidence", "input", "output"]).default("all"),
    filters: evaluationFiltersSchema.optional(),
  }),
  z.object({
    operation: z.literal("group_count"),
    groupBy: z.enum(["dataType", "judge", "prompt", "revision", "status", "targetModel"]),
    limit: z.number().int().min(1).max(50).default(20),
    filters: evaluationFiltersSchema.optional(),
  }),
  z.object({
    operation: z.literal("average"),
    groupBy: z.enum(["criterion", "judge", "prompt", "revision", "targetModel"]).optional(),
    limit: z.number().int().min(1).max(50).default(20),
    filters: evaluationFiltersSchema.optional(),
  }),
]);

export class EvaluationResultNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(caseId: string) {
    super(`Evaluation result ${caseId} was not found.`);
    this.name = "EvaluationResultNotFoundError";
  }
}

/** Signals malformed result filters, cursors, or structured-query input at the application boundary. */
export class EvaluationQueryRequestError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "EvaluationQueryRequestError";
  }
}

/** Parses untrusted result input into a validated value and preserves one stable public error type. */
export function parseQueryInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new EvaluationQueryRequestError(
      result.error.issues[0]?.message ?? "Invalid evaluation query.",
    );
  return result.data;
}

/** Removes pagination controls before returning the filter shape echoed by result responses. */
export function projectFilters(
  input: z.infer<typeof evaluationResultListInputSchema>,
): ResultFilters {
  const { cursor: _cursor, limit: _limit, ...filters } = input;
  return filters;
}

/** Converts transport strings into SQL-ready values while keeping search membership separate. */
export function normalizeFilters(filters: ResultFilters): NormalizedFilters {
  return {
    search: filters.search ?? null,
    searchField: filters.searchField ?? "all",
    caseIds: null,
    criterion: filters.criterion ?? null,
    runId: filters.runId ?? null,
    promptId: filters.promptId ?? null,
    promptRevisionId: filters.promptRevisionId ?? null,
    targetModelId: filters.targetModelId ?? null,
    judgeModelId: filters.judgeModelId ?? null,
    status: filters.status ?? null,
    dataType: filters.dataType ?? null,
    from: filters.from ? new Date(filters.from) : null,
    to: filters.to ? new Date(filters.to) : null,
  };
}

/** Encodes the chronological result keyset cursor for a URL-safe API response. */
export function encodeResultCursor(cursor: ResultCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

/** Decodes and validates a client cursor without exposing JSON or base64 parsing errors. */
export function decodeResultCursor(value: string): ResultCursor {
  try {
    return parseQueryInput(
      cursorSchema,
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
  } catch (error) {
    if (error instanceof EvaluationQueryRequestError) throw error;
    throw new EvaluationQueryRequestError("Result cursor is invalid.");
  }
}
