/** Owns durable evaluation run schemas, public result shapes, limits, and request-safe errors. */

import { z } from "zod";

import { type Criterion, requestSchema } from "../api.ts";

export type EvaluationRunStatus = "completed" | "failed" | "interrupted" | "running";
export type EvaluationRunSource = "ai" | "human";

export type EvaluationBatchJob = {
  id: string;
  executionNumber: number;
  configurationId: string;
  configurationName: string;
  targetModelId: string;
  repetition: number;
  caseCount: number;
  criterionCount: number;
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

export type EvaluationRunSummary = {
  id: string;
  source: EvaluationRunSource;
  status: EvaluationRunStatus;
  promptId: string;
  promptRevisionId: string;
  promptRevisionNumber: number;
  promptTitle: string;
  targetProfileId: string | null;
  targetProfileRevisionId: string | null;
  targetProfileName: string | null;
  targetModelId: string;
  judgeModelIds: string[];
  caseCount: number;
  configurationFingerprint: string;
  effectiveInstructionsHash: string | null;
  chatId: string | null;
  isSyntheticExample: boolean;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type StoredEvaluationScore = {
  id: string;
  criterionPosition: number;
  criterion: Criterion;
  dataType: "BOOLEAN" | "CATEGORICAL" | "CORRECTION" | "NUMERIC" | "TEXT";
  judgeModelId: string;
  value: boolean | number | string;
  comment: string;
  evidence: string[];
};

export type StoredEvaluationCase = {
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

/** Validates one durable run request and its exact prompt, model, and provenance pins. */
export const evaluationRunInputSchema = requestSchema.extend({
  promptId: z.uuid(),
  promptRevisionId: z.uuid(),
  targetModelId: z.string().trim().min(1),
  judges: z
    .array(z.string().trim().min(1))
    .min(1)
    .refine((judges) => new Set(judges).size === judges.length, "Judge model IDs must be unique."),
  cases: requestSchema.shape.cases.element
    .extend({ input: z.string().trim().min(1) })
    .array()
    .min(1),
  isSyntheticExample: z.boolean().default(false),
});

/** Bounds the batch fan-out before the server expands it into independently durable runs. */
export const evaluationBatchInputSchema = z.object({
  promptId: z.uuid(),
  promptRevisionId: z.uuid(),
  targetModelIds: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(12)
    .refine((models) => new Set(models).size === models.length, "Target model IDs must be unique."),
  judges: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(6)
    .refine((judges) => new Set(judges).size === judges.length, "Judge model IDs must be unique."),
  configurations: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        name: z.string().trim().min(1),
        criteria: requestSchema.shape.cases.element.shape.criteria,
      }),
    )
    .min(1)
    .max(12)
    .refine(
      (configurations) =>
        new Set(configurations.map(({ id }) => id)).size === configurations.length,
      "Configuration IDs must be unique.",
    ),
  cases: z
    .array(z.object({ input: z.string().trim().min(1) }))
    .min(1)
    .max(100),
  repetitions: z.number().int().min(1).max(5),
  isSyntheticExample: z.boolean().default(false),
});

export type EvaluationBatchInput = z.infer<typeof evaluationBatchInputSchema>;

/** Reports an unknown durable run without leaking storage errors through adapters. */
export class EvaluationRunNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(runId: string) {
    super(`Evaluation run ${runId} was not found.`);
    this.name = "EvaluationRunNotFoundError";
  }
}

/** Reports invalid run configuration with an adapter-safe client error status. */
export class EvaluationRequestError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "EvaluationRequestError";
  }
}
