/** Owns the end-to-end evaluator workflow, including Langfuse experiment execution around Target tasks and criteria scoring. */

import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import type { ExperimentResult } from "@langfuse/client";
import { z } from "zod";

import { evaluationCriteriaSchema } from "../../evaluation/schemas.ts";
import { LangfuseExperimentRunner } from "./experiments.ts";
import { getJudgeModels, judgesSchema } from "./judges.ts";

export type Target = {
  readonly model: string;
  invoke(input: unknown): PromiseLike<unknown>;
};

const evaluatorCaseSchema = z.object({
  input: z.unknown().refine((input) => input !== undefined, "Case input is required."),
  expectedOutput: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  criteria: evaluationCriteriaSchema,
});
const targetSchema = z.custom<Target>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "model" in value &&
    typeof value.model === "string" &&
    value.model.length > 0 &&
    value.model === value.model.trim() &&
    "invoke" in value &&
    typeof value.invoke === "function",
  "Target must expose a non-empty model ID and an invoke function.",
);
const experimentResultSchema = z.custom<ExperimentResult>();

const EvaluatorInput = new StateSchema({
  name: z.string().trim().min(1).default("evaluation"),
  target: targetSchema,
  cases: z.array(evaluatorCaseSchema).min(1),
  judges: judgesSchema,
  skipTargetModel: z.boolean().default(false),
  maxConcurrency: z.number().int().positive().optional(),
  runName: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const EvaluatorOutput = new StateSchema({
  experiment: experimentResultSchema,
});

const EvaluatorState = new StateSchema({
  ...EvaluatorInput.fields,
  experiment: experimentResultSchema.optional(),
});

let defaultRunner: LangfuseExperimentRunner | undefined;

const runExperiment: typeof EvaluatorState.Node = async (state) => {
  const judgeModels = state.skipTargetModel
    ? getJudgeModels(state.judges).filter((model) => model !== state.target.model)
    : getJudgeModels(state.judges);
  if (judgeModels.length === 0) {
    throw new Error("No judge models remain after skipping the Target model.");
  }

  defaultRunner ??= new LangfuseExperimentRunner();
  const experiment = await defaultRunner.run({
    name: state.name,
    data: state.cases.map(({ input, expectedOutput, metadata }, caseIndex) => ({
      input,
      expectedOutput,
      metadata: { ...metadata, caseIndex },
    })),
    task: async (item) => state.target.invoke(item.input),
    criteria: (metadata) => {
      const caseIndex = requireCaseIndex(metadata);
      const testCase = state.cases[caseIndex];
      if (!testCase) throw new Error(`Unknown evaluation case index: ${caseIndex}.`);
      return testCase.criteria;
    },
    judges: { model: judgeModels },
    runName: state.runName,
    description: state.description,
    maxConcurrency: state.maxConcurrency,
    metadata: { ...state.metadata, targetModel: state.target.model },
  });
  return { experiment };
};

function requireCaseIndex(metadata: Record<string, unknown> | undefined): number {
  const caseIndex = metadata?.caseIndex;
  if (typeof caseIndex !== "number" || !Number.isInteger(caseIndex) || caseIndex < 0) {
    throw new Error("Evaluation case metadata is missing a valid case index.");
  }
  return caseIndex;
}

export const evaluatorGraph = new StateGraph({
  input: EvaluatorInput,
  output: EvaluatorOutput,
  state: EvaluatorState,
})
  .addNode("runExperiment", runExperiment)
  .addEdge(START, "runExperiment")
  .addEdge("runExperiment", END)
  .compile();
