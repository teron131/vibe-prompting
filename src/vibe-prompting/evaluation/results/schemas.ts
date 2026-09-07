/** Owns evaluation request and response schemas, typed failures, and the data shapes shared by result reads. */

import { z } from "zod";

import type { Criterion } from "../../criteria/schemas.ts";
import type { EvaluationRunStatus, EvaluationRunSummary } from "../runs/schemas.ts";

export type EvaluationDataType = Uppercase<Criterion["type"]>;

export type ResultFilters = z.infer<typeof evaluationFiltersSchema>;

export type ResultScore = {
  id: string;
  criterionPosition: number;
  criterion: Criterion;
  dataType: EvaluationDataType;
  judgeModel: string;
  value: boolean | number | string;
  comment: string;
  evidence: string[];
};

export type ResultListItem = {
  caseId: string;
  runId: string;
  position: number;
  promptRevisionId: string;
  promptRevisionNumber: number;
  promptTitle: string;
  targetModel: string;
  judgeModels: string[];
  status: EvaluationRunStatus;
  input: unknown;
  output: unknown | null;
  scores: ResultScore[];
  isSyntheticExample: boolean;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  targetRunId: string | null;
  targetRunTurnId: string | null;
};

export type EvaluationWorkspaceFacets = {
  prompts: Array<{ count: number; id: string; label: string }>;
  revisions: Array<{ count: number; value: string }>;
  targetModels: Array<{ count: number; value: string }>;
  judgeModels: Array<{ count: number; value: string }>;
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
  targetModels: string[] | null;
  judgeModels: string[] | null;
  status: EvaluationRunStatus | null;
  dataType: EvaluationDataType | null;
  from: Date | null;
  to: Date | null;
};

export type ResultCursor = { runId: string; position: number; createdAt: string };

const dataTypeSchema = z.enum(["BOOLEAN", "CATEGORICAL", "CORRECTION", "NUMERIC", "TEXT"]);
const statusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
const modelsSchema = z.array(z.string().trim().min(1).max(200)).max(20).optional();
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
    targetModels: modelsSchema,
    judgeModels: modelsSchema,
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
export const evaluationResultListInputSchema = evaluationFiltersSchema.extend({
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const evaluationStructuredQuerySchema = z.discriminatedUnion("operation", [
  evaluationFiltersSchema.safeExtend({
    operation: z.literal("count"),
    entity: z.enum(["cases", "runs", "scores"]),
  }),
  evaluationFiltersSchema.safeExtend({
    operation: z.literal("keyword_count"),
    keyword: z.string().trim().min(1).max(200),
    field: z.enum(["all", "comment", "evidence", "input", "output"]).default("all"),
  }),
  evaluationFiltersSchema.safeExtend({
    operation: z.literal("group_count"),
    groupBy: z.enum(["dataType", "judge", "prompt", "revision", "status", "targetModel"]),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  evaluationFiltersSchema.safeExtend({
    operation: z.literal("average"),
    groupBy: z.enum(["criterion", "judge", "prompt", "revision", "targetModel"]).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
]);
export type EvaluationStructuredQuery = z.infer<typeof evaluationStructuredQuerySchema>;

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

export type StoredEvaluationScore = ResultScore;

type StoredEvaluationCase = {
  id: string;
  position: number;
  input: unknown;
  criteria: Criterion[];
  output: unknown | null;
  scores: StoredEvaluationScore[];
};

export type StoredEvaluationRun = EvaluationRunSummary & {
  promptMarkdown: string;
  targetConfiguration: Record<string, unknown> | null;
  cases: StoredEvaluationCase[];
};

export type BooleanTrendPoint = {
  runId: string;
  revisionId: string;
  revisionNumber: number;
  completedAt: string;
  rates: Array<{ criterionPosition: number; criterion: string; passed: number; total: number }>;
};
