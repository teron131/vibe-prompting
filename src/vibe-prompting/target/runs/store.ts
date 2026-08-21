/** Owns Target Run persistence, immutable completed turns, exact runtime provenance, and prompt-scoped history projection. */

import { randomUUID } from "node:crypto";

import type { ModelMessage } from "ai";
import type postgres from "postgres";

import type { Database, DatabaseClient } from "../../database.ts";
import {
  type StoredTargetRun,
  TargetRunConflictError,
  TargetRunNotFoundError,
  type TargetRunSource,
  type TargetRunSummary,
  type TargetRunTurn,
  type TargetRunTurnStatus,
  type TargetRunUsage,
} from "./schemas.ts";

type RunRow = {
  chatId: string | null;
  createdAt: Date;
  effectiveInstructionsHash: string;
  id: string;
  latestStatus: TargetRunTurnStatus;
  promptId: string;
  promptRevisionId: string;
  promptRevisionNumber: number;
  promptTitle: string;
  reasoningEffort: TargetRunSummary["reasoningEffort"];
  source: TargetRunSource;
  targetConfiguration: Record<string, unknown>;
  targetModelId: string;
  targetProfileId: string;
  targetProfileName: string;
  targetProfileRevisionId: string;
  turnCount: number;
  updatedAt: Date;
};

type TurnRow = {
  activity: TargetRunTurn["activity"];
  completedAt: Date | null;
  createdAt: Date;
  errorMessage: string | null;
  id: string;
  input: string;
  output: string | null;
  position: number;
  responseMessages: ModelMessage[] | null;
  status: TargetRunTurnStatus;
  usage: TargetRunUsage | null;
};

export type TargetRunExecutionContext = {
  effectiveInstructionsHash: string;
  promptId: string;
  promptRevisionId: string;
  reasoningEffort: TargetRunSummary["reasoningEffort"];
  responseHistory: Array<{ input: string; responseMessages: ModelMessage[] }>;
  targetModelId: string;
  targetProfileId: string;
  targetProfileRevisionId: string;
  turn: { id: string; input: string; position: number };
};

export type NewTargetRun = {
  chatId: string | null;
  effectiveInstructionsHash: string;
  instruction: string;
  promptId: string;
  promptRevisionId: string;
  reasoningEffort: TargetRunSummary["reasoningEffort"];
  source: TargetRunSource;
  targetModelId: string;
  targetProfileId: string;
  targetProfileRevisionId: string;
};

export class TargetRunStore {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async reconcileInterrupted(): Promise<number> {
    return this.#database.transaction(async (sql) => {
      const rows = await sql`
        UPDATE target_run_turns
        SET
          status = 'interrupted',
          error_message = 'The server process ended before this Target Run turn completed.',
          completed_at = now()
        WHERE status = 'running'
        RETURNING run_id
      `;
      if (rows.length) {
        await sql`
          UPDATE target_runs
          SET updated_at = now()
          WHERE id IN ${sql(rows.map(({ runId }) => runId))}
        `;
      }
      return rows.length;
    });
  }

  async create(input: NewTargetRun): Promise<string> {
    const runId = randomUUID();
    const turnId = randomUUID();
    await this.#database.transaction(async (sql) => {
      await sql`
        INSERT INTO target_runs (
          id, prompt_id, prompt_revision_id, target_profile_id, target_profile_revision_id,
          target_model_id, reasoning_effort, effective_instructions_hash, source, chat_id
        )
        VALUES (
          ${runId}, ${input.promptId}, ${input.promptRevisionId}, ${input.targetProfileId},
          ${input.targetProfileRevisionId}, ${input.targetModelId},
          ${input.reasoningEffort}, ${input.effectiveInstructionsHash}, ${input.source}, ${input.chatId}
        )
      `;
      await insertTurn(sql, runId, turnId, 0, input.instruction);
    });
    return runId;
  }

  async appendTurn(runId: string, instruction: string): Promise<void> {
    await this.#database.transaction(async (sql) => {
      const [run] = await sql<{ id: string }[]>`
        SELECT id
        FROM target_runs
        WHERE id = ${runId}
        FOR UPDATE
      `;
      if (!run) throw new TargetRunNotFoundError(runId);
      const [active] = await sql<{ id: string }[]>`
        SELECT id
        FROM target_run_turns
        WHERE run_id = ${runId} AND status = 'running'
      `;
      if (active) throw new TargetRunConflictError("This Target Run already has an active turn.");
      const [position] = await sql<{ next: number }[]>`
        SELECT coalesce(max(position), -1)::integer + 1 AS next
        FROM target_run_turns
        WHERE run_id = ${runId}
      `;
      await insertTurn(sql, runId, randomUUID(), position?.next ?? 0, instruction);
      await sql`UPDATE target_runs SET updated_at = now() WHERE id = ${runId}`;
    });
  }

  async completeTurn(
    runId: string,
    turnId: string,
    activity: TargetRunTurn["activity"],
    output: string,
    responseMessages: ModelMessage[],
    usage: TargetRunUsage,
  ): Promise<void> {
    await this.#database.transaction(async (sql) => {
      await sql`
        UPDATE target_run_turns
        SET
          activity_json = ${sql.json(activity as postgres.JSONValue[])},
          output_text = ${output},
          response_messages_json = ${sql.json(responseMessages as postgres.JSONValue[])},
          usage_json = ${sql.json(usage as unknown as postgres.JSONValue)},
          status = 'completed',
          error_message = NULL,
          completed_at = now()
        WHERE id = ${turnId} AND run_id = ${runId} AND status = 'running'
      `;
      await sql`UPDATE target_runs SET updated_at = now() WHERE id = ${runId}`;
    });
  }

  async failTurn(
    runId: string,
    turnId: string,
    status: Extract<TargetRunTurnStatus, "failed" | "interrupted">,
    message: string,
  ): Promise<void> {
    await this.#database.transaction(async (sql) => {
      await sql`
        UPDATE target_run_turns
        SET status = ${status}, error_message = ${message}, completed_at = now()
        WHERE id = ${turnId} AND run_id = ${runId} AND status = 'running'
      `;
      await sql`UPDATE target_runs SET updated_at = now() WHERE id = ${runId}`;
    });
  }

  async get(runId: string): Promise<StoredTargetRun> {
    return this.#database.run(async (sql) => {
      const row = await requireRunRow(sql, runId);
      return { ...projectRunSummary(row), turns: (await selectTurns(sql, runId)).map(projectTurn) };
    });
  }

  async list(promptId: string, limit = 30): Promise<TargetRunSummary[]> {
    return this.#database.run(async (sql) => {
      const rows = await selectRunRows(sql, promptId, Math.min(Math.max(limit, 1), 100));
      return rows.map(projectRunSummary);
    });
  }

  async getExecutionContext(runId: string): Promise<TargetRunExecutionContext> {
    return this.#database.run(async (sql) => {
      const row = await requireRunRow(sql, runId);
      const turns = await selectTurns(sql, runId);
      const activeTurn = turns.find(({ status }) => status === "running");
      if (!activeTurn) throw new TargetRunConflictError("This Target Run has no active turn.");
      const responseHistory = turns
        .filter(
          (turn): turn is TurnRow & { responseMessages: ModelMessage[] } =>
            turn.position < activeTurn.position &&
            turn.status === "completed" &&
            Boolean(turn.responseMessages),
        )
        .map(({ input, responseMessages }) => ({ input, responseMessages }));
      return {
        effectiveInstructionsHash: row.effectiveInstructionsHash,
        promptId: row.promptId,
        promptRevisionId: row.promptRevisionId,
        reasoningEffort: row.reasoningEffort,
        responseHistory,
        targetModelId: row.targetModelId,
        targetProfileId: row.targetProfileId,
        targetProfileRevisionId: row.targetProfileRevisionId,
        turn: { id: activeTurn.id, input: activeTurn.input, position: activeTurn.position },
      };
    });
  }
}

async function insertTurn(
  sql: DatabaseClient,
  runId: string,
  turnId: string,
  position: number,
  instruction: string,
): Promise<void> {
  await sql`
    INSERT INTO target_run_turns (id, run_id, position, input_text, status)
    VALUES (${turnId}, ${runId}, ${position}, ${instruction}, 'running')
  `;
}

async function requireRunRow(sql: DatabaseClient, runId: string): Promise<RunRow> {
  const [row] = await selectRunRowsById(sql, runId);
  if (!row) throw new TargetRunNotFoundError(runId);
  return row;
}

function selectRunRowsById(sql: DatabaseClient, runId: string) {
  return sql<
    RunRow[]
  >`${runProjection(sql)} WHERE target_runs.id = ${runId} GROUP BY ${runGrouping(sql)}`;
}

function selectRunRows(sql: DatabaseClient, promptId: string, limit: number) {
  return sql<
    RunRow[]
  >`${runProjection(sql)} WHERE target_runs.prompt_id = ${promptId} GROUP BY ${runGrouping(sql)} ORDER BY target_runs.updated_at DESC, target_runs.id DESC LIMIT ${limit}`;
}

function runProjection(sql: DatabaseClient) {
  return sql`
    SELECT
      target_runs.id,
      target_runs.prompt_id,
      target_runs.prompt_revision_id,
      target_runs.target_profile_id,
      target_runs.target_profile_revision_id,
      target_runs.target_model_id,
      target_runs.reasoning_effort,
      target_runs.effective_instructions_hash,
      target_runs.source,
      target_runs.chat_id,
      target_runs.created_at,
      target_runs.updated_at,
      prompts.title AS prompt_title,
      prompt_revisions.revision_number AS prompt_revision_number,
      target_profiles.name AS target_profile_name,
      target_profile_revisions.configuration AS target_configuration,
      count(target_run_turns.id)::integer AS turn_count,
      coalesce(
        (array_agg(target_run_turns.status ORDER BY target_run_turns.position DESC))[1],
        'interrupted'
      ) AS latest_status
    FROM target_runs
    JOIN prompts ON prompts.id = target_runs.prompt_id
    JOIN prompt_revisions ON prompt_revisions.id = target_runs.prompt_revision_id
    JOIN target_profiles ON target_profiles.id = target_runs.target_profile_id
    JOIN target_profile_revisions
      ON target_profile_revisions.target_profile_id = target_runs.target_profile_id
      AND target_profile_revisions.id = target_runs.target_profile_revision_id
    LEFT JOIN target_run_turns ON target_run_turns.run_id = target_runs.id
  `;
}

function runGrouping(sql: DatabaseClient) {
  return sql`
    target_runs.id,
    prompts.title,
    prompt_revisions.revision_number,
    target_profiles.name,
    target_profile_revisions.configuration
  `;
}

function selectTurns(sql: DatabaseClient, runId: string) {
  return sql<TurnRow[]>`
    SELECT
      id,
      position,
      input_text AS input,
      activity_json AS activity,
      output_text AS output,
      response_messages_json AS response_messages,
      usage_json AS usage,
      status,
      error_message,
      created_at,
      completed_at
    FROM target_run_turns
    WHERE run_id = ${runId}
    ORDER BY position
  `;
}

function projectRunSummary(row: RunRow): TargetRunSummary {
  return {
    chatId: row.chatId,
    createdAt: row.createdAt.toISOString(),
    effectiveInstructionsHash: row.effectiveInstructionsHash,
    id: row.id,
    latestStatus: row.latestStatus,
    promptId: row.promptId,
    promptRevisionId: row.promptRevisionId,
    promptRevisionNumber: row.promptRevisionNumber,
    promptTitle: row.promptTitle,
    reasoningEffort: row.reasoningEffort,
    source: row.source,
    targetConfiguration: row.targetConfiguration,
    targetModelId: row.targetModelId,
    targetProfileId: row.targetProfileId,
    targetProfileName: row.targetProfileName,
    targetProfileRevisionId: row.targetProfileRevisionId,
    turnCount: row.turnCount,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function projectTurn(row: TurnRow): TargetRunTurn {
  return {
    activity: row.activity,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    errorMessage: row.errorMessage,
    id: row.id,
    input: row.input,
    output: row.output,
    position: row.position,
    status: row.status,
    usage: row.usage,
  };
}
