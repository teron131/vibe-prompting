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

export type BooleanTrendPoint = {
  completedAt: string;
  rates: Array<{ criterion: string; criterionPosition: number; passed: number; total: number }>;
  revisionId: string;
  runId: string;
};

export type EvaluationRunsResponse = { runs: EvaluationRunSummary[] };
export type EvaluationRunResponse = { run: EvaluationRun; trend: BooleanTrendPoint[] };
