/** Resolves immutable evaluation inputs and expands batches before any run records or execution are created. */

import { createHash } from "node:crypto";

import type { ModelContext } from "../../clients/llm/context.ts";
import { PromptConflictError, type PromptSystem } from "../../prompt-system/index.ts";
import type { TargetSystem } from "../../target/index.ts";
import type { TargetRuns } from "../../target/runs/index.ts";
import { type EvaluationCase, requestSchema } from "../api.ts";
import {
  type EvaluationBatchInput,
  evaluationBatchInputSchema,
  type EvaluationBatchJob,
  type EvaluationBatchPreview,
  EvaluationRequestError,
  evaluationRunInputSchema,
  type EvaluationRunSource,
  recordedEvaluationRunInputSchema,
} from "./schemas.ts";
import type { NewEvaluationRun } from "./store.ts";

/** Pins live dependencies while preserving the exact persisted fingerprint and batch ordering. */
export class EvaluationPreparation {
  readonly #prompts: PromptSystem;
  readonly #targets: TargetSystem;
  readonly #targetRuns: TargetRuns;
  readonly #models: ModelContext;
  constructor(
    prompts: PromptSystem,
    targets: TargetSystem,
    targetRuns: TargetRuns,
    models: ModelContext,
  ) {
    this.#prompts = prompts;
    this.#targets = targets;
    this.#targetRuns = targetRuns;
    this.#models = models;
  }

  /** Pins every external dependency needed by one run before its durable record exists. */
  async run(
    actorUserId: string,
    rawInput: unknown,
    source: EvaluationRunSource,
    chatId: string | null,
  ): Promise<NewEvaluationRun> {
    const parsed = evaluationRunInputSchema.safeParse(rawInput);
    if (!parsed.success)
      throw new EvaluationRequestError(
        parsed.error.issues[0]?.message ?? "Invalid evaluation request.",
      );
    const input = parsed.data;
    const request = requestSchema.parse({ cases: input.cases, judgeModels: input.judgeModels });
    const judgeModels = request.judgeModels;
    requireConfiguredModels([input.targetModel, ...judgeModels], this.#models);
    const prompt = await this.#prompts.getPrompt(input.promptId);
    if (prompt.revisionId !== input.promptRevisionId) {
      throw new PromptConflictError(prompt.activeRevisionId);
    }
    const { profile, effectiveInstructionsHash } = await this.#targets.resolveDefinition({
      actorUserId,
      promptId: prompt.id,
      promptRevisionId: prompt.revisionId,
      targetModel: input.targetModel,
    });
    const configurationFingerprint = createConfigurationFingerprint({
      targetModel: input.targetModel,
      targetProfileRevisionId: profile.revisionId,
      targetConfiguration: profile.configuration,
      effectiveInstructionsHash,
      judgeModels,
      cases: request.cases,
    });
    return {
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
    };
  }

  /** Captures an exact completed turn and its conversation trace without reopening the Target. */
  async recorded(
    actorUserId: string,
    rawInput: unknown,
    source: EvaluationRunSource,
    chatId: string | null,
  ): Promise<NewEvaluationRun> {
    const parsed = recordedEvaluationRunInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new EvaluationRequestError(
        parsed.error.issues[0]?.message ?? "Invalid recorded evaluation request.",
      );
    }
    const input = parsed.data;
    requireConfiguredModels(input.judgeModels, this.#models);
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
    return record;
  }
  /** Validates a batch and reports its execution fan-out without creating run records. */
  async preview(rawInput: unknown): Promise<EvaluationBatchPreview> {
    const input = await this.#requireBatchInput(rawInput);
    return expandBatch(input);
  }

  /** Prepares the complete ordered batch before the caller begins its atomic persistence transaction. */
  async batch(
    actorUserId: string,
    rawInput: unknown,
    source: EvaluationRunSource,
    chatId: string | null,
  ): Promise<{ preview: EvaluationBatchPreview; records: NewEvaluationRun[] }> {
    const input = await this.#requireBatchInput(rawInput);
    const preview = expandBatch(input);
    const configurations = new Map(
      input.configurations.map((configuration) => [configuration.id, configuration]),
    );
    const records: NewEvaluationRun[] = [];
    for (const job of preview.jobs) {
      const configuration = configurations.get(job.configurationId);
      if (!configuration) {
        throw new EvaluationRequestError(
          `Unknown evaluation configuration: ${job.configurationId}.`,
        );
      }
      records.push(
        await this.run(
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
    return { preview, records };
  }
  /** Parses batch input and checks its models and pinned prompt revision before execution. */
  async #requireBatchInput(rawInput: unknown): Promise<EvaluationBatchInput> {
    const parsed = evaluationBatchInputSchema.safeParse(rawInput);
    if (!parsed.success)
      throw new EvaluationRequestError(
        parsed.error.issues[0]?.message ?? "Invalid evaluation batch request.",
      );
    const input = parsed.data;
    requireConfiguredModels([...input.targetModels, ...input.judgeModels], this.#models);
    const prompt = await this.#prompts.getPrompt(input.promptId);
    if (prompt.revisionId !== input.promptRevisionId) {
      throw new PromptConflictError(prompt.activeRevisionId);
    }
    return input;
  }
}

/** Validates all target and judge models against the current runtime configuration. */
function requireConfiguredModels(models: readonly string[], context: ModelContext): void {
  const configuredModels = new Set(context.readConfig().models.map(({ id }) => id));
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
