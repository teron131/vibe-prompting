/** Projects typed evaluation aggregates into criterion rows without collapsing unlike score types. */

import type { EvaluationAnalyticsResponse } from "@/contracts/evaluation-workspace";

export type CriterionRow = {
  baselineDelta: string | null;
  criterion: string;
  criterionPosition: number;
  dataType: "BOOLEAN" | "CATEGORICAL" | "NUMERIC";
  detail: string;
  distribution?: Array<{ label: string; share: number }>;
  key: string;
  sampleCount: number;
  value: string;
  valueTone?: "positive";
};

export function buildCriterionRows(
  data: EvaluationAnalyticsResponse | undefined,
  baseline: EvaluationAnalyticsResponse | undefined,
): CriterionRow[] {
  if (!data) return [];
  const baselineBoolean = new Map(
    (baseline?.boolean ?? []).map((row) => [criterionKey("BOOLEAN", row), row]),
  );
  const baselineNumeric = new Map(
    (baseline?.numeric ?? []).map((row) => [criterionKey("NUMERIC", row), row]),
  );
  const categoricalGroups = groupCategorical(data.categorical);
  return [
    ...data.boolean.map((row) => {
      const interval = wilsonInterval(row.passed, row.total);
      const comparison = baselineBoolean.get(criterionKey("BOOLEAN", row));
      return {
        baselineDelta: comparison
          ? formatPercentagePointDelta(row.passRate - comparison.passRate)
          : null,
        criterion: row.criterion,
        criterionPosition: row.criterionPosition,
        dataType: "BOOLEAN" as const,
        detail: `95% CI ${formatPercent(interval.lower)}–${formatPercent(interval.upper)}`,
        key: criterionKey("BOOLEAN", row),
        sampleCount: row.total,
        value: `${formatPercent(row.passRate)} pass`,
        valueTone: "positive" as const,
      };
    }),
    ...categoricalGroups.map(([key, rows]) => {
      const total = rows.reduce((sum, row) => sum + row.count, 0);
      const ordered = [...rows].sort((left, right) => right.count - left.count);
      const leader = ordered[0];
      return {
        baselineDelta: null,
        criterion: leader?.criterion ?? "Categorical criterion",
        criterionPosition: leader?.criterionPosition ?? 0,
        dataType: "CATEGORICAL" as const,
        detail: leader ? `${formatPercent(leader.count / total)} of responses` : "No responses",
        distribution: ordered.map((row) => ({ label: row.category, share: row.count / total })),
        key,
        sampleCount: total,
        value: leader?.category ?? "—",
      };
    }),
    ...data.numeric.map((row) => {
      const comparison = baselineNumeric.get(criterionKey("NUMERIC", row));
      return {
        baselineDelta: comparison ? formatSignedNumber(row.median - comparison.median) : null,
        criterion: row.criterion,
        criterionPosition: row.criterionPosition,
        dataType: "NUMERIC" as const,
        detail: `p10 ${formatNumber(row.p10)}–p90 ${formatNumber(row.p90)} · σ ${formatNumber(row.standardDeviation)}`,
        key: criterionKey("NUMERIC", row),
        sampleCount: row.count,
        value: `${formatNumber(row.median)} median`,
      };
    }),
  ].sort(
    (left, right) =>
      left.criterionPosition - right.criterionPosition ||
      left.dataType.localeCompare(right.dataType) ||
      left.criterion.localeCompare(right.criterion),
  );
}

export function formatDuration(value: number | null): string {
  if (value === null) return "—";
  if (value < 1_000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function groupCategorical(
  rows: EvaluationAnalyticsResponse["categorical"],
): Array<[string, EvaluationAnalyticsResponse["categorical"]]> {
  const groups = new Map<string, EvaluationAnalyticsResponse["categorical"]>();
  for (const row of rows) {
    const key = criterionKey("CATEGORICAL", row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()];
}

function criterionKey(
  dataType: CriterionRow["dataType"],
  row: { criterion: string; criterionPosition: number },
): string {
  return `${dataType}:${row.criterionPosition}:${row.criterion}`;
}

function wilsonInterval(passed: number, total: number): { lower: number; upper: number } {
  if (!total) return { lower: 0, upper: 0 };
  const z = 1.96;
  const proportion = passed / total;
  const denominator = 1 + (z * z) / total;
  const center = proportion + (z * z) / (2 * total);
  const spread =
    z * Math.sqrt((proportion * (1 - proportion)) / total + (z * z) / (4 * total * total));
  return {
    lower: Math.max(0, (center - spread) / denominator),
    upper: Math.min(1, (center + spread) / denominator),
  };
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatSignedNumber(value: number): string {
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function formatPercentagePointDelta(value: number): string {
  const points = value * 100;
  return `${points > 0 ? "+" : ""}${points.toFixed(1)} pp`;
}
