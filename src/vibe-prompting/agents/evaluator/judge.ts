/** Binds evaluator model selection to the reusable criteria evaluator while keeping model routing out of persistence code. */

import type { RunnableConfig } from "@langchain/core/runnables";

import { createChatModel } from "../../clients/llm.ts";
import { CriteriaEvaluator } from "../../evaluation/evaluators.ts";
import type { EvaluationCriteria } from "../../evaluation/schemas.ts";

export type CriteriaJudgeInput = {
  criteria: EvaluationCriteria;
  evaluatorModel: string;
  expectedOutput?: unknown;
  input: unknown;
  metadata?: Record<string, unknown>;
  output: unknown;
};

export async function evaluateCriteria(input: CriteriaJudgeInput, options?: RunnableConfig) {
  const evaluator = new CriteriaEvaluator({
    criteria: input.criteria,
    model: createChatModel({ model: input.evaluatorModel }),
  });
  return evaluator.evaluate(
    {
      expectedOutput: input.expectedOutput,
      input: input.input,
      metadata: input.metadata,
      output: input.output,
    },
    options,
  );
}
