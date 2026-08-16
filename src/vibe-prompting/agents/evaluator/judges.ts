/** Coordinates criteria judgments across configured models while keeping model routing out of persistence code. */

import { END, ReducedValue, Send, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";

import { createChatModel } from "../../clients/llm.ts";
import { CriteriaEvaluator } from "../../evaluation/evaluators.ts";
import {
  type EvaluationCriteria,
  evaluationCriteriaSchema,
  evaluationReportSchema,
  type EvaluationSubject,
  evaluationSubjectSchema,
} from "../../evaluation/schemas.ts";

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

const prepareJudges: typeof JudgeState.Node = () => ({});

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

const collectEvaluations: typeof JudgeState.Node = () => ({});

function requireJudgeModel(model: string | undefined): string {
  if (!model) throw new Error("Judge model was not dispatched.");
  return model;
}

export const judgesGraph = new StateGraph({
  input: JudgeInput,
  output: JudgeOutput,
  state: JudgeState,
})
  .addNode("prepareJudges", prepareJudges)
  .addNode("evaluateJudge", evaluateJudge)
  .addNode("collectEvaluations", collectEvaluations)
  .addEdge(START, "prepareJudges")
  .addConditionalEdges("prepareJudges", dispatchJudges, ["evaluateJudge"])
  .addEdge("evaluateJudge", "collectEvaluations")
  .addEdge("collectEvaluations", END)
  .compile();

export async function evaluateWithJudges(
  subject: EvaluationSubject,
  criteria: EvaluationCriteria,
  judges: Judges,
): Promise<JudgeEvaluation[]> {
  const result = await judgesGraph.invoke({ subject, criteria, judges });
  return result.evaluations;
}

export function getJudgeModels(judges: Judges): string[] {
  const { model } = judgesSchema.parse(judges);
  return Array.isArray(model) ? model : [model];
}
