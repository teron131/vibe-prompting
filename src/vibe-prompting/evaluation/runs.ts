/** Owns application-facing evaluation attempts, exact prompt-revision pinning, attributed score persistence, and detached execution. */

import { createHash, randomUUID } from "node:crypto";

import type postgres from "postgres";
import { z } from "zod";

import { loadRuntimeConfig } from "../config/index.ts";
import type { Database, DatabaseClient } from "../database.ts";
import { PromptConflictError, type PromptSystem } from "../prompt-system/index.ts";
import type { PinnedTarget, TargetSystem } from "../target/index.ts";
import {
  type Criterion,
  type CriterionEvaluation,
  evaluate,
  type EvaluationCase,
  type EvaluationRun,
  requestSchema,
} from "./api.ts";

export type EvaluationRunStatus = "completed" | "failed" | "interrupted" | "running";
export type EvaluationRunSource = "ai" | "human";

export type EvaluationRunSummary = {
  caseCount: number;
  chatId: string | null;
  completedAt: string | null;
  configurationFingerprint: string;
  createdAt: string;
  effectiveInstructionsHash: string | null;
  errorMessage: string | null;
  id: string;
  judgeModelIds: string[];
  promptId: string;
  promptRevisionId: string;
  promptTitle: string;
  source: EvaluationRunSource;
  status: EvaluationRunStatus;
  targetProfileId: string | null;
  targetProfileName: string | null;
  targetProfileRevisionId: string | null;
  targetModelId: string;
};

export type StoredEvaluationScore = {
  comment: string;
  criterion: Criterion;
  criterionPosition: number;
  dataType: "BOOLEAN" | "CATEGORICAL" | "CORRECTION" | "NUMERIC" | "TEXT";
  evidence: string[];
  id: string;
  judgeModelId: string;
  value: boolean | number | string;
};

export type StoredEvaluationCase = {
  criteria: Criterion[];
  id: string;
  input: unknown;
  output: unknown | null;
  position: number;
  scores: StoredEvaluationScore[];
};

export type StoredEvaluationRun = EvaluationRunSummary & {
  cases: StoredEvaluationCase[];
  promptMarkdown: string;
  targetConfiguration: Record<string, unknown> | null;
};

export type BooleanTrendPoint = {
  completedAt: string;
  rates: Array<{ criterion: string; criterionPosition: number; passed: number; total: number }>;
  revisionId: string;
  runId: string;
};

export const evaluationRunInputSchema = requestSchema.extend({
  cases: requestSchema.shape.cases.element
    .extend({ input: z.string().trim().min(1) })
    .array()
    .min(1),
  judges: z
    .array(z.string().trim().min(1))
    .min(1)
    .refine((judges) => new Set(judges).size === judges.length, "Judge model IDs must be unique."),
  promptId: z.string().uuid(),
  promptRevisionId: z.string().uuid(),
  targetModelId: z.string().trim().min(1),
});

type RunSummaryRow = {
  promptId: string;
  promptRevisionId: string;
  caseCount: number;
  chatId: string | null;
  completedAt: Date | null;
  configurationFingerprint: string;
  createdAt: Date;
  effectiveInstructionsHash: string | null;
  errorMessage: string | null;
  id: string;
  judgeModelIds: string[];
  promptTitle: string;
  source: EvaluationRunSource;
  status: EvaluationRunStatus;
  targetProfileId: string | null;
  targetProfileName: string | null;
  targetProfileRevisionId: string | null;
  targetModelId: string;
};

type RunRow = RunSummaryRow & {
  promptMarkdown: string;
  targetConfiguration: Record<string, unknown> | null;
};

type CaseRow = {
  criteria: Criterion[];
  id: string;
  input: unknown;
  output: unknown | null;
  position: number;
};

type ScoreRow = {
  caseId: string;
  comment: string;
  criterion: Criterion;
  criterionPosition: number;
  dataType: StoredEvaluationScore["dataType"];
  evidence: string[];
  id: string;
  judgeModelId: string;
  value: boolean | number | string;
};

export class EvaluationRunNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(runId: string) {
    super(`Evaluation run ${runId} was not found.`);
    this.name = "EvaluationRunNotFoundError";
  }
}

export class EvaluationRequestError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "EvaluationRequestError";
  }
}

export class EvaluationRuns {
  readonly #database: Database;
  readonly #prompts: PromptSystem;
  readonly #targets: TargetSystem;

  constructor(database: Database, prompts: PromptSystem, targets: TargetSystem) {
    this.#database = database;
    this.#prompts = prompts;
    this.#targets = targets;
  }

  async reconcileInterrupted(): Promise<number> {
    return this.#database.run(async (sql) => {
      const rows = await sql`
        UPDATE evaluation_runs
        SET
          status = 'interrupted',
          error_message = 'The server process ended before this evaluation completed.',
          completed_at = now()
        WHERE status = 'running'
        RETURNING id
      `;
      return rows.length;
    });
  }

  async startHumanRun(rawInput: unknown): Promise<EvaluationRunSummary> {
    return this.#startRun(rawInput, "human", null);
  }

  async startAgentRun(rawInput: unknown, chatId: string): Promise<EvaluationRunSummary> {
    return this.#startRun(rawInput, "ai", chatId);
  }

  async #startRun(
    rawInput: unknown,
    source: EvaluationRunSource,
    chatId: string | null,
  ): Promise<EvaluationRunSummary> {
    const parsed = evaluationRunInputSchema.safeParse(rawInput);
    if (!parsed.success)
      throw new EvaluationRequestError(
        parsed.error.issues[0]?.message ?? "Invalid evaluation request.",
      );
    const input = parsed.data;
    const request = requestSchema.parse({ cases: input.cases, judges: input.judges });
    const judgeModelIds = Array.isArray(request.judges) ? request.judges : [request.judges];
    const configuredModels = new Set(loadRuntimeConfig().models.map(({ id }) => id));
    const unknownModel = [input.targetModelId, ...judgeModelIds].find(
      (id) => !configuredModels.has(id),
    );
    if (unknownModel) throw new EvaluationRequestError(`Model is not configured: ${unknownModel}.`);
    const prompt = await this.#prompts.getPrompt(input.promptId);
    if (prompt.revisionId !== input.promptRevisionId) throw new PromptConflictError();
    const pinnedTarget = await this.#targets.createPinnedTarget({
      promptId: prompt.id,
      promptRevisionId: prompt.revisionId,
      targetModelId: input.targetModelId,
    });
    const targetConfiguration = pinnedTarget.profile.configuration;
    const configurationFingerprint = createConfigurationFingerprint({
      cases: request.cases,
      effectiveInstructionsHash: pinnedTarget.effectiveInstructionsHash,
      judges: judgeModelIds,
      targetConfiguration,
      targetModelId: input.targetModelId,
      targetProfileRevisionId: pinnedTarget.profile.revisionId,
    });
    let runId: string;
    try {
      runId = await this.#database.transaction((sql) =>
        insertRun(sql, {
          promptId: prompt.id,
          promptRevisionId: prompt.revisionId,
          cases: request.cases,
          chatId,
          configurationFingerprint,
          judgeModelIds,
          source,
          status: "running",
          targetProfileId: pinnedTarget.profile.id,
          targetProfileRevisionId: pinnedTarget.profile.revisionId,
          targetModelId: input.targetModelId,
          effectiveInstructionsHash: pinnedTarget.effectiveInstructionsHash,
        }),
      );
    } catch (error) {
      await pinnedTarget.close();
      throw error;
    }
    void this.#executeRun(runId, pinnedTarget, {
      cases: request.cases,
      judges: judgeModelIds,
    }).catch(() => undefined);
    return this.getRunSummary(runId);
  }

  async getRun(runId: string): Promise<StoredEvaluationRun> {
    return this.#database.run(async (sql) => {
      const row = await requireRunRow(sql, runId);
      const cases = await selectCases(sql, runId);
      const scores = await selectScores(sql, runId);
      const scoresByCase = new Map<string, ScoreRow[]>();
      for (const score of scores) {
        const grouped = scoresByCase.get(score.caseId) ?? [];
        grouped.push(score);
        scoresByCase.set(score.caseId, grouped);
      }
      return {
        ...projectRunSummary(row),
        cases: cases.map((testCase) => ({
          criteria: testCase.criteria,
          id: testCase.id,
          input: testCase.input,
          output: testCase.output,
          position: testCase.position,
          scores: (scoresByCase.get(testCase.id) ?? []).map((score) => ({
            comment: score.comment,
            criterion: score.criterion,
            criterionPosition: score.criterionPosition,
            dataType: score.dataType,
            evidence: score.evidence,
            id: score.id,
            judgeModelId: score.judgeModelId,
            value: score.value,
          })),
        })),
        promptMarkdown: row.promptMarkdown,
        targetConfiguration: row.targetConfiguration,
      };
    });
  }

  async getRunSummary(runId: string): Promise<EvaluationRunSummary> {
    return this.#database.run(async (sql) => projectRunSummary(await requireRunRow(sql, runId)));
  }

  async listRuns(
    input: { limit?: number; promptId?: string } = {},
  ): Promise<EvaluationRunSummary[]> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    return this.#database.run(async (sql) => {
      const rows = input.promptId
        ? await selectRunRowsForPrompt(sql, input.promptId, limit)
        : await selectRunRows(sql, limit);
      return rows.map(projectRunSummary);
    });
  }

  async getCompatibleBooleanTrend(runId: string): Promise<BooleanTrendPoint[]> {
    const run = await this.getRun(runId);
    if (
      run.status !== "completed" ||
      run.cases.some(({ criteria }) => criteria.some(({ type }) => type !== "boolean"))
    )
      return [];
    const compatible = await this.#database.run(async (sql) => {
      const rows = await sql<{ id: string }[]>`
        SELECT id
        FROM evaluation_runs
        WHERE
          prompt_id = ${run.promptId}
          AND configuration_fingerprint = ${run.configurationFingerprint}
          AND status = 'completed'
        ORDER BY completed_at, id
      `;
      return rows.map(({ id }) => id);
    });
    if (compatible.length < 2) return [];
    const runs = await Promise.all(compatible.map((id) => this.getRun(id)));
    return runs.map(projectBooleanTrendPoint);
  }

  async #executeRun(
    runId: string,
    pinnedTarget: PinnedTarget,
    request: { cases: EvaluationCase<unknown>[]; judges: string[] },
  ): Promise<void> {
    try {
      const result = await evaluate(pinnedTarget.target, request);
      await this.#database.transaction((sql) => completeRun(sql, runId, request.cases, result));
    } catch (error) {
      await this.#database.run(
        (sql) => sql`
          UPDATE evaluation_runs
          SET status = 'failed', error_message = ${safeExecutionError(error)}, completed_at = now()
          WHERE id = ${runId} AND status = 'running'
        `,
      );
    } finally {
      await pinnedTarget.close();
    }
  }
}

async function insertRun(
  sql: DatabaseClient,
  input: {
    promptId: string;
    promptRevisionId: string;
    cases: EvaluationCase<unknown>[];
    chatId: string | null;
    configurationFingerprint: string;
    judgeModelIds: string[];
    source: EvaluationRunSource;
    status: EvaluationRunStatus;
    targetProfileId: string;
    targetProfileRevisionId: string;
    targetModelId: string;
    effectiveInstructionsHash: string;
  },
): Promise<string> {
  const runId = randomUUID();
  await sql`
    INSERT INTO evaluation_runs (
      id, prompt_id, prompt_revision_id, chat_id, source, target_model_id,
      judge_model_ids, status, configuration_fingerprint,
      target_profile_id, target_profile_revision_id, effective_instructions_hash,
      completed_at
    )
    VALUES (
      ${runId}, ${input.promptId}, ${input.promptRevisionId}, ${input.chatId}, ${input.source},
      ${input.targetModelId}, ${sql.array(input.judgeModelIds)}, ${input.status},
      ${input.configurationFingerprint}, ${input.targetProfileId},
      ${input.targetProfileRevisionId}, ${input.effectiveInstructionsHash},
      ${input.status === "completed" ? new Date() : null}
    )
  `;
  for (const [position, testCase] of input.cases.entries()) {
    await sql`
      INSERT INTO evaluation_cases (id, run_id, position, input_json, criteria_json)
      VALUES (
        ${randomUUID()}, ${runId}, ${position},
        ${sql.json(testCase.input as postgres.JSONValue)},
        ${sql.json(testCase.criteria as postgres.JSONValue[])}
      )
    `;
  }
  return runId;
}

async function completeRun(
  sql: DatabaseClient,
  runId: string,
  configuredCases: EvaluationCase<unknown>[],
  result: EvaluationRun,
): Promise<void> {
  const cases = await selectCases(sql, runId);
  for (const [caseIndex, evaluatedCase] of result.cases.entries()) {
    const storedCase = cases[caseIndex];
    const configuredCase = configuredCases[caseIndex];
    if (!storedCase || !configuredCase)
      throw new Error(`Unknown evaluation case index: ${caseIndex}.`);
    await sql`
      UPDATE evaluation_cases
      SET output_json = ${sql.json(evaluatedCase.output as postgres.JSONValue)}
      WHERE id = ${storedCase.id}
    `;
    const judgeOffsets = new Map<string, number>();
    for (const evaluation of evaluatedCase.evaluations) {
      const criterionPosition = judgeOffsets.get(evaluation.judge) ?? 0;
      judgeOffsets.set(evaluation.judge, criterionPosition + 1);
      const criterion = configuredCase.criteria[criterionPosition];
      if (!criterion) throw new Error(`Unknown criterion position: ${criterionPosition}.`);
      await insertScore(sql, storedCase.id, criterionPosition, criterion, evaluation);
    }
  }
  await sql`
    UPDATE evaluation_runs
    SET status = 'completed', completed_at = now(), error_message = NULL
    WHERE id = ${runId}
  `;
}

async function insertScore(
  sql: DatabaseClient,
  caseId: string,
  criterionPosition: number,
  criterion: Criterion,
  evaluation: CriterionEvaluation,
): Promise<void> {
  await sql`
    INSERT INTO evaluation_scores (
      id, case_id, criterion_position, data_type, criterion_json,
      judge_model_id, value_json, comment, evidence_json
    )
    VALUES (
      ${randomUUID()}, ${caseId}, ${criterionPosition},
      ${criterion.type.toUpperCase() as StoredEvaluationScore["dataType"]},
      ${sql.json(criterion as postgres.JSONValue)}, ${evaluation.judge},
      ${sql.json(evaluation.value as postgres.JSONValue)}, ${evaluation.comment},
      ${sql.json(evaluation.evidence)}
    )
  `;
}

async function requireRunRow(sql: DatabaseClient, runId: string): Promise<RunRow> {
  const [row] = await selectRunRow(sql, runId);
  if (!row) throw new EvaluationRunNotFoundError(runId);
  return row;
}

function selectRunRow(sql: DatabaseClient, runId: string) {
  return sql<RunRow[]>`
    SELECT
      evaluation_runs.id, evaluation_runs.prompt_id,
      evaluation_runs.prompt_revision_id,
      evaluation_runs.chat_id, evaluation_runs.source, evaluation_runs.target_model_id,
      evaluation_runs.judge_model_ids, evaluation_runs.status,
      evaluation_runs.configuration_fingerprint, evaluation_runs.error_message,
      evaluation_runs.effective_instructions_hash,
      evaluation_runs.target_profile_id, evaluation_runs.target_profile_revision_id,
      target_profile_revisions.configuration AS target_configuration,
      evaluation_runs.created_at, evaluation_runs.completed_at,
      target_profiles.name AS target_profile_name,
      prompts.title AS prompt_title, prompt_revisions.markdown AS prompt_markdown,
      count(evaluation_cases.id)::integer AS case_count
    FROM evaluation_runs
    JOIN prompts ON prompts.id = evaluation_runs.prompt_id
    JOIN prompt_revisions ON prompt_revisions.id = evaluation_runs.prompt_revision_id
    LEFT JOIN target_profiles ON target_profiles.id = evaluation_runs.target_profile_id
    LEFT JOIN target_profile_revisions
      ON target_profile_revisions.target_profile_id = evaluation_runs.target_profile_id
      AND target_profile_revisions.id = evaluation_runs.target_profile_revision_id
    LEFT JOIN evaluation_cases ON evaluation_cases.run_id = evaluation_runs.id
    WHERE evaluation_runs.id = ${runId}
    GROUP BY
      evaluation_runs.id, prompts.title, prompt_revisions.markdown,
      target_profiles.name, target_profile_revisions.configuration
  `;
}

function selectRunRows(sql: DatabaseClient, limit: number) {
  return sql<RunSummaryRow[]>`
    SELECT
      evaluation_runs.id, evaluation_runs.prompt_id,
      evaluation_runs.prompt_revision_id,
      evaluation_runs.chat_id, evaluation_runs.source, evaluation_runs.target_model_id,
      evaluation_runs.judge_model_ids, evaluation_runs.status,
      evaluation_runs.configuration_fingerprint, evaluation_runs.error_message,
      evaluation_runs.effective_instructions_hash,
      evaluation_runs.target_profile_id, evaluation_runs.target_profile_revision_id,
      evaluation_runs.created_at, evaluation_runs.completed_at,
      target_profiles.name AS target_profile_name,
      prompts.title AS prompt_title,
      count(evaluation_cases.id)::integer AS case_count
    FROM evaluation_runs
    JOIN prompts ON prompts.id = evaluation_runs.prompt_id
    LEFT JOIN target_profiles ON target_profiles.id = evaluation_runs.target_profile_id
    LEFT JOIN evaluation_cases ON evaluation_cases.run_id = evaluation_runs.id
    GROUP BY evaluation_runs.id, prompts.title, target_profiles.name
    ORDER BY evaluation_runs.created_at DESC, evaluation_runs.id DESC
    LIMIT ${limit}
  `;
}

function selectRunRowsForPrompt(sql: DatabaseClient, promptId: string, limit: number) {
  return sql<RunSummaryRow[]>`
    SELECT
      evaluation_runs.id, evaluation_runs.prompt_id,
      evaluation_runs.prompt_revision_id,
      evaluation_runs.chat_id, evaluation_runs.source, evaluation_runs.target_model_id,
      evaluation_runs.judge_model_ids, evaluation_runs.status,
      evaluation_runs.configuration_fingerprint, evaluation_runs.error_message,
      evaluation_runs.effective_instructions_hash,
      evaluation_runs.target_profile_id, evaluation_runs.target_profile_revision_id,
      evaluation_runs.created_at, evaluation_runs.completed_at,
      target_profiles.name AS target_profile_name,
      prompts.title AS prompt_title,
      count(evaluation_cases.id)::integer AS case_count
    FROM evaluation_runs
    JOIN prompts ON prompts.id = evaluation_runs.prompt_id
    LEFT JOIN target_profiles ON target_profiles.id = evaluation_runs.target_profile_id
    LEFT JOIN evaluation_cases ON evaluation_cases.run_id = evaluation_runs.id
    WHERE evaluation_runs.prompt_id = ${promptId}
    GROUP BY evaluation_runs.id, prompts.title, target_profiles.name
    ORDER BY evaluation_runs.created_at DESC, evaluation_runs.id DESC
    LIMIT ${limit}
  `;
}

function selectCases(sql: DatabaseClient, runId: string) {
  return sql<CaseRow[]>`
    SELECT id, position, input_json AS input, criteria_json AS criteria, output_json AS output
    FROM evaluation_cases
    WHERE run_id = ${runId}
    ORDER BY position
  `;
}

function selectScores(sql: DatabaseClient, runId: string) {
  return sql<ScoreRow[]>`
    SELECT
      evaluation_scores.id, evaluation_scores.case_id,
      evaluation_scores.criterion_position, evaluation_scores.data_type,
      evaluation_scores.criterion_json AS criterion,
      evaluation_scores.judge_model_id, evaluation_scores.value_json AS value,
      evaluation_scores.comment, evaluation_scores.evidence_json AS evidence
    FROM evaluation_scores
    JOIN evaluation_cases ON evaluation_cases.id = evaluation_scores.case_id
    WHERE evaluation_cases.run_id = ${runId}
    ORDER BY evaluation_cases.position, evaluation_scores.criterion_position, evaluation_scores.judge_model_id
  `;
}

function projectRunSummary(row: RunSummaryRow): EvaluationRunSummary {
  return {
    caseCount: row.caseCount,
    chatId: row.chatId,
    completedAt: row.completedAt?.toISOString() ?? null,
    configurationFingerprint: row.configurationFingerprint,
    createdAt: row.createdAt.toISOString(),
    effectiveInstructionsHash: row.effectiveInstructionsHash,
    errorMessage: row.errorMessage,
    id: row.id,
    judgeModelIds: row.judgeModelIds,
    promptId: row.promptId,
    promptRevisionId: row.promptRevisionId,
    promptTitle: row.promptTitle,
    source: row.source,
    status: row.status,
    targetProfileId: row.targetProfileId,
    targetProfileName: row.targetProfileName,
    targetProfileRevisionId: row.targetProfileRevisionId,
    targetModelId: row.targetModelId,
  };
}

function createConfigurationFingerprint(input: {
  cases: EvaluationCase<unknown>[];
  effectiveInstructionsHash: string;
  judges: string[];
  targetConfiguration: Record<string, unknown>;
  targetModelId: string;
  targetProfileRevisionId: string;
}): string {
  const canonical = JSON.stringify({
    cases: input.cases,
    effectiveInstructionsHash: input.effectiveInstructionsHash,
    judges: input.judges.toSorted(),
    targetConfiguration: input.targetConfiguration,
    targetModelId: input.targetModelId,
    targetProfileRevisionId: input.targetProfileRevisionId,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function safeExecutionError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/LANGFUSE_(PUBLIC|SECRET)_KEY|Langfuse/i.test(message)) return message.slice(0, 500);
  return "Evaluation execution failed before a complete result was available. Check the configured model and telemetry services, then retry.";
}

function projectBooleanTrendPoint(run: StoredEvaluationRun): BooleanTrendPoint {
  const positions = new Map<number, { criterion: string; passed: number; total: number }>();
  for (const testCase of run.cases) {
    for (const score of testCase.scores) {
      if (score.dataType !== "BOOLEAN" || typeof score.value !== "boolean") continue;
      const current = positions.get(score.criterionPosition) ?? {
        criterion: score.criterion.instruction,
        passed: 0,
        total: 0,
      };
      current.total += 1;
      if (score.value) current.passed += 1;
      positions.set(score.criterionPosition, current);
    }
  }
  return {
    completedAt: run.completedAt ?? run.createdAt,
    rates: [...positions.entries()].map(([criterionPosition, value]) => ({
      criterionPosition,
      ...value,
    })),
    revisionId: run.promptRevisionId,
    runId: run.id,
  };
}
