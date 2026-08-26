/** Defines Target execution with optional Scenario turns and recorded-evaluation handoff as one LangGraph. */

import {
  END,
  type LangGraphRunnableConfig,
  START,
  StateGraph,
  StateSchema,
} from "@langchain/langgraph";
import { z } from "zod";

import type { EvaluationRuns } from "../evaluation/runs/index.ts";
import type { StoredTargetRun, TargetRuns } from "./runs/index.ts";
import {
  decideScenarioTurn,
  initializeScenarioDriver,
  type ScenarioTranscriptMessage,
} from "./scenarios/driver.ts";
import {
  MAX_SCENARIO_TURNS,
  type ScenarioDecision,
  type ScenarioEvaluationReference,
  type ScenarioStopReason,
  scenarioStopReasonSchema,
} from "./scenarios/schemas.ts";
import { type ScenarioExecution, ScenarioRunStore } from "./scenarios/store.ts";

export type TargetGraphDependencies = {
  scenarioStore: ScenarioRunStore;
  targetRuns: TargetRuns;
  evaluations: EvaluationRuns;
};

const TargetGraphContext = z.object({
  evaluations: z.custom<EvaluationRuns>(),
  scenarioStore: z.custom<ScenarioRunStore>(),
  targetRuns: z.custom<TargetRuns>(),
});

const TargetGraphInput = new StateSchema({
  runId: z.uuid(),
});

const TargetGraphOutput = new StateSchema({
  runId: z.uuid(),
});

const TargetGraphState = new StateSchema({
  ...TargetGraphInput.fields,
  execution: z.custom<ScenarioExecution>().optional(),
  brief: z.string().trim().min(1).optional(),
  decision: z.custom<ScenarioDecision>().optional(),
  targetRun: z.custom<StoredTargetRun>().optional(),
  stopReason: scenarioStopReasonSchema.optional(),
});

type GraphState = typeof TargetGraphState.State;

const TARGET_GRAPH_RECURSION_LIMIT = MAX_SCENARIO_TURNS * 2 + 8;

function createTargetGraph() {
  const loadScenario: typeof TargetGraphState.Node = async (state, config) => {
    const { scenarioStore } = requireGraphDependencies(config);
    const execution = await scenarioStore.getExecution(state.runId);
    return { execution };
  };

  const runScenario: typeof TargetGraphState.Node = async (state, config) => {
    const execution = requireGenerativeExecution(state);
    const targetRun = state.targetRun;
    if (!targetRun) {
      const initialized = await initializeScenarioDriver({
        modelId: execution.driverModel,
        instruction: execution.instruction,
        maxTurns: execution.maxTurns,
        signal: requireSignal(config.signal),
      });
      const { scenarioStore } = requireGraphDependencies(config);
      await scenarioStore.setDriverBrief(state.runId, initialized.brief);
      return {
        brief: initialized.brief,
        decision: initialized.decision,
        ...(initialized.decision.action === "end" ? { stopReason: "driver-ended" as const } : {}),
      };
    }
    const sentTurns = targetRun.turns.length;
    if (sentTurns >= execution.maxTurns) return { stopReason: "maximum-turns" as const };
    if (!state.brief) {
      throw new Error("A generative Scenario did not preserve its Driver Brief.");
    }
    const decision = await decideScenarioTurn({
      modelId: execution.driverModel,
      brief: state.brief,
      transcript: projectTranscript(targetRun),
      remainingTurns: execution.maxTurns - sentTurns,
      signal: requireSignal(config.signal),
    });
    return {
      decision,
      ...(decision.action === "end" ? { stopReason: "driver-ended" as const } : {}),
    };
  };

  const advanceStaticScenario: typeof TargetGraphState.Node = (state) => {
    const execution = requireStaticExecution(state);
    const sentTurns = state.targetRun?.turns.length ?? 0;
    const message = execution.messages[sentTurns];
    return message
      ? { decision: { action: "send" as const, message } }
      : { stopReason: "static-complete" as const };
  };

  const runTarget: typeof TargetGraphState.Node = async (state, config) => {
    const { scenarioStore, targetRuns } = requireGraphDependencies(config);
    const execution = requireExecution(state);
    const decision = requireDecision(state);
    if (decision.action !== "send") throw new Error("A Target turn requires a Driver message.");
    const targetRunId = state.targetRun?.id;
    const launched = targetRunId
      ? await targetRuns.continueRunAndWait(execution.startedByUserId, targetRunId, {
          instruction: decision.message,
        })
      : await targetRuns.startRunAndWait(
          execution.startedByUserId,
          {
            promptId: execution.promptId,
            promptRevisionId: execution.promptRevisionId,
            targetModel: execution.targetModel,
            reasoningEffort: execution.reasoningEffort,
            instruction: decision.message,
          },
          execution.chatId,
          execution.source,
        );
    if (!targetRunId && !(await scenarioStore.attachTargetRun(state.runId, launched.run.id))) {
      await targetRuns.stop(execution.startedByUserId, launched.run.id);
      throw new DOMException("The Scenario Run was stopped.", "AbortError");
    }
    const targetRun = await launched.completion;
    if (!(await scenarioStore.isRunning(state.runId))) {
      throw new DOMException("The Scenario Run was stopped.", "AbortError");
    }
    requireCompletedLatestTurn(targetRun);
    return { targetRun };
  };

  const evaluateTarget: typeof TargetGraphState.Node = async (state, config) => {
    const { evaluations, scenarioStore } = requireGraphDependencies(config);
    const execution = requireExecution(state);
    const evaluationRuns: ScenarioEvaluationReference[] = [];
    let evaluationError: string | null = null;
    const evaluationPlan = execution.evaluationPlan;
    if (!evaluationPlan) throw new Error("The Target graph reached Evaluation without a plan.");
    const finalTurn = state.targetRun?.turns.findLast(
      ({ output, status }) => status === "completed" && output !== null,
    );
    if (!state.targetRun || !finalTurn) {
      evaluationError = "The Scenario ended without a completed Target response to evaluate.";
    } else {
      for (const configuration of evaluationPlan.configurations) {
        if (!(await scenarioStore.isRunning(state.runId))) return {};
        try {
          const evaluation =
            execution.source === "ai"
              ? await evaluations.startAgentRecordedRun(
                  execution.startedByUserId,
                  {
                    targetRunId: state.targetRun.id,
                    targetRunTurnId: finalTurn.id,
                    judgeModels: evaluationPlan.judgeModels,
                    criteria: configuration.criteria,
                  },
                  execution.chatId,
                )
              : await evaluations.startHumanRecordedRun(execution.startedByUserId, {
                  targetRunId: state.targetRun.id,
                  targetRunTurnId: finalTurn.id,
                  judgeModels: evaluationPlan.judgeModels,
                  criteria: configuration.criteria,
                });
          const reference = {
            runId: evaluation.id,
            configurationName: configuration.name,
          };
          if (!(await scenarioStore.appendEvaluationRun(state.runId, reference))) {
            await evaluations.cancel(execution.startedByUserId, evaluation.id);
            return {};
          }
          evaluationRuns.push(reference);
        } catch (error) {
          evaluationError = safeWorkflowError(error);
          break;
        }
      }
      if (evaluationRuns.length > 0) {
        const settledEvaluations = await Promise.allSettled(
          evaluationRuns.map(({ runId }) =>
            evaluations.waitForRun(execution.startedByUserId, runId),
          ),
        );
        const rejected = settledEvaluations.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (rejected) evaluationError ??= safeWorkflowError(rejected.reason);
        const unsuccessful = settledEvaluations
          .flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
          .find(({ status }) => status !== "completed");
        if (unsuccessful) {
          evaluationError ??=
            unsuccessful.errorMessage ??
            `Evaluation Run ${unsuccessful.id} ended with status ${unsuccessful.status}.`;
        }
      }
    }
    await scenarioStore.setEvaluationError(state.runId, evaluationError);
    return {};
  };

  const completeScenario: typeof TargetGraphState.Node = async (state, config) => {
    const { scenarioStore } = requireGraphDependencies(config);
    await scenarioStore.complete(state.runId, requireStopReason(state));
    return {};
  };

  return new StateGraph({
    context: TargetGraphContext,
    input: TargetGraphInput,
    output: TargetGraphOutput,
    state: TargetGraphState,
  })
    .addNode("loadScenario", loadScenario)
    .addNode("runScenario", runScenario)
    .addNode("advanceStaticScenario", advanceStaticScenario)
    .addNode("runTarget", runTarget)
    .addNode("evaluateTarget", evaluateTarget)
    .addNode("completeScenario", completeScenario)
    .addEdge(START, "loadScenario")
    .addConditionalEdges("loadScenario", routeScenarioMode, [
      "runScenario",
      "advanceStaticScenario",
    ])
    .addConditionalEdges("runScenario", routeAfterScenario, [
      "runTarget",
      "evaluateTarget",
      "completeScenario",
    ])
    .addConditionalEdges("advanceStaticScenario", routeAfterScenario, [
      "runTarget",
      "evaluateTarget",
      "completeScenario",
    ])
    .addConditionalEdges("runTarget", routeScenarioMode, ["runScenario", "advanceStaticScenario"])
    .addEdge("evaluateTarget", "completeScenario")
    .addEdge("completeScenario", END)
    .compile();
}

export const targetGraph = createTargetGraph();

/** Runs Target execution with the optional Scenario branch and evaluation handoff enabled. */
export async function runTargetGraph(
  runId: string,
  dependencies: TargetGraphDependencies,
  signal: AbortSignal,
): Promise<void> {
  await targetGraph.invoke(
    { runId },
    { context: dependencies, recursionLimit: TARGET_GRAPH_RECURSION_LIMIT, signal },
  );
}

function requireGraphDependencies(config: LangGraphRunnableConfig): TargetGraphDependencies {
  const parsed = TargetGraphContext.safeParse(config.context);
  if (!parsed.success) {
    throw new Error(
      "Target graph execution requires Scenario, Target Run, and Evaluation services.",
    );
  }
  return parsed.data;
}

function routeScenarioMode(state: GraphState): "runScenario" | "advanceStaticScenario" {
  return requireExecution(state).mode === "generative" ? "runScenario" : "advanceStaticScenario";
}

function routeAfterScenario(
  state: GraphState,
): "runTarget" | "evaluateTarget" | "completeScenario" {
  if (!state.stopReason) return "runTarget";
  return requireExecution(state).evaluationPlan ? "evaluateTarget" : "completeScenario";
}

function requireExecution(state: GraphState): ScenarioExecution {
  if (!state.execution) throw new Error("The Scenario workflow was not initialized.");
  return state.execution;
}

function requireGenerativeExecution(
  state: GraphState,
): Extract<ScenarioExecution, { mode: "generative" }> {
  const execution = requireExecution(state);
  if (execution.mode !== "generative") {
    throw new Error("The Scenario Driver requires a generative Scenario.");
  }
  return execution;
}

function requireStaticExecution(state: GraphState): Extract<ScenarioExecution, { mode: "static" }> {
  const execution = requireExecution(state);
  if (execution.mode !== "static") {
    throw new Error("Static message selection requires a static Scenario.");
  }
  return execution;
}

function requireDecision(state: GraphState): ScenarioDecision {
  if (!state.decision) throw new Error("The Scenario workflow has no Driver decision.");
  return state.decision;
}

function requireStopReason(state: GraphState): ScenarioStopReason {
  if (!state.stopReason)
    throw new Error("The Scenario workflow reached completion without a stop reason.");
  return state.stopReason;
}

function requireSignal(signal: AbortSignal | undefined): AbortSignal {
  if (!signal) throw new Error("The Scenario workflow requires a cancellation signal.");
  return signal;
}

function projectTranscript(run: StoredTargetRun): ScenarioTranscriptMessage[] {
  return run.turns
    .filter(
      (turn): turn is typeof turn & { output: string } =>
        turn.status === "completed" && turn.output !== null,
    )
    .flatMap((turn) => [
      { role: "user" as const, content: turn.input },
      { role: "assistant" as const, content: turn.output },
    ]);
}

function requireCompletedLatestTurn(run: StoredTargetRun): void {
  const latest = run.turns.at(-1);
  if (latest?.status === "completed" && latest.output !== null) return;
  const detail = latest?.errorMessage?.trim();
  throw new Error(detail || "The Target Run did not produce a complete response.");
}

function safeWorkflowError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.slice(0, 500);
  return "The Scenario workflow failed before it reached a terminal decision.";
}
