/** Owns durable Scenario Run inputs, lifecycle states, Driver decisions, and public projections. */

import { z } from "zod";

import {
  type EvaluationRunStatus,
  recordedEvaluationRunInputSchema,
} from "../../evaluation/runs/index.ts";
import {
  type StoredTargetRun,
  type TargetReasoningEffort,
  targetRunCreateInputSchema,
} from "../runs/index.ts";

export const MAX_SCENARIO_TURNS = 10;

const evaluationPlanSchema = z.object({
  configurations: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        criteria: recordedEvaluationRunInputSchema.shape.criteria,
      }),
    )
    .min(1),
  judgeModels: recordedEvaluationRunInputSchema.shape.judgeModels,
});

const scenarioBaseSchema = targetRunCreateInputSchema.omit({ instruction: true }).extend({
  evaluationPlan: evaluationPlanSchema.optional(),
});

export const scenarioRunCreateInputSchema = z.discriminatedUnion("mode", [
  scenarioBaseSchema.extend({
    mode: z.literal("generative"),
    instruction: z.string().trim().min(1),
    driverModel: targetRunCreateInputSchema.shape.targetModel.optional(),
    maxTurns: z.number().int().min(1).max(MAX_SCENARIO_TURNS).default(5),
  }),
  scenarioBaseSchema.extend({
    mode: z.literal("static"),
    messages: z.array(z.string().trim().min(1)).min(1).max(MAX_SCENARIO_TURNS),
  }),
]);

export type ScenarioMode = z.infer<typeof scenarioRunCreateInputSchema>["mode"];
export type ScenarioRunStatus = EvaluationRunStatus;

export const scenarioStopReasonSchema = z.enum([
  "driver-ended",
  "maximum-turns",
  "static-complete",
]);
export type ScenarioStopReason = z.infer<typeof scenarioStopReasonSchema>;

export type ScenarioDecision = { action: "send"; message: string } | { action: "end" };

export type ScenarioEvaluationPlan = z.infer<typeof evaluationPlanSchema>;

export type ScenarioEvaluationReference = {
  runId: string;
  configurationName: string;
};

type ScenarioRunBase = {
  id: string;
  promptRevisionNumber: number;
  promptTitle: string;
  targetModel: string;
  reasoningEffort: TargetReasoningEffort;
  evaluationErrorMessage: string | null;
  status: ScenarioRunStatus;
  stopReason: ScenarioStopReason | null;
  errorMessage: string | null;
  createdAt: string;
};

export type ScenarioRun = ScenarioRunBase &
  (
    | {
        mode: "generative";
        instruction: string;
        driverBrief: string | null;
        driverModel: string;
        maxTurns: number;
      }
    | { mode: "static"; messages: string[] }
  );

export type ScenarioEvaluation = {
  id: string;
  configurationName: string;
  judgeModels: string[];
  status: EvaluationRunStatus;
};

export type ScenarioRunResponse = {
  scenario: ScenarioRun;
  target: StoredTargetRun | null;
  evaluations: ScenarioEvaluation[];
};

export class ScenarioRunNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(runId: string) {
    super(`Scenario Run ${runId} was not found.`);
    this.name = "ScenarioRunNotFoundError";
  }
}

export class ScenarioRunRequestError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "ScenarioRunRequestError";
  }
}
