/** Owns target-and-judge evaluation while using Langfuse as optional experiment persistence. */

import { END, ReducedValue, Send, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";

import {
  createLangfuseClient,
  createLangfuseTelemetry,
  type LangfuseConfig,
  loadOptionalLangfuseConfig,
} from "../clients/langfuse.ts";
import { LangfuseExperimentRunner } from "./experiments.ts";
import {
  getJudgeModels,
  type JudgeEvaluation,
  type Judges,
  judgesGraph,
  judgesSchema,
} from "./judges.ts";
import {
  evaluationCriteriaSchema,
  evaluationSubjectSchema,
  type EvaluatorScore,
} from "./schemas.ts";

export type Target = {
  readonly model: string;
  invoke(input: unknown): PromiseLike<unknown>;
};

export type { EvaluatorScore } from "./schemas.ts";

const DEFAULT_MAX_CONCURRENCY = 10;

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
const evaluatedCaseSchema = z.object({
  input: z.unknown(),
  output: z.unknown(),
  evaluations: z.array(z.custom<EvaluatorScore>()),
});
const indexedCaseResultSchema = z.object({
  caseIndex: z.number().int().nonnegative(),
  result: evaluatedCaseSchema,
});

export type EvaluatorCaseResult = z.infer<typeof evaluatedCaseSchema>;

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
  results: z.array(evaluatedCaseSchema),
});

const EvaluatorState = new StateSchema({
  ...EvaluatorInput.fields,
  resolvedJudges: judgesSchema.optional(),
  caseOffset: z.number().int().nonnegative().default(0),
  caseResults: new ReducedValue(
    z.array(indexedCaseResultSchema).default(() => []),
    {
      reducer: (current, next) => [...current, ...next],
    },
  ),
  results: z.array(evaluatedCaseSchema).optional(),
});

type EvaluatorStateValue = typeof EvaluatorState.State;

let defaultRunner: LangfuseExperimentRunner | undefined;

const prepareEvaluation: typeof EvaluatorState.Node = (state) => {
  const judgeModels = state.skipTargetModel
    ? getJudgeModels(state.judges).filter((model) => model !== state.target.model)
    : getJudgeModels(state.judges);
  if (judgeModels.length === 0) {
    throw new Error("No judge models remain after skipping the Target model.");
  }

  const langfuseConfig = loadOptionalLangfuseConfig();
  if (langfuseConfig) getDefaultRunner(langfuseConfig).startTracing();
  return { resolvedJudges: { model: judgeModels } };
};

function getDefaultRunner(config: LangfuseConfig): LangfuseExperimentRunner {
  defaultRunner ??= new LangfuseExperimentRunner({
    client: createLangfuseClient(config),
    telemetry: createLangfuseTelemetry(config),
  });
  return defaultRunner;
}

function dispatchCaseBatch(state: EvaluatorStateValue): Send[] {
  const judges = requireResolvedJudges(state.resolvedJudges);
  const batchEnd = Math.min(
    state.caseOffset + (state.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY),
    state.cases.length,
  );
  return state.cases.slice(state.caseOffset, batchEnd).map(
    (testCase, batchIndex) =>
      new Send("evaluateCase", {
        target: state.target,
        caseIndex: state.caseOffset + batchIndex,
        input: testCase.input,
        expectedOutput: testCase.expectedOutput,
        metadata: testCase.metadata,
        criteria: testCase.criteria,
        judges,
      }),
  );
}

const advanceBatch: typeof EvaluatorState.Node = (state) => ({
  caseOffset: Math.min(
    state.caseOffset + (state.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY),
    state.cases.length,
  ),
});

function routeNextBatch(state: EvaluatorStateValue): Send[] | "finalizeEvaluation" {
  return state.caseOffset < state.cases.length ? dispatchCaseBatch(state) : "finalizeEvaluation";
}

const finalizeEvaluation: typeof EvaluatorState.Node = async (state) => {
  const completedCases = state.caseResults.toSorted(
    (left, right) => left.caseIndex - right.caseIndex,
  );
  const langfuseConfig = loadOptionalLangfuseConfig();
  if (langfuseConfig) {
    await getDefaultRunner(langfuseConfig).persist({
      name: state.name,
      cases: completedCases.map(({ caseIndex, result }) => {
        const testCase = state.cases[caseIndex];
        if (!testCase) throw new Error(`Unknown evaluation case index: ${caseIndex}.`);
        return {
          input: testCase.input,
          output: result.output,
          expectedOutput: testCase.expectedOutput,
          metadata: testCase.metadata,
          criteria: testCase.criteria,
          scores: result.evaluations,
        };
      }),
      runName: state.runName,
      description: state.description,
      maxConcurrency: state.maxConcurrency,
      metadata: { ...state.metadata, targetModel: state.target.model },
    });
  }
  return { results: completedCases.map(({ result }) => result) };
};

const EvaluationCaseInput = new StateSchema({
  target: targetSchema,
  caseIndex: z.number().int().nonnegative(),
  input: z.unknown().refine((input) => input !== undefined, "Case input is required."),
  expectedOutput: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  criteria: evaluationCriteriaSchema,
  judges: judgesSchema,
});

const EvaluationCaseOutput = new StateSchema({
  caseResults: z.array(indexedCaseResultSchema),
});

const EvaluationCaseState = new StateSchema({
  ...EvaluationCaseInput.fields,
  subject: evaluationSubjectSchema.optional(),
  evaluations: z.array(z.custom<JudgeEvaluation>()).optional(),
  caseResults: z.array(indexedCaseResultSchema).optional(),
});

const invokeTarget: typeof EvaluationCaseState.Node = async (state) => ({
  subject: {
    input: state.input,
    output: await state.target.invoke(state.input),
    expectedOutput: state.expectedOutput,
    metadata: { ...state.metadata, caseIndex: state.caseIndex },
  },
});

const projectCaseResult: typeof EvaluationCaseState.Node = (state) => {
  const subject = requireEvaluationSubject(state.subject);
  return {
    caseResults: [
      {
        caseIndex: state.caseIndex,
        result: {
          input: state.input,
          output: subject.output,
          evaluations: toEvaluatorScores(requireJudgeEvaluations(state.evaluations)),
        },
      },
    ],
  };
};

const evaluationCaseGraph = new StateGraph({
  input: EvaluationCaseInput,
  output: EvaluationCaseOutput,
  state: EvaluationCaseState,
})
  .addNode("invokeTarget", invokeTarget)
  .addNode("judgeEvaluation", judgesGraph)
  .addNode("projectResult", projectCaseResult)
  .addEdge(START, "invokeTarget")
  .addEdge("invokeTarget", "judgeEvaluation")
  .addEdge("judgeEvaluation", "projectResult")
  .addEdge("projectResult", END)
  .compile();

function toEvaluatorScores(evaluations: JudgeEvaluation[]): EvaluatorScore[] {
  return evaluations.flatMap(({ model, report }) =>
    report.results.map((result) => ({
      criterionName: result.name,
      dataType: result.dataType,
      value: result.value,
      judgeModel: model,
      comment: result.comment,
      evidence: result.evidence,
    })),
  );
}

function requireResolvedJudges(judges: Judges | undefined): Judges {
  if (!judges) throw new Error("Evaluation judges were not prepared.");
  return judges;
}

function requireEvaluationSubject(
  subject: z.output<typeof evaluationSubjectSchema> | undefined,
): z.output<typeof evaluationSubjectSchema> {
  if (!subject) throw new Error("Evaluation subject was not prepared.");
  return subject;
}

function requireJudgeEvaluations(evaluations: JudgeEvaluation[] | undefined): JudgeEvaluation[] {
  if (!evaluations) throw new Error("Judge evaluations were not produced.");
  return evaluations;
}

export const evaluatorGraph = new StateGraph({
  input: EvaluatorInput,
  output: EvaluatorOutput,
  state: EvaluatorState,
})
  .addNode("prepareEvaluation", prepareEvaluation)
  .addNode<"evaluateCase", typeof EvaluationCaseInput>("evaluateCase", evaluationCaseGraph, {
    input: EvaluationCaseInput,
  })
  .addNode("advanceBatch", advanceBatch)
  .addNode("finalizeEvaluation", finalizeEvaluation)
  .addEdge(START, "prepareEvaluation")
  .addConditionalEdges("prepareEvaluation", dispatchCaseBatch, ["evaluateCase"])
  .addEdge("evaluateCase", "advanceBatch")
  .addConditionalEdges("advanceBatch", routeNextBatch, ["evaluateCase", "finalizeEvaluation"])
  .addEdge("finalizeEvaluation", END)
  .compile();
