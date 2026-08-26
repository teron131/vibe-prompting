/** Owns evaluation run validation, target preparation, atomic batch launch, and detached execution. */

import { createHash } from "node:crypto";

import { loadRuntimeConfig } from "../../config/index.ts";
import type { Database } from "../../database/index.ts";
import { PromptConflictError, type PromptSystem } from "../../prompt-system/index.ts";
import type { TargetSystem } from "../../target/index.ts";
import type { TargetRuns } from "../../target/runs/index.ts";
import { evaluate, evaluateRecorded, type EvaluationCase, requestSchema } from "../api.ts";
import {
  type BooleanTrendPoint,
  type EvaluationBatchInput,
  evaluationBatchInputSchema,
  type EvaluationBatchJob,
  type EvaluationBatchPreview,
  type EvaluationBatchStart,
  EvaluationRequestError,
  evaluationRunInputSchema,
  type EvaluationRunSource,
  type EvaluationRunStatus,
  type EvaluationRunSummary,
  recordedEvaluationRunInputSchema,
  type StoredEvaluationRun,
} from "./schemas.ts";
import { EvaluationRunStore, type NewEvaluationRun } from "./store.ts";

type PreparedRun = {
  record: NewEvaluationRun;
};

type RunCompletion = {
  promise: Promise<void>;
  resolve: () => void;
};

const MAX_ACTIVE_EVALUATION_JOBS = 2;

/** Coordinates prompt and target dependencies while persistence remains behind the run store. */
export class EvaluationRuns {
  readonly #completions = new Map<string, RunCompletion>();
  readonly #controllers = new Map<string, AbortController>();
  readonly #prompts: PromptSystem;
  readonly #store: EvaluationRunStore;
  readonly #targets: TargetSystem;
  readonly #targetRuns: TargetRuns;
  #activeJobs = 0;
  #draining = false;
  #drainRequested = false;

  constructor(
    database: Database,
    prompts: PromptSystem,
    targets: TargetSystem,
    targetRuns: TargetRuns,
  ) {
    this.#prompts = prompts;
    this.#store = new EvaluationRunStore(database);
    this.#targets = targets;
    this.#targetRuns = targetRuns;
  }

  /** Marks runs left in progress by a previous process as interrupted during startup recovery. */
  async reconcileInterrupted(): Promise<number> {
    const interrupted = await this.#store.reconcileInterrupted();
    this.#scheduleDrain();
    return interrupted;
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
    const parsed = recordedEvaluationRunInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new EvaluationRequestError(
        parsed.error.issues[0]?.message ?? "Invalid recorded evaluation request.",
      );
    }
    const input = parsed.data;
    requireConfiguredModels(input.judgeModels);
    const targetRun = await this.#targetRuns.getRun(actorUserId, input.targetRunId);
    const selectedTurn = targetRun.turns.find(({ id }) => id === input.targetRunTurnId);
    if (!selectedTurn)
      throw new EvaluationRequestError(`Target Run turn ${input.targetRunTurnId} was not found.`);
    if (selectedTurn.status !== "completed" || selectedTurn.output === null) {
      throw new EvaluationRequestError("Only a completed Target Run turn can be evaluated.");
    }
    const trace = {
      messages: targetRun.turns
        .filter(
          ({ position, status }) => position <= selectedTurn.position && status === "completed",
        )
        .flatMap((turn) => [
          { content: turn.input, role: "user" as const },
          ...(turn.position < selectedTurn.position && turn.output !== null
            ? [{ content: turn.output, role: "assistant" as const }]
            : []),
        ]),
    };
    const cases = [{ input: trace, criteria: input.criteria }];
    const record: NewEvaluationRun = {
      cases,
      chatId,
      configurationFingerprint: createConfigurationFingerprint({
        cases,
        effectiveInstructionsHash: targetRun.effectiveInstructionsHash,
        judgeModels: input.judgeModels,
        targetConfiguration: targetRun.targetConfiguration,
        targetModel: targetRun.targetModel,
        targetProfileRevisionId: targetRun.targetProfileRevisionId,
      }),
      effectiveInstructionsHash: targetRun.effectiveInstructionsHash,
      isSyntheticExample: false,
      judgeModels: input.judgeModels,
      promptId: targetRun.promptId,
      promptRevisionId: targetRun.promptRevisionId,
      source,
      targetModel: targetRun.targetModel,
      targetProfileId: targetRun.targetProfileId,
      targetProfileRevisionId: targetRun.targetProfileRevisionId,
      targetRunId: targetRun.id,
      targetRunTurnId: selectedTurn.id,
      startedByUserId: actorUserId,
      recordedOutputs: [selectedTurn.output],
    };
    const runId = await this.#store.create(record);
    this.#trackCompletion(runId);
    this.#scheduleDrain();
    return this.getRunSummary(actorUserId, runId);
  }

  /** Validates a batch and reports its execution fan-out without creating run records. */
  async previewBatch(rawInput: unknown): Promise<EvaluationBatchPreview> {
    const input = await this.#requireBatchInput(rawInput);
    return expandBatch(input);
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
    const input = await this.#requireBatchInput(rawInput);
    const preview = expandBatch(input);
    const configurations = new Map(
      input.configurations.map((configuration) => [configuration.id, configuration]),
    );
    const preparedRuns: PreparedRun[] = [];
    for (const job of preview.jobs) {
      const configuration = configurations.get(job.configurationId);
      if (!configuration) {
        throw new EvaluationRequestError(
          `Unknown evaluation configuration: ${job.configurationId}.`,
        );
      }
      preparedRuns.push(
        await this.#prepareRun(
          actorUserId,
          {
            promptId: input.promptId,
            promptRevisionId: input.promptRevisionId,
            targetModel: job.targetModel,
            judgeModels: input.judgeModels,
            cases: input.cases.map(({ input: caseInput }) => ({
              input: caseInput,
              criteria: configuration.criteria,
            })),
            isSyntheticExample: input.isSyntheticExample,
          },
          source,
          chatId,
        ),
      );
    }
    const runIds = await this.#store.createBatch(preparedRuns.map(({ record }) => record));
    for (const runId of runIds) this.#trackCompletion(runId);
    this.#scheduleDrain();
    const runs = await Promise.all(runIds.map((runId) => this.getRunSummary(actorUserId, runId)));
    return { preview, runs };
  }

  /** Parses batch input and checks its models and pinned prompt revision before execution. */
  async #requireBatchInput(rawInput: unknown): Promise<EvaluationBatchInput> {
    const parsed = evaluationBatchInputSchema.safeParse(rawInput);
    if (!parsed.success)
      throw new EvaluationRequestError(
        parsed.error.issues[0]?.message ?? "Invalid evaluation batch request.",
      );
    const input = parsed.data;
    requireConfiguredModels([...input.targetModels, ...input.judgeModels]);
    const prompt = await this.#prompts.getPrompt(input.promptId);
    if (prompt.revisionId !== input.promptRevisionId) {
      throw new PromptConflictError(prompt.activeRevisionId);
    }
    return input;
  }

  /** Pins the target, persists a running record, and schedules execution outside the request. */
  async #startRun(
    actorUserId: string,
    rawInput: unknown,
    source: EvaluationRunSource,
    chatId: string | null,
  ): Promise<EvaluationRunSummary> {
    const prepared = await this.#prepareRun(actorUserId, rawInput, source, chatId);
    const runId = await this.#store.create(prepared.record);
    this.#trackCompletion(runId);
    this.#scheduleDrain();
    return this.getRunSummary(actorUserId, runId);
  }

  /** Pins every external dependency needed by one run before its durable record exists. */
  async #prepareRun(
    actorUserId: string,
    rawInput: unknown,
    source: EvaluationRunSource,
    chatId: string | null,
  ): Promise<PreparedRun> {
    const parsed = evaluationRunInputSchema.safeParse(rawInput);
    if (!parsed.success)
      throw new EvaluationRequestError(
        parsed.error.issues[0]?.message ?? "Invalid evaluation request.",
      );
    const input = parsed.data;
    const request = requestSchema.parse({ cases: input.cases, judgeModels: input.judgeModels });
    const judgeModels = request.judgeModels;
    requireConfiguredModels([input.targetModel, ...judgeModels]);
    const prompt = await this.#prompts.getPrompt(input.promptId);
    if (prompt.revisionId !== input.promptRevisionId) {
      throw new PromptConflictError(prompt.activeRevisionId);
    }
    const profile = await this.#targets.ensureProfileForPrompt(actorUserId, prompt.id);
    const effectiveInstructionsHash = createHash("sha256")
      .update([profile.instructions, prompt.markdown].filter(Boolean).join("\n\n"))
      .digest("hex");
    const configurationFingerprint = createConfigurationFingerprint({
      targetModel: input.targetModel,
      targetProfileRevisionId: profile.revisionId,
      targetConfiguration: profile.configuration,
      effectiveInstructionsHash,
      judgeModels,
      cases: request.cases,
    });
    return {
      record: {
        promptId: prompt.id,
        promptRevisionId: prompt.revisionId,
        targetProfileId: profile.id,
        targetProfileRevisionId: profile.revisionId,
        targetModel: input.targetModel,
        judgeModels,
        cases: request.cases,
        effectiveInstructionsHash,
        configurationFingerprint,
        source,
        chatId,
        isSyntheticExample: input.isSyntheticExample,
        targetRunId: null,
        targetRunTurnId: null,
        startedByUserId: actorUserId,
      },
    };
  }

  /** Loads one complete immutable report with its cases and judge-attributed score facts. */
  async getRun(viewerUserId: string, runId: string): Promise<StoredEvaluationRun> {
    return this.#store.get(runId, viewerUserId);
  }

  /** Loads lightweight status and provenance for progress polling. */
  async getRunSummary(viewerUserId: string, runId: string): Promise<EvaluationRunSummary> {
    return this.#store.getSummary(runId, viewerUserId);
  }

  /** Lists recent run summaries with an optional prompt scope and a bounded page size. */
  async listRuns(
    viewerUserId: string,
    input: { limit?: number; promptId?: string } = {},
  ): Promise<EvaluationRunSummary[]> {
    return this.#store.list(viewerUserId, input);
  }

  async cancel(actorUserId: string, runId: string): Promise<EvaluationRunSummary> {
    await this.#store.cancel(runId, actorUserId);
    this.#controllers.get(runId)?.abort(new Error("The evaluation was cancelled."));
    this.#resolveCompletion(runId);
    this.#scheduleDrain();
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
    return this.getRunSummary(viewerUserId, runId);
  }

  /** Returns chronological compatible runs from SQL aggregates when the selected configuration is Boolean-only. */
  async getCompatibleBooleanTrend(runId: string): Promise<BooleanTrendPoint[]> {
    return this.#store.getBooleanTrend(runId);
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
    while (this.#activeJobs < MAX_ACTIVE_EVALUATION_JOBS) {
      const runId = await this.#store.claimNextQueued();
      if (!runId) return;
      this.#activeJobs += 1;
      void this.#executeClaimed(runId).finally(() => {
        this.#activeJobs -= 1;
        this.#scheduleDrain();
      });
    }
  }

  /** Executes one claimed queue record and lets guarded store transitions preserve cancellation. */
  async #executeClaimed(runId: string): Promise<void> {
    const controller = new AbortController();
    this.#controllers.set(runId, controller);
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
          { signal: controller.signal },
        );
      } else {
        const pinnedTarget = await this.#targets.createPinnedTarget({
          actorUserId: run.startedByUserId,
          promptId: run.promptId,
          promptRevisionId: run.promptRevisionId,
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
              return invokeUntilAborted(pinnedTarget.target.invoke(input), controller.signal);
            },
          },
          { cases, judgeModels: run.judgeModels },
          { signal: controller.signal },
        );
      }
      await this.#store.complete(runId, cases, result);
    } catch (error) {
      await this.#store.fail(runId, safeExecutionError(error));
    } finally {
      this.#controllers.delete(runId);
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

/** Validates all target and judge models against the current runtime configuration. */
function requireConfiguredModels(models: readonly string[]): void {
  const configuredModels = new Set(loadRuntimeConfig().models.map(({ id }) => id));
  const unknownModel = models.find((id) => !configuredModels.has(id));
  if (unknownModel) throw new EvaluationRequestError(`Model is not configured: ${unknownModel}.`);
}

/** Expands configuration, target, and repetition axes into the exact detached jobs to create. */
function expandBatch(input: EvaluationBatchInput): EvaluationBatchPreview {
  const jobs: EvaluationBatchJob[] = [];
  for (const configuration of input.configurations) {
    for (const targetModel of input.targetModels) {
      for (let repetition = 1; repetition <= input.repetitions; repetition += 1) {
        jobs.push({
          id: `${configuration.id}:${targetModel}:${repetition}`,
          executionNumber: jobs.length + 1,
          configurationId: configuration.id,
          configurationName: configuration.name,
          targetModel,
          repetition,
          caseCount: input.cases.length,
          judgeScoreDecisions:
            input.cases.length * configuration.criteria.length * input.judgeModels.length,
        });
      }
    }
  }
  return {
    jobs,
    executionCount: jobs.length,
    targetCaseInvocations: jobs.reduce((total, job) => total + job.caseCount, 0),
    judgeScoreDecisions: jobs.reduce((total, job) => total + job.judgeScoreDecisions, 0),
  };
}

function createConfigurationFingerprint(input: {
  targetModel: string;
  targetProfileRevisionId: string;
  targetConfiguration: Record<string, unknown>;
  effectiveInstructionsHash: string;
  judgeModels: string[];
  cases: EvaluationCase<unknown>[];
}): string {
  // These canonical keys are persisted through the hash and must remain stable across API naming changes.
  const canonical = JSON.stringify({
    targetModelId: input.targetModel,
    targetProfileRevisionId: input.targetProfileRevisionId,
    targetConfiguration: input.targetConfiguration,
    effectiveInstructionsHash: input.effectiveInstructionsHash,
    judges: input.judgeModels.toSorted(),
    cases: input.cases,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function safeExecutionError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/LANGFUSE_(PUBLIC|SECRET)_KEY|Langfuse/i.test(message)) return message.slice(0, 500);
  return "Evaluation execution failed before a complete result was available. Check the configured model and telemetry services, then retry.";
}

function isTerminalStatus(status: EvaluationRunStatus): boolean {
  return status !== "queued" && status !== "running";
}
