/** Reloads one durable evaluation report, polls honest running state, and separates attributed results from the exact prompt artifact. */

"use client";

import {
  ArrowLeft,
  ExternalLink,
  FileText,
  FlaskConical,
  LoaderCircle,
  MessageSquareText,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { ModelIdentityLabel } from "@/components/chat/model-selector";
import { DefaultExampleBadge } from "@/components/evaluations/shared/default-example-badge";
import { MarkdownPreview } from "@/components/prompts/markdown-preview";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/utils";
import type {
  BooleanTrendPoint,
  EvaluationRun,
  EvaluationRunResponse,
  EvaluationRunSummary,
} from "@/contracts/evaluations";
import type { PromptDetail } from "@/contracts/prompts";
import { createApiRequester, createErrorReader } from "@/shared/api";
import { formatDateTime } from "@/shared/date";
import { memberDisplayName } from "@/shared/member";

import { RevisionTrend } from "../shared/revision-trend";
import { EvaluationMarkdownValue } from "./markdown-value";
import { ScoreGrid } from "./score-grid";
import { RunScoreOverview } from "./score-visualization";

const evaluationReportApi = createApiRequester(
  { cache: "no-store" },
  "Evaluation report request failed.",
);
const readError = createErrorReader("Evaluation report request failed.");

export function EvaluationReport({ runId }: { runId: string }) {
  const [run, setRun] = useState<EvaluationRun>();
  const [trend, setTrend] = useState<BooleanTrendPoint[]>([]);
  const [view, setView] = useState<"prompt" | "results">("results");
  const [source, setSource] = useState(false);
  const [error, setError] = useState<string>();
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    const data = await evaluationReportApi.json<EvaluationRunResponse>(`/api/evaluations/${runId}`);
    setRun(data.run);
    setTrend(data.trend);
    setError(undefined);
    return data.run.status;
  }, [runId]);

  useEffect(() => {
    void load().catch((cause) => setError(readError(cause)));
  }, [load]);
  useEffect(() => {
    if (run?.status !== "queued" && run?.status !== "running") return;
    const timer = window.setInterval(() => {
      void load()
        .then((status) => {
          if (status !== "queued" && status !== "running") window.clearInterval(timer);
        })
        .catch((cause) => setError(readError(cause)));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [load, run?.status]);

  const counts = new Map<string, number>();
  for (const testCase of run?.cases ?? [])
    for (const score of testCase.scores)
      counts.set(score.dataType, (counts.get(score.dataType) ?? 0) + 1);
  const scoreCounts = [...counts.entries()];

  async function retry() {
    if (!run) return;
    try {
      const prompt = await evaluationReportApi.json<PromptDetail>(`/api/prompts/${run.promptId}`);
      const next = await evaluationReportApi.json<EvaluationRunSummary>("/api/evaluations", {
        body: JSON.stringify({
          cases: run.cases.map(({ criteria, input }) => ({ criteria, input })),
          isSyntheticExample: run.isSyntheticExample,
          judges: run.judgeModelIds,
          promptId: run.promptId,
          promptRevisionId: prompt.prompt.activeRevisionId,
          targetModelId: run.targetModelId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      window.location.assign(`/evaluations/${next.id}`);
    } catch (cause) {
      toast.error(readError(cause));
    }
  }

  async function cancel() {
    if (!run || (run.status !== "queued" && run.status !== "running")) return;
    setCancelling(true);
    try {
      await evaluationReportApi.json(`/api/evaluations/${run.id}`, { method: "DELETE" });
      await load();
    } catch (cause) {
      setError(readError(cause));
    } finally {
      setCancelling(false);
    }
  }

  if (!run && !error)
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <LoaderCircle
          aria-label="Loading evaluation report"
          className="size-5 animate-spin text-muted-foreground"
        />
      </div>
    );
  if (!run)
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      </div>
    );

  return (
    <main className="page-gutter mx-auto w-full max-w-7xl py-5 sm:py-7">
      <header className="border-b pb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Link
              className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              href="/evaluations/results"
            >
              <ArrowLeft aria-hidden="true" className="size-3.5" />
              Results
            </Link>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className="min-w-0 truncate text-xl font-semibold tracking-tight sm:text-2xl">
                {run.promptTitle}
              </h2>
              <span className="rounded-sm border px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
                v{run.promptRevisionNumber}
              </span>
              {run.isSyntheticExample ? (
                <DefaultExampleBadge className="text-[11px] tracking-wide" />
              ) : null}
            </div>
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
              Attributed results for one durable prompt revision, target, case set, and judge set.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {run.chatId ? (
              <Link
                className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-accent"
                href={`/chat/${run.chatId}`}
              >
                <MessageSquareText aria-hidden="true" className="size-4" />
                Producing chat
              </Link>
            ) : null}
            {run.status === "queued" || run.status === "running" ? (
              <Button disabled={cancelling} onClick={cancel} variant="outline">
                {cancelling ? (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                ) : null}
                Cancel
              </Button>
            ) : null}
            {run.status === "failed" || run.status === "interrupted" ? (
              <Button onClick={retry} variant="outline">
                <RotateCcw aria-hidden="true" className="size-4" />
                Retry active revision
              </Button>
            ) : null}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-[5rem_minmax(0,1fr)] border-y text-xs sm:grid-cols-[auto_1fr] lg:grid-cols-[auto_1fr_auto_1fr]">
          <ProvenanceDatum label="State">
            <Status status={run.status} />
          </ProvenanceDatum>
          <ProvenanceDatum label="Evaluated">
            <span className="font-mono">{formatDateTime(run.completedAt ?? run.createdAt)}</span>
          </ProvenanceDatum>
          <ProvenanceDatum label="Target">
            <ModelIdentityLabel labelClassName="font-mono" modelId={run.targetModelId} />
          </ProvenanceDatum>
          <ProvenanceDatum label="Prompt revision">
            <span className="font-mono" title={run.promptRevisionId}>
              v{run.promptRevisionNumber} · {run.promptRevisionId.slice(0, 8)}
            </span>
          </ProvenanceDatum>
          <ProvenanceDatum label="Cases">
            <span className="font-mono">
              {run.cases.filter(({ output }) => output !== null).length}/{run.caseCount} completed
            </span>
          </ProvenanceDatum>
          <ProvenanceDatum label="Score facts">
            <span className="font-mono">
              {scoreCounts.length
                ? scoreCounts.map(([type, count]) => `${type.toLowerCase()} ${count}`).join(" · ")
                : "None yet"}
            </span>
          </ProvenanceDatum>
          <ProvenanceDatum label="Runtime">
            <span className="font-mono">
              {run.targetProfileName ?? "Legacy runtime"}
              {run.targetProfileRevisionId ? ` · ${run.targetProfileRevisionId}` : ""}
            </span>
          </ProvenanceDatum>
          {run.targetRunId ? (
            <ProvenanceDatum label="Recorded trace">
              <Link
                className="font-mono font-medium hover:underline"
                href={`/target-runs/${run.targetRunId}`}
              >
                Target Run {run.targetRunId.slice(0, 8)} · no target replay
              </Link>
            </ProvenanceDatum>
          ) : null}
          <ProvenanceDatum label="Judges">
            {run.judgeModelIds.length ? (
              <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
                {run.judgeModelIds.map((modelId) => (
                  <ModelIdentityLabel labelClassName="font-mono" key={modelId} modelId={modelId} />
                ))}
              </span>
            ) : (
              <span className="font-mono">None</span>
            )}
          </ProvenanceDatum>
        </div>
        <details className="group border-b text-xs">
          <summary className="flex cursor-pointer list-none items-center justify-between py-2.5 text-muted-foreground hover:text-foreground">
            <span>Exact provenance</span>
            <span className="font-mono group-open:hidden">Run {run.id.slice(0, 8)}</span>
            <span className="hidden font-mono group-open:inline">Close</span>
          </summary>
          <dl className="grid gap-x-6 gap-y-3 pb-4 sm:grid-cols-2 lg:grid-cols-3">
            <ExactDatum label="Run ID" value={run.id} />
            <ExactDatum
              label="Source"
              value={run.source === "ai" ? "AI-authored" : "Human-authored"}
            />
            <ExactDatum label="Started by" value={memberDisplayName(run.startedByName)} />
            <ExactDatum label="Prompt ID" value={run.promptId} />
            <ExactDatum label="Configuration fingerprint" value={run.configurationFingerprint} />
            <ExactDatum
              label="Effective instructions hash"
              value={run.effectiveInstructionsHash ?? "Not recorded"}
            />
            <ExactDatum label="Target profile ID" value={run.targetProfileId ?? "Legacy runtime"} />
            <ExactDatum label="Target Run ID" value={run.targetRunId ?? "Live target execution"} />
            <ExactDatum
              label="Target Run turn ID"
              value={run.targetRunTurnId ?? "Live target execution"}
            />
            <ExactDatum
              label="Target configuration"
              value={
                run.targetConfiguration ? JSON.stringify(run.targetConfiguration) : "Not recorded"
              }
            />
            <ExactDatum label="Created at" value={run.createdAt} />
            <ExactDatum label="Completed at" value={run.completedAt ?? "Not completed"} />
          </dl>
        </details>
      </header>
      <nav
        aria-label="Report view"
        className="page-bleed sticky top-0 z-10 flex border-b bg-background/95 backdrop-blur"
      >
        <button
          className={cn(
            "border-b-2 px-1 py-3 text-sm font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            view === "results" ? "border-foreground" : "border-transparent text-muted-foreground",
          )}
          onClick={() => setView("results")}
          type="button"
        >
          <FlaskConical aria-hidden="true" className="mr-2 inline size-4" />
          Results
        </button>
        <button
          className={cn(
            "ml-6 border-b-2 px-1 py-3 text-sm font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            view === "prompt" ? "border-foreground" : "border-transparent text-muted-foreground",
          )}
          onClick={() => setView("prompt")}
          type="button"
        >
          <FileText aria-hidden="true" className="mr-2 inline size-4" />
          Prompt artifact
        </button>
      </nav>
      <div className="pt-6">
        {view === "prompt" ? (
          <section>
            <div className="flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-sm font-semibold">Exact evaluated revision</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  This immutable artifact, not the active prompt revision, produced the results.
                </p>
              </div>
              <div className="flex gap-2">
                <Link
                  className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs hover:bg-accent"
                  href={`/prompts/${run.promptId}`}
                >
                  Prompt detail
                  <ExternalLink aria-hidden="true" className="size-3" />
                </Link>
                <Button onClick={() => setSource((value) => !value)} size="sm" variant="ghost">
                  {source ? "Preview" : "Source"}
                </Button>
              </div>
            </div>
            {source ? (
              <pre className="min-h-96 whitespace-pre-wrap break-words py-6 font-mono text-sm leading-6 sm:py-8">
                {run.promptMarkdown}
              </pre>
            ) : (
              <MarkdownPreview className="min-h-96 py-6 sm:py-8" markdown={run.promptMarkdown} />
            )}
          </section>
        ) : (
          <Results run={run} trend={trend} />
        )}
      </div>
    </main>
  );
}

function Results({ run, trend }: { run: EvaluationRun; trend: BooleanTrendPoint[] }) {
  if (run.status === "queued" || run.status === "running")
    return (
      <section className="border-y py-10">
        <div className="flex max-w-2xl items-start gap-3">
          <LoaderCircle
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 animate-spin text-muted-foreground"
          />
          <div>
            <h2 className="font-medium">Evaluation is {run.status}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The durable attempt is safe to leave; this report will continue polling.
            </p>
          </div>
        </div>
      </section>
    );
  if (run.status === "failed" || run.status === "cancelled" || run.status === "interrupted")
    return (
      <section className="border-y border-destructive/40 py-6">
        <div>
          <h2 className="font-medium capitalize text-destructive">{run.status} evaluation</h2>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            {run.errorMessage ?? "No provider result or score was persisted."}
          </p>
        </div>
      </section>
    );
  return (
    <div>
      <section aria-labelledby="criterion-overview-heading">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2
            className="text-xs font-semibold uppercase tracking-wide"
            id="criterion-overview-heading"
          >
            Criterion overview
          </h2>
          <span className="font-mono text-[11px] text-muted-foreground">
            {run.caseCount} {run.caseCount === 1 ? "case" : "cases"} · {run.judgeModelIds.length}{" "}
            {run.judgeModelIds.length === 1 ? "judge" : "judges"}
          </span>
        </div>
        <RunScoreOverview run={run} />
      </section>
      {trend.length >= 2 ? (
        <section className="mt-8 border-t pt-6">
          <RevisionTrend points={trend} />
        </section>
      ) : null}
      <section className="mt-8 border-t" aria-labelledby="case-evidence-heading">
        <div className="flex items-baseline justify-between gap-4 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide" id="case-evidence-heading">
            Case evidence
          </h2>
          <span className="font-mono text-[11px] text-muted-foreground">
            {run.cases.length} persisted
          </span>
        </div>
        {run.cases.map((testCase) => (
          <article className="border-t" key={testCase.id}>
            <header className="flex items-center justify-between gap-4 py-3">
              <h3 className="font-semibold">Case {testCase.position + 1}</h3>
              <span className="font-mono text-[11px] text-muted-foreground">
                {testCase.scores.length}{" "}
                {testCase.scores.length === 1 ? "score fact" : "score facts"}
              </span>
            </header>
            <div className="grid border-t lg:grid-cols-2">
              <EvaluationMarkdownValue className="lg:pr-6" label="Input" value={testCase.input} />
              <EvaluationMarkdownValue
                className="border-t lg:border-t-0 lg:border-l lg:pl-6"
                label="Target output"
                value={testCase.output}
              />
            </div>
            <div className="border-t py-5">
              <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Attributed score evidence
              </div>
              <ScoreGrid judges={run.judgeModelIds} testCase={testCase} />
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function ProvenanceDatum({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="contents">
      <div className="border-b py-2 pr-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:border-b-0 sm:border-r sm:px-3 sm:first:pl-0 lg:border-b lg:[&:nth-last-child(-n+4)]:border-b-0">
        {label}
      </div>
      <div className="min-w-0 border-b py-2 text-foreground sm:border-b-0 sm:px-3 lg:border-b lg:[&:nth-last-child(-n+4)]:border-b-0">
        {children}
      </div>
    </div>
  );
}

function ExactDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-all font-mono text-[11px] text-foreground">{value}</dd>
    </div>
  );
}

function Status({ status }: { status: EvaluationRun["status"] }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
        status === "completed" && "bg-chart-2/15 text-chart-2",
        (status === "queued" || status === "running") && "bg-chart-4/20 text-foreground",
        (status === "failed" || status === "cancelled" || status === "interrupted") &&
          "bg-destructive/10 text-destructive",
      )}
    >
      {status}
    </span>
  );
}
