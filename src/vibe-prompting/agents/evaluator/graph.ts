/** Owns the end-to-end evaluator workflow, including Langfuse experiment execution around Target tasks and criteria scoring. */

import type { BaseMessage } from "@langchain/core/messages";
import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import type { ExperimentItem, ExperimentResult } from "@langfuse/client";
import type { ModelMessage } from "ai";
import { z } from "zod";

import { evaluationCriteriaSchema } from "../../evaluation/schemas.ts";
import { AiSdkAdapter } from "../target/ai-sdk-adapter.ts";
import { LangChainAdapter } from "../target/langchain-adapter.ts";
import { evaluatorModelsSchema, LangfuseExperimentRunner } from "./experiments.ts";

type Target = AiSdkAdapter | LangChainAdapter;

const experimentDataSchema = z.custom<ExperimentItem[]>(
  (value) => Array.isArray(value) && value.length > 0,
  "Experiment data must contain at least one item.",
);
const targetSchema = z.custom<Target>(
  (value) => value instanceof AiSdkAdapter || value instanceof LangChainAdapter,
  "Target must be a supported adapter.",
);
const experimentResultSchema = z.custom<ExperimentResult>();

const EvaluatorInput = new StateSchema({
  criteria: evaluationCriteriaSchema,
  data: experimentDataSchema,
  description: z.string().optional(),
  evaluatorModels: evaluatorModelsSchema,
  skipTargetModel: z.boolean().default(false),
  maxConcurrency: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  name: z.string().trim().min(1),
  runName: z.string().trim().min(1).optional(),
  target: targetSchema,
});

const EvaluatorOutput = new StateSchema({
  experiment: experimentResultSchema,
});

const EvaluatorState = new StateSchema({
  ...EvaluatorInput.fields,
  experiment: experimentResultSchema.optional(),
});

const runExperiment: typeof EvaluatorState.Node = async (state) => {
  const evaluatorModels = state.skipTargetModel
    ? state.evaluatorModels.filter((model) => model !== state.target.model)
    : state.evaluatorModels;
  if (evaluatorModels.length === 0) {
    throw new Error("No evaluator models remain after excluding the Target model.");
  }

  const runner = new LangfuseExperimentRunner();
  try {
    const experiment = await runner.run({
      criteria: state.criteria,
      data: state.data,
      description: state.description,
      evaluatorModels,
      maxConcurrency: state.maxConcurrency,
      metadata: state.metadata,
      name: state.name,
      runName: state.runName,
      task: async (item) => runTarget(state.target, item.input),
    });
    return { experiment };
  } finally {
    await runner.close();
  }
};

async function runTarget(target: Target, input: unknown) {
  return target instanceof AiSdkAdapter
    ? target.invoke(input as ModelMessage[])
    : target.invoke(input as BaseMessage[]);
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
