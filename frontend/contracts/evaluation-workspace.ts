/** Defines browser-safe result exploration, aggregate analytics, and structured read-query contracts for the evaluation workspace. */

import type { Criterion, EvaluationRunStatus } from "./evaluations";

export type EvaluationDataType = "BOOLEAN" | "CATEGORICAL" | "CORRECTION" | "NUMERIC" | "TEXT";

export type EvaluationWorkspaceFilters = {
  search?: string;
  searchField?: "all" | "comment" | "evidence" | "input" | "output";
  criterion?: string;
  runId?: string;
  promptId?: string;
  promptRevisionId?: string;
  targetModels?: string[];
  judgeModels?: string[];
  status?: EvaluationRunStatus;
  dataType?: EvaluationDataType;
  from?: string;
  to?: string;
};

export type ResultFilters = EvaluationWorkspaceFilters;

export type EvaluationWorkspaceProvenance = {
  source: "evaluation_storage";
  generatedAt: string;
  syntheticExamplesIncluded: boolean;
};

export type EvaluationResultScore = {
  id: string;
  criterionPosition: number;
  criterion: Criterion;
  dataType: EvaluationDataType;
  judgeModel: string;
  value: boolean | number | string;
  comment: string;
  evidence: string[];
};

export type EvaluationResultItem = {
  caseId: string;
  runId: string;
  position: number;
  promptRevisionId: string;
  promptRevisionNumber: number;
  promptTitle: string;
  targetModel: string;
  targetRunId: string | null;
  targetRunTurnId: string | null;
  judgeModels: string[];
  status: EvaluationRunStatus;
  input: unknown;
  output: unknown | null;
  scores: EvaluationResultScore[];
  isSyntheticExample: boolean;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type EvaluationWorkspaceFacets = {
  prompts: Array<{ count: number; id: string; label: string }>;
  revisions: Array<{ count: number; value: string }>;
  targetModels: Array<{ count: number; value: string }>;
  judgeModels: Array<{ count: number; value: string }>;
  statuses: Array<{ count: number; value: EvaluationRunStatus }>;
  dataTypes: Array<{ count: number; value: EvaluationDataType }>;
};

export type EvaluationResultsResponse = {
  items: EvaluationResultItem[];
  total: number;
  nextCursor: string | null;
  facets: EvaluationWorkspaceFacets;
  appliedFilters: EvaluationWorkspaceFilters;
  provenance: EvaluationWorkspaceProvenance;
};

export type EvaluationResultResponse = {
  item: EvaluationResultItem;
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
  appliedFilters: EvaluationWorkspaceFilters;
  provenance: EvaluationWorkspaceProvenance;
};

export type EvaluationStructuredQuery =
  | (EvaluationWorkspaceFilters & {
      operation: "count";
      entity: "cases" | "runs" | "scores";
    })
  | (EvaluationWorkspaceFilters & {
      operation: "keyword_count";
      keyword: string;
      field?: "all" | "comment" | "evidence" | "input" | "output";
    })
  | (EvaluationWorkspaceFilters & {
      operation: "group_count";
      groupBy: "dataType" | "judge" | "prompt" | "revision" | "status" | "targetModel";
      limit?: number;
    })
  | (EvaluationWorkspaceFilters & {
      operation: "average";
      groupBy?: "criterion" | "judge" | "prompt" | "revision" | "targetModel";
      limit?: number;
    });

export type EvaluationQueryResponse = {
  operation: EvaluationStructuredQuery["operation"];
  query: EvaluationStructuredQuery;
  answer: string;
  value: number | null;
  matchedCount: number;
  rows: Array<{ label: string; value: number; count?: number }>;
  href: string;
  appliedFilters: EvaluationWorkspaceFilters;
  provenance: EvaluationWorkspaceProvenance;
};
