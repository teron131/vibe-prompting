/** Owns evaluation run validation, target preparation, atomic batch launch, and detached execution. */

import { createHash } from "node:crypto";

import { loadRuntimeConfig } from "../../config/index.ts";
import type { Database } from "../../database.ts";
import { PromptConflictError, type PromptSystem } from "../../prompt-system/index.ts";
import type { PinnedTarget, TargetSystem } from "../../target/index.ts";
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
  type EvaluationRunSummary,
  recordedEvaluationRunInputSchema,
  type StoredEvaluationRun,
} from "./schemas.ts";
import { EvaluationRunStore, type NewEvaluationRun } from "./store.ts";

type PreparedRun = {
  record: NewEvaluationRun;
  pinnedTarget: PinnedTarget;
  request: { cases: EvaluationCase<unknown>[]; judges: string[] };
};

/** Coordinates prompt and target dependencies while persistence remains behind the run store. */
export class EvaluationRuns {
  readonly #prompts: PromptSystem;
  readonly #store: EvaluationRunStore;
  readonly #targets: TargetSystem;
  readonly #targetRuns: TargetRuns;

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
    return this.#store.reconcileInterrupted();
  }

  /** Validates and persists a manually requested run before detached execution begins. */
  async startHumanRun(rawInput: unknown): Promise<EvaluationRunSummary> {
    return this.#startRun(rawInput, "human", null);
  }

  /** Validates and persists an agent-requested run while attributing it to its chat. */
  async startAgentRun(rawInput: unknown, chatId: string): Promise<EvaluationRunSummary> {
    return this.#startRun(rawInput, "ai", chatId);
  }

  /** Persists an evaluation of one completed Target Run turn and starts only the judge stage. */
  async startHumanRecordedRun(rawInput: unknown): Promise<EvaluationRunSummary> {
    const parsed = recordedEvaluationRunInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new EvaluationRequestError(
        parsed.error.issues[0]?.message ?? "Invalid recorded evaluation request.",
      );
    }
    const input = parsed.data;
    requireConfiguredModels(input.judges);
    const targetRun = await this.#targetRuns.getRun(input.targetRunId);
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
      chatId: null,
      configurationFingerprint: createConfigurationFingerprint({
        cases,
        effectiveInstructionsHash: targetRun.effectiveInstructionsHash,
        judges: input.judges,
        targetConfiguration: targetRun.targetConfiguration,
        targetModelId: targetRun.targetModelId,
        targetProfileRevisionId: targetRun.targetProfileRevisionId,
      }),
      effectiveInstructionsHash: targetRun.effectiveInstructionsHash,
      isSyntheticExample: false,
      judgeModelIds: input.judges,
      promptId: targetRun.promptId,
      promptRevisionId: targetRun.promptRevisionId,
      source: "human",
      targetModelId: targetRun.targetModelId,
      targetProfileId: targetRun.targetProfileId,
      targetProfileRevisionId: targetRun.targetProfileRevisionId,
      targetRunId: targetRun.id,
      targetRunTurnId: selectedTurn.id,
    };
    const runId = await this.#store.create(record);
    void this.#executeRecordedRun(runId, targetRun.targetModelId, {
      cases: [{ ...cases[0], output: selectedTurn.output }],
      judges: input.judges,
    }).catch(() => undefined);
    return this.getRunSummary(runId);
  }

  /** Validates a batch and reports its execution fan-out without creating run records. */
  async previewBatch(rawInput: unknown): Promise<EvaluationBatchPreview> {
    const input = await this.#requireBatchInput(rawInput);
    return expandBatch(input);
  }

  /** Pins every batch target, commits all run records together, and then starts detached execution. */
  async startHumanBatch(rawInput: unknown): Promise<EvaluationBatchStart> {
    return this.#startBatch(rawInput, "human", null);
  }

  /** Pins every agent batch target, commits all run records together, and attributes them to its chat. */
  async startAgentBatch(rawInput: unknown, chatId: string): Promise<EvaluationBatchStart> {
    return this.#startBatch(rawInput, "ai", chatId);
  }

  /** Prepares every job, then atomically persists the batch before detached execution begins. */
  async #startBatch(
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
    let runIds: string[];
    try {
      for (const job of preview.jobs) {
        const configuration = configurations.get(job.configurationId);
        if (!configuration)
          throw new EvaluationRequestError(
            `Unknown evaluation configuration: ${job.configurationId}.`,
          );
        preparedRuns.push(
          await this.#prepareRun(
            {
              promptId: input.promptId,
              promptRevisionId: input.promptRevisionId,
              targetModelId: job.targetModelId,
              judges: input.judges,
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
      runIds = await this.#store.createBatch(preparedRuns.map(({ record }) => record));
    } catch (error) {
      await closePreparedTargets(preparedRuns);
      throw error;
    }
    for (const [index, runId] of runIds.entries()) {
      const prepared = preparedRuns[index];
      if (!prepared) throw new Error(`Unknown prepared evaluation run index: ${index}.`);
      void this.#executeRun(runId, prepared.pinnedTarget, prepared.request).catch(() => undefined);
    }
    const runs = await Promise.all(runIds.map((runId) => this.getRunSummary(runId)));
    return { preview, runs };
  }

  /** Parses batch input and checks its model IDs and pinned prompt revision before execution. */
  async #requireBatchInput(rawInput: unknown): Promise<EvaluationBatchInput> {
    const parsed = evaluationBatchInputSchema.safeParse(rawInput);
    if (!parsed.success)
      throw new EvaluationRequestError(
        parsed.error.issues[0]?.message ?? "Invalid evaluation batch request.",
      );
    const input = parsed.data;
    requireConfiguredModels([...input.targetModelIds, ...input.judges]);
    const prompt = await this.#prompts.getPrompt(input.promptId);
    if (prompt.revisionId !== input.promptRevisionId) throw new PromptConflictError();
    return input;
  }

  /** Pins the target, persists a running record, and schedules execution outside the request. */
  async #startRun(
    rawInput: unknown,
    source: EvaluationRunSource,
    chatId: string | null,
  ): Promise<EvaluationRunSummary> {
    const prepared = await this.#prepareRun(rawInput, source, chatId);
    let runId: string;
    try {
      runId = await this.#store.create(prepared.record);
    } catch (error) {
      await prepared.pinnedTarget.close();
      throw error;
    }
    void this.#executeRun(runId, prepared.pinnedTarget, prepared.request).catch(() => undefined);
    return this.getRunSummary(runId);
  }

  /** Pins every external dependency needed by one run before its durable record exists. */
  async #prepareRun(
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
    const request = requestSchema.parse({ cases: input.cases, judges: input.judges });
    const judgeModelIds = Array.isArray(request.judges) ? request.judges : [request.judges];
    requireConfiguredModels([input.targetModelId, ...judgeModelIds]);
    const prompt = await this.#prompts.getPrompt(input.promptId);
    if (prompt.revisionId !== input.promptRevisionId) throw new PromptConflictError();
    const pinnedTarget = await this.#targets.createPinnedTarget({
      promptId: prompt.id,
      promptRevisionId: prompt.revisionId,
      targetModelId: input.targetModelId,
    });
    try {
      const targetConfiguration = pinnedTarget.profile.configuration;
      const configurationFingerprint = createConfigurationFingerprint({
        targetModelId: input.targetModelId,
        targetProfileRevisionId: pinnedTarget.profile.revisionId,
        targetConfiguration,
        effectiveInstructionsHash: pinnedTarget.effectiveInstructionsHash,
        judges: judgeModelIds,
        cases: request.cases,
      });
      return {
        record: {
          promptId: prompt.id,
          promptRevisionId: prompt.revisionId,
          targetProfileId: pinnedTarget.profile.id,
          targetProfileRevisionId: pinnedTarget.profile.revisionId,
          targetModelId: input.targetModelId,
          judgeModelIds,
          cases: request.cases,
          effectiveInstructionsHash: pinnedTarget.effectiveInstructionsHash,
          configurationFingerprint,
          source,
          chatId,
          isSyntheticExample: input.isSyntheticExample,
          targetRunId: null,
          targetRunTurnId: null,
        },
        pinnedTarget,
        request: { cases: request.cases, judges: judgeModelIds },
      };
    } catch (error) {
      await pinnedTarget.close();
      throw error;
    }
  }

  /** Loads one complete immutable report with its cases and judge-attributed score facts. */
  async getRun(runId: string): Promise<StoredEvaluationRun> {
    return this.#store.get(runId);
  }

  /** Loads lightweight status and provenance for progress polling. */
  async getRunSummary(runId: string): Promise<EvaluationRunSummary> {
    return this.#store.getSummary(runId);
  }

  /** Lists recent run summaries with an optional prompt scope and a bounded page size. */
  async listRuns(
    input: { limit?: number; promptId?: string } = {},
  ): Promise<EvaluationRunSummary[]> {
    return this.#store.list(input);
  }

  /** Returns chronological compatible runs from SQL aggregates when the selected configuration is Boolean-only. */
  async getCompatibleBooleanTrend(runId: string): Promise<BooleanTrendPoint[]> {
    return this.#store.getBooleanTrend(runId);
  }

  /** Executes a detached run and converts any execution failure into its terminal status. */
  async #executeRun(
    runId: string,
    pinnedTarget: PinnedTarget,
    request: { cases: EvaluationCase<unknown>[]; judges: string[] },
  ): Promise<void> {
    try {
      const result = await evaluate(pinnedTarget.target, request);
      await this.#store.complete(runId, request.cases, result);
    } catch (error) {
      await this.#store.fail(runId, safeExecutionError(error));
    } finally {
      await pinnedTarget.close();
    }
  }

  async #executeRecordedRun(
    runId: string,
    targetModelId: string,
    request: {
      cases: Array<EvaluationCase<unknown> & { output: unknown }>;
      judges: string[];
    },
  ): Promise<void> {
    try {
      const result = await evaluateRecorded(targetModelId, request);
      await this.#store.complete(runId, request.cases, result);
    } catch (error) {
      await this.#store.fail(runId, safeExecutionError(error));
    }
  }
}

/** Validates all target and judge IDs against the current runtime model configuration. */
function requireConfiguredModels(modelIds: readonly string[]): void {
  const configuredModels = new Set(loadRuntimeConfig().models.map(({ id }) => id));
  const unknownModel = modelIds.find((id) => !configuredModels.has(id));
  if (unknownModel) throw new EvaluationRequestError(`Model is not configured: ${unknownModel}.`);
}

/** Expands configuration, target, and repetition axes into the exact detached jobs to create. */
function expandBatch(input: EvaluationBatchInput): EvaluationBatchPreview {
  const jobs: EvaluationBatchJob[] = [];
  for (const configuration of input.configurations) {
    for (const targetModelId of input.targetModelIds) {
      for (let repetition = 1; repetition <= input.repetitions; repetition += 1) {
        jobs.push({
          id: `${configuration.id}:${targetModelId}:${repetition}`,
          executionNumber: jobs.length + 1,
          configurationId: configuration.id,
          configurationName: configuration.name,
          targetModelId,
          repetition,
          caseCount: input.cases.length,
          criterionCount: configuration.criteria.length,
          judgeScoreDecisions:
            input.cases.length * configuration.criteria.length * input.judges.length,
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
  targetModelId: string;
  targetProfileRevisionId: string;
  targetConfiguration: Record<string, unknown>;
  effectiveInstructionsHash: string;
  judges: string[];
  cases: EvaluationCase<unknown>[];
}): string {
  const canonical = JSON.stringify({
    targetModelId: input.targetModelId,
    targetProfileRevisionId: input.targetProfileRevisionId,
    targetConfiguration: input.targetConfiguration,
    effectiveInstructionsHash: input.effectiveInstructionsHash,
    judges: input.judges.toSorted(),
    cases: input.cases,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function safeExecutionError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/LANGFUSE_(PUBLIC|SECRET)_KEY|Langfuse/i.test(message)) return message.slice(0, 500);
  return "Evaluation execution failed before a complete result was available. Check the configured model and telemetry services, then retry.";
}

/** Closes prepared target resources without masking the batch preparation or transaction error. */
async function closePreparedTargets(preparedRuns: readonly PreparedRun[]): Promise<void> {
  await Promise.all(
    preparedRuns.map(async ({ pinnedTarget }) => {
      await pinnedTarget.close().catch(() => undefined);
    }),
  );
}
