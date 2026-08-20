/** Presents prompt-bound evaluation history as a latest outcome with criterion evidence and concise prior attempts. */

import {
  CheckCircle2,
  Circle,
  ExternalLink,
  FlaskConical,
  LoaderCircle,
  XCircle,
} from "lucide-react";
import Link from "next/link";

import { RevisionTrend } from "@/components/evaluations/revision-trend";
import { buildPromptCriterionOutcomes } from "@/components/prompts/evaluation-model";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/utils";
import type {
  BooleanTrendPoint,
  EvaluationRun,
  EvaluationRunStatus,
  EvaluationRunSummary,
} from "@/contracts/evaluations";
import { formatDateTime } from "@/shared/date";

export function PromptEvaluationView({
  error,
  latestRun,
  loading,
  onRetry,
  promptId,
  revisionVersions,
  runs,
  trend,
}: {
  error?: string;
  latestRun?: EvaluationRun;
  loading: boolean;
  onRetry(): void;
  promptId: string;
  revisionVersions: ReadonlyMap<string, number>;
  runs: EvaluationRunSummary[];
  trend: BooleanTrendPoint[];
}) {
  const latestSummary = runs[0];
  return (
    <section>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold">Evaluation results</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            See whether this prompt met each criterion and what evidence supported the result.
          </p>
        </div>
        <Link
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          href={`/evaluations?prompt=${promptId}`}
        >
          <FlaskConical aria-hidden="true" className="size-4" />
          New run
        </Link>
      </div>
      {error && !latestRun ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <p>{error}</p>
          <Button className="mt-3" onClick={onRetry} size="sm" variant="outline">
            Try again
          </Button>
        </div>
      ) : !latestSummary ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <FlaskConical aria-hidden="true" className="mx-auto size-5 text-muted-foreground" />
          <h4 className="mt-3 font-medium">No evaluation results yet</h4>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Start a run to test the latest revision against examples and clear success criteria.
          </p>
        </div>
      ) : loading && !latestRun ? (
        <div className="grid min-h-48 place-items-center rounded-xl border bg-card">
          <LoaderCircle
            aria-label="Loading latest evaluation result"
            className="size-5 animate-spin text-muted-foreground"
          />
        </div>
      ) : latestRun ? (
        <LatestResult revisionVersions={revisionVersions} run={latestRun} />
      ) : null}
      {trend.length >= 2 ? (
        <div className="mt-5">
          <RevisionTrend points={trend} />
        </div>
      ) : null}
      {runs.length > 1 ? (
        <div className="mt-6">
          <h4 className="mb-2 text-sm font-semibold">Earlier runs</h4>
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {runs.slice(1).map((run) => (
              <Link
                className="flex items-center justify-between gap-3 p-3 text-sm hover:bg-accent"
                href={`/evaluations/${run.id}`}
                key={run.id}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{run.targetModelId}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {revisionLabel(run.promptRevisionId, revisionVersions)} · {run.caseCount}{" "}
                    {run.caseCount === 1 ? "case" : "cases"} ·{" "}
                    {formatDateTime(run.completedAt ?? run.createdAt)}
                  </span>
                </span>
                <Status status={run.status} />
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function LatestResult({
  revisionVersions,
  run,
}: {
  revisionVersions: ReadonlyMap<string, number>;
  run: EvaluationRun;
}) {
  const outcomes = run.status === "completed" ? buildPromptCriterionOutcomes(run) : [];
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold">Latest result</h4>
            <Status status={run.status} />
          </div>
          <p className="mt-1 truncate text-sm">
            {run.targetProfileName ?? "Legacy runtime"} · {run.targetModelId}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Tested {revisionLabel(run.promptRevisionId, revisionVersions)} · {run.caseCount}{" "}
            {run.caseCount === 1 ? "case" : "cases"} ·{" "}
            {formatDateTime(run.completedAt ?? run.createdAt)}
          </p>
        </div>
        <Link
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          href={`/evaluations/${run.id}`}
        >
          Full report
          <ExternalLink aria-hidden="true" className="size-3" />
        </Link>
      </div>
      {run.status === "running" ? (
        <div className="flex items-start gap-3 p-5">
          <LoaderCircle
            aria-hidden="true"
            className="mt-0.5 size-4 animate-spin text-muted-foreground"
          />
          <div>
            <p className="text-sm font-medium">Evaluation is running</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Results will appear here as soon as the durable run completes.
            </p>
          </div>
        </div>
      ) : run.status === "failed" || run.status === "interrupted" ? (
        <div className="p-5">
          <p className="text-sm font-medium capitalize">{run.status} evaluation</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {run.errorMessage ?? "The run ended before it produced a complete result."}
          </p>
        </div>
      ) : outcomes.length ? (
        <div className="divide-y">
          {outcomes.map((outcome) => (
            <div className="p-4" key={`${outcome.type}-${outcome.instruction}`}>
              <div className="flex items-start gap-3">
                <OutcomeIcon result={outcome.result} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <p className="text-sm font-medium">{outcome.instruction}</p>
                    <p className="shrink-0 text-xs font-medium text-muted-foreground">
                      {outcome.summary}
                    </p>
                  </div>
                  {outcome.evidence.length ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Evidence: </span>
                      {outcome.evidence.join(" · ")}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      No evidence excerpt was returned.
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-5 text-sm text-muted-foreground">
          The run completed without criterion scores.
        </div>
      )}
    </div>
  );
}

function OutcomeIcon({ result }: { result: "fail" | "neutral" | "pass" }) {
  if (result === "pass")
    return <CheckCircle2 aria-label="Passed" className="mt-0.5 size-4 shrink-0 text-chart-2" />;
  if (result === "fail")
    return (
      <XCircle
        aria-label="Did not fully pass"
        className="mt-0.5 size-4 shrink-0 text-destructive"
      />
    );
  return <Circle aria-label="Result" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
}

function Status({ status }: { status: EvaluationRunStatus }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
        status === "completed" && "bg-chart-2/15 text-chart-2",
        status === "running" && "bg-chart-4/20 text-foreground",
        (status === "failed" || status === "interrupted") && "bg-destructive/10 text-destructive",
      )}
    >
      {status}
    </span>
  );
}

function revisionLabel(revisionId: string, versions: ReadonlyMap<string, number>): string {
  const version = versions.get(revisionId);
  return `${version ? `v${version}` : "revision"} · ${revisionId.slice(0, 7)}`;
}
