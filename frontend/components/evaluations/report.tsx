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

import { MarkdownPreview } from "@/components/prompts/artifact";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/utils";
import type {
  BooleanTrendPoint,
  EvaluationRun,
  EvaluationRunResponse,
  EvaluationRunSummary,
} from "@/contracts/evaluations";
import type { PromptDetail } from "@/contracts/prompts";

import { RevisionTrend } from "./revision-trend";
import { ScoreGrid } from "./score-grid";

export function EvaluationReport({ runId }: { runId: string }) {
  const [run, setRun] = useState<EvaluationRun>();
  const [trend, setTrend] = useState<BooleanTrendPoint[]>([]);
  const [view, setView] = useState<"prompt" | "results">("results");
  const [source, setSource] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    const data = await fetchJson<EvaluationRunResponse>(`/api/evaluations/${runId}`);
    setRun(data.run);
    setTrend(data.trend);
    setError(undefined);
    return data.run.status;
  }, [runId]);

  useEffect(() => {
    void load().catch((cause) => setError(readError(cause)));
  }, [load]);
  useEffect(() => {
    if (run?.status !== "running") return;
    const timer = window.setInterval(() => {
      void load()
        .then((status) => {
          if (status !== "running") window.clearInterval(timer);
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
      const prompt = await fetchJson<PromptDetail>(`/api/prompts/${run.promptId}`);
      const next = await fetchJson<EvaluationRunSummary>("/api/evaluations", {
        body: JSON.stringify({
          cases: run.cases.map(({ criteria, input }) => ({ criteria, input })),
          judges: run.judgeModelIds,
          promptId: run.promptId,
          promptRevisionId: prompt.prompt.revisionId,
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
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            href="/evaluations"
          >
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            Evaluation workbench
          </Link>
          <h2 className="text-xl font-semibold">{run.promptTitle}</h2>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Status status={run.status} />
            <span>{run.source === "ai" ? "AI" : "Human"}</span>
            <span>{run.targetProfileName ?? "Legacy runtime"}</span>
            {run.targetProfileRevisionId ? (
              <span className="font-mono">Runtime {run.targetProfileRevisionId.slice(0, 8)}</span>
            ) : null}
            <span className="font-mono">Revision {run.promptRevisionId.slice(0, 8)}</span>
            <span>{formatDate(run.completedAt ?? run.createdAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {run.chatId ? (
            <Link
              className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-accent"
              href={`/chat/${run.chatId}`}
            >
              <MessageSquareText aria-hidden="true" className="size-4" />
              Producing chat
            </Link>
          ) : null}
          {run.status === "failed" || run.status === "interrupted" ? (
            <Button onClick={retry} variant="outline">
              <RotateCcw aria-hidden="true" className="size-4" />
              Retry current revision
            </Button>
          ) : null}
        </div>
      </div>
      <section className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Status" value={run.status} />
        <Metric
          label="Completed cases"
          value={`${run.cases.filter(({ output }) => output !== null).length}/${run.caseCount}`}
        />
        <Metric label="Judges" value={String(run.judgeModelIds.length)} />
        <Metric
          label="Score facts"
          value={
            scoreCounts.length
              ? scoreCounts.map(([type, count]) => `${type.toLowerCase()} ${count}`).join(" · ")
              : "None yet"
          }
        />
      </section>
      <div className="mb-5 flex border-b">
        <button
          className={cn(
            "border-b-2 px-4 py-2 text-sm font-medium",
            view === "results" ? "border-primary" : "border-transparent text-muted-foreground",
          )}
          onClick={() => setView("results")}
          type="button"
        >
          <FlaskConical aria-hidden="true" className="mr-2 inline size-4" />
          Results
        </button>
        <button
          className={cn(
            "border-b-2 px-4 py-2 text-sm font-medium",
            view === "prompt" ? "border-primary" : "border-transparent text-muted-foreground",
          )}
          onClick={() => setView("prompt")}
          type="button"
        >
          <FileText aria-hidden="true" className="mr-2 inline size-4" />
          Prompt artifact
        </button>
      </div>
      {view === "prompt" ? (
        <section className="rounded-xl border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <div className="text-sm font-medium">Exact evaluated revision</div>
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
            <pre className="min-h-96 whitespace-pre-wrap break-words p-5 font-mono text-sm leading-6 sm:p-7">
              {run.promptMarkdown}
            </pre>
          ) : (
            <MarkdownPreview className="min-h-96 p-5 sm:p-7" markdown={run.promptMarkdown} />
          )}
        </section>
      ) : (
        <Results run={run} trend={trend} />
      )}
    </div>
  );
}

function Results({ run, trend }: { run: EvaluationRun; trend: BooleanTrendPoint[] }) {
  if (run.status === "running")
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <LoaderCircle
          aria-hidden="true"
          className="mx-auto size-5 animate-spin text-muted-foreground"
        />
        <h3 className="mt-3 font-medium">Evaluation is running</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          The durable attempt is safe to leave; this report will continue polling.
        </p>
      </div>
    );
  if (run.status === "failed" || run.status === "interrupted")
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5">
        <h3 className="font-medium capitalize">{run.status} evaluation</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {run.errorMessage ?? "No provider result or score was persisted."}
        </p>
      </div>
    );
  return (
    <div className="space-y-5">
      <RevisionTrend points={trend} />
      {run.cases.map((testCase) => (
        <section className="rounded-xl border bg-card p-4 sm:p-5" key={testCase.id}>
          <h3 className="font-semibold">Case {testCase.position + 1}</h3>
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            <ValueBlock label="Input" value={testCase.input} />
            <ValueBlock label="Target output" value={testCase.output} />
          </div>
          <div className="mt-5">
            <ScoreGrid judges={run.judgeModelIds} testCase={testCase} />
          </div>
        </section>
      ))}
    </div>
  );
}

function ValueBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      <div className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-secondary/60 p-3 text-sm">
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </div>
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-medium capitalize leading-5" title={value}>
        {value}
      </div>
    </div>
  );
}
function Status({ status }: { status: EvaluationRun["status"] }) {
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
function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}
async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: "no-store", ...init });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: unknown };
    throw new Error(
      typeof body.error === "string" ? body.error : "Evaluation report request failed.",
    );
  }
  return (await response.json()) as T;
}
function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Evaluation report request failed.";
}
