/** Coordinates criteria judgments across configured models while keeping model routing out of persistence code. */

import { END, ReducedValue, Send, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";

import { createChatModel } from "../clients/llm.ts";
import { CriteriaEvaluator } from "./evaluators.ts";
import {
  evaluationCriteriaSchema,
  evaluationReportSchema,
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
  const model = requireJudgeModel(state.judgeModel);
  const evaluator = new CriteriaEvaluator({
    model: createChatModel({ model }),
    criteria: state.criteria,
  });
  const report = await evaluator.evaluate(state.subject, config);
  return {
    evaluations: [{ model, report }],
  };
};

function requireJudgeModel(model: string | undefined): string {
  if (!model) throw new Error("Judge model was not dispatched.");
  return model;
}

export const judgesGraph = new StateGraph({
  input: JudgeInput,
  output: JudgeOutput,
  state: JudgeState,
})
  .addNode("evaluateJudge", evaluateJudge)
  .addConditionalEdges(START, dispatchJudges, ["evaluateJudge"])
  .addEdge("evaluateJudge", END)
  .compile();

export function getJudgeModels(judges: Judges): string[] {
  const { model } = judgesSchema.parse(judges);
  return Array.isArray(model) ? model : [model];
}
