/** Owns evaluation run validation, target preparation, atomic batch launch, and detached execution. */

import { RunQueue } from "../../app/queue.ts";
import type { ModelContext } from "../../clients/llm/context.ts";
import type { ContextSystem } from "../../context-system/index.ts";
import type { Database } from "../../database/index.ts";
import type { TargetSystem } from "../../target/index.ts";
import type { TargetRuns } from "../../target/runs/index.ts";
import { evaluate, evaluateRecorded } from "../api.ts";
import type { EvaluationEngine } from "../engine/graph.ts";
import { EvaluationPreparation } from "./preparation.ts";
import {
  type EvaluationBatchPreview,
  type EvaluationBatchStart,
  type EvaluationRunSource,
  type EvaluationRunStatus,
  type EvaluationRunSummary,
} from "./schemas.ts";
import { EvaluationRunStore } from "./store.ts";

type RunCompletion = {
  promise: Promise<void>;
  resolve: () => void;
};

const MAX_ACTIVE_EVALUATION_JOBS = 2;

/** Coordinates context and target dependencies while persistence remains behind the run store. */
export class EvaluationRuns {
  readonly #completions = new Map<string, RunCompletion>();
  readonly #queue: RunQueue;
  readonly #preparation: EvaluationPreparation;
  readonly #engine: EvaluationEngine;
  readonly #store: EvaluationRunStore;
  readonly #targets: TargetSystem;

  constructor(
    database: Database,
    contexts: ContextSystem,
    targets: TargetSystem,
    targetRuns: TargetRuns,
    models: ModelContext,
    engine: EvaluationEngine,
  ) {
    this.#store = new EvaluationRunStore(database);
    this.#targets = targets;
    this.#preparation = new EvaluationPreparation(contexts, targets, targetRuns, models);
    this.#engine = engine;
    this.#queue = new RunQueue({
      name: "Evaluation",
      concurrency: MAX_ACTIVE_EVALUATION_JOBS,
      claim: () => this.#store.claimNextQueued(),
      execute: (id, signal) => this.#executeClaimed(id, signal),
    });
  }

  /** Marks runs left in progress by a previous process as interrupted during startup recovery. */
  async reconcileInterrupted(): Promise<number> {
    return this.#store.reconcileInterrupted();
  }

  /** Validates and persists a manually requested run before detached execution begins. */
  async startHumanRun(actorUserId: string, rawInput: unknown): Promise<EvaluationRunSummary> {
    return this.#startRun(actorUserId, rawInput, "human", null);
  }

  /** Validates and persists an agent-requested run with optional originating-chat attribution. */
  async startAgentRun(
    actorUserId: string,
    rawInput: unknown,
    chatId: string | null,
  ): Promise<EvaluationRunSummary> {
    return this.#startRun(actorUserId, rawInput, "ai", chatId);
  }

  /** Persists an evaluation of one completed Target Run turn and starts only the judge stage. */
  async startHumanRecordedRun(
    actorUserId: string,
    rawInput: unknown,
  ): Promise<EvaluationRunSummary> {
    return this.#startRecordedRun(actorUserId, rawInput, "human", null);
  }

  /** Persists a judge-only Target trace evaluation with agent and producing-chat provenance. */
  async startAgentRecordedRun(
    actorUserId: string,
    rawInput: unknown,
    chatId: string | null,
  ): Promise<EvaluationRunSummary> {
    return this.#startRecordedRun(actorUserId, rawInput, "ai", chatId);
  }

  async #startRecordedRun(
    actorUserId: string,
    rawInput: unknown,
    source: EvaluationRunSource,
    chatId: string | null,
  ): Promise<EvaluationRunSummary> {
    return this.#queue.prepare(async () => {
      const record = await this.#preparation.recorded(actorUserId, rawInput, source, chatId);
      const runId = await this.#store.create(record);
      this.#trackCompletion(runId);
      this.#queue.wake();
      return this.getRunSummary(actorUserId, runId);
    });
  }

  /** Validates a batch and reports its execution fan-out without creating run records. */
  async previewBatch(rawInput: unknown): Promise<EvaluationBatchPreview> {
    return this.#preparation.preview(rawInput);
  }

  /** Pins every batch target, commits all run records together, and then starts detached execution. */
  async startHumanBatch(actorUserId: string, rawInput: unknown): Promise<EvaluationBatchStart> {
    return this.#startBatch(actorUserId, rawInput, "human", null);
  }

  /** Pins every agent batch target, commits all run records together, and preserves optional originating-chat attribution. */
  async startAgentBatch(
    actorUserId: string,
    rawInput: unknown,
    chatId: string | null,
  ): Promise<EvaluationBatchStart> {
    return this.#startBatch(actorUserId, rawInput, "ai", chatId);
  }

  /** Prepares every job, then atomically persists the batch before detached execution begins. */
  async #startBatch(
    actorUserId: string,
    rawInput: unknown,
    source: EvaluationRunSource,
    chatId: string | null,
  ): Promise<EvaluationBatchStart> {
    return this.#queue.prepare(async () => {
      const { preview, records } = await this.#preparation.batch(
        actorUserId,
        rawInput,
        source,
        chatId,
      );
      const runIds = await this.#store.createBatch(records);
      for (const runId of runIds) this.#trackCompletion(runId);
      this.#queue.wake();
      const runs = await Promise.all(runIds.map((runId) => this.getRunSummary(actorUserId, runId)));
      return { preview, runs };
    });
  }

  /** Pins the target, persists a running record, and schedules execution outside the request. */
  async #startRun(
    actorUserId: string,
    rawInput: unknown,
    source: EvaluationRunSource,
    chatId: string | null,
  ): Promise<EvaluationRunSummary> {
    return this.#queue.prepare(async () => {
      const record = await this.#preparation.run(actorUserId, rawInput, source, chatId);
      const runId = await this.#store.create(record);
      this.#trackCompletion(runId);
      this.#queue.wake();
      return this.getRunSummary(actorUserId, runId);
    });
  }

  async getRunSummary(viewerUserId: string, runId: string): Promise<EvaluationRunSummary> {
    return this.#store.getSummary(runId, viewerUserId);
  }

  /** Lists recent run summaries with an optional context scope and a bounded page size. */
  async listRuns(
    viewerUserId: string,
    input: { limit?: number; contextId?: string } = {},
  ): Promise<EvaluationRunSummary[]> {
    return this.#store.list(viewerUserId, input);
  }

  async cancel(actorUserId: string, runId: string): Promise<EvaluationRunSummary> {
    await this.#store.cancel(runId, actorUserId);
    this.#queue.cancel(runId, new Error("The evaluation was cancelled."));
    this.#resolveCompletion(runId);
    this.#queue.wake();
    return this.getRunSummary(actorUserId, runId);
  }

  /** Waits on this process's queue lifecycle and returns the authoritative terminal projection. */
  async waitForRun(viewerUserId: string, runId: string): Promise<EvaluationRunSummary> {
    const completion = this.#completions.get(runId)?.promise;
    const run = await this.getRunSummary(viewerUserId, runId);
    if (isTerminalStatus(run.status)) return run;
    if (!completion) {
      throw new Error(`Evaluation Run ${runId} is active outside this process lifecycle.`);
    }
    await completion;
    const completed = await this.getRunSummary(viewerUserId, runId);
    if (!isTerminalStatus(completed.status))
      throw new Error("The evaluation runtime closed before this run reached a terminal state.");
    return completed;
  }

  /** Activates draining only after the application has reconciled every durable workflow. */
  start(): void {
    this.#queue.start();
  }

  /** Settles accepted preparation and active execution before the application closes storage. */
  async close(): Promise<void> {
    await this.#queue.close();
    for (const id of this.#completions.keys()) this.#resolveCompletion(id);
  }

  /** Executes one claimed queue record and lets guarded store transitions preserve cancellation. */
  async #executeClaimed(runId: string, signal: AbortSignal): Promise<void> {
    let close = () => Promise.resolve();
    try {
      const run = await this.#store.getExecution(runId);
      const cases = run.cases.map(({ criteria, input }) => ({ criteria, input }));
      let result;
      if (run.targetRunTurnId) {
        const recordedCases = run.cases.map(({ criteria, input, output }) => {
          if (output === null) throw new Error("Recorded evaluation output is missing.");
          return { criteria, input, output };
        });
        result = await evaluateRecorded(
          run.targetModel,
          {
            cases: recordedCases,
            judgeModels: run.judgeModels,
          },
          { signal, engine: this.#engine },
        );
      } else {
        const pinnedTarget = await this.#targets.createPinnedTarget({
          actorUserId: run.startedByUserId,
          contextId: run.contextId,
          contextRevisionId: run.contextRevisionId,
          targetProfileId: run.targetProfileId ?? undefined,
          targetProfileRevisionId: run.targetProfileRevisionId ?? undefined,
          targetModel: run.targetModel,
        });
        close = pinnedTarget.close;
        result = await evaluate(
          {
            model: pinnedTarget.target.model,
            invoke: (input) => {
              if (typeof input !== "string")
                throw new Error("Evaluation target input must be text.");
              return invokeUntilAborted(pinnedTarget.target.invoke(input), signal);
            },
          },
          { cases, judgeModels: run.judgeModels },
          { signal, engine: this.#engine },
        );
      }
      await this.#store.complete(runId, cases, result);
    } catch (error) {
      await this.#store.fail(
        runId,
        signal.aborted
          ? "The application runtime ended before this run completed."
          : safeExecutionError(error),
        signal.aborted ? "interrupted" : "failed",
      );
    } finally {
      this.#resolveCompletion(runId);
      await close();
    }
  }

  #trackCompletion(runId: string): void {
    let resolve: () => void = () => {};
    const promise = new Promise<void>((complete) => {
      resolve = complete;
    });
    this.#completions.set(runId, { promise, resolve });
  }

  #resolveCompletion(runId: string): void {
    const completion = this.#completions.get(runId);
    if (!completion) return;
    this.#completions.delete(runId);
    completion.resolve();
  }
}

async function invokeUntilAborted<T>(result: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  return Promise.race([
    Promise.resolve(result),
    new Promise<never>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  ]);
}

function safeExecutionError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/LANGFUSE_(PUBLIC|SECRET)_KEY|Langfuse/i.test(message)) return message.slice(0, 500);
  return "Evaluation execution failed before a complete result was available. Check the configured model and telemetry services, then retry.";
}

function isTerminalStatus(status: EvaluationRunStatus): boolean {
  return status !== "queued" && status !== "running";
}
