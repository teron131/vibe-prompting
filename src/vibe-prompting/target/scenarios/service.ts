/** Exposes optional Scenario operations while Target execution owns graph sequencing. */

import { loadRuntimeConfig } from "../../config/index.ts";
import type { Database } from "../../database/index.ts";
import type { EvaluationRuns } from "../../evaluation/runs/index.ts";
import type { PromptSystem } from "../../prompt-system/index.ts";
import { runTargetGraph, type TargetGraphDependencies } from "../graph.ts";
import type { TargetRuns, TargetRunSource } from "../runs/index.ts";
import {
  scenarioRunCreateInputSchema,
  ScenarioRunRequestError,
  type ScenarioRunResponse,
} from "./schemas.ts";
import { type NewScenarioRun, ScenarioRunStore } from "./store.ts";

// Bounds whole workflows because Driver calls run outside the Target and Evaluation inner queues.
const MAX_ACTIVE_SCENARIO_RUNS = 2;

export class ScenarioRuns {
  readonly #controllers = new Map<string, AbortController>();
  readonly #evaluations: EvaluationRuns;
  readonly #prompts: PromptSystem;
  readonly #store: ScenarioRunStore;
  readonly #targetRuns: TargetRuns;
  readonly #graphDependencies: TargetGraphDependencies;
  #activeRuns = 0;
  #draining = false;
  #drainRequested = false;

  constructor(
    database: Database,
    prompts: PromptSystem,
    targetRuns: TargetRuns,
    evaluations: EvaluationRuns,
  ) {
    this.#evaluations = evaluations;
    this.#prompts = prompts;
    this.#store = new ScenarioRunStore(database);
    this.#targetRuns = targetRuns;
    this.#graphDependencies = { evaluations, scenarioStore: this.#store, targetRuns };
  }

  async reconcileInterrupted(): Promise<number> {
    const interrupted = await this.#store.reconcileInterrupted();
    this.#scheduleDrain();
    return interrupted;
  }

  async startHumanRun(actorUserId: string, rawInput: unknown): Promise<ScenarioRunResponse> {
    return this.#startRun(actorUserId, rawInput, "human", null);
  }

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

  async cancel(actorUserId: string, runId: string): Promise<ScenarioRunResponse> {
    const { evaluationRunIds, targetRunId } = await this.#store.cancel(runId, actorUserId);
    this.#controllers
      .get(runId)
      ?.abort(new DOMException("The Scenario Run was stopped.", "AbortError"));
    await Promise.all([
      ...(targetRunId ? [this.#targetRuns.stop(actorUserId, targetRunId)] : []),
      ...evaluationRunIds.map((evaluationRunId) =>
        this.#evaluations.cancel(actorUserId, evaluationRunId),
      ),
    ]);
    this.#scheduleDrain();
    return this.getRunResponse(actorUserId, runId);
  }

  async #startRun(
    actorUserId: string,
    rawInput: unknown,
    source: TargetRunSource,
    chatId: string | null,
  ): Promise<ScenarioRunResponse> {
    const parsed = scenarioRunCreateInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ScenarioRunRequestError(
        parsed.error.issues[0]?.message ?? "Invalid Scenario Run request.",
      );
    }
    const input = parsed.data;
    requireConfiguredModels([
      input.targetModel,
      ...(input.mode === "generative" ? [input.driverModel ?? input.targetModel] : []),
      ...(input.evaluationPlan?.judgeModels ?? []),
    ]);
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
    this.#scheduleDrain();
    return this.getRunResponse(actorUserId, runId);
  }

  #scheduleDrain(): void {
    this.#drainRequested = true;
    if (this.#draining) return;
    this.#draining = true;
    queueMicrotask(() => {
      void this.#drainUntilIdle();
    });
  }

  async #drainUntilIdle(): Promise<void> {
    try {
      while (this.#drainRequested) {
        this.#drainRequested = false;
        await this.#drain();
      }
    } finally {
      this.#draining = false;
      if (this.#drainRequested) this.#scheduleDrain();
    }
  }

  async #drain(): Promise<void> {
    while (this.#activeRuns < MAX_ACTIVE_SCENARIO_RUNS) {
      const runId = await this.#store.claimNextQueued();
      if (!runId) return;
      this.#activeRuns += 1;
      void this.#executeClaimed(runId).finally(() => {
        this.#activeRuns -= 1;
        this.#scheduleDrain();
      });
    }
  }

  /** Invokes Target execution while the facade owns Scenario failure projection and cancellation handles. */
  async #executeClaimed(runId: string): Promise<void> {
    const controller = new AbortController();
    this.#controllers.set(runId, controller);
    try {
      await runTargetGraph(runId, this.#graphDependencies, controller.signal);
    } catch (error) {
      if (await this.#store.isRunning(runId)) {
        await this.#store.fail(runId, safeExecutionError(error));
      }
    } finally {
      this.#controllers.delete(runId);
    }
  }
}

function requireConfiguredModels(models: readonly string[]): void {
  const configured = new Set(loadRuntimeConfig().models.map(({ id }) => id));
  const unknown = models.find((id) => !configured.has(id));
  if (unknown) throw new ScenarioRunRequestError(`Model is not configured: ${unknown}.`);
}

function safeExecutionError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.slice(0, 500);
  return "The Scenario Run failed before it reached a terminal decision.";
}
