/** Owns browser-safe evaluation attempt, score, report, and trend shapes shared by routes and components. */

export type Criterion =
  | { instruction: string; type: "boolean" }
  | { categories: string[]; instruction: string; type: "categorical" }
  | { instruction: string; max: number; min: number; type: "numeric" }
  | { instruction: string; type: "text" }
  | { instruction: string; type: "correction" };

export type EvaluationRunStatus = "completed" | "failed" | "interrupted" | "running";

export type EvaluationRunSummary = {
  caseCount: number;
  chatId: string | null;
  completedAt: string | null;
  configurationFingerprint: string;
  createdAt: string;
  effectiveInstructionsHash: string | null;
  errorMessage: string | null;
  id: string;
  isSyntheticExample: boolean;
  judgeModelIds: string[];
  promptId: string;
  promptRevisionId: string;
  promptTitle: string;
  source: "ai" | "human";
  status: EvaluationRunStatus;
  targetProfileId: string | null;
  targetProfileName: string | null;
  targetProfileRevisionId: string | null;
  targetModelId: string;
};

export type EvaluationScore = {
  comment: string;
  criterion: Criterion;
  criterionPosition: number;
  dataType: "BOOLEAN" | "CATEGORICAL" | "CORRECTION" | "NUMERIC" | "TEXT";
  evidence: string[];
  id: string;
  judgeModelId: string;
  value: boolean | number | string;
};

export type EvaluationCase = {
  criteria: Criterion[];
  id: string;
  input: unknown;
  output: unknown | null;
  position: number;
  scores: EvaluationScore[];
};

export type EvaluationRun = EvaluationRunSummary & {
  cases: EvaluationCase[];
  promptMarkdown: string;
  targetConfiguration: Record<string, unknown> | null;
};

export type EvaluationBatchConfiguration = {
  criteria: Criterion[];
  id: string;
  name: string;
};

export type EvaluationBatchRequest = {
  cases: Array<{ input: string }>;
  configurations: EvaluationBatchConfiguration[];
  isSyntheticExample: boolean;
  judges: string[];
  promptId: string;
  promptRevisionId: string;
  repetitions: number;
  targetModelIds: string[];
};

export type EvaluationBatchJob = {
  caseCount: number;
  configurationId: string;
  configurationName: string;
  criterionCount: number;
  executionNumber: number;
  id: string;
  judgeScoreDecisions: number;
  repetition: number;
  targetModelId: string;
};

export type EvaluationBatchPreview = {
  executionCount: number;
  jobs: EvaluationBatchJob[];
  judgeScoreDecisions: number;
  targetCaseInvocations: number;
};

export type EvaluationBatchStart = {
  preview: EvaluationBatchPreview;
  runs: EvaluationRunSummary[];
};

export type EvaluationBatchStatus = { runs: EvaluationRunSummary[] };

export type CriteriaProfile = {
  createdAt: string;
  criteria: Criterion[];
  id: string;
  isDefault: boolean;
  name: string;
  updatedAt: string;
};

export type CriteriaProfileInput = { criteria: Criterion[]; name: string };

export type CriteriaProfileResponse = { profile: CriteriaProfile };

export type CriteriaProfilesResponse = { profiles: CriteriaProfile[] };

export type BooleanTrendPoint = {
  completedAt: string;
  rates: Array<{ criterion: string; criterionPosition: number; passed: number; total: number }>;
  revisionId: string;
  runId: string;
};

export type EvaluationRunsResponse = { runs: EvaluationRunSummary[] };
export type EvaluationRunResponse = { run: EvaluationRun; trend: BooleanTrendPoint[] };
