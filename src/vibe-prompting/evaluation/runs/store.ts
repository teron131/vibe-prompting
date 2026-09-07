/** Owns durable evaluation run persistence, terminal state transitions, execution reads, and lifecycle summaries. */

import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import type { Criterion } from "../../criteria/schemas.ts";
import type { Database, DatabaseClient } from "../../database/index.ts";
import { type CriterionEvaluation, type EvaluationCase, type EvaluationRun } from "../api.ts";
import type { StoredEvaluationScore } from "../results/schemas.ts";
import {
  projectRunSummary,
  requireRunRow,
  selectCases,
  selectRunRows,
  selectRunRowsForPrompt,
} from "./queries.ts";
import {
  EvaluationRunNotFoundError,
  type EvaluationRunSource,
  type EvaluationRunStatus,
  type EvaluationRunSummary,
} from "./schemas.ts";

/** Carries the complete immutable configuration required before a running record can become visible. */
export type NewEvaluationRun = {
  promptId: string;
  promptRevisionId: string;
  targetProfileId: string;
  targetProfileRevisionId: string;
  targetModel: string;
  judgeModels: string[];
  cases: EvaluationCase<unknown>[];
  effectiveInstructionsHash: string;
  configurationFingerprint: string;
  source: EvaluationRunSource;
  chatId: string | null;
  isSyntheticExample: boolean;
  targetRunId: string | null;
  targetRunTurnId: string | null;
  startedByUserId: string;
  recordedOutputs?: unknown[];
};

export type EvaluationExecution = {
  promptId: string;
  promptRevisionId: string;
  targetProfileId: string | null;
  targetProfileRevisionId: string | null;
  targetModel: string;
  judgeModels: string[];
  cases: Array<{ input: unknown; criteria: Criterion[]; output: unknown | null }>;
  targetRunTurnId: string | null;
  startedByUserId: string;
};

/** Keeps every evaluation run state transition and projection behind one PostgreSQL owner. */
export class EvaluationRunStore {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  /** Terminalizes work abandoned by an earlier process before new application work is served. */
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

  async create(record: NewEvaluationRun): Promise<string> {
    return this.#database.transaction((sql) => insertRun(sql, record));
  }

  /** Commits every run and case record together so a batch is either discoverable in full or absent. */
  async createBatch(records: readonly NewEvaluationRun[]): Promise<string[]> {
    return this.#database.transaction(async (sql) => {
      const runIds: string[] = [];
      for (const record of records) runIds.push(await insertRun(sql, record));
      return runIds;
    });
  }

  async claimNextQueued(): Promise<string | undefined> {
    return this.#database.transaction(async (sql) => {
      const [claimed] = await sql<{ id: string }[]>`
        WITH next_run AS (
          SELECT id
          FROM evaluation_runs
          WHERE status = 'queued'
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE evaluation_runs
        SET status = 'running'
        WHERE id = (SELECT id FROM next_run) AND status = 'queued'
        RETURNING id
      `;
      return claimed?.id;
    });
  }

  async cancel(runId: string, actorUserId: string): Promise<boolean> {
    return this.#database.run(async (sql) => {
      const rows = await sql`
        UPDATE evaluation_runs
        SET
          status = 'cancelled',
          error_message = 'The evaluation was cancelled.',
          cancelled_at = now(),
          cancelled_by_user_id = ${actorUserId},
          completed_at = now()
        WHERE id = ${runId} AND status IN ('queued', 'running')
        RETURNING id
      `;
      if (rows.length) return true;
      const [existing] = await sql<{ status: EvaluationRunStatus }[]>`
        SELECT status FROM evaluation_runs WHERE id = ${runId}
      `;
      if (!existing) throw new EvaluationRunNotFoundError(runId);
      return existing.status === "cancelled";
    });
  }

  /** Locks the run before completion so startup reconciliation and late workers cannot both win. */
  async complete(
    runId: string,
    configuredCases: EvaluationCase<unknown>[],
    result: EvaluationRun,
  ): Promise<void> {
    await this.#database.transaction((sql) => completeRun(sql, runId, configuredCases, result));
  }

  /** Records failure only while the run remains active so late workers cannot replace another terminal state. */
  async fail(
    runId: string,
    message: string,
    status: "failed" | "interrupted" = "failed",
  ): Promise<void> {
    await this.#database.run(
      (sql) => sql`
        UPDATE evaluation_runs
        SET status = ${status}, error_message = ${message}, completed_at = now()
        WHERE id = ${runId} AND status = 'running'
      `,
    );
  }

  async getExecution(runId: string): Promise<EvaluationExecution> {
    return this.#database.run(async (sql) => {
      const row = await requireRunRow(sql, runId);
      return {
        promptId: row.promptId,
        promptRevisionId: row.promptRevisionId,
        targetProfileId: row.targetProfileId,
        targetProfileRevisionId: row.targetProfileRevisionId,
        targetModel: row.targetModel,
        judgeModels: row.judgeModels,
        cases: (await selectCases(sql, runId)).map(({ input, criteria, output }) => ({
          input,
          criteria,
          output,
        })),
        targetRunTurnId: row.targetRunTurnId,
        startedByUserId: row.startedByUserId,
      };
    });
  }

  async getSummary(runId: string, viewerUserId: string): Promise<EvaluationRunSummary> {
    return this.#database.run(async (sql) =>
      projectRunSummary(await requireRunRow(sql, runId), viewerUserId),
    );
  }

  async list(
    viewerUserId: string,
    input: { limit?: number; promptId?: string } = {},
  ): Promise<EvaluationRunSummary[]> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    return this.#database.run(async (sql) => {
      const rows = input.promptId
        ? await selectRunRowsForPrompt(sql, input.promptId, limit)
        : await selectRunRows(sql, limit);
      return rows.map((row) => projectRunSummary(row, viewerUserId));
    });
  }
}

async function insertRun(sql: DatabaseClient, input: NewEvaluationRun): Promise<string> {
  const runId = randomUUID();
  await sql`
    INSERT INTO evaluation_runs (
      id, prompt_id, prompt_revision_id, chat_id, source, target_model_id,
      judge_model_ids, status, configuration_fingerprint, is_synthetic_example,
      target_profile_id, target_profile_revision_id, effective_instructions_hash,
      target_run_id, target_run_turn_id,
      completed_at, started_by_user_id
    )
    VALUES (
      ${runId}, ${input.promptId}, ${input.promptRevisionId}, ${input.chatId}, ${input.source},
      ${input.targetModel}, ${sql.array(input.judgeModels)}, 'queued',
      ${input.configurationFingerprint}, ${input.isSyntheticExample}, ${input.targetProfileId},
      ${input.targetProfileRevisionId}, ${input.effectiveInstructionsHash},
      ${input.targetRunId}, ${input.targetRunTurnId},
      NULL, ${input.startedByUserId}
    )
  `;
  for (const [position, testCase] of input.cases.entries()) {
    const output = input.recordedOutputs?.[position];
    await sql`
      INSERT INTO evaluation_cases (id, run_id, position, input_json, criteria_json, output_json)
      VALUES (
        ${randomUUID()}, ${runId}, ${position},
        ${sql.json(testCase.input as postgres.JSONValue)},
        ${sql.json(testCase.criteria as postgres.JSONValue[])},
        ${output === undefined ? null : sql.json(output as postgres.JSONValue)}
      )
    `;
  }
  return runId;
}

/** Locks the running state before persisting output and scores so interrupted runs cannot be resurrected. */
async function completeRun(
  sql: DatabaseClient,
  runId: string,
  configuredCases: EvaluationCase<unknown>[],
  result: EvaluationRun,
): Promise<void> {
  const [run] = await sql<{ status: EvaluationRunStatus }[]>`
    SELECT status
    FROM evaluation_runs
    WHERE id = ${runId}
    FOR UPDATE
  `;
  if (!run) throw new EvaluationRunNotFoundError(runId);
  if (run.status !== "running") return;

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
      const criterionPosition = judgeOffsets.get(evaluation.judgeModel) ?? 0;
      judgeOffsets.set(evaluation.judgeModel, criterionPosition + 1);
      const criterion = configuredCase.criteria[criterionPosition];
      if (!criterion) throw new Error(`Unknown criterion position: ${criterionPosition}.`);
      await insertScore(sql, storedCase.id, criterionPosition, criterion, evaluation);
    }
  }
  await sql`
    UPDATE evaluation_runs
    SET status = 'completed', completed_at = now(), error_message = NULL
    WHERE id = ${runId} AND status = 'running'
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
      ${sql.json(criterion as postgres.JSONValue)}, ${evaluation.judgeModel},
      ${sql.json(evaluation.value as postgres.JSONValue)}, ${evaluation.comment},
      ${sql.json(evaluation.evidence)}
    )
  `;
}
