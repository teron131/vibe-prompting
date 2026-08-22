/** Owns Target Run persistence, immutable completed turns, exact runtime provenance, and prompt-scoped history projection. */

import { randomUUID } from "node:crypto";

import type { ModelMessage } from "ai";
import type postgres from "postgres";

import type { Database, DatabaseClient } from "../../database/index.ts";
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
  id: string;
  promptId: string;
  promptRevisionId: string;
  promptRevisionNumber: number;
  promptTitle: string;
  targetProfileId: string;
  targetProfileName: string;
  targetProfileRevisionId: string;
  targetConfiguration: Record<string, unknown>;
  targetModelId: string;
  reasoningEffort: TargetRunSummary["reasoningEffort"];
  source: TargetRunSource;
  startedByUserId: string;
  startedByName: string | null;
  chatId: string | null;
  chatOwnerUserId: string | null;
  effectiveInstructionsHash: string;
  latestStatus: TargetRunTurnStatus;
  turnCount: number;
  createdAt: Date;
  updatedAt: Date;
};

type TurnRow = {
  id: string;
  position: number;
  status: TargetRunTurnStatus;
  input: string;
  output: string | null;
  activity: TargetRunTurn["activity"];
  responseMessages: ModelMessage[] | null;
  usage: TargetRunUsage | null;
  createdByUserId: string;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
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
  promptId: string;
  promptRevisionId: string;
  targetProfileId: string;
  targetProfileRevisionId: string;
  targetModelId: string;
  reasoningEffort: TargetRunSummary["reasoningEffort"];
  effectiveInstructionsHash: string;
  instruction: string;
  source: TargetRunSource;
  chatId: string | null;
  startedByUserId: string;
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
          target_model_id, reasoning_effort, effective_instructions_hash, source, chat_id,
          started_by_user_id
        )
        VALUES (
          ${runId}, ${input.promptId}, ${input.promptRevisionId}, ${input.targetProfileId},
          ${input.targetProfileRevisionId}, ${input.targetModelId},
          ${input.reasoningEffort}, ${input.effectiveInstructionsHash}, ${input.source}, ${input.chatId},
          ${input.startedByUserId}
        )
      `;
      await insertTurn(sql, runId, turnId, 0, input.instruction, input.startedByUserId);
    });
    return runId;
  }

  async appendTurn(actorUserId: string, runId: string, instruction: string): Promise<void> {
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
      await insertTurn(sql, runId, randomUUID(), position?.next ?? 0, instruction, actorUserId);
      await sql`UPDATE target_runs SET updated_at = now() WHERE id = ${runId}`;
    });
  }

  async cancelActiveTurn(runId: string, actorUserId: string): Promise<boolean> {
    return this.#database.transaction(async (sql) => {
      const rows = await sql`
        UPDATE target_run_turns
        SET
          status = 'cancelled',
          error_message = 'The Target Run turn was cancelled.',
          cancelled_at = now(),
          cancelled_by_user_id = ${actorUserId},
          completed_at = now()
        WHERE run_id = ${runId} AND status = 'running'
        RETURNING id
      `;
      if (rows.length) await sql`UPDATE target_runs SET updated_at = now() WHERE id = ${runId}`;
      return rows.length > 0;
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

  async get(runId: string, viewerUserId: string): Promise<StoredTargetRun> {
    return this.#database.run(async (sql) => {
      const row = await requireRunRow(sql, runId);
      return {
        ...projectRunSummary(row, viewerUserId),
        turns: (await selectTurns(sql, runId)).map(projectTurn),
      };
    });
  }

  async list(viewerUserId: string, promptId: string, limit = 30): Promise<TargetRunSummary[]> {
    return this.#database.run(async (sql) => {
      const rows = await selectRunRows(sql, promptId, Math.min(Math.max(limit, 1), 100));
      return rows.map((row) => projectRunSummary(row, viewerUserId));
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
  actorUserId: string,
): Promise<void> {
  await sql`
    INSERT INTO target_run_turns (
      id, run_id, position, input_text, status, created_by_user_id
    )
    VALUES (${turnId}, ${runId}, ${position}, ${instruction}, 'running', ${actorUserId})
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
      target_runs.started_by_user_id,
      starter.name AS started_by_name,
      target_runs.created_at,
      target_runs.updated_at,
      prompts.title AS prompt_title,
      prompt_revisions.revision_number AS prompt_revision_number,
      target_profiles.name AS target_profile_name,
      target_profile_revisions.configuration AS target_configuration,
      chats.owner_user_id AS chat_owner_user_id,
      count(target_run_turns.id)::integer AS turn_count,
      coalesce(
        (array_agg(target_run_turns.status ORDER BY target_run_turns.position DESC))[1],
        'interrupted'
      ) AS latest_status
    FROM target_runs
    JOIN prompts ON prompts.id = target_runs.prompt_id
    JOIN prompt_revisions ON prompt_revisions.id = target_runs.prompt_revision_id
    JOIN auth_users AS starter ON starter.id = target_runs.started_by_user_id
    JOIN target_profiles ON target_profiles.id = target_runs.target_profile_id
    JOIN target_profile_revisions
      ON target_profile_revisions.target_profile_id = target_runs.target_profile_id
      AND target_profile_revisions.id = target_runs.target_profile_revision_id
    LEFT JOIN target_run_turns ON target_run_turns.run_id = target_runs.id
    LEFT JOIN chats ON chats.id = target_runs.chat_id
  `;
}

function runGrouping(sql: DatabaseClient) {
  return sql`
    target_runs.id,
    prompts.title,
    prompt_revisions.revision_number,
    target_profiles.name,
    target_profile_revisions.configuration,
    chats.owner_user_id,
    starter.name
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
      created_by_user_id,
      completed_at
    FROM target_run_turns
    WHERE run_id = ${runId}
    ORDER BY position
  `;
}

function projectRunSummary(row: RunRow, viewerUserId: string): TargetRunSummary {
  return {
    chatId: row.chatOwnerUserId === viewerUserId ? row.chatId : null,
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
    startedByName: row.startedByName,
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
