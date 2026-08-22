/** Defines browser-safe result exploration, aggregate analytics, and structured read-query contracts for the evaluation workspace. */

import type { Criterion, EvaluationRunStatus } from "./evaluations";

export type EvaluationDataType = "BOOLEAN" | "CATEGORICAL" | "CORRECTION" | "NUMERIC" | "TEXT";

export type EvaluationWorkspaceFilters = {
  runId?: string;
  promptId?: string;
  promptRevisionId?: string;
  targetModelIds?: string[];
  judgeModelIds?: string[];
  criterion?: string;
  dataType?: EvaluationDataType;
  status?: EvaluationRunStatus;
  from?: string;
  to?: string;
  search?: string;
  searchField?: "all" | "comment" | "evidence" | "input" | "output";
};

export type ResultFilters = EvaluationWorkspaceFilters;

export type EvaluationWorkspaceProvenance = {
  generatedAt: string;
  source: "evaluation_storage";
  syntheticExamplesIncluded: boolean;
};

export type EvaluationResultScore = {
  comment: string;
  criterion: Criterion;
  criterionPosition: number;
  dataType: EvaluationDataType;
  evidence: string[];
  id: string;
  judgeModelId: string;
  value: boolean | number | string;
};

export type EvaluationResultItem = {
  caseId: string;
  completedAt: string | null;
  createdAt: string;
  errorMessage: string | null;
  input: unknown;
  isSyntheticExample: boolean;
  judgeModelIds: string[];
  output: unknown | null;
  position: number;
  promptRevisionId: string;
  promptRevisionNumber: number;
  promptTitle: string;
  runId: string;
  scores: EvaluationResultScore[];
  status: EvaluationRunStatus;
  targetModelId: string;
  targetRunId: string | null;
  targetRunTurnId: string | null;
};

export type EvaluationWorkspaceFacets = {
  dataTypes: Array<{ count: number; value: EvaluationDataType }>;
  judges: Array<{ count: number; value: string }>;
  prompts: Array<{ count: number; id: string; label: string }>;
  revisions: Array<{ count: number; value: string }>;
  statuses: Array<{ count: number; value: EvaluationRunStatus }>;
  targetModels: Array<{ count: number; value: string }>;
};

export type EvaluationResultsResponse = {
  appliedFilters: EvaluationWorkspaceFilters;
  facets: EvaluationWorkspaceFacets;
  items: EvaluationResultItem[];
  nextCursor: string | null;
  provenance: EvaluationWorkspaceProvenance;
  total: number;
};

export type EvaluationResultResponse = {
  item: EvaluationResultItem;
  provenance: EvaluationWorkspaceProvenance;
};

export type EvaluationAnalyticsResponse = {
  totals: { cases: number; runs: number; scores: number };
  boolean: Array<{
    criterion: string;
    criterionPosition: number;
    failed: number;
    passRate: number;
    passed: number;
    total: number;
  }>;
  categorical: Array<{
    category: string;
    count: number;
    criterion: string;
    criterionPosition: number;
  }>;
  numeric: Array<{
    criterion: string;
    criterionPosition: number;
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
    durationMeasuredRuns: number;
    failedRuns: number;
    interruptedRuns: number;
    medianDurationMs: number | null;
    p95DurationMs: number | null;
    runningRuns: number;
    totalRuns: number;
  };
  reliability: {
    agreedJudgeGroups: number;
    comparableJudgeGroups: number;
    judgeAgreementRate: number | null;
  };
  timeline: Array<{ cases: number; date: string; runs: number; scores: number }>;
  facets: EvaluationWorkspaceFacets;
  appliedFilters: EvaluationWorkspaceFilters;
  provenance: EvaluationWorkspaceProvenance;
};

export type EvaluationStructuredQuery =
  | {
      entity: "cases" | "runs" | "scores";
      filters?: EvaluationWorkspaceFilters;
      operation: "count";
    }
  | {
      field?: "all" | "comment" | "evidence" | "input" | "output";
      filters?: EvaluationWorkspaceFilters;
      keyword: string;
      operation: "keyword_count";
    }
  | {
      filters?: EvaluationWorkspaceFilters;
      groupBy: "dataType" | "judge" | "prompt" | "revision" | "status" | "targetModel";
      limit?: number;
      operation: "group_count";
    }
  | {
      filters?: EvaluationWorkspaceFilters;
      groupBy?: "criterion" | "judge" | "prompt" | "revision" | "targetModel";
      limit?: number;
      operation: "average";
    };

export type EvaluationQueryResponse = {
  answer: string;
  appliedFilters: EvaluationWorkspaceFilters;
  href: string;
  matchedCount: number;
  operation: EvaluationStructuredQuery["operation"];
  provenance: EvaluationWorkspaceProvenance;
  query: EvaluationStructuredQuery;
  rows: Array<{ count?: number; label: string; value: number }>;
  value: number | null;
};
