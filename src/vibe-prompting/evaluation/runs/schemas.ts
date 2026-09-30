/** Owns durable run requests, lifecycle summaries, batch limits, and request-safe errors. */

import { z } from "zod";

import { criteriaSchema } from "../../criteria/schemas.ts";
import { requestSchema } from "../api.ts";

export type EvaluationRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
export type EvaluationRunSource = "ai" | "human";

export type EvaluationBatchJob = {
  id: string;
  executionNumber: number;
  configurationId: string;
  configurationName: string;
  targetModel: string;
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

export type EvaluationRunSummary = {
  id: string;
  contextId: string;
  contextRevisionId: string;
  contextRevisionNumber: number;
  contextTitle: string;
  targetProfileId: string | null;
  targetProfileRevisionId: string | null;
  targetProfileName: string | null;
  targetModel: string;
  targetRunId: string | null;
  targetRunTurnId: string | null;
  judgeModels: string[];
  caseCount: number;
  configurationFingerprint: string;
  effectiveInstructionsHash: string | null;
  source: EvaluationRunSource;
  startedByName: string | null;
  chatId: string | null;
  isSyntheticExample: boolean;
  status: EvaluationRunStatus;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

/** Validates one durable run request and its exact context, model, and provenance pins. */
export const evaluationRunInputSchema = requestSchema.extend({
  contextId: z.uuid(),
  contextRevisionId: z.uuid(),
  targetModel: z.string().trim().min(1),
  cases: requestSchema.shape.cases.element
    .extend({ input: z.string().trim().min(1) })
    .array()
    .min(1),
  isSyntheticExample: z.boolean().default(false),
});

/** Validates a request to judge one completed Target Run turn without invoking the Target again. */
export const recordedEvaluationRunInputSchema = z.object({
  criteria: criteriaSchema,
  judgeModels: requestSchema.shape.judgeModels,
  targetRunId: z.uuid(),
  targetRunTurnId: z.uuid(),
});

/** Bounds the batch fan-out before the server expands it into independently durable runs. */
export const evaluationBatchInputSchema = z.object({
  contextId: z.uuid(),
  contextRevisionId: z.uuid(),
  targetModels: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(12)
    .refine((models) => new Set(models).size === models.length, "Target models must be unique."),
  judgeModels: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(6)
    .refine(
      (judgeModels) => new Set(judgeModels).size === judgeModels.length,
      "Judge models must be unique.",
    ),
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
    .max(10),
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
