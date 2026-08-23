/** Owns durable evaluation run persistence, terminal state transitions, report projection, and trend aggregation. */

import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import type { Database, DatabaseClient } from "../../database/index.ts";
import {
  type Criterion,
  type CriterionEvaluation,
  type EvaluationCase,
  type EvaluationRun,
} from "../api.ts";
import {
  type BooleanTrendPoint,
  EvaluationRunNotFoundError,
  type EvaluationRunSource,
  type EvaluationRunStatus,
  type EvaluationRunSummary,
  type StoredEvaluationRun,
  type StoredEvaluationScore,
} from "./schemas.ts";

type RunSummaryRow = {
  id: string;
  promptId: string;
  promptRevisionId: string;
  promptRevisionNumber: number;
  promptTitle: string;
  targetProfileId: string | null;
  targetProfileRevisionId: string | null;
  targetProfileName: string | null;
  targetModelId: string;
  targetRunId: string | null;
  targetRunTurnId: string | null;
  judgeModelIds: string[];
  caseCount: number;
  configurationFingerprint: string;
  effectiveInstructionsHash: string | null;
  source: EvaluationRunSource;
  startedByUserId: string;
  startedByName: string | null;
  chatId: string | null;
  chatOwnerUserId: string | null;
  isSyntheticExample: boolean;
  status: EvaluationRunStatus;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

type RunRow = RunSummaryRow & {
  promptMarkdown: string;
  targetConfiguration: Record<string, unknown> | null;
};

type CaseRow = {
  id: string;
  position: number;
  input: unknown;
  criteria: Criterion[];
  output: unknown | null;
};

type ScoreRow = {
  id: string;
  caseId: string;
  criterionPosition: number;
  criterion: Criterion;
  dataType: StoredEvaluationScore["dataType"];
  judgeModelId: string;
  value: boolean | number | string;
  comment: string;
  evidence: string[];
};

type TrendSourceRow = {
  id: string;
  promptId: string;
  promptRevisionId: string;
  configurationFingerprint: string;
  status: EvaluationRunStatus;
  booleanOnly: boolean;
};

type BooleanTrendRow = {
  id: string;
  promptRevisionId: string;
  promptRevisionNumber: number;
  completedAt: Date | null;
  createdAt: Date;
  criterionPosition: number | null;
  criterion: string | null;
  passed: number | null;
  total: number | null;
};

/** Carries the complete immutable configuration required before a running record can become visible. */
export type NewEvaluationRun = {
  promptId: string;
  promptRevisionId: string;
  targetProfileId: string;
  targetProfileRevisionId: string;
  targetModelId: string;
  judgeModelIds: string[];
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
  targetModelId: string;
  judgeModelIds: string[];
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
  async fail(runId: string, message: string): Promise<void> {
    await this.#database.run(
      (sql) => sql`
        UPDATE evaluation_runs
        SET status = 'failed', error_message = ${message}, completed_at = now()
        WHERE id = ${runId} AND status = 'running'
      `,
    );
  }

  async get(runId: string, viewerUserId: string): Promise<StoredEvaluationRun> {
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
        ...projectRunSummary(row, viewerUserId),
        promptMarkdown: row.promptMarkdown,
        targetConfiguration: row.targetConfiguration,
        cases: cases.map((testCase) => ({
          id: testCase.id,
          position: testCase.position,
          input: testCase.input,
          criteria: testCase.criteria,
          output: testCase.output,
          scores: (scoresByCase.get(testCase.id) ?? []).map((score) => ({
            id: score.id,
            criterionPosition: score.criterionPosition,
            criterion: score.criterion,
            dataType: score.dataType,
            judgeModelId: score.judgeModelId,
            value: score.value,
            comment: score.comment,
            evidence: score.evidence,
          })),
        })),
      };
    });
  }

  async getExecution(runId: string): Promise<EvaluationExecution> {
    return this.#database.run(async (sql) => {
      const row = await requireRunRow(sql, runId);
      return {
        promptId: row.promptId,
        promptRevisionId: row.promptRevisionId,
        targetProfileId: row.targetProfileId,
        targetProfileRevisionId: row.targetProfileRevisionId,
        targetModelId: row.targetModelId,
        judgeModelIds: row.judgeModelIds,
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

  /** Returns compatible Boolean history with two bounded aggregate queries instead of loading full reports. */
  async getBooleanTrend(runId: string): Promise<BooleanTrendPoint[]> {
    const source = await this.#database.run(async (sql) => {
      const [row] = await sql<TrendSourceRow[]>`
        SELECT
          evaluation_runs.id,
          evaluation_runs.prompt_id,
          evaluation_runs.prompt_revision_id,
          evaluation_runs.configuration_fingerprint,
          evaluation_runs.status,
          NOT EXISTS (
            SELECT 1
            FROM evaluation_cases
            CROSS JOIN LATERAL jsonb_array_elements(evaluation_cases.criteria_json) AS criterion(item)
            WHERE evaluation_cases.run_id = evaluation_runs.id
              AND criterion.item->>'type' IS DISTINCT FROM 'boolean'
          ) AS boolean_only
        FROM evaluation_runs
        WHERE evaluation_runs.id = ${runId}
      `;
      if (!row) throw new EvaluationRunNotFoundError(runId);
      return row;
    });
    if (source.status !== "completed" || !source.booleanOnly) return [];

    const rows = await this.#database.run(
      (sql) => sql<BooleanTrendRow[]>`
        WITH compatible_runs AS (
          SELECT
            evaluation_runs.id,
            evaluation_runs.prompt_revision_id,
            prompt_revisions.revision_number AS prompt_revision_number,
            evaluation_runs.created_at,
            evaluation_runs.completed_at
          FROM evaluation_runs
          JOIN prompt_revisions ON prompt_revisions.id = evaluation_runs.prompt_revision_id
          WHERE evaluation_runs.prompt_id = ${source.promptId}
            AND evaluation_runs.configuration_fingerprint = ${source.configurationFingerprint}
            AND evaluation_runs.status = 'completed'
        ), boolean_scores AS (
          SELECT
            evaluation_cases.run_id,
            evaluation_scores.criterion_position,
            evaluation_scores.criterion_json->>'name' AS criterion,
            count(*)::integer AS total,
            count(*) FILTER (WHERE evaluation_scores.value_json #>> '{}' = 'true')::integer AS passed
          FROM evaluation_scores
          JOIN evaluation_cases ON evaluation_cases.id = evaluation_scores.case_id
          WHERE evaluation_cases.run_id IN (SELECT id FROM compatible_runs)
            AND evaluation_scores.data_type = 'BOOLEAN'
            AND jsonb_typeof(evaluation_scores.value_json) = 'boolean'
          GROUP BY
            evaluation_cases.run_id,
            evaluation_scores.criterion_position,
            evaluation_scores.criterion_json->>'name'
        )
        SELECT
          compatible_runs.id,
          compatible_runs.prompt_revision_id,
          compatible_runs.prompt_revision_number,
          compatible_runs.created_at,
          compatible_runs.completed_at,
          boolean_scores.criterion_position,
          boolean_scores.criterion,
          boolean_scores.passed,
          boolean_scores.total
        FROM compatible_runs
        LEFT JOIN boolean_scores ON boolean_scores.run_id = compatible_runs.id
        ORDER BY compatible_runs.completed_at, compatible_runs.id,
          boolean_scores.criterion_position, boolean_scores.criterion
      `,
    );
    return projectBooleanTrendRows(rows);
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
      ${input.targetModelId}, ${sql.array(input.judgeModelIds)}, 'queued',
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
      evaluation_runs.chat_id, evaluation_runs.source, evaluation_runs.started_by_user_id,
      starter.name AS started_by_name,
      evaluation_runs.target_model_id,
      evaluation_runs.judge_model_ids, evaluation_runs.status,
      evaluation_runs.configuration_fingerprint, evaluation_runs.error_message,
      evaluation_runs.is_synthetic_example,
      evaluation_runs.effective_instructions_hash,
      evaluation_runs.target_profile_id, evaluation_runs.target_profile_revision_id,
      evaluation_runs.target_run_id, evaluation_runs.target_run_turn_id,
      target_profile_revisions.configuration AS target_configuration,
      evaluation_runs.created_at, evaluation_runs.completed_at,
      chats.owner_user_id AS chat_owner_user_id,
      target_profiles.name AS target_profile_name,
      prompts.title AS prompt_title,
      prompt_revisions.revision_number AS prompt_revision_number,
      prompt_revisions.markdown AS prompt_markdown,
      count(evaluation_cases.id)::integer AS case_count
    FROM evaluation_runs
    JOIN prompts ON prompts.id = evaluation_runs.prompt_id
    JOIN prompt_revisions ON prompt_revisions.id = evaluation_runs.prompt_revision_id
    JOIN auth_users AS starter ON starter.id = evaluation_runs.started_by_user_id
    LEFT JOIN target_profiles ON target_profiles.id = evaluation_runs.target_profile_id
    LEFT JOIN target_profile_revisions
      ON target_profile_revisions.target_profile_id = evaluation_runs.target_profile_id
      AND target_profile_revisions.id = evaluation_runs.target_profile_revision_id
    LEFT JOIN evaluation_cases ON evaluation_cases.run_id = evaluation_runs.id
    LEFT JOIN chats ON chats.id = evaluation_runs.chat_id
    WHERE evaluation_runs.id = ${runId}
    GROUP BY
      evaluation_runs.id, prompts.title, prompt_revisions.revision_number, prompt_revisions.markdown,
      target_profiles.name, target_profile_revisions.configuration, chats.owner_user_id,
      starter.name
  `;
}

function selectRunRows(sql: DatabaseClient, limit: number) {
  return sql<RunSummaryRow[]>`
    SELECT
      evaluation_runs.id, evaluation_runs.prompt_id,
      evaluation_runs.prompt_revision_id,
      evaluation_runs.chat_id, evaluation_runs.source, evaluation_runs.started_by_user_id,
      starter.name AS started_by_name,
      evaluation_runs.target_model_id,
      evaluation_runs.judge_model_ids, evaluation_runs.status,
      evaluation_runs.configuration_fingerprint, evaluation_runs.error_message,
      evaluation_runs.is_synthetic_example,
      evaluation_runs.effective_instructions_hash,
      evaluation_runs.target_profile_id, evaluation_runs.target_profile_revision_id,
      evaluation_runs.target_run_id, evaluation_runs.target_run_turn_id,
      evaluation_runs.created_at, evaluation_runs.completed_at,
      chats.owner_user_id AS chat_owner_user_id,
      target_profiles.name AS target_profile_name,
      prompts.title AS prompt_title, prompt_revisions.revision_number AS prompt_revision_number,
      count(evaluation_cases.id)::integer AS case_count
    FROM evaluation_runs
    JOIN prompts ON prompts.id = evaluation_runs.prompt_id
    JOIN prompt_revisions ON prompt_revisions.id = evaluation_runs.prompt_revision_id
    JOIN auth_users AS starter ON starter.id = evaluation_runs.started_by_user_id
    LEFT JOIN target_profiles ON target_profiles.id = evaluation_runs.target_profile_id
    LEFT JOIN evaluation_cases ON evaluation_cases.run_id = evaluation_runs.id
    LEFT JOIN chats ON chats.id = evaluation_runs.chat_id
    GROUP BY evaluation_runs.id, prompts.title, prompt_revisions.revision_number, target_profiles.name, chats.owner_user_id, starter.name
    ORDER BY evaluation_runs.created_at DESC, evaluation_runs.id DESC
    LIMIT ${limit}
  `;
}

function selectRunRowsForPrompt(sql: DatabaseClient, promptId: string, limit: number) {
  return sql<RunSummaryRow[]>`
    SELECT
      evaluation_runs.id, evaluation_runs.prompt_id,
      evaluation_runs.prompt_revision_id,
      evaluation_runs.chat_id, evaluation_runs.source, evaluation_runs.started_by_user_id,
      starter.name AS started_by_name,
      evaluation_runs.target_model_id,
      evaluation_runs.judge_model_ids, evaluation_runs.status,
      evaluation_runs.configuration_fingerprint, evaluation_runs.error_message,
      evaluation_runs.is_synthetic_example,
      evaluation_runs.effective_instructions_hash,
      evaluation_runs.target_profile_id, evaluation_runs.target_profile_revision_id,
      evaluation_runs.target_run_id, evaluation_runs.target_run_turn_id,
      evaluation_runs.created_at, evaluation_runs.completed_at,
      chats.owner_user_id AS chat_owner_user_id,
      target_profiles.name AS target_profile_name,
      prompts.title AS prompt_title, prompt_revisions.revision_number AS prompt_revision_number,
      count(evaluation_cases.id)::integer AS case_count
    FROM evaluation_runs
    JOIN prompts ON prompts.id = evaluation_runs.prompt_id
    JOIN prompt_revisions ON prompt_revisions.id = evaluation_runs.prompt_revision_id
    JOIN auth_users AS starter ON starter.id = evaluation_runs.started_by_user_id
    LEFT JOIN target_profiles ON target_profiles.id = evaluation_runs.target_profile_id
    LEFT JOIN evaluation_cases ON evaluation_cases.run_id = evaluation_runs.id
    LEFT JOIN chats ON chats.id = evaluation_runs.chat_id
    WHERE evaluation_runs.prompt_id = ${promptId}
    GROUP BY evaluation_runs.id, prompts.title, prompt_revisions.revision_number, target_profiles.name, chats.owner_user_id, starter.name
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

function projectRunSummary(row: RunSummaryRow, viewerUserId: string): EvaluationRunSummary {
  return {
    id: row.id,
    promptId: row.promptId,
    promptRevisionId: row.promptRevisionId,
    promptRevisionNumber: row.promptRevisionNumber,
    promptTitle: row.promptTitle,
    targetProfileId: row.targetProfileId,
    targetProfileRevisionId: row.targetProfileRevisionId,
    targetProfileName: row.targetProfileName,
    targetModelId: row.targetModelId,
    targetRunId: row.targetRunId,
    targetRunTurnId: row.targetRunTurnId,
    judgeModelIds: row.judgeModelIds,
    caseCount: row.caseCount,
    configurationFingerprint: row.configurationFingerprint,
    effectiveInstructionsHash: row.effectiveInstructionsHash,
    source: row.source,
    startedByName: row.startedByName,
    chatId: row.chatOwnerUserId === viewerUserId ? row.chatId : null,
    isSyntheticExample: row.isSyntheticExample,
    status: row.status,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

/** Reassembles SQL aggregates into the public chronological trend shape. */
function projectBooleanTrendRows(rows: BooleanTrendRow[]): BooleanTrendPoint[] {
  const points = new Map<
    string,
    {
      runId: string;
      revisionId: string;
      revisionNumber: number;
      completedAt: string;
      rates: Map<number, { criterion: string; passed: number; total: number }>;
    }
  >();
  for (const row of rows) {
    const point = points.get(row.id) ?? {
      runId: row.id,
      revisionId: row.promptRevisionId,
      revisionNumber: row.promptRevisionNumber,
      completedAt: (row.completedAt ?? row.createdAt).toISOString(),
      rates: new Map(),
    };
    points.set(row.id, point);
    if (row.criterionPosition === null || row.criterion === null) continue;
    const rate = point.rates.get(row.criterionPosition) ?? {
      criterion: row.criterion,
      passed: 0,
      total: 0,
    };
    rate.passed += row.passed ?? 0;
    rate.total += row.total ?? 0;
    point.rates.set(row.criterionPosition, rate);
  }
  if (points.size < 2) return [];
  return [...points.values()].map(({ runId, revisionId, revisionNumber, completedAt, rates }) => ({
    runId,
    revisionId,
    revisionNumber,
    completedAt,
    rates: [...rates.entries()].map(([criterionPosition, value]) => ({
      criterionPosition,
      ...value,
    })),
  }));
}
