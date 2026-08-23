/** Owns browser-safe evaluation attempt, score, report, and trend shapes shared by routes and components. */

export type Criterion =
  | { name: string; type: "boolean"; instruction: string }
  | { name: string; type: "categorical"; instruction: string; categories: string[] }
  | { name: string; type: "numeric"; instruction: string; min: number; max: number }
  | { name: string; type: "text"; instruction: string }
  | { name: string; type: "correction"; instruction: string };

export type SavedCriterion = Criterion & { id: string; version: number };

export type EvaluationRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type EvaluationRunSummary = {
  id: string;
  promptId: string;
  promptRevisionId: string;
  promptRevisionNumber: number;
  promptTitle: string;
  targetProfileId: string | null;
  targetProfileName: string | null;
  targetProfileRevisionId: string | null;
  targetModelId: string;
  targetRunId: string | null;
  targetRunTurnId: string | null;
  judgeModelIds: string[];
  caseCount: number;
  configurationFingerprint: string;
  effectiveInstructionsHash: string | null;
  source: "ai" | "human";
  startedByName: string | null;
  chatId: string | null;
  isSyntheticExample: boolean;
  status: EvaluationRunStatus;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type EvaluationScore = {
  id: string;
  criterionPosition: number;
  criterion: Criterion;
  dataType: "BOOLEAN" | "CATEGORICAL" | "CORRECTION" | "NUMERIC" | "TEXT";
  judgeModelId: string;
  value: boolean | number | string;
  comment: string;
  evidence: string[];
};

export type EvaluationCase = {
  id: string;
  position: number;
  input: unknown;
  criteria: Criterion[];
  output: unknown | null;
  scores: EvaluationScore[];
};

export type EvaluationRun = EvaluationRunSummary & {
  promptMarkdown: string;
  targetConfiguration: Record<string, unknown> | null;
  cases: EvaluationCase[];
};

export type EvaluationBatchConfiguration = {
  id: string;
  name: string;
  criteria: Criterion[];
};

export type EvaluationBatchRequest = {
  promptId: string;
  promptRevisionId: string;
  targetModelIds: string[];
  judges: string[];
  configurations: EvaluationBatchConfiguration[];
  cases: Array<{ input: string }>;
  repetitions: number;
  isSyntheticExample: boolean;
};

export type EvaluationBatchJob = {
  id: string;
  executionNumber: number;
  configurationId: string;
  configurationName: string;
  targetModelId: string;
  repetition: number;
  caseCount: number;
  judgeScoreDecisions: number;
};

export type EvaluationBatchPreview = {
  jobs: EvaluationBatchJob[];
  executionCount: number;
  targetCaseInvocations: number;
  judgeScoreDecisions: number;
};

export type EvaluationBatchStart = {
  preview: EvaluationBatchPreview;
  runs: EvaluationRunSummary[];
};

export type EvaluationBatchStatus = { runs: EvaluationRunSummary[] };

export type Criteria = {
  id: string;
  name: string;
  criterionSequence: SavedCriterion[];
  version: number;
};

export type SavedCriterionResponse = { criterion: SavedCriterion };

export type CriterionLibraryResponse = { criterion: SavedCriterion[] };

export type CriteriaInput = { name: string; criterionIds: string[] };

export type CriteriaResponse = { criteria: Criteria };

export type CriteriaListResponse = { criteria: Criteria[] };

export type BooleanTrendPoint = {
  runId: string;
  revisionId: string;
  revisionNumber: number;
  completedAt: string;
  rates: Array<{ criterionPosition: number; criterion: string; passed: number; total: number }>;
};

export type EvaluationRunsResponse = { runs: EvaluationRunSummary[] };
export type EvaluationRunResponse = { run: EvaluationRun; trend: BooleanTrendPoint[] };
