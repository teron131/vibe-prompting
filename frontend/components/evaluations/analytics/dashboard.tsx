/** Turns server-aggregated evaluation facts into a criterion-first comparison and evidence workflow. */

"use client";

import {
  ArrowUpRight,
  BarChart3,
  CircleAlert,
  Clock3,
  LoaderCircle,
  RefreshCcw,
  Scale,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ModelIdentityLabel } from "@/components/chat/model-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/components/ui/utils";
import type {
  EvaluationAnalyticsResponse,
  EvaluationDataType,
  EvaluationWorkspaceFacets,
  EvaluationWorkspaceFilters,
} from "@/contracts/evaluation-workspace";
import type { EvaluationRunStatus } from "@/contracts/evaluations";
import { requestJson } from "@/shared/api";
import { formatDateTime } from "@/shared/date";

import { EvaluationHelper } from "../shared/evaluation-helper";
import {
  ClearFilters,
  FilterSelect,
  MoreFilters,
  MultiFilterSelect,
} from "../shared/filter-controls";
import { analyticsFilterParams, parseEvaluationFilters } from "../shared/filter-state";
import { buildCriterionRows, type CriterionRow, formatDuration, formatPercent } from "./model";

type ComparisonDimension = "promptRevisionId" | "targetModelId";

const emptyFacets: EvaluationWorkspaceFacets = {
  dataTypes: [],
  judges: [],
  prompts: [],
  revisions: [],
  statuses: [],
  targetModels: [],
};

export function EvaluationAnalyticsDashboard() {
  const [filters, setFilters] = useState<EvaluationWorkspaceFilters>({});
  const [comparisonDimension, setComparisonDimension] = useState<ComparisonDimension>();
  const [baselineValue, setBaselineValue] = useState("");
  const [facetCatalog, setFacetCatalog] = useState<EvaluationWorkspaceFacets>(emptyFacets);
  const [data, setData] = useState<EvaluationAnalyticsResponse>();
  const [baselineData, setBaselineData] = useState<EvaluationAnalyticsResponse>();
  const [comparisonFacets, setComparisonFacets] = useState<EvaluationWorkspaceFacets>();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const requestId = useRef(0);

  useEffect(() => {
    const initial = readInitialState();
    setFilters(initial.filters);
    setComparisonDimension(initial.comparisonDimension);
    setBaselineValue(initial.baselineValue);
    setReady(true);
  }, []);

  const currentComparisonValue = currentComparison(filters, comparisonDimension);
  const hasComparison = Boolean(
    comparisonDimension &&
    currentComparisonValue &&
    baselineValue &&
    currentComparisonValue !== baselineValue,
  );

  const load = useCallback(async () => {
    if (!ready) return;
    const currentRequestId = ++requestId.current;
    setLoading(true);
    setError(undefined);
    try {
      const baselineRequest =
        hasComparison && comparisonDimension
          ? fetchAnalytics({
              ...filters,
              ...(comparisonDimension === "targetModelId"
                ? { targetModelIds: [baselineValue] }
                : { promptRevisionId: baselineValue }),
            })
          : Promise.resolve(undefined);
      const comparisonFacetRequest =
        comparisonDimension && currentComparisonValue
          ? fetchAnalytics({
              ...filters,
              ...(comparisonDimension === "targetModelId"
                ? { targetModelIds: undefined }
                : { promptRevisionId: undefined }),
            })
          : Promise.resolve(undefined);
      const [nextData, nextBaseline, nextComparisonSource] = await Promise.all([
        fetchAnalytics(filters),
        baselineRequest,
        comparisonFacetRequest,
      ]);
      if (currentRequestId !== requestId.current) return;
      setData(nextData);
      setBaselineData(nextBaseline);
      setComparisonFacets(nextComparisonSource?.facets);
      setFacetCatalog((current) =>
        hasFacetValues(current) ? current : (nextData?.facets ?? emptyFacets),
      );
    } catch (cause) {
      if (currentRequestId !== requestId.current) return;
      setError(
        cause instanceof Error ? cause.message : "Evaluation analytics could not be loaded.",
      );
    } finally {
      if (currentRequestId === requestId.current) setLoading(false);
    }
  }, [baselineValue, comparisonDimension, currentComparisonValue, filters, hasComparison, ready]);

  useEffect(() => void load(), [load]);

  useEffect(() => {
    if (!ready) return;
    const params = analyticsFilterParams(filters);
    if (comparisonDimension) params.set("compareBy", comparisonDimension);
    if (baselineValue) params.set("baseline", baselineValue);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${params.size ? `?${params}` : ""}`,
    );
  }, [baselineValue, comparisonDimension, filters, ready]);

  const rows = useMemo(() => buildCriterionRows(data, baselineData), [baselineData, data]);

  function updateFilter<Key extends keyof EvaluationWorkspaceFilters>(
    key: Key,
    value: EvaluationWorkspaceFilters[Key],
  ) {
    setFilters((current) => ({ ...current, [key]: value }));
    if (key === comparisonDimension && value === baselineValue) setBaselineValue("");
  }

  function updateComparison(value: string) {
    setComparisonDimension((value || undefined) as ComparisonDimension | undefined);
    setBaselineValue("");
  }

  function clearScope() {
    setFilters({});
    setComparisonDimension(undefined);
    setBaselineValue("");
  }

  return (
    <div>
      <header className="page-gutter bg-background py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Criterion analytics</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Compare quality by criterion, check whether the evidence is reliable, then inspect the
              cases behind it.
            </p>
          </div>
          {loading && data ? (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
              Updating scope
            </span>
          ) : null}
        </div>
      </header>

      <div className="page-gutter border-b bg-muted/25 py-3">
        <EvaluationHelper className="max-w-5xl" />
        <AnalyticsFilters
          baselineValue={baselineValue}
          clearScope={clearScope}
          comparisonDimension={comparisonDimension}
          comparisonFacets={comparisonFacets ?? facetCatalog}
          facets={facetCatalog}
          filters={filters}
          refresh={() => void load()}
          setBaselineValue={setBaselineValue}
          updateComparison={updateComparison}
          updateFilter={updateFilter}
        />
      </div>

      {!data && loading ? (
        <div className="grid min-h-[55vh] place-items-center text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            Aggregating persisted scores
          </span>
        </div>
      ) : error && !data ? (
        <ErrorState message={error} retry={() => void load()} />
      ) : data ? (
        <main aria-busy={loading} className="page-gutter min-w-0 bg-background py-5 lg:py-6">
          {error ? (
            <div className="mb-5 flex items-start gap-2 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {error}
            </div>
          ) : null}
          <DecisionStrip data={data} criteriaCount={rows.length} />
          <CriterionPerformance
            baselineLabel={baselineLabel(comparisonDimension, baselineValue)}
            filters={filters}
            rows={rows}
          />
          <Diagnostics data={data} />
          <footer className="border-t pt-3 font-mono text-[11px] text-muted-foreground">
            Generated {formatDateTime(data.provenance.generatedAt)} · Evaluation storage · Synthetic
            examples included
          </footer>
        </main>
      ) : null}
    </div>
  );
}

function AnalyticsFilters({
  baselineValue,
  clearScope,
  comparisonDimension,
  comparisonFacets,
  facets,
  filters,
  refresh,
  setBaselineValue,
  updateComparison,
  updateFilter,
}: {
  baselineValue: string;
  clearScope(): void;
  comparisonDimension?: ComparisonDimension;
  comparisonFacets: EvaluationWorkspaceFacets;
  facets: EvaluationWorkspaceFacets;
  filters: EvaluationWorkspaceFilters;
  refresh(): void;
  setBaselineValue(value: string): void;
  updateComparison(value: string): void;
  updateFilter<Key extends keyof EvaluationWorkspaceFilters>(
    key: Key,
    value: EvaluationWorkspaceFilters[Key],
  ): void;
}) {
  const currentComparisonValue = currentComparison(filters, comparisonDimension);
  const hiddenActiveCount = [filters.status, filters.dataType, filters.from, filters.to].filter(
    Boolean,
  ).length;
  const activeCount =
    hiddenActiveCount +
    [
      filters.promptId,
      filters.promptRevisionId,
      filters.targetModelIds?.length,
      filters.judgeModelIds?.length,
      comparisonDimension,
    ].filter(Boolean).length;
  const baselineOptions =
    comparisonDimension === "targetModelId"
      ? comparisonFacets.targetModels.map(({ count, value }) => ({ count, label: value, value }))
      : comparisonDimension === "promptRevisionId"
        ? comparisonFacets.revisions.map(({ count, value }) => ({
            count,
            label: shortId(value),
            value,
          }))
        : [];

  return (
    <section aria-labelledby="analytics-scope-heading" className="mt-3 pt-2">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xs font-semibold" id="analytics-scope-heading">
          Analysis scope
        </h2>
        <div className="flex items-center gap-1">
          <ClearFilters count={activeCount} onClear={clearScope} />
          <Button aria-label="Refresh analytics" onClick={refresh} size="icon" variant="ghost">
            <RefreshCcw aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <FilterSelect
          className="w-auto max-w-[14rem] flex-1 basis-40"
          label="Prompt"
          onValueChange={(value) => updateFilter("promptId", value || undefined)}
          value={filters.promptId ?? ""}
        >
          <option value="">All prompts</option>
          {facets.prompts.map((facet) => (
            <option key={facet.id} value={facet.id}>
              {facet.label} ({facet.count})
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          className="w-auto max-w-[14rem] flex-1 basis-40 font-mono"
          label="Prompt revision"
          onValueChange={(value) => updateFilter("promptRevisionId", value || undefined)}
          value={filters.promptRevisionId ?? ""}
        >
          <option value="">All revisions</option>
          {facets.revisions.map((facet) => (
            <option key={facet.value} value={facet.value}>
              {shortId(facet.value)} ({facet.count})
            </option>
          ))}
        </FilterSelect>
        <MultiFilterSelect
          allLabel="All target models"
          className="min-w-0 flex-1 basis-40"
          label="Target model"
          onValuesChange={(values) =>
            updateFilter("targetModelIds", values.length ? values : undefined)
          }
          values={filters.targetModelIds ?? []}
        >
          {facets.targetModels.map((facet) => (
            <option key={facet.value} value={facet.value}>
              <ModelFacetLabel count={facet.count} modelId={facet.value} />
            </option>
          ))}
        </MultiFilterSelect>
        <MultiFilterSelect
          allLabel="All judges"
          className="min-w-0 flex-1 basis-40"
          label="Judge"
          onValuesChange={(values) =>
            updateFilter("judgeModelIds", values.length ? values : undefined)
          }
          values={filters.judgeModelIds ?? []}
        >
          {facets.judges.map((facet) => (
            <option key={facet.value} value={facet.value}>
              <ModelFacetLabel count={facet.count} modelId={facet.value} />
            </option>
          ))}
        </MultiFilterSelect>
        <MoreFilters
          activeCount={hiddenActiveCount}
          contentClassName="grid grid-cols-2 gap-2"
          hint="status · type · dates"
        >
          <FilterSelect
            className="w-full"
            label="Run status"
            onValueChange={(value) =>
              updateFilter("status", (value || undefined) as EvaluationRunStatus | undefined)
            }
            value={filters.status ?? ""}
          >
            <option value="">All statuses</option>
            {facets.statuses.map((facet) => (
              <option key={facet.value} value={facet.value}>
                {facet.value} ({facet.count})
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            className="w-full"
            label="Score type"
            onValueChange={(value) =>
              updateFilter("dataType", (value || undefined) as EvaluationDataType | undefined)
            }
            value={filters.dataType ?? ""}
          >
            <option value="">All score types</option>
            {facets.dataTypes.map((facet) => (
              <option key={facet.value} value={facet.value}>
                {facet.value} ({facet.count})
              </option>
            ))}
          </FilterSelect>
          <DateFilter
            label="From"
            onChange={(value) => updateFilter("from", value)}
            value={dateInputValue(filters.from)}
          />
          <DateFilter
            label="To"
            onChange={(value) => updateFilter("to", value)}
            value={dateInputValue(filters.to)}
          />
        </MoreFilters>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t pt-2 text-xs">
        <span className="shrink-0 text-muted-foreground">Compare by</span>
        <FilterSelect
          className="w-auto basis-40"
          label="Compare by"
          onValueChange={updateComparison}
          value={comparisonDimension ?? ""}
        >
          <option value="">No baseline</option>
          <option value="targetModelId">Target model</option>
          <option value="promptRevisionId">Prompt revision</option>
        </FilterSelect>
        {comparisonDimension ? (
          currentComparisonValue ? (
            <>
              <span className="shrink-0 text-muted-foreground">against</span>
              <FilterSelect
                className="w-auto basis-40"
                label="Baseline"
                onValueChange={setBaselineValue}
                value={baselineValue}
              >
                <option value="">Choose a baseline</option>
                {baselineOptions
                  .filter(({ value }) => value !== currentComparisonValue)
                  .map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} ({option.count})
                    </option>
                  ))}
              </FilterSelect>
            </>
          ) : (
            <span className="text-muted-foreground">
              Choose one {comparisonLabel(comparisonDimension)} above to compare against.
            </span>
          )
        ) : null}
      </div>
    </section>
  );
}

function DateFilter({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange(value: string | undefined): void;
  value: string;
}) {
  return (
    <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      {label}
      <Input
        className={cn(
          "h-8 w-auto text-xs shadow-none",
          value && "border-foreground/40 bg-accent/50 font-medium text-foreground",
        )}
        onChange={(event) => onChange(event.target.value || undefined)}
        type="date"
        value={value}
      />
    </label>
  );
}

function currentComparison(
  filters: EvaluationWorkspaceFilters,
  dimension: ComparisonDimension | undefined,
): string | undefined {
  if (dimension === "targetModelId") {
    return filters.targetModelIds?.length === 1 ? filters.targetModelIds[0] : undefined;
  }
  return dimension === "promptRevisionId" ? filters.promptRevisionId : undefined;
}

function ModelFacetLabel({ count, modelId }: { count: number; modelId: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <ModelIdentityLabel modelId={modelId} />
      <span className="shrink-0 text-muted-foreground">({count})</span>
    </span>
  );
}

function comparisonLabel(dimension: ComparisonDimension): string {
  return dimension === "targetModelId" ? "target model" : "prompt revision";
}

function DecisionStrip({
  criteriaCount,
  data,
}: {
  criteriaCount: number;
  data: EvaluationAnalyticsResponse;
}) {
  const completionRate = data.execution.totalRuns
    ? data.execution.completedRuns / data.execution.totalRuns
    : null;
  return (
    <section
      aria-label="Decision summary"
      className="grid rounded-xl bg-muted/20 sm:grid-cols-2 xl:grid-cols-4"
    >
      <SummaryDatum icon={BarChart3} label="Criteria in view" value={String(criteriaCount)} />
      <SummaryDatum
        detail={
          data.reliability.comparableJudgeGroups
            ? `${data.reliability.agreedJudgeGroups} of ${data.reliability.comparableJudgeGroups} comparable groups`
            : "Needs two judges on the same criterion"
        }
        icon={Scale}
        label="Exact judge agreement"
        value={formatPercent(data.reliability.judgeAgreementRate)}
      />
      <SummaryDatum
        detail={`${data.execution.completedRuns} of ${data.execution.totalRuns} runs`}
        icon={ShieldCheck}
        label="Run completion"
        value={formatPercent(completionRate)}
      />
      <SummaryDatum
        detail={`${data.execution.durationMeasuredRuns} completed runs measured`}
        icon={Clock3}
        label="Median run duration"
        value={formatDuration(data.execution.medianDurationMs)}
      />
    </section>
  );
}

function SummaryDatum({
  className,
  detail,
  icon: Icon,
  label,
  value,
}: {
  className?: string;
  detail?: string;
  icon: typeof BarChart3;
  label: string;
  value: string;
}) {
  return (
    <div className={cn("min-w-0 px-4 py-4", className)}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon aria-hidden="true" className="size-3.5" />
        {label}
      </div>
      <div className="mt-1 font-mono text-lg font-semibold">{value}</div>
      {detail ? (
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{detail}</div>
      ) : null}
    </div>
  );
}

function CriterionPerformance({
  baselineLabel,
  filters,
  rows,
}: {
  baselineLabel: string | null;
  filters: EvaluationWorkspaceFilters;
  rows: CriterionRow[];
}) {
  const comparableRows = rows.filter(({ baselineDelta }) => baselineDelta !== null).length;
  return (
    <section className="py-7">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">Criterion performance</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Each row keeps its native score type instead of collapsing unlike criteria into one
            quality number.
          </p>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">
          {rows.length} criteria · {baselineLabel ? `vs ${baselineLabel}` : "no baseline"}
        </span>
      </div>

      {baselineLabel && comparableRows === 0 ? (
        <p className="mt-4 rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
          The selected cohorts do not share a Boolean or numeric criterion, so a trustworthy delta
          cannot be calculated.
        </p>
      ) : null}

      {rows.length ? (
        <div
          aria-label="Criterion performance table"
          className="mt-4 overflow-x-auto bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          role="region"
          tabIndex={0}
        >
          <table className="w-full min-w-[64rem] text-left text-xs">
            <thead className="sticky top-0 z-10 bg-muted font-mono text-[11px] text-muted-foreground">
              <tr>
                <th className="w-24 px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Criterion</th>
                <th className="w-72 px-3 py-2 font-medium">Performance</th>
                <th className="w-32 px-3 py-2 text-right font-medium">Scores</th>
                <th className="w-28 px-3 py-2 text-right font-medium">Baseline Δ</th>
                <th className="w-24 px-3 py-2 text-right font-medium">Results</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <CriterionPerformanceRow filters={filters} key={row.key} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyMetric>No Boolean, categorical, or numeric criteria match this scope.</EmptyMetric>
      )}
    </section>
  );
}

function CriterionPerformanceRow({
  filters,
  row,
}: {
  filters: EvaluationWorkspaceFilters;
  row: CriterionRow;
}) {
  return (
    <tr className="align-top transition-colors odd:bg-muted/10 hover:bg-muted/30">
      <td className="px-3 py-3">
        <span className="inline-flex rounded-sm border bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {row.dataType}
        </span>
      </td>
      <td className="max-w-xl px-3 py-3">
        <div className="font-medium leading-snug">{row.criterion}</div>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span
            className={cn(
              "font-mono text-sm font-semibold",
              row.valueTone === "positive" && "text-emerald-700 dark:text-emerald-400",
            )}
          >
            {row.value}
          </span>
          <span className="text-right font-mono text-[11px] text-muted-foreground">
            {row.detail}
          </span>
        </div>
        {row.distribution ? <Distribution segments={row.distribution} /> : null}
      </td>
      <td className="px-3 py-3 text-right font-mono">{row.sampleCount.toLocaleString()}</td>
      <td className="px-3 py-3 text-right font-mono text-muted-foreground">
        {row.baselineDelta ?? "—"}
      </td>
      <td className="px-3 py-3 text-right">
        <Link
          className="inline-flex items-center gap-1 font-medium hover:underline"
          href={resultsHref(filters, row)}
        >
          Open
          <ArrowUpRight aria-hidden="true" className="size-3" />
        </Link>
      </td>
    </tr>
  );
}

function Distribution({ segments }: { segments: Array<{ label: string; share: number }> }) {
  return (
    <div
      className="mt-2 flex h-1.5 overflow-hidden bg-secondary"
      title={distributionTitle(segments)}
    >
      {segments.map((segment, index) => (
        <span
          aria-label={`${segment.label}: ${(segment.share * 100).toFixed(1)}%`}
          className={cn(
            "h-full",
            index === 0
              ? "bg-foreground"
              : index === 1
                ? "bg-foreground/60"
                : index === 2
                  ? "bg-foreground/35"
                  : "bg-foreground/20",
          )}
          key={segment.label}
          style={{ width: `${segment.share * 100}%` }}
        />
      ))}
    </div>
  );
}

function Diagnostics({ data }: { data: EvaluationAnalyticsResponse }) {
  const failed = data.execution.failedRuns + data.execution.interruptedRuns;
  return (
    <section className="grid border-t lg:grid-cols-2">
      <div className="py-6 lg:pr-7">
        <div className="flex items-center gap-2">
          <Scale aria-hidden="true" className="size-3.5" />
          <h2 className="text-sm font-semibold">Reliability</h2>
        </div>
        <dl className="mt-4 divide-y text-xs">
          <DiagnosticRow
            detail="Exact matches across Boolean and categorical scores with more than one judge."
            label="Judge agreement"
            value={formatPercent(data.reliability.judgeAgreementRate)}
          />
          <DiagnosticRow
            detail="Failed and interrupted runs in the selected scope."
            label="Execution failures"
            value={`${failed} / ${data.execution.totalRuns}`}
          />
          <DiagnosticRow
            detail="Running evaluations remain visible instead of being treated as completed evidence."
            label="Still running"
            value={String(data.execution.runningRuns)}
          />
        </dl>
      </div>

      <div className="py-6 lg:pl-7">
        <div className="flex items-center gap-2">
          <Clock3 aria-hidden="true" className="size-3.5" />
          <h2 className="text-sm font-semibold">Efficiency</h2>
        </div>
        <dl className="mt-4 divide-y text-xs">
          <DiagnosticRow
            detail="Whole evaluation run, not individual target or judge calls."
            label="Median / p95 duration"
            value={`${formatDuration(data.execution.medianDurationMs)} / ${formatDuration(data.execution.p95DurationMs)}`}
          />
          <DiagnosticRow
            detail="Model-call usage is not yet attributed to evaluation run and case IDs."
            label="Tokens"
            value="Not attributed"
          />
          <DiagnosticRow
            detail="Deployment-wide spend events cannot be safely assigned to evaluation calls."
            label="Estimated cost"
            value="Not attributed"
          />
        </dl>
      </div>
    </section>
  );
}

function DiagnosticRow({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-baseline sm:gap-4">
      <dt className="font-medium">{label}</dt>
      <dd className="text-muted-foreground">{detail}</dd>
      <dd className="font-mono font-semibold sm:text-right">{value}</dd>
    </div>
  );
}

function ErrorState({ message, retry }: { message: string; retry(): void }) {
  return (
    <div className="m-6 rounded-lg bg-destructive/5 p-6 text-center text-sm text-destructive">
      <CircleAlert aria-hidden="true" className="mx-auto mb-2 size-5" />
      {message}
      <div>
        <Button className="mt-4" onClick={retry} size="sm" variant="outline">
          Retry
        </Button>
      </div>
    </div>
  );
}

function EmptyMetric({ children }: { children: string }) {
  return (
    <p className="mt-4 rounded-lg bg-muted/25 p-6 text-sm text-muted-foreground">{children}</p>
  );
}

function resultsHref(filters: EvaluationWorkspaceFilters, row: CriterionRow): string {
  const params = analyticsFilterParams({
    ...filters,
    criterion: row.criterion,
    dataType: row.dataType,
  });
  return `/evaluations/results?${params}`;
}

async function fetchAnalytics(
  filters: EvaluationWorkspaceFilters,
): Promise<EvaluationAnalyticsResponse> {
  const params = analyticsFilterParams(filters);
  return requestJson<EvaluationAnalyticsResponse>(
    `/api/evaluations/analytics${params.size ? `?${params}` : ""}`,
  );
}

function readInitialState(): {
  baselineValue: string;
  comparisonDimension?: ComparisonDimension;
  filters: EvaluationWorkspaceFilters;
} {
  if (typeof window === "undefined") return { baselineValue: "", filters: {} };
  const params = new URLSearchParams(window.location.search);
  const compareBy = params.get("compareBy");
  return {
    baselineValue: params.get("baseline") ?? "",
    comparisonDimension:
      compareBy === "promptRevisionId" || compareBy === "targetModelId" ? compareBy : undefined,
    filters: parseEvaluationFilters(window.location.search),
  };
}

function hasFacetValues(facets: EvaluationWorkspaceFacets): boolean {
  return Object.values(facets).some((values) => values.length > 0);
}

function baselineLabel(dimension: ComparisonDimension | undefined, value: string): string | null {
  if (!dimension || !value) return null;
  return dimension === "promptRevisionId" ? shortId(value) : value;
}

function distributionTitle(segments: Array<{ label: string; share: number }>): string {
  return segments.map(({ label, share }) => `${label}: ${formatPercent(share)}`).join(" · ");
}

function shortId(value: string): string {
  return value.slice(0, 8);
}

function dateInputValue(value: string | undefined): string {
  return value?.slice(0, 10) ?? "";
}
