/** Reads immutable run snapshots shared by execution, lifecycle summaries, and historical reports without owning transitions. */
import type { Criterion } from "../../criteria/schemas.ts";
import type { DatabaseClient } from "../../database/index.ts";
import {
  EvaluationRunNotFoundError,
  type EvaluationRunSource,
  type EvaluationRunStatus,
  type EvaluationRunSummary,
} from "./schemas.ts";

type RunSummaryRow = {
  id: string;
  contextId: string;
  contextRevisionId: string;
  contextRevisionNumber: number;
  contextTitle: string;
  targetProfileId: string | null;
  targetProfileRevisionId: string | null;
  targetProfileName: string | null;
  targetModel: string;
  targetRunId: string | null;
  targetRunTurnId: string | null;
  judgeModels: string[];
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
  contextMarkdown: string;
  targetConfiguration: Record<string, unknown> | null;
};

type CaseRow = {
  id: string;
  position: number;
  input: unknown;
  criteria: Criterion[];
  output: unknown | null;
};

export async function requireRunRow(sql: DatabaseClient, runId: string): Promise<RunRow> {
  const [row] = await selectRunRow(sql, runId);
  if (!row) throw new EvaluationRunNotFoundError(runId);
  return row;
}

function selectRunRow(sql: DatabaseClient, runId: string) {
  return sql<RunRow[]>`
    SELECT
      evaluation_runs.id, evaluation_runs.context_id,
      evaluation_runs.context_revision_id,
      evaluation_runs.chat_id, evaluation_runs.source, evaluation_runs.started_by_user_id,
      starter.name AS started_by_name,
      evaluation_runs.target_model_id AS target_model,
      evaluation_runs.judge_model_ids AS judge_models, evaluation_runs.status,
      evaluation_runs.configuration_fingerprint, evaluation_runs.error_message,
      evaluation_runs.is_synthetic_example,
      evaluation_runs.effective_instructions_hash,
      evaluation_runs.target_profile_id, evaluation_runs.target_profile_revision_id,
      evaluation_runs.target_run_id, evaluation_runs.target_run_turn_id,
      target_profile_revisions.configuration AS target_configuration,
      evaluation_runs.created_at, evaluation_runs.completed_at,
      chats.owner_user_id AS chat_owner_user_id,
      target_profiles.name AS target_profile_name,
      contexts.title AS context_title,
      context_revisions.revision_number AS context_revision_number,
      context_revisions.markdown AS context_markdown,
      count(evaluation_cases.id)::integer AS case_count
    FROM evaluation_runs
    JOIN contexts ON contexts.id = evaluation_runs.context_id
    JOIN context_revisions ON context_revisions.id = evaluation_runs.context_revision_id
    JOIN auth_users AS starter ON starter.id = evaluation_runs.started_by_user_id
    LEFT JOIN target_profiles ON target_profiles.id = evaluation_runs.target_profile_id
    LEFT JOIN target_profile_revisions
      ON target_profile_revisions.target_profile_id = evaluation_runs.target_profile_id
      AND target_profile_revisions.id = evaluation_runs.target_profile_revision_id
    LEFT JOIN evaluation_cases ON evaluation_cases.run_id = evaluation_runs.id
    LEFT JOIN chats ON chats.id = evaluation_runs.chat_id
    WHERE evaluation_runs.id = ${runId}
    GROUP BY
      evaluation_runs.id, contexts.title, context_revisions.revision_number, context_revisions.markdown,
      target_profiles.name, target_profile_revisions.configuration, chats.owner_user_id,
      starter.name
  `;
}

export function selectRunRows(sql: DatabaseClient, limit: number) {
  return sql<RunSummaryRow[]>`
    SELECT
      evaluation_runs.id, evaluation_runs.context_id,
      evaluation_runs.context_revision_id,
      evaluation_runs.chat_id, evaluation_runs.source, evaluation_runs.started_by_user_id,
      starter.name AS started_by_name,
      evaluation_runs.target_model_id AS target_model,
      evaluation_runs.judge_model_ids AS judge_models, evaluation_runs.status,
      evaluation_runs.configuration_fingerprint, evaluation_runs.error_message,
      evaluation_runs.is_synthetic_example,
      evaluation_runs.effective_instructions_hash,
      evaluation_runs.target_profile_id, evaluation_runs.target_profile_revision_id,
      evaluation_runs.target_run_id, evaluation_runs.target_run_turn_id,
      evaluation_runs.created_at, evaluation_runs.completed_at,
      chats.owner_user_id AS chat_owner_user_id,
      target_profiles.name AS target_profile_name,
      contexts.title AS context_title, context_revisions.revision_number AS context_revision_number,
      count(evaluation_cases.id)::integer AS case_count
    FROM evaluation_runs
    JOIN contexts ON contexts.id = evaluation_runs.context_id
    JOIN context_revisions ON context_revisions.id = evaluation_runs.context_revision_id
    JOIN auth_users AS starter ON starter.id = evaluation_runs.started_by_user_id
    LEFT JOIN target_profiles ON target_profiles.id = evaluation_runs.target_profile_id
    LEFT JOIN evaluation_cases ON evaluation_cases.run_id = evaluation_runs.id
    LEFT JOIN chats ON chats.id = evaluation_runs.chat_id
    GROUP BY evaluation_runs.id, contexts.title, context_revisions.revision_number, target_profiles.name, chats.owner_user_id, starter.name
    ORDER BY evaluation_runs.created_at DESC, evaluation_runs.id DESC
    LIMIT ${limit}
  `;
}

export function selectRunRowsForContext(sql: DatabaseClient, contextId: string, limit: number) {
  return sql<RunSummaryRow[]>`
    SELECT
      evaluation_runs.id, evaluation_runs.context_id,
      evaluation_runs.context_revision_id,
      evaluation_runs.chat_id, evaluation_runs.source, evaluation_runs.started_by_user_id,
      starter.name AS started_by_name,
      evaluation_runs.target_model_id AS target_model,
      evaluation_runs.judge_model_ids AS judge_models, evaluation_runs.status,
      evaluation_runs.configuration_fingerprint, evaluation_runs.error_message,
      evaluation_runs.is_synthetic_example,
      evaluation_runs.effective_instructions_hash,
      evaluation_runs.target_profile_id, evaluation_runs.target_profile_revision_id,
      evaluation_runs.target_run_id, evaluation_runs.target_run_turn_id,
      evaluation_runs.created_at, evaluation_runs.completed_at,
      chats.owner_user_id AS chat_owner_user_id,
      target_profiles.name AS target_profile_name,
      contexts.title AS context_title, context_revisions.revision_number AS context_revision_number,
      count(evaluation_cases.id)::integer AS case_count
    FROM evaluation_runs
    JOIN contexts ON contexts.id = evaluation_runs.context_id
    JOIN context_revisions ON context_revisions.id = evaluation_runs.context_revision_id
    JOIN auth_users AS starter ON starter.id = evaluation_runs.started_by_user_id
    LEFT JOIN target_profiles ON target_profiles.id = evaluation_runs.target_profile_id
    LEFT JOIN evaluation_cases ON evaluation_cases.run_id = evaluation_runs.id
    LEFT JOIN chats ON chats.id = evaluation_runs.chat_id
    WHERE evaluation_runs.context_id = ${contextId}
    GROUP BY evaluation_runs.id, contexts.title, context_revisions.revision_number, target_profiles.name, chats.owner_user_id, starter.name
    ORDER BY evaluation_runs.created_at DESC, evaluation_runs.id DESC
    LIMIT ${limit}
  `;
}

export function selectCases(sql: DatabaseClient, runId: string) {
  return sql<CaseRow[]>`
    SELECT id, position, input_json AS input, criteria_json AS criteria, output_json AS output
    FROM evaluation_cases
    WHERE run_id = ${runId}
    ORDER BY position
  `;
}

export function projectRunSummary(row: RunSummaryRow, viewerUserId: string): EvaluationRunSummary {
  return {
    id: row.id,
    contextId: row.contextId,
    contextRevisionId: row.contextRevisionId,
    contextRevisionNumber: row.contextRevisionNumber,
    contextTitle: row.contextTitle,
    targetProfileId: row.targetProfileId,
    targetProfileRevisionId: row.targetProfileRevisionId,
    targetProfileName: row.targetProfileName,
    targetModel: row.targetModel,
    targetRunId: row.targetRunId,
    targetRunTurnId: row.targetRunTurnId,
    judgeModels: row.judgeModels,
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
