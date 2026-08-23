/** Owns PostgreSQL reads and projections for evaluation results, facets, aggregates, and structured query rows. */

import type { DatabaseClient } from "../../database/index.ts";
import type { SearchDocument } from "../../search.ts";
import type { Criterion } from "../api.ts";
import type { EvaluationRunStatus } from "../runs/index.ts";
import type {
  EvaluationDataType,
  EvaluationWorkspaceFacets,
  NormalizedFilters,
  ResultCursor,
  ResultListItem,
  ResultScore,
} from "./schemas.ts";

type ResultRow = {
  caseId: string;
  runId: string;
  position: number;
  promptRevisionId: string;
  promptRevisionNumber: number;
  promptTitle: string;
  targetModelId: string;
  judgeModelIds: string[];
  status: EvaluationRunStatus;
  input: unknown;
  output: unknown | null;
  isSyntheticExample: boolean;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
  targetRunId: string | null;
  targetRunTurnId: string | null;
};

type ScoreRow = {
  id: string;
  caseId: string;
  criterionPosition: number;
  criterion: Criterion;
  dataType: EvaluationDataType;
  judgeModelId: string;
  value: boolean | number | string;
  comment: string;
  evidence: string[];
};

type SearchField = NormalizedFilters["searchField"];

type SearchDocumentRow = {
  caseId: string;
  createdAt: Date;
  text: string;
};

/** Loads one chronological page of cases while applying resolved search membership and keyset cursors. */
export function selectResultRows(
  sql: DatabaseClient,
  filters: NormalizedFilters,
  cursor: ResultCursor | null,
  limit: number,
) {
  const cursorDate = cursor ? new Date(cursor.createdAt) : null;
  return sql<ResultRow[]>`
    SELECT
      evaluation_cases.id AS case_id, evaluation_cases.position,
      evaluation_cases.input_json AS input, evaluation_cases.output_json AS output,
      evaluation_runs.id AS run_id,
      evaluation_runs.prompt_revision_id, evaluation_runs.target_model_id,
      evaluation_runs.target_run_id, evaluation_runs.target_run_turn_id,
      evaluation_runs.status, evaluation_runs.judge_model_ids,
      evaluation_runs.error_message, evaluation_runs.is_synthetic_example,
      evaluation_runs.created_at, evaluation_runs.completed_at, prompts.title AS prompt_title,
      prompt_revisions.revision_number AS prompt_revision_number
    FROM evaluation_cases
    JOIN evaluation_runs ON evaluation_runs.id = evaluation_cases.run_id
    JOIN prompts ON prompts.id = evaluation_runs.prompt_id
    JOIN prompt_revisions ON prompt_revisions.id = evaluation_runs.prompt_revision_id
    WHERE
      (${filters.runId}::uuid IS NULL OR evaluation_runs.id = ${filters.runId})
      AND
      (${filters.promptId}::uuid IS NULL OR evaluation_runs.prompt_id = ${filters.promptId})
      AND (${filters.promptRevisionId}::uuid IS NULL OR evaluation_runs.prompt_revision_id = ${filters.promptRevisionId})
      AND ${targetModelsCondition(sql, filters)}
      AND (${filters.status}::text IS NULL OR evaluation_runs.status = ${filters.status})
      AND (${filters.from}::timestamptz IS NULL OR evaluation_runs.created_at >= ${filters.from})
      AND (${filters.to}::timestamptz IS NULL OR evaluation_runs.created_at <= ${filters.to})
      AND ${caseJudgeModelsCondition(sql, filters)}
      AND (${filters.dataType}::text IS NULL OR EXISTS (
        SELECT 1 FROM evaluation_scores
        WHERE evaluation_scores.case_id = evaluation_cases.id
          AND evaluation_scores.data_type = ${filters.dataType}
      ))
      AND (${filters.criterion}::text IS NULL OR EXISTS (
        SELECT 1 FROM evaluation_scores
        WHERE evaluation_scores.case_id = evaluation_cases.id
          AND evaluation_scores.criterion_json->>'name' = ${filters.criterion}
      ))
      AND ${caseIdsCondition(sql, filters)}
      AND (${cursorDate}::timestamptz IS NULL OR (
        evaluation_runs.created_at < ${cursorDate}
        OR (evaluation_runs.created_at = ${cursorDate} AND evaluation_runs.id < ${cursor?.runId ?? null}::uuid)
        OR (evaluation_runs.created_at = ${cursorDate} AND evaluation_runs.id = ${cursor?.runId ?? null}::uuid AND evaluation_cases.position > ${cursor?.position ?? null}::integer)
      ))
    ORDER BY evaluation_runs.created_at DESC, evaluation_runs.id DESC, evaluation_cases.position ASC
    LIMIT ${limit}
  `;
}

/** Loads one result case without pagination so detail responses can reuse the list projection. */
export function selectResultById(sql: DatabaseClient, caseId: string) {
  return sql<ResultRow[]>`
    SELECT
      evaluation_cases.id AS case_id, evaluation_cases.position,
      evaluation_cases.input_json AS input, evaluation_cases.output_json AS output,
      evaluation_runs.id AS run_id,
      evaluation_runs.prompt_revision_id, evaluation_runs.target_model_id,
      evaluation_runs.target_run_id, evaluation_runs.target_run_turn_id,
      evaluation_runs.status, evaluation_runs.judge_model_ids,
      evaluation_runs.error_message, evaluation_runs.is_synthetic_example,
      evaluation_runs.created_at, evaluation_runs.completed_at, prompts.title AS prompt_title,
      prompt_revisions.revision_number AS prompt_revision_number
    FROM evaluation_cases
    JOIN evaluation_runs ON evaluation_runs.id = evaluation_cases.run_id
    JOIN prompts ON prompts.id = evaluation_runs.prompt_id
    JOIN prompt_revisions ON prompt_revisions.id = evaluation_runs.prompt_revision_id
    WHERE evaluation_cases.id = ${caseId}
  `;
}

/** Loads score facts separately so result-case pagination does not multiply case rows. */
export function selectScoresForCases(sql: DatabaseClient, caseIds: string[]) {
  if (caseIds.length === 0) return Promise.resolve([] as ScoreRow[]);
  return sql<ScoreRow[]>`
    SELECT
      evaluation_scores.id, evaluation_scores.case_id,
      evaluation_scores.criterion_position, evaluation_scores.data_type,
      evaluation_scores.criterion_json AS criterion, evaluation_scores.judge_model_id,
      evaluation_scores.value_json AS value, evaluation_scores.comment,
      evaluation_scores.evidence_json AS evidence
    FROM evaluation_scores
    WHERE evaluation_scores.case_id = ANY(${sql.array(caseIds)}::uuid[])
    ORDER BY evaluation_scores.case_id, evaluation_scores.criterion_position, evaluation_scores.judge_model_id
  `;
}

/** Groups score rows by case and projects database dates and nullable fields into API values. */
export function projectCaseResults(rows: ResultRow[], scores: ScoreRow[]): ResultListItem[] {
  const byCase = new Map<string, ResultScore[]>();
  for (const score of scores) {
    const group = byCase.get(score.caseId) ?? [];
    group.push({
      id: score.id,
      criterionPosition: score.criterionPosition,
      criterion: score.criterion,
      dataType: score.dataType,
      judgeModelId: score.judgeModelId,
      value: score.value,
      comment: score.comment,
      evidence: score.evidence,
    });
    byCase.set(score.caseId, group);
  }
  return rows.map((row) => ({
    caseId: row.caseId,
    runId: row.runId,
    position: row.position,
    promptRevisionId: row.promptRevisionId,
    promptRevisionNumber: row.promptRevisionNumber,
    promptTitle: row.promptTitle,
    targetModelId: row.targetModelId,
    judgeModelIds: row.judgeModelIds,
    status: row.status,
    input: row.input,
    output: row.output,
    scores: byCase.get(row.caseId) ?? [],
    isSyntheticExample: row.isSyntheticExample,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    targetRunId: row.targetRunId,
    targetRunTurnId: row.targetRunTurnId,
  }));
}

/** Counts cases using the same non-search and resolved-search predicates as result pages. */
export function countFilteredCases(sql: DatabaseClient, filters: NormalizedFilters) {
  return sql<Array<{ count: number }>>`
    SELECT count(*)::integer AS count
    FROM evaluation_cases
    JOIN evaluation_runs ON evaluation_runs.id = evaluation_cases.run_id
    WHERE
      (${filters.runId}::uuid IS NULL OR evaluation_runs.id = ${filters.runId})
      AND
      (${filters.promptId}::uuid IS NULL OR evaluation_runs.prompt_id = ${filters.promptId})
      AND (${filters.promptRevisionId}::uuid IS NULL OR evaluation_runs.prompt_revision_id = ${filters.promptRevisionId})
      AND ${targetModelsCondition(sql, filters)}
      AND (${filters.status}::text IS NULL OR evaluation_runs.status = ${filters.status})
      AND (${filters.from}::timestamptz IS NULL OR evaluation_runs.created_at >= ${filters.from})
      AND (${filters.to}::timestamptz IS NULL OR evaluation_runs.created_at <= ${filters.to})
      AND ${caseJudgeModelsCondition(sql, filters)}
      AND (${filters.dataType}::text IS NULL OR EXISTS (
        SELECT 1 FROM evaluation_scores WHERE evaluation_scores.case_id = evaluation_cases.id AND evaluation_scores.data_type = ${filters.dataType}
      ))
      AND (${filters.criterion}::text IS NULL OR EXISTS (
        SELECT 1 FROM evaluation_scores WHERE evaluation_scores.case_id = evaluation_cases.id AND evaluation_scores.criterion_json->>'name' = ${filters.criterion}
      ))
      AND ${caseIdsCondition(sql, filters)}
  `;
}

/** Projects one searchable document per case while preserving field-specific search semantics. */
export async function selectSearchDocuments(
  sql: DatabaseClient,
  filters: NormalizedFilters,
  field: SearchField,
): Promise<Array<SearchDocument<string>>> {
  const rows = await sql<SearchDocumentRow[]>`
    SELECT
      evaluation_cases.id AS case_id,
      evaluation_runs.created_at,
      CASE
        WHEN ${field}::text = 'input' THEN evaluation_cases.input_json::text
        WHEN ${field}::text = 'output' THEN COALESCE(evaluation_cases.output_json::text, '')
        WHEN ${field}::text = 'comment' THEN COALESCE((
          SELECT string_agg(COALESCE(search_scores.comment, ''), E'\n' ORDER BY search_scores.criterion_position, search_scores.judge_model_id, search_scores.id)
          FROM evaluation_scores AS search_scores
          WHERE search_scores.case_id = evaluation_cases.id
        ), '')
        WHEN ${field}::text = 'evidence' THEN COALESCE((
          SELECT string_agg(COALESCE(search_scores.evidence_json::text, ''), E'\n' ORDER BY search_scores.criterion_position, search_scores.judge_model_id, search_scores.id)
          FROM evaluation_scores AS search_scores
          WHERE search_scores.case_id = evaluation_cases.id
        ), '')
        ELSE concat_ws(E'\n',
          evaluation_cases.input_json::text,
          COALESCE(evaluation_cases.output_json::text, ''),
          (SELECT string_agg(COALESCE(search_scores.comment, ''), E'\n' ORDER BY search_scores.criterion_position, search_scores.judge_model_id, search_scores.id)
           FROM evaluation_scores AS search_scores WHERE search_scores.case_id = evaluation_cases.id),
          (SELECT string_agg(COALESCE(search_scores.evidence_json::text, ''), E'\n' ORDER BY search_scores.criterion_position, search_scores.judge_model_id, search_scores.id)
           FROM evaluation_scores AS search_scores WHERE search_scores.case_id = evaluation_cases.id)
        )
      END AS text
    FROM evaluation_cases
    JOIN evaluation_runs ON evaluation_runs.id = evaluation_cases.run_id
    WHERE
      (${filters.runId}::uuid IS NULL OR evaluation_runs.id = ${filters.runId})
      AND
      (${filters.promptId}::uuid IS NULL OR evaluation_runs.prompt_id = ${filters.promptId})
      AND (${filters.promptRevisionId}::uuid IS NULL OR evaluation_runs.prompt_revision_id = ${filters.promptRevisionId})
      AND ${targetModelsCondition(sql, filters)}
      AND (${filters.status}::text IS NULL OR evaluation_runs.status = ${filters.status})
      AND (${filters.from}::timestamptz IS NULL OR evaluation_runs.created_at >= ${filters.from})
      AND (${filters.to}::timestamptz IS NULL OR evaluation_runs.created_at <= ${filters.to})
      AND ${caseJudgeModelsCondition(sql, filters)}
      AND (${filters.dataType}::text IS NULL OR EXISTS (
        SELECT 1 FROM evaluation_scores
        WHERE evaluation_scores.case_id = evaluation_cases.id
          AND evaluation_scores.data_type = ${filters.dataType}
      ))
      AND (${filters.criterion}::text IS NULL OR EXISTS (
        SELECT 1 FROM evaluation_scores
        WHERE evaluation_scores.case_id = evaluation_cases.id
          AND evaluation_scores.criterion_json->>'name' = ${filters.criterion}
      ))
  `;
  return rows.map((row) => ({
    documentId: row.caseId,
    ownerId: row.caseId,
    title: "",
    text: row.text,
    updatedAt: row.createdAt.toISOString(),
    value: row.caseId,
  }));
}

export async function selectFacets(
  sql: DatabaseClient,
  filters: NormalizedFilters,
): Promise<EvaluationWorkspaceFacets> {
  const [prompts, revisions, targetModels, statuses, judges, dataTypes] = await Promise.all([
    selectPromptFacets(sql, withoutFacet(filters, "promptId")),
    selectRunFacet(sql, withoutFacet(filters, "promptRevisionId"), "revision"),
    selectRunFacet(sql, withoutFacet(filters, "targetModelIds"), "targetModel"),
    selectRunFacet(sql, withoutFacet(filters, "status"), "status"),
    selectScoreFacet(sql, withoutFacet(filters, "judgeModelIds"), "judge"),
    selectScoreFacet(sql, withoutFacet(filters, "dataType"), "dataType"),
  ]);
  return {
    prompts,
    revisions,
    targetModels,
    judges,
    statuses: statuses as EvaluationWorkspaceFacets["statuses"],
    dataTypes: dataTypes as EvaluationWorkspaceFacets["dataTypes"],
  };
}

function withoutFacet<Key extends keyof NormalizedFilters>(
  filters: NormalizedFilters,
  key: Key,
): NormalizedFilters {
  return { ...filters, [key]: null };
}

function selectPromptFacets(sql: DatabaseClient, filters: NormalizedFilters) {
  return sql<Array<{ count: number; id: string; label: string }>>`
    SELECT evaluation_runs.prompt_id AS id, prompts.title AS label, count(DISTINCT evaluation_cases.id)::integer AS count
    FROM evaluation_cases
    JOIN evaluation_runs ON evaluation_runs.id = evaluation_cases.run_id
    JOIN prompts ON prompts.id = evaluation_runs.prompt_id
    LEFT JOIN evaluation_scores ON evaluation_scores.case_id = evaluation_cases.id
    WHERE ${filterConditions(sql, filters)}
    GROUP BY evaluation_runs.prompt_id, prompts.title
    ORDER BY count DESC, prompts.title
  `;
}

function selectRunFacet(
  sql: DatabaseClient,
  filters: NormalizedFilters,
  facet: "revision" | "status" | "targetModel",
) {
  const expression =
    facet === "revision"
      ? sql`evaluation_runs.prompt_revision_id::text`
      : facet === "status"
        ? sql`evaluation_runs.status`
        : sql`evaluation_runs.target_model_id`;
  return sql<Array<{ count: number; value: string }>>`
    SELECT ${expression} AS value, count(DISTINCT evaluation_cases.id)::integer AS count
    FROM evaluation_cases
    JOIN evaluation_runs ON evaluation_runs.id = evaluation_cases.run_id
    LEFT JOIN evaluation_scores ON evaluation_scores.case_id = evaluation_cases.id
    WHERE ${filterConditions(sql, filters)}
    GROUP BY ${expression}
    ORDER BY count DESC, value
  `;
}

function selectScoreFacet(
  sql: DatabaseClient,
  filters: NormalizedFilters,
  facet: "dataType" | "judge",
) {
  const expression =
    facet === "judge" ? sql`evaluation_scores.judge_model_id` : sql`evaluation_scores.data_type`;
  return sql<Array<{ count: number; value: string }>>`
    SELECT ${expression} AS value, count(DISTINCT evaluation_cases.id)::integer AS count
    FROM evaluation_cases
    JOIN evaluation_runs ON evaluation_runs.id = evaluation_cases.run_id
    JOIN evaluation_scores ON evaluation_scores.case_id = evaluation_cases.id
    WHERE ${filterConditions(sql, filters)}
    GROUP BY ${expression}
    ORDER BY count DESC, value
  `;
}

function filterConditions(sql: DatabaseClient, filters: NormalizedFilters) {
  return sql`
    (${filters.runId}::uuid IS NULL OR evaluation_runs.id = ${filters.runId})
    AND
    (${filters.promptId}::uuid IS NULL OR evaluation_runs.prompt_id = ${filters.promptId})
    AND (${filters.promptRevisionId}::uuid IS NULL OR evaluation_runs.prompt_revision_id = ${filters.promptRevisionId})
    AND ${targetModelsCondition(sql, filters)}
    AND (${filters.status}::text IS NULL OR evaluation_runs.status = ${filters.status})
    AND (${filters.from}::timestamptz IS NULL OR evaluation_runs.created_at >= ${filters.from})
    AND (${filters.to}::timestamptz IS NULL OR evaluation_runs.created_at <= ${filters.to})
    AND ${judgeModelsCondition(sql, filters)}
    AND (${filters.dataType}::text IS NULL OR evaluation_scores.data_type = ${filters.dataType})
    AND (${filters.criterion}::text IS NULL OR evaluation_scores.criterion_json->>'name' = ${filters.criterion})
    AND ${caseIdsCondition(sql, filters)}
  `;
}

function caseIdsCondition(sql: DatabaseClient, filters: NormalizedFilters) {
  if (filters.caseIds === null) return sql`TRUE`;
  return sql`evaluation_cases.id = ANY(${sql.array(filters.caseIds)}::uuid[])`;
}

function targetModelsCondition(sql: DatabaseClient, filters: NormalizedFilters) {
  if (filters.targetModelIds === null) return sql`TRUE`;
  return sql`evaluation_runs.target_model_id = ANY(${sql.array(filters.targetModelIds)}::text[])`;
}

function caseJudgeModelsCondition(sql: DatabaseClient, filters: NormalizedFilters) {
  if (filters.judgeModelIds === null) return sql`TRUE`;
  return sql`EXISTS (
    SELECT 1 FROM evaluation_scores
    WHERE evaluation_scores.case_id = evaluation_cases.id
      AND evaluation_scores.judge_model_id = ANY(${sql.array(filters.judgeModelIds)}::text[])
  )`;
}

function judgeModelsCondition(sql: DatabaseClient, filters: NormalizedFilters) {
  if (filters.judgeModelIds === null) return sql`TRUE`;
  return sql`evaluation_scores.judge_model_id = ANY(${sql.array(filters.judgeModelIds)}::text[])`;
}

export function selectTotals(sql: DatabaseClient, filters: NormalizedFilters) {
  return sql<Array<{ cases: number; runs: number; scores: number }>>`
    SELECT
      count(DISTINCT evaluation_cases.id)::integer AS cases,
      count(DISTINCT evaluation_runs.id)::integer AS runs,
      count(DISTINCT evaluation_scores.id)::integer AS scores
    FROM evaluation_cases
    JOIN evaluation_runs ON evaluation_runs.id = evaluation_cases.run_id
    LEFT JOIN evaluation_scores ON evaluation_scores.case_id = evaluation_cases.id
    WHERE ${filterConditions(sql, filters)}
  `;
}

export function selectBooleanAggregates(sql: DatabaseClient, filters: NormalizedFilters) {
  return sql<
    Array<{
      criterion: string;
      criterionPosition: number;
      passed: number;
      total: number;
    }>
  >`
    SELECT
      evaluation_scores.criterion_position,
      evaluation_scores.criterion_json->>'name' AS criterion,
      count(*) FILTER (WHERE (evaluation_scores.value_json #>> '{}')::boolean)::integer AS passed,
      count(*)::integer AS total
    FROM evaluation_scores
    JOIN evaluation_cases ON evaluation_cases.id = evaluation_scores.case_id
    JOIN evaluation_runs ON evaluation_runs.id = evaluation_cases.run_id
    WHERE evaluation_scores.data_type = 'BOOLEAN' AND ${filterConditions(sql, filters)}
    GROUP BY evaluation_scores.criterion_position, evaluation_scores.criterion_json->>'name'
    ORDER BY evaluation_scores.criterion_position, criterion
  `;
}

export function selectCategoricalAggregates(sql: DatabaseClient, filters: NormalizedFilters) {
  return sql<
    Array<{ category: string; count: number; criterion: string; criterionPosition: number }>
  >`
    SELECT
      evaluation_scores.criterion_position,
      evaluation_scores.criterion_json->>'name' AS criterion,
      evaluation_scores.value_json #>> '{}' AS category,
      count(*)::integer AS count
    FROM evaluation_scores
    JOIN evaluation_cases ON evaluation_cases.id = evaluation_scores.case_id
    JOIN evaluation_runs ON evaluation_runs.id = evaluation_cases.run_id
    WHERE evaluation_scores.data_type = 'CATEGORICAL' AND ${filterConditions(sql, filters)}
    GROUP BY evaluation_scores.criterion_position, evaluation_scores.criterion_json->>'name', evaluation_scores.value_json
    ORDER BY evaluation_scores.criterion_position, count DESC, category
  `;
}

export function selectNumericAggregates(sql: DatabaseClient, filters: NormalizedFilters) {
  return sql<
    Array<{
      average: number;
      count: number;
      criterion: string;
      criterionPosition: number;
      maximum: number;
      median: number;
      minimum: number;
      p10: number;
      p90: number;
      standardDeviation: number;
    }>
  >`
    SELECT
      evaluation_scores.criterion_position,
      evaluation_scores.criterion_json->>'name' AS criterion,
      count(*)::integer AS count,
      avg((evaluation_scores.value_json #>> '{}')::double precision)::double precision AS average,
      min((evaluation_scores.value_json #>> '{}')::double precision)::double precision AS minimum,
      max((evaluation_scores.value_json #>> '{}')::double precision)::double precision AS maximum,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY (evaluation_scores.value_json #>> '{}')::double precision)::double precision AS median,
      percentile_cont(0.1) WITHIN GROUP (ORDER BY (evaluation_scores.value_json #>> '{}')::double precision)::double precision AS p10,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY (evaluation_scores.value_json #>> '{}')::double precision)::double precision AS p90,
      stddev_pop((evaluation_scores.value_json #>> '{}')::double precision)::double precision AS standard_deviation
    FROM evaluation_scores
    JOIN evaluation_cases ON evaluation_cases.id = evaluation_scores.case_id
    JOIN evaluation_runs ON evaluation_runs.id = evaluation_cases.run_id
    WHERE evaluation_scores.data_type = 'NUMERIC' AND jsonb_typeof(evaluation_scores.value_json) = 'number' AND ${filterConditions(sql, filters)}
    GROUP BY evaluation_scores.criterion_position, evaluation_scores.criterion_json->>'name'
    ORDER BY evaluation_scores.criterion_position, criterion
  `;
}

export function selectExecutionSummary(sql: DatabaseClient, filters: NormalizedFilters) {
  return sql<
    Array<{
      completedRuns: number;
      durationMeasuredRuns: number;
      failedRuns: number;
      interruptedRuns: number;
      medianDurationMs: number | null;
      runningRuns: number;
      totalRuns: number;
    }>
  >`
    WITH filtered_runs AS (
      SELECT DISTINCT
        evaluation_runs.id,
        evaluation_runs.status,
        evaluation_runs.created_at,
        evaluation_runs.completed_at
      FROM evaluation_cases
      JOIN evaluation_runs ON evaluation_runs.id = evaluation_cases.run_id
      LEFT JOIN evaluation_scores ON evaluation_scores.case_id = evaluation_cases.id
      WHERE ${filterConditions(sql, filters)}
    ), run_durations AS (
      SELECT extract(epoch FROM (completed_at - created_at))::double precision * 1000 AS duration_ms
      FROM filtered_runs
      WHERE status = 'completed' AND completed_at IS NOT NULL
    )
    SELECT
      count(*) FILTER (WHERE status = 'completed')::integer AS completed_runs,
      count(*) FILTER (WHERE status = 'failed')::integer AS failed_runs,
      count(*) FILTER (WHERE status = 'interrupted')::integer AS interrupted_runs,
      count(*) FILTER (WHERE status = 'running')::integer AS running_runs,
      count(*)::integer AS total_runs,
      (SELECT count(*)::integer FROM run_durations) AS duration_measured_runs,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::double precision FROM run_durations) AS median_duration_ms
    FROM filtered_runs
  `;
}

export function selectReliabilitySummary(sql: DatabaseClient, filters: NormalizedFilters) {
  return sql<
    Array<{
      agreedJudgeGroups: number;
      comparableJudgeGroups: number;
      judgeAgreementRate: number | null;
    }>
  >`
    WITH judge_groups AS (
      SELECT
        evaluation_scores.case_id,
        evaluation_scores.criterion_position,
        evaluation_scores.data_type,
        count(DISTINCT evaluation_scores.judge_model_id)::integer AS judge_count,
        count(DISTINCT evaluation_scores.value_json)::integer AS value_count
      FROM evaluation_scores
      JOIN evaluation_cases ON evaluation_cases.id = evaluation_scores.case_id
      JOIN evaluation_runs ON evaluation_runs.id = evaluation_cases.run_id
      WHERE evaluation_scores.data_type IN ('BOOLEAN', 'CATEGORICAL') AND ${filterConditions(sql, filters)}
      GROUP BY evaluation_scores.case_id, evaluation_scores.criterion_position, evaluation_scores.data_type
    )
    SELECT
      count(*) FILTER (WHERE judge_count > 1 AND value_count = 1)::integer AS agreed_judge_groups,
      count(*) FILTER (WHERE judge_count > 1)::integer AS comparable_judge_groups,
      count(*) FILTER (WHERE judge_count > 1 AND value_count = 1)::double precision
        / NULLIF(count(*) FILTER (WHERE judge_count > 1), 0)::double precision AS judge_agreement_rate
    FROM judge_groups
  `;
}

export function selectTimeline(sql: DatabaseClient, filters: NormalizedFilters) {
  return sql<Array<{ cases: number; date: string; runs: number; scores: number }>>`
    SELECT
      to_char(date_trunc('day', evaluation_runs.created_at), 'YYYY-MM-DD') AS date,
      count(DISTINCT evaluation_runs.id)::integer AS runs,
      count(DISTINCT evaluation_cases.id)::integer AS cases,
      count(DISTINCT evaluation_scores.id)::integer AS scores
    FROM evaluation_cases
    JOIN evaluation_runs ON evaluation_runs.id = evaluation_cases.run_id
    LEFT JOIN evaluation_scores ON evaluation_scores.case_id = evaluation_cases.id
    WHERE ${filterConditions(sql, filters)}
    GROUP BY date_trunc('day', evaluation_runs.created_at)
    ORDER BY date_trunc('day', evaluation_runs.created_at)
  `;
}

export function selectGroupedRows(
  facets: EvaluationWorkspaceFacets,
  groupBy: "dataType" | "judge" | "prompt" | "revision" | "status" | "targetModel",
): Array<{ label: string; value: number }> {
  if (groupBy === "prompt")
    return facets.prompts.map(({ count, label }) => ({ label, value: count }));
  const source =
    groupBy === "dataType"
      ? facets.dataTypes
      : groupBy === "judge"
        ? facets.judges
        : groupBy === "revision"
          ? facets.revisions
          : groupBy === "status"
            ? facets.statuses
            : facets.targetModels;
  return source.map(({ count, value }) => ({ label: value, value: count }));
}

export function selectNumericQueryRows(
  sql: DatabaseClient,
  filters: NormalizedFilters,
  groupBy: "criterion" | "judge" | "prompt" | "revision" | "targetModel" | undefined,
  limit: number,
) {
  if (!groupBy)
    return sql<Array<{ count: number; label: string; value: number }>>`
      SELECT
        'All numeric scores' AS label,
        count(*)::integer AS count,
        avg((evaluation_scores.value_json #>> '{}')::double precision)::double precision AS value
      FROM evaluation_scores
      JOIN evaluation_cases ON evaluation_cases.id = evaluation_scores.case_id
      JOIN evaluation_runs ON evaluation_runs.id = evaluation_cases.run_id
      WHERE evaluation_scores.data_type = 'NUMERIC'
        AND jsonb_typeof(evaluation_scores.value_json) = 'number'
        AND ${filterConditions(sql, filters)}
    `;
  const label =
    groupBy === "criterion"
      ? sql`evaluation_scores.criterion_json->>'name'`
      : groupBy === "judge"
        ? sql`evaluation_scores.judge_model_id`
        : groupBy === "prompt"
          ? sql`prompts.title`
          : groupBy === "revision"
            ? sql`evaluation_runs.prompt_revision_id::text`
            : sql`evaluation_runs.target_model_id`;
  return sql<Array<{ count: number; label: string; value: number }>>`
    SELECT
      ${label} AS label,
      count(*)::integer AS count,
      avg((evaluation_scores.value_json #>> '{}')::double precision)::double precision AS value
    FROM evaluation_scores
    JOIN evaluation_cases ON evaluation_cases.id = evaluation_scores.case_id
    JOIN evaluation_runs ON evaluation_runs.id = evaluation_cases.run_id
    JOIN prompts ON prompts.id = evaluation_runs.prompt_id
    WHERE evaluation_scores.data_type = 'NUMERIC'
      AND jsonb_typeof(evaluation_scores.value_json) = 'number'
      AND ${filterConditions(sql, filters)}
    GROUP BY ${label}
    ORDER BY count DESC, label
    LIMIT ${limit}
  `;
}
