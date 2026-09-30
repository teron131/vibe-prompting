/** Coordinates Target Run validation, exact runtime pinning, detached execution, and process-local event replay. */

import type { ModelMessage } from "ai";

import { type ModelContext, standaloneModelContext } from "../../clients/llm/context.ts";
import type { ContextSystem } from "../../context-system/index.ts";
import type { Database } from "../../database/index.ts";
import { sanitizeAiSdkHistory } from "../adapters/ai-sdk.ts";
import type { PinnedTarget } from "../runtime.ts";
import type { TargetSystem } from "../system.ts";
import { type TargetRunClaim, TargetRunRegistry } from "./registry.ts";
import {
  type StoredTargetRun,
  targetRunCreateInputSchema,
  TargetRunRequestError,
  type TargetRunResponse,
  type TargetRunSource,
  type TargetRunSummary,
  targetRunTurnInputSchema,
} from "./schemas.ts";
import { TargetRunStore } from "./store.ts";

export class TargetRuns {
  readonly #models: ModelContext;
  readonly #preparing = new Set<Promise<unknown>>();
  readonly #executions = new Set<Promise<void>>();
  #closed = false;
  #closing: Promise<void> | undefined;
  readonly #contexts: ContextSystem;
  readonly #registry = new TargetRunRegistry();
  readonly #store: TargetRunStore;
  readonly #targets: TargetSystem;

  constructor(
    database: Database,
    contexts: ContextSystem,
    targets: TargetSystem,
    models: ModelContext = standaloneModelContext,
  ) {
    this.#models = models;
    this.#contexts = contexts;
    this.#store = new TargetRunStore(database);
    this.#targets = targets;
  }

  async reconcileInterrupted(): Promise<number> {
    return this.#store.reconcileInterrupted();
  }

  async startHumanRun(actorUserId: string, rawInput: unknown): Promise<StoredTargetRun> {
    const launched = await this.#startRun(actorUserId, rawInput, "human", null);
    return this.#store.get(launched.runId, actorUserId);
  }

  async startAgentRun(
    actorUserId: string,
    rawInput: unknown,
    chatId: string | null,
  ): Promise<StoredTargetRun> {
    const launched = await this.#startRun(actorUserId, rawInput, "ai", chatId);
    return this.#store.get(launched.runId, actorUserId);
  }

  /** Starts a workflow-owned Target Run and exposes its terminal turn without polling. */
  async startRunAndWait(
    actorUserId: string,
    rawInput: unknown,
    chatId: string | null = null,
    source: TargetRunSource = "ai",
  ): Promise<{ run: StoredTargetRun; completion: Promise<StoredTargetRun> }> {
    const launched = await this.#startRun(actorUserId, rawInput, source, chatId, true);
    return {
      run: await this.#store.get(launched.runId, actorUserId),
      completion: launched.completion.then(() => this.#store.get(launched.runId, actorUserId)),
    };
  }

  async continueRun(
    actorUserId: string,
    runId: string,
    rawInput: unknown,
  ): Promise<StoredTargetRun> {
    return this.#trackPreparation(async () => {
      const parsed = targetRunTurnInputSchema.safeParse(rawInput);
      if (!parsed.success)
        throw new TargetRunRequestError(
          parsed.error.issues[0]?.message ?? "Invalid Target Run turn.",
        );
      await this.#store.appendTurn(actorUserId, runId, parsed.data.instruction);
      await this.#launch(runId, actorUserId);
      return this.#store.get(runId, actorUserId);
    });
  }

  /** Continues an automated Target Run and exposes its terminal turn to the owning workflow without polling. */
  async continueRunAndWait(
    actorUserId: string,
    runId: string,
    rawInput: unknown,
  ): Promise<{ run: StoredTargetRun; completion: Promise<StoredTargetRun> }> {
    return this.#trackPreparation(async () => {
      const parsed = targetRunTurnInputSchema.safeParse(rawInput);
      if (!parsed.success)
        throw new TargetRunRequestError(
          parsed.error.issues[0]?.message ?? "Invalid Target Run turn.",
        );
      await this.#store.appendTurn(actorUserId, runId, parsed.data.instruction);
      const launched = await this.#launch(runId, actorUserId, undefined, true);
      return {
        run: await this.#store.get(runId, actorUserId),
        completion: launched.completion.then(() => this.#store.get(runId, actorUserId)),
      };
    });
  }

  async getRun(viewerUserId: string, runId: string): Promise<StoredTargetRun> {
    return this.#store.get(runId, viewerUserId);
  }

  async getRunResponse(viewerUserId: string, runId: string): Promise<TargetRunResponse> {
    const run = await this.#store.get(runId, viewerUserId);
    return {
      run,
      active: run.turns.some(({ status }) => status === "running"),
      events: this.#registry.snapshot(runId).events,
    };
  }

  async listRuns(
    viewerUserId: string,
    contextId: string,
    limit?: number,
  ): Promise<TargetRunSummary[]> {
    return this.#store.list(viewerUserId, contextId, limit);
  }

  async stop(actorUserId: string, runId: string): Promise<boolean> {
    const cancelled = await this.#store.cancelActiveTurn(runId, actorUserId);
    if (cancelled) this.#registry.stop(runId);
    return cancelled;
  }

  async #startRun(
    actorUserId: string,
    rawInput: unknown,
    source: TargetRunSource,
    chatId: string | null,
    waitForCapacity: boolean = false,
  ): Promise<{ runId: string; completion: Promise<void> }> {
    return this.#trackPreparation(async () => {
      const parsed = targetRunCreateInputSchema.safeParse(rawInput);
      if (!parsed.success)
        throw new TargetRunRequestError(
          parsed.error.issues[0]?.message ?? "Invalid Target Run request.",
        );
      const input = parsed.data;
      requireConfiguredModel(input.targetModel, this.#models);
      await this.#contexts.getRevision(input.contextId, input.contextRevisionId);
      const pinnedTarget = await this.#targets.createPinnedTarget({
        actorUserId,
        contextId: input.contextId,
        contextRevisionId: input.contextRevisionId,
        reasoningEffort: input.reasoningEffort,
        targetModel: input.targetModel,
      });
      let runId: string;
      try {
        runId = await this.#store.create({
          chatId,
          effectiveInstructionsHash: pinnedTarget.effectiveInstructionsHash,
          instruction: input.instruction,
          contextId: input.contextId,
          contextRevisionId: input.contextRevisionId,
          reasoningEffort: input.reasoningEffort,
          source,
          startedByUserId: actorUserId,
          targetModel: input.targetModel,
          targetProfileId: pinnedTarget.profile.id,
          targetProfileRevisionId: pinnedTarget.profile.revisionId,
        });
      } catch (error) {
        await pinnedTarget.close();
        throw error;
      }
      const launched = await this.#launch(runId, actorUserId, pinnedTarget, waitForCapacity);
      return { runId, completion: launched.completion };
    });
  }

  async #launch(
    runId: string,
    actorUserId: string,
    preparedTarget?: PinnedTarget,
    waitForCapacity: boolean = false,
  ): Promise<{ completion: Promise<void> }> {
    const context = await this.#store.getExecutionContext(runId).catch(async (error: unknown) => {
      await preparedTarget?.close();
      throw error;
    });
    let pinnedTarget = preparedTarget;
    try {
      pinnedTarget ??= await this.#targets.createPinnedTarget({
        actorUserId,
        contextId: context.contextId,
        contextRevisionId: context.contextRevisionId,
        reasoningEffort: context.reasoningEffort,
        targetModel: context.targetModel,
        targetProfileId: context.targetProfileId,
        targetProfileRevisionId: context.targetProfileRevisionId,
      });
      const launchedTarget = pinnedTarget;
      const execute = (claimed: TargetRunClaim) => {
        const costEstimate = this.#models.pricing.estimate(context.targetModel);
        return launchedTarget.runtime
          .run({
            messages: toModelMessages(context.responseHistory, context.turn.input),
            onEvent: claimed.publish,
            signal: claimed.signal,
          })
          .then(async (result) => {
            const durationMs = Math.max(0, Date.now() - context.turn.createdAt.getTime());
            const usage = {
              ...result.usage,
              durationMs,
              estimatedCostUsd: await costEstimate.calculate(result.usage),
            };
            await this.#store.completeTurn(
              runId,
              context.turn.id,
              result.activity,
              result.output,
              result.responseMessages,
              usage,
            );
            claimed.publish({ type: "finish" });
          })
          .catch(async (error: unknown) => {
            const interrupted = claimed.signal.aborted;
            const message = interrupted
              ? "The Target Run turn was stopped."
              : safeExecutionError(error);
            await this.#store.failTurn(
              runId,
              context.turn.id,
              interrupted ? "interrupted" : "failed",
              message,
            );
            claimed.publish(interrupted ? { type: "stopped" } : { message, type: "error" });
          })
          .finally(async () => {
            try {
              await launchedTarget.close();
            } finally {
              claimed.release();
            }
          });
      };
      const completion = waitForCapacity
        ? this.#registry.claimWhenAvailable(runId).then(execute, async (error: unknown) => {
            await launchedTarget.close();
            const interrupted = error instanceof DOMException && error.name === "AbortError";
            await this.#store.failTurn(
              runId,
              context.turn.id,
              interrupted ? "interrupted" : "failed",
              interrupted ? "The Target Run turn was stopped." : safeExecutionError(error),
            );
          })
        : execute(this.#registry.claim(runId));
      this.#executions.add(completion);
      void completion.then(
        () => this.#executions.delete(completion),
        () => this.#executions.delete(completion),
      );
      return { completion };
    } catch (error) {
      await pinnedTarget?.close().catch(() => undefined);
      await this.#store
        .failTurn(
          runId,
          context.turn.id,
          this.#closed ? "interrupted" : "failed",
          this.#closed
            ? "The Target runtime shut down before this turn completed."
            : safeExecutionError(error),
        )
        .catch(() => undefined);
      throw error;
    }
  }
  /** Waits for accepted launches and active turn cleanup before database shutdown. */
  close(): Promise<void> {
    this.#closing ??= this.#close();
    return this.#closing;
  }

  async #close(): Promise<void> {
    this.#closed = true;
    this.#registry.close();
    await Promise.allSettled(this.#preparing);
    await Promise.allSettled(this.#executions);
  }

  #trackPreparation<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#closed) throw new Error("Target Runs are closed.");
    const pending = Promise.resolve().then(operation);
    this.#preparing.add(pending);
    void pending.then(
      () => this.#preparing.delete(pending),
      () => this.#preparing.delete(pending),
    );
    return pending;
  }
}

function toModelMessages(
  history: Array<{ input: string; responseMessages: ModelMessage[] }>,
  instruction: string,
): ModelMessage[] {
  return [
    ...history.flatMap(({ input, responseMessages }) => [
      { content: input, role: "user" as const },
      ...sanitizeAiSdkHistory(responseMessages),
    ]),
    { content: instruction, role: "user" as const },
  ];
}

function requireConfiguredModel(modelId: string, context: ModelContext): void {
  if (!context.readConfig().models.some(({ id }) => id === modelId)) {
    throw new TargetRunRequestError(`Model is not configured: ${modelId}.`);
  }
}

function safeExecutionError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.slice(0, 500);
  return "The Target Run failed before a complete response was available.";
}
