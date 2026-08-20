/** Owns model-driven evaluator implementations and fan-out across configured judge models. */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { END, ReducedValue, Send, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";

import { createModel } from "../../clients/llm/langchain.ts";
import { buildCriteriaPrompt, buildCriteriaSystemPrompt } from "./prompts.ts";
import {
  createEvaluationReportSchema,
  type EvaluationCriteria,
  evaluationCriteriaSchema,
  type EvaluationReport,
  evaluationReportSchema,
  type EvaluationSubject,
  evaluationSubjectSchema,
} from "./schemas.ts";

const judgeModelSchema = z.string().trim().min(1);
const judgeModelsSchema = z
  .union([judgeModelSchema, z.array(judgeModelSchema).min(1)])
  .superRefine((model, context) => {
    if (Array.isArray(model) && new Set(model).size !== model.length) {
      context.addIssue({ code: "custom", message: "Judge model IDs must be unique." });
    }
  });

export const judgesSchema = z.object({ model: judgeModelsSchema });

export type Judges = z.infer<typeof judgesSchema>;

const judgeEvaluationSchema = z.object({
  model: judgeModelSchema,
  report: evaluationReportSchema,
});

export type JudgeEvaluation = z.infer<typeof judgeEvaluationSchema>;

const JudgeInput = new StateSchema({
  subject: evaluationSubjectSchema,
  criteria: evaluationCriteriaSchema,
  judges: judgesSchema,
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
function dispatchJudges(state: typeof JudgeState.State): Send[] {
  return getJudgeModels(state.judges).map(
    (judgeModel) =>
      new Send("evaluateJudge", {
        ...state,
        judgeModel,
      }),
  );
}

const evaluateJudge: typeof JudgeState.Node = async (state, config) => {
  const judgeModelId = state.judgeModel;
  if (!judgeModelId) throw new Error("Judge model was not dispatched.");
  const report = await evaluateCriteria(
    createModel({ model: judgeModelId, reasoningEffort: "low" }),
    state.criteria,
    state.subject,
    config,
  );
  return {
    evaluations: [{ model: judgeModelId, report }],
  };
};

export const judgesGraph = new StateGraph({
  input: JudgeInput,
  output: JudgeOutput,
  state: JudgeState,
})
  .addNode("evaluateJudge", evaluateJudge)
  .addConditionalEdges(START, dispatchJudges, ["evaluateJudge"])
  .addEdge("evaluateJudge", END)
  .compile();

/** Normalizes the single-model and multi-model judge input accepted by the public contract. */
export function getJudgeModels(judges: Judges): string[] {
  const { model } = judgesSchema.parse(judges);
  return Array.isArray(model) ? model : [model];
}

/** Runs one low-effort structured judge call against the complete configured criterion set. */
async function evaluateCriteria(
  model: BaseChatModel,
  criteria: EvaluationCriteria,
  subject: EvaluationSubject,
  options?: Partial<RunnableConfig>,
): Promise<EvaluationReport> {
  const configuredCriteria = evaluationCriteriaSchema.parse(criteria);
  return model
    .withStructuredOutput<EvaluationReport>(createEvaluationReportSchema(configuredCriteria))
    .invoke(
      [
        new SystemMessage(buildCriteriaSystemPrompt(configuredCriteria)),
        new HumanMessage(buildCriteriaPrompt(subject, configuredCriteria)),
      ],
      options,
    );
}
