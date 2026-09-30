/** Assembles historical reports and compatible Boolean trends from stored snapshots, retaining viewer-safe provenance. */
import type { Criterion } from "../../criteria/schemas.ts";
import type { Database, DatabaseClient } from "../../database/index.ts";
import { projectRunSummary, requireRunRow, selectCases } from "../runs/queries.ts";
import { EvaluationRunNotFoundError, type EvaluationRunStatus } from "../runs/schemas.ts";
import type { BooleanTrendPoint, StoredEvaluationRun, StoredEvaluationScore } from "./schemas.ts";

type ScoreRow = {
  id: string;
  caseId: string;
  criterionPosition: number;
  criterion: Criterion;
  dataType: StoredEvaluationScore["dataType"];
  judgeModel: string;
  value: boolean | number | string;
  comment: string;
  evidence: string[];
};

type TrendSourceRow = {
  id: string;
  contextId: string;
  contextRevisionId: string;
  configurationFingerprint: string;
  status: EvaluationRunStatus;
  booleanOnly: boolean;
};

type BooleanTrendRow = {
  id: string;
  contextRevisionId: string;
  contextRevisionNumber: number;
  completedAt: Date | null;
  createdAt: Date;
  criterionPosition: number | null;
  criterion: string | null;
  passed: number | null;
  total: number | null;
};

/** Returns a complete historical report with immutable criteria and per-judge score facts. */
export async function readRunReport(
  database: Database,
  runId: string,
  viewerUserId: string,
): Promise<StoredEvaluationRun> {
  return database.run(async (sql) => {
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
      contextMarkdown: row.contextMarkdown,
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
          judgeModel: score.judgeModel,
          value: score.value,
          comment: score.comment,
          evidence: score.evidence,
        })),
      })),
    };
  });
}

/** Returns compatible Boolean history with two bounded aggregate queries instead of loading full reports. */
export async function readBooleanTrend(
  database: Database,
  runId: string,
): Promise<BooleanTrendPoint[]> {
  const source = await database.run(async (sql) => {
    const [row] = await sql<TrendSourceRow[]>`
        SELECT
          evaluation_runs.id,
          evaluation_runs.context_id,
          evaluation_runs.context_revision_id,
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

  const rows = await database.run(
    (sql) => sql<BooleanTrendRow[]>`
        WITH compatible_runs AS (
          SELECT
            evaluation_runs.id,
            evaluation_runs.context_revision_id,
            context_revisions.revision_number AS context_revision_number,
            evaluation_runs.created_at,
            evaluation_runs.completed_at
          FROM evaluation_runs
          JOIN context_revisions ON context_revisions.id = evaluation_runs.context_revision_id
          WHERE evaluation_runs.context_id = ${source.contextId}
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
          compatible_runs.context_revision_id,
          compatible_runs.context_revision_number,
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
function selectScores(sql: DatabaseClient, runId: string) {
  return sql<ScoreRow[]>`
    SELECT
      evaluation_scores.id, evaluation_scores.case_id,
      evaluation_scores.criterion_position, evaluation_scores.data_type,
      evaluation_scores.criterion_json AS criterion,
      evaluation_scores.judge_model_id AS judge_model, evaluation_scores.value_json AS value,
      evaluation_scores.comment, evaluation_scores.evidence_json AS evidence
    FROM evaluation_scores
    JOIN evaluation_cases ON evaluation_cases.id = evaluation_scores.case_id
    WHERE evaluation_cases.run_id = ${runId}
    ORDER BY evaluation_cases.position, evaluation_scores.criterion_position, evaluation_scores.judge_model_id
  `;
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
      revisionId: row.contextRevisionId,
      revisionNumber: row.contextRevisionNumber,
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
