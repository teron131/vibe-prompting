/** Owns Scenario launch, cancellation, and lifecycle coordination across Target and Evaluation runs. */

import { RunQueue } from "../app/queue.ts";
import { type ModelContext, standaloneModelContext } from "../clients/llm/context.ts";
import type { Database } from "../database/index.ts";
import type { EvaluationRuns } from "../evaluation/runs/index.ts";
import type { PromptSystem } from "../prompt-system/index.ts";
import type { TargetRuns, TargetRunSource } from "../target/runs/index.ts";
import { runScenarioGraph, type ScenarioGraphDependencies } from "./graph.ts";
import {
  scenarioRunCreateInputSchema,
  ScenarioRunRequestError,
  type ScenarioRunResponse,
} from "./schemas.ts";
import { type NewScenarioRun, ScenarioRunStore } from "./store.ts";

// Bounds whole workflows because Driver calls run outside the Target and Evaluation inner queues.
const MAX_ACTIVE_SCENARIO_RUNS = 2;

/** Coordinates durable Scenario workflows while Target Runs retain transcripts and Evaluation Runs retain scores. */
export class ScenarioRuns {
  readonly #queue: RunQueue;
  readonly #models: ModelContext;
  readonly #evaluations: EvaluationRuns;
  readonly #prompts: PromptSystem;
  readonly #store: ScenarioRunStore;
  readonly #targetRuns: TargetRuns;
  readonly #graphDependencies: ScenarioGraphDependencies;

  constructor(
    database: Database,
    prompts: PromptSystem,
    targetRuns: TargetRuns,
    evaluations: EvaluationRuns,
    models: ModelContext = standaloneModelContext,
  ) {
    this.#evaluations = evaluations;
    this.#prompts = prompts;
    this.#store = new ScenarioRunStore(database);
    this.#targetRuns = targetRuns;
    this.#graphDependencies = { evaluations, scenarioStore: this.#store, targetRuns, models };
    this.#models = models;
    this.#queue = new RunQueue({
      name: "Scenario",
      concurrency: MAX_ACTIVE_SCENARIO_RUNS,
      claim: () => this.#store.claimNextQueued(),
      execute: (id, signal) => this.#executeClaimed(id, signal),
    });
  }

  async reconcileInterrupted(): Promise<number> {
    return this.#store.reconcileInterrupted();
  }

  /** Persists a human-requested Scenario before scheduling its graph outside the request. */
  async startHumanRun(actorUserId: string, rawInput: unknown): Promise<ScenarioRunResponse> {
    return this.#startRun(actorUserId, rawInput, "human", null);
  }

  /** Starts the same workflow with AI authorship and optional originating-chat attribution. */
  async startAgentRun(
    actorUserId: string,
    rawInput: unknown,
    chatId: string | null,
  ): Promise<ScenarioRunResponse> {
    return this.#startRun(actorUserId, rawInput, "ai", chatId);
  }

  async getRunResponse(viewerUserId: string, runId: string): Promise<ScenarioRunResponse> {
    const { evaluationRuns, scenario, targetRunId } = await this.#store.get(runId);
    const evaluations = await Promise.all(
      evaluationRuns.map(async (reference) => {
        const run = await this.#evaluations.getRunSummary(viewerUserId, reference.runId);
        return {
          id: run.id,
          configurationName: reference.configurationName,
          judgeModels: run.judgeModels,
          status: run.status,
        };
      }),
    );
    return {
      scenario,
      target: targetRunId ? await this.#targetRuns.getRun(viewerUserId, targetRunId) : null,
      evaluations,
    };
  }

  /** Cancels the Scenario and propagates cancellation to its attached Target and Evaluation runs. */
  async cancel(actorUserId: string, runId: string): Promise<ScenarioRunResponse> {
    const { evaluationRunIds, targetRunId } = await this.#store.cancel(runId, actorUserId);
    this.#queue.cancel(runId, new DOMException("The Scenario Run was stopped.", "AbortError"));
    await Promise.all([
      ...(targetRunId ? [this.#targetRuns.stop(actorUserId, targetRunId)] : []),
      ...evaluationRunIds.map((evaluationRunId) =>
        this.#evaluations.cancel(actorUserId, evaluationRunId),
      ),
    ]);
    this.#queue.wake();
    return this.getRunResponse(actorUserId, runId);
  }

  async #startRun(
    actorUserId: string,
    rawInput: unknown,
    source: TargetRunSource,
    chatId: string | null,
  ): Promise<ScenarioRunResponse> {
    return this.#queue.prepare(async () => {
      const parsed = scenarioRunCreateInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw new ScenarioRunRequestError(
          parsed.error.issues[0]?.message ?? "Invalid Scenario Run request.",
        );
      }
      const input = parsed.data;
      requireConfiguredModels(
        [
          input.targetModel,
          ...(input.mode === "generative" ? [input.driverModel ?? input.targetModel] : []),
          ...(input.evaluationPlan?.judgeModels ?? []),
        ],
        this.#models,
      );
      await this.#prompts.getRevision(input.promptId, input.promptRevisionId);
      const common = {
        promptId: input.promptId,
        promptRevisionId: input.promptRevisionId,
        targetModel: input.targetModel,
        reasoningEffort: input.reasoningEffort,
        evaluationPlan: input.evaluationPlan ?? null,
        source,
        chatId,
        startedByUserId: actorUserId,
      };
      const record: NewScenarioRun =
        input.mode === "generative"
          ? {
              ...common,
              mode: "generative",
              instruction: input.instruction,
              driverModel: input.driverModel ?? input.targetModel,
              maxTurns: input.maxTurns,
            }
          : { ...common, mode: "static", messages: input.messages };
      const runId = await this.#store.create(record);
      this.#queue.wake();
      return this.getRunResponse(actorUserId, runId);
    });
  }

  /** Activates draining only after the application has reconciled every durable workflow. */
  start(): void {
    this.#queue.start();
  }

  /** Settles accepted preparation and active execution before the application closes storage. */
  async close(): Promise<void> {
    await this.#queue.close();
  }

  /** Invokes the Scenario graph while the service owns failure projection and cancellation handles. */
  async #executeClaimed(runId: string, signal: AbortSignal): Promise<void> {
    try {
      await runScenarioGraph(runId, this.#graphDependencies, signal);
    } catch (error) {
      if (await this.#store.isRunning(runId)) {
        await this.#store.fail(
          runId,
          signal.aborted
            ? "The application runtime ended before this run completed."
            : safeExecutionError(error),
          signal.aborted ? "interrupted" : "failed",
        );
      }
    }
  }
}

function requireConfiguredModels(models: readonly string[], context: ModelContext): void {
  const configured = new Set(context.readConfig().models.map(({ id }) => id));
  const unknown = models.find((id) => !configured.has(id));
  if (unknown) throw new ScenarioRunRequestError(`Model is not configured: ${unknown}.`);
}

function safeExecutionError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.slice(0, 500);
  return "The Scenario Run failed before it reached a terminal decision.";
}
