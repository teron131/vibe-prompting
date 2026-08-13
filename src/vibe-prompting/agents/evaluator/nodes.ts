/** Owns the evaluator graph contract and its single composite criteria pass while leaving experiment iteration and persistence outside the graph. */

import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";

import { createChatModel } from "../../clients/llm.ts";
import { CriteriaEvaluator } from "../../evaluation/evaluators.ts";
import { evaluationCriteriaSchema, evaluationReportSchema } from "../../evaluation/schemas.ts";

export const EvaluatorInput = new StateSchema({
  criteria: evaluationCriteriaSchema,
  evaluatorModel: z.string().trim().min(1),
  expectedOutput: z.unknown().optional(),
  input: z.unknown(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  output: z.unknown(),
});

export const EvaluatorOutput = new StateSchema({
  evaluation: evaluationReportSchema,
});

export const EvaluatorState = new StateSchema({
  ...EvaluatorInput.fields,
  evaluation: evaluationReportSchema.optional(),
});

export const evaluate: typeof EvaluatorState.Node = async (state, options) => {
  const evaluator = new CriteriaEvaluator({
    criteria: state.criteria,
    model: createChatModel({ model: state.evaluatorModel }),
  });
  const evaluation = await evaluator.evaluate(
    {
      expectedOutput: state.expectedOutput,
      input: state.input,
      metadata: state.metadata,
      output: state.output,
    },
    options,
  );
  return { evaluation };
};
