/** Owns model-driven evaluator implementations and fan-out across configured judge models. */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { END, ReducedValue, Send, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";

import { createModel } from "../../clients/llm/langchain.ts";
import { buildCriteriaPrompt, buildCriteriaSystemPrompt } from "./prompts.ts";
import {
  createEvaluationResponseSchema,
  type EvaluationCriteria,
  evaluationCriteriaSchema,
  type EvaluationResponse,
  type EvaluationResults,
  evaluationResultsSchema,
  type EvaluationSubject,
  evaluationSubjectSchema,
  projectEvaluationResponse,
} from "./schemas.ts";

const judgeModelSchema = z.string().trim().min(1);
export const judgeModelsSchema = z
  .array(judgeModelSchema)
  .min(1)
  .refine((models) => new Set(models).size === models.length, "Judge models must be unique.");

const judgeEvaluationSchema = z.object({
  model: judgeModelSchema,
  results: evaluationResultsSchema,
});

export type JudgeEvaluation = z.infer<typeof judgeEvaluationSchema>;

const JudgeInput = new StateSchema({
  subject: evaluationSubjectSchema,
  criteria: evaluationCriteriaSchema,
  judgeModels: judgeModelsSchema,
});

const JudgeOutput = new StateSchema({
  evaluations: z.array(judgeEvaluationSchema),
});

const JudgeState = new StateSchema({
  ...JudgeInput.fields,
  judgeModel: judgeModelSchema.optional(),
  evaluations: new ReducedValue(
    z.array(judgeEvaluationSchema).default(() => []),
    {
      reducer: (current, next) => [...current, ...next],
    },
  ),
});

/** Fans one normalized case out to one graph branch per configured judge model. */
function dispatchJudgeModels(state: typeof JudgeState.State): Send[] {
  return state.judgeModels.map(
    (judgeModel) =>
      new Send("evaluateJudge", {
        ...state,
        judgeModel,
      }),
  );
}

const evaluateJudge: typeof JudgeState.Node = async (state, config) => {
  const judgeModel = state.judgeModel;
  if (!judgeModel) throw new Error("Judge model was not dispatched.");
  const results = await evaluateCriteria(
    createModel({ model: judgeModel, reasoningEffort: "high" }),
    state.criteria,
    state.subject,
    config,
  );
  return {
    evaluations: [{ model: judgeModel, results }],
  };
};

export const judgesGraph = new StateGraph({
  input: JudgeInput,
  output: JudgeOutput,
  state: JudgeState,
})
  .addNode("evaluateJudge", evaluateJudge)
  .addConditionalEdges(START, dispatchJudgeModels, ["evaluateJudge"])
  .addEdge("evaluateJudge", END)
  .compile();

/** Runs one structured judge call against the complete configured criterion set. */
async function evaluateCriteria(
  model: BaseChatModel,
  criteria: EvaluationCriteria,
  subject: EvaluationSubject,
  options?: Partial<RunnableConfig>,
): Promise<EvaluationResults> {
  const configuredCriteria = evaluationCriteriaSchema.parse(criteria);
  const response = await model
    .withStructuredOutput<EvaluationResponse>(createEvaluationResponseSchema(configuredCriteria))
    .invoke(
      [
        new SystemMessage(buildCriteriaSystemPrompt(configuredCriteria)),
        new HumanMessage(buildCriteriaPrompt(subject, configuredCriteria)),
      ],
      options,
    );
  return projectEvaluationResponse(response, configuredCriteria);
}
