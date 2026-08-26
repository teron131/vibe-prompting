/** Owns Scenario Run persistence, queue claiming, lifecycle transitions, and Target Run linkage. */

import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import type { Database, DatabaseClient } from "../../database/index.ts";
import type { TargetReasoningEffort, TargetRunSource } from "../runs/index.ts";
import {
  type ScenarioEvaluationPlan,
  type ScenarioEvaluationReference,
  type ScenarioMode,
  type ScenarioRun,
  ScenarioRunNotFoundError,
  type ScenarioRunStatus,
  type ScenarioStopReason,
} from "./schemas.ts";

type ScenarioRow = {
  id: string;
  promptRevisionNumber: number;
  promptTitle: string;
  targetModel: string;
  reasoningEffort: TargetReasoningEffort;
  mode: ScenarioMode;
  instruction: string | null;
  staticMessages: string[] | null;
  driverModel: string | null;
  driverBrief: string | null;
  maxTurns: number | null;
  targetRunId: string | null;
  evaluationRuns: ScenarioEvaluationReference[];
  evaluationErrorMessage: string | null;
  status: ScenarioRunStatus;
  stopReason: ScenarioStopReason | null;
  errorMessage: string | null;
  createdAt: Date;
};

type NewScenarioRunBase = {
  promptId: string;
  promptRevisionId: string;
  targetModel: string;
  reasoningEffort: TargetReasoningEffort;
  evaluationPlan: ScenarioEvaluationPlan | null;
  source: TargetRunSource;
  chatId: string | null;
  startedByUserId: string;
};

export type NewScenarioRun = NewScenarioRunBase &
  (
    | { mode: "static"; messages: string[] }
    | { mode: "generative"; instruction: string; driverModel: string; maxTurns: number }
  );

type ScenarioExecutionBase = {
  promptId: string;
  promptRevisionId: string;
  targetModel: string;
  reasoningEffort: TargetReasoningEffort;
  evaluationPlan: ScenarioEvaluationPlan | null;
  source: TargetRunSource;
  startedByUserId: string;
  chatId: string | null;
};

export type ScenarioExecution = ScenarioExecutionBase &
  (
    | { mode: "static"; messages: string[] }
    | { mode: "generative"; instruction: string; driverModel: string; maxTurns: number }
  );

type ScenarioExecutionRow = ScenarioExecutionBase & {
  mode: ScenarioMode;
  instruction: string | null;
  staticMessages: string[] | null;
  driverModel: string | null;
  maxTurns: number | null;
};

type ScenarioRecord = {
  scenario: ScenarioRun;
  targetRunId: string | null;
  evaluationRuns: ScenarioEvaluationReference[];
};

type ScenarioCancellation = {
  evaluationRunIds: string[];
  targetRunId: string | null;
};

export class ScenarioRunStore {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async reconcileInterrupted(): Promise<number> {
    return this.#database.run(async (sql) => {
      const rows = await sql`
        UPDATE scenario_runs
        SET
          status = 'interrupted',
          stop_reason = NULL,
          error_message = 'The server process ended before this Scenario Run completed.',
          updated_at = now(),
          completed_at = now()
        WHERE status = 'running'
        RETURNING id
      `;
      return rows.length;
    });
  }

  async create(input: NewScenarioRun): Promise<string> {
    const runId = randomUUID();
    await this.#database.run(async (sql) => {
      await sql`
        INSERT INTO scenario_runs (
          id, prompt_id, prompt_revision_id, target_model_id, reasoning_effort, mode,
          instruction_text, static_messages_json, driver_model_id, max_turns, status, source,
          chat_id, started_by_user_id, evaluation_plan_json
        )
        VALUES (
          ${runId}, ${input.promptId}, ${input.promptRevisionId}, ${input.targetModel},
          ${input.reasoningEffort}, ${input.mode},
          ${input.mode === "generative" ? input.instruction : null},
          ${input.mode === "static" ? sql.json(input.messages as postgres.JSONValue[]) : null},
          ${input.mode === "generative" ? input.driverModel : null},
          ${input.mode === "generative" ? input.maxTurns : null}, 'queued', ${input.source},
          ${input.chatId}, ${input.startedByUserId},
          ${input.evaluationPlan ? sql.json(input.evaluationPlan as unknown as postgres.JSONValue) : null}
        )
      `;
    });
    return runId;
  }

  async claimNextQueued(): Promise<string | undefined> {
    return this.#database.transaction(async (sql) => {
      const [row] = await sql<{ id: string }[]>`
        WITH next_run AS (
          SELECT id
          FROM scenario_runs
          WHERE status = 'queued'
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE scenario_runs
        SET status = 'running', updated_at = now()
        FROM next_run
        WHERE scenario_runs.id = next_run.id
        RETURNING scenario_runs.id
      `;
      return row?.id;
    });
  }

  async getExecution(runId: string): Promise<ScenarioExecution> {
    return this.#database.run(async (sql) => {
      const [row] = await sql<ScenarioExecutionRow[]>`
        SELECT
          prompt_id,
          prompt_revision_id,
          target_model_id AS target_model,
          reasoning_effort,
          mode,
          instruction_text AS instruction,
          static_messages_json AS static_messages,
          driver_model_id AS driver_model,
          max_turns,
          evaluation_plan_json AS evaluation_plan,
          source,
          started_by_user_id,
          chat_id
        FROM scenario_runs
        WHERE id = ${runId} AND status = 'running'
      `;
      if (!row) throw new ScenarioRunNotFoundError(runId);
      const common = {
        promptId: row.promptId,
        promptRevisionId: row.promptRevisionId,
        targetModel: row.targetModel,
        reasoningEffort: row.reasoningEffort,
        evaluationPlan: row.evaluationPlan,
        source: row.source,
        startedByUserId: row.startedByUserId,
        chatId: row.chatId,
      };
      if (row.mode === "static") {
        if (!row.staticMessages) throw new Error("A static Scenario is missing its messages.");
        return { ...common, mode: "static", messages: row.staticMessages };
      }
      if (!row.instruction || !row.driverModel || row.maxTurns === null) {
        throw new Error("A generative Scenario is missing its Driver configuration.");
      }
      return {
        ...common,
        mode: "generative",
        instruction: row.instruction,
        driverModel: row.driverModel,
        maxTurns: row.maxTurns,
      };
    });
  }

  async get(runId: string): Promise<ScenarioRecord> {
    return this.#database.run(async (sql) =>
      projectScenarioRun(await requireScenarioRow(sql, runId)),
    );
  }

  async setDriverBrief(runId: string, brief: string): Promise<void> {
    await this.#database.run(async (sql) => {
      await sql`
        UPDATE scenario_runs
        SET driver_brief = ${brief}, updated_at = now()
        WHERE id = ${runId} AND status = 'running'
      `;
    });
  }

  async attachTargetRun(runId: string, targetRunId: string): Promise<boolean> {
    return this.#database.run(async (sql) => {
      const rows = await sql`
        UPDATE scenario_runs
        SET target_run_id = ${targetRunId}, updated_at = now()
        WHERE id = ${runId} AND status = 'running' AND target_run_id IS NULL
        RETURNING id
      `;
      return rows.length > 0;
    });
  }

  async appendEvaluationRun(
    runId: string,
    evaluationRun: ScenarioEvaluationReference,
  ): Promise<boolean> {
    return this.#database.run(async (sql) => {
      const rows = await sql`
        UPDATE scenario_runs
        SET
          evaluation_runs_json = evaluation_runs_json || ${sql.json([evaluationRun] as unknown as postgres.JSONValue)},
          updated_at = now()
        WHERE id = ${runId} AND status = 'running'
        RETURNING id
      `;
      return rows.length > 0;
    });
  }

  async setEvaluationError(runId: string, errorMessage: string | null): Promise<void> {
    await this.#database.run(
      (sql) => sql`
      UPDATE scenario_runs
      SET evaluation_error_message = ${errorMessage}, updated_at = now()
      WHERE id = ${runId} AND status = 'running'
    `,
    );
  }

  async complete(runId: string, reason: ScenarioStopReason): Promise<void> {
    await this.#database.run(async (sql) => {
      await sql`
        UPDATE scenario_runs
        SET
          status = 'completed',
          stop_reason = ${reason},
          error_message = NULL,
          updated_at = now(),
          completed_at = now()
        WHERE id = ${runId} AND status = 'running'
      `;
    });
  }

  async fail(runId: string, message: string): Promise<void> {
    await this.#database.run(async (sql) => {
      await sql`
        UPDATE scenario_runs
        SET
          status = 'failed',
          stop_reason = NULL,
          error_message = ${message},
          updated_at = now(),
          completed_at = now()
        WHERE id = ${runId} AND status = 'running'
      `;
    });
  }

  async cancel(runId: string, actorUserId: string): Promise<ScenarioCancellation> {
    return this.#database.transaction(async (sql) => {
      const [row] = await sql<
        { evaluationRuns: ScenarioEvaluationReference[]; targetRunId: string | null }[]
      >`
        UPDATE scenario_runs
        SET
          status = 'cancelled',
          stop_reason = NULL,
          error_message = NULL,
          cancelled_at = now(),
          cancelled_by_user_id = ${actorUserId},
          updated_at = now(),
          completed_at = now()
        WHERE id = ${runId} AND status IN ('queued', 'running')
        RETURNING target_run_id, evaluation_runs_json AS evaluation_runs
      `;
      if (row) {
        return {
          evaluationRunIds: row.evaluationRuns.map(({ runId }) => runId),
          targetRunId: row.targetRunId,
        };
      }
      const [existing] = await sql<{ id: string }[]>`
        SELECT id
        FROM scenario_runs
        WHERE id = ${runId}
      `;
      if (!existing) throw new ScenarioRunNotFoundError(runId);
      return { evaluationRunIds: [], targetRunId: null };
    });
  }

  async isRunning(runId: string): Promise<boolean> {
    return this.#database.run(async (sql) => {
      const [row] = await sql<{ running: boolean }[]>`
        SELECT status = 'running' AS running
        FROM scenario_runs
        WHERE id = ${runId}
      `;
      return row?.running ?? false;
    });
  }
}

async function requireScenarioRow(sql: DatabaseClient, runId: string): Promise<ScenarioRow> {
  const [row] = await sql<ScenarioRow[]>`
    SELECT
      scenario_runs.id,
      prompt_revisions.revision_number AS prompt_revision_number,
      prompts.title AS prompt_title,
      scenario_runs.target_model_id AS target_model,
      scenario_runs.reasoning_effort,
      scenario_runs.mode,
      scenario_runs.instruction_text AS instruction,
      scenario_runs.static_messages_json AS static_messages,
      scenario_runs.driver_model_id AS driver_model,
      scenario_runs.driver_brief,
      scenario_runs.max_turns,
      scenario_runs.status,
      scenario_runs.target_run_id,
      scenario_runs.stop_reason,
      scenario_runs.error_message,
      scenario_runs.evaluation_runs_json AS evaluation_runs,
      scenario_runs.evaluation_error_message,
      scenario_runs.created_at
    FROM scenario_runs
    JOIN prompts ON prompts.id = scenario_runs.prompt_id
    JOIN prompt_revisions ON prompt_revisions.id = scenario_runs.prompt_revision_id
    WHERE scenario_runs.id = ${runId}
  `;
  if (!row) throw new ScenarioRunNotFoundError(runId);
  return row;
}

function projectScenarioRun(row: ScenarioRow): ScenarioRecord {
  const base = {
    id: row.id,
    promptRevisionNumber: row.promptRevisionNumber,
    promptTitle: row.promptTitle,
    targetModel: row.targetModel,
    reasoningEffort: row.reasoningEffort,
    evaluationErrorMessage: row.evaluationErrorMessage,
    status: row.status,
    stopReason: row.stopReason,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
  };
  let scenario: ScenarioRun;
  if (row.mode === "static") {
    if (!row.staticMessages) throw new Error("A static Scenario is missing its messages.");
    scenario = { ...base, mode: "static", messages: row.staticMessages };
  } else {
    if (!row.instruction || !row.driverModel || row.maxTurns === null) {
      throw new Error("A generative Scenario is missing its Driver configuration.");
    }
    scenario = {
      ...base,
      mode: "generative",
      instruction: row.instruction,
      driverBrief: row.driverBrief,
      driverModel: row.driverModel,
      maxTurns: row.maxTurns,
    };
  }
  return {
    scenario,
    targetRunId: row.targetRunId,
    evaluationRuns: row.evaluationRuns,
  };
}
