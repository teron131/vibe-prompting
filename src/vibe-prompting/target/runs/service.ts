/** Coordinates Target Run validation, exact runtime pinning, detached AI SDK execution, and process-local event replay. */

import type { ModelMessage } from "ai";

import { loadRuntimeConfig } from "../../config/index.ts";
import type { Database } from "../../database.ts";
import type { PromptSystem } from "../../prompt-system/index.ts";
import { sanitizeAiSdkHistory } from "../adapters/ai-sdk.ts";
import type { PinnedTarget, TargetSystem } from "../system.ts";
import { TargetRunRegistry } from "./registry.ts";
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
  readonly #prompts: PromptSystem;
  readonly #registry = new TargetRunRegistry();
  readonly #store: TargetRunStore;
  readonly #targets: TargetSystem;

  constructor(database: Database, prompts: PromptSystem, targets: TargetSystem) {
    this.#prompts = prompts;
    this.#store = new TargetRunStore(database);
    this.#targets = targets;
  }

  async reconcileInterrupted(): Promise<number> {
    return this.#store.reconcileInterrupted();
  }

  async startHumanRun(rawInput: unknown): Promise<StoredTargetRun> {
    return this.#startRun(rawInput, "human", null);
  }

  async startAgentRun(rawInput: unknown, chatId: string): Promise<StoredTargetRun> {
    return this.#startRun(rawInput, "ai", chatId);
  }

  async continueRun(runId: string, rawInput: unknown): Promise<StoredTargetRun> {
    const parsed = targetRunTurnInputSchema.safeParse(rawInput);
    if (!parsed.success)
      throw new TargetRunRequestError(
        parsed.error.issues[0]?.message ?? "Invalid Target Run turn.",
      );
    await this.#store.appendTurn(runId, parsed.data.instruction);
    await this.#launch(runId);
    return this.#store.get(runId);
  }

  async getRun(runId: string): Promise<StoredTargetRun> {
    return this.#store.get(runId);
  }

  async getRunResponse(runId: string): Promise<TargetRunResponse> {
    const run = await this.#store.get(runId);
    return {
      active: run.turns.some(({ status }) => status === "running"),
      events: this.#registry.snapshot(runId).events,
      run,
    };
  }

  async listRuns(promptId: string, limit?: number): Promise<TargetRunSummary[]> {
    return this.#store.list(promptId, limit);
  }

  stop(runId: string): boolean {
    return this.#registry.stop(runId);
  }

  async #startRun(
    rawInput: unknown,
    source: TargetRunSource,
    chatId: string | null,
  ): Promise<StoredTargetRun> {
    const parsed = targetRunCreateInputSchema.safeParse(rawInput);
    if (!parsed.success)
      throw new TargetRunRequestError(
        parsed.error.issues[0]?.message ?? "Invalid Target Run request.",
      );
    const input = parsed.data;
    requireConfiguredModel(input.targetModelId);
    await this.#prompts.getRevision(input.promptId, input.promptRevisionId);
    const pinnedTarget = await this.#targets.createPinnedTarget({
      promptId: input.promptId,
      promptRevisionId: input.promptRevisionId,
      reasoningEffort: input.reasoningEffort,
      targetModelId: input.targetModelId,
    });
    let runId: string;
    try {
      runId = await this.#store.create({
        chatId,
        effectiveInstructionsHash: pinnedTarget.effectiveInstructionsHash,
        instruction: input.instruction,
        promptId: input.promptId,
        promptRevisionId: input.promptRevisionId,
        reasoningEffort: input.reasoningEffort,
        source,
        targetModelId: input.targetModelId,
        targetProfileId: pinnedTarget.profile.id,
        targetProfileRevisionId: pinnedTarget.profile.revisionId,
      });
    } catch (error) {
      await pinnedTarget.close();
      throw error;
    }
    await this.#launch(runId, pinnedTarget);
    return this.#store.get(runId);
  }

  async #launch(runId: string, preparedTarget?: PinnedTarget): Promise<void> {
    const context = await this.#store.getExecutionContext(runId);
    let pinnedTarget = preparedTarget;
    try {
      pinnedTarget ??= await this.#targets.createPinnedTarget({
        promptId: context.promptId,
        promptRevisionId: context.promptRevisionId,
        reasoningEffort: context.reasoningEffort,
        targetModelId: context.targetModelId,
        targetProfileId: context.targetProfileId,
        targetProfileRevisionId: context.targetProfileRevisionId,
      });
      const launchedTarget = pinnedTarget;
      const claimed = this.#registry.claim(runId);
      void launchedTarget.runtime
        .run({
          messages: toModelMessages(context.responseHistory, context.turn.input),
          onEvent: claimed.publish,
          signal: claimed.signal,
        })
        .then(async (result) => {
          await this.#store.completeTurn(
            runId,
            context.turn.id,
            result.activity,
            result.output,
            result.responseMessages,
            result.usage,
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
          await launchedTarget.close();
          claimed.release();
        });
    } catch (error) {
      await pinnedTarget?.close().catch(() => undefined);
      await this.#store
        .failTurn(runId, context.turn.id, "failed", safeExecutionError(error))
        .catch(() => undefined);
      throw error;
    }
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

function requireConfiguredModel(modelId: string): void {
  if (!loadRuntimeConfig().models.some(({ id }) => id === modelId)) {
    throw new TargetRunRequestError(`Model is not configured: ${modelId}.`);
  }
}

function safeExecutionError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.slice(0, 500);
  return "The Target Run failed before a complete response was available.";
}
