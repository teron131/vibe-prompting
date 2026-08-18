/** Owns current prompt editing, preview, conflict-safe immutable saves, dirty navigation guards, and revision inspection. */

"use client";

import {
  ArrowLeft,
  Code2,
  Eye,
  GitCompareArrows,
  LoaderCircle,
  MessageSquareText,
  Save,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { RevisionTrend } from "@/components/evaluations/revision-trend";
import { MarkdownPreview } from "@/components/prompts/prompt-artifact";
import { PromptDiff } from "@/components/prompts/prompt-diff";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/components/ui/utils";
import type {
  BooleanTrendPoint,
  EvaluationRunResponse,
  EvaluationRunsResponse,
  EvaluationRunSummary,
} from "@/contracts/evaluations";
import type { PromptDetail, PromptRevision, PromptSummary } from "@/contracts/prompts";

export function PromptEditor({ promptId }: { promptId: string }) {
  const [detail, setDetail] = useState<PromptDetail>();
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState(false);
  const [selectedRevisionId, setSelectedRevisionId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [runs, setRuns] = useState<EvaluationRunSummary[]>([]);
  const [trend, setTrend] = useState<BooleanTrendPoint[]>([]);
  const dirty = Boolean(detail && draft !== detail.prompt.markdown);

  const load = useCallback(async () => {
    const [value, runData] = await Promise.all([
      fetchJson<PromptDetail>(`/api/prompts/${promptId}`),
      fetchJson<EvaluationRunsResponse>(
        `/api/evaluations?promptId=${encodeURIComponent(promptId)}`,
      ),
    ]);
    setDetail(value);
    setDraft(value.prompt.markdown);
    setSelectedRevisionId(value.prompt.revisionId);
    setRuns(runData.runs);
    setTrend(await loadCompatibleTrend(runData.runs));
    setError(undefined);
  }, [promptId]);

  useEffect(() => {
    void load().catch((cause) => setError(readError(cause)));
  }, [load]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    const guardLinks = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (target && !window.confirm("Discard the unsaved prompt draft?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", guardLinks, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", guardLinks, true);
    };
  }, [dirty]);

  async function save() {
    if (!detail || !dirty || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const prompt = await fetchJson<PromptSummary>(`/api/prompts/${promptId}`, {
        body: JSON.stringify({ expectedRevisionId: detail.prompt.revisionId, markdown: draft }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      await load();
      setSelectedRevisionId(prompt.revisionId);
      toast.success("Prompt revision saved.");
    } catch (cause) {
      const message = readError(cause);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const selectedRevision = detail?.revisions.find(({ id }) => id === selectedRevisionId);
  const parentRevision = detail?.revisions.find(
    ({ id }) => id === selectedRevision?.parentRevisionId,
  );
  const selectedDate = selectedRevision ? formatDate(selectedRevision.createdAt) : "";

  if (!detail && !error)
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <LoaderCircle
          aria-label="Loading prompt"
          className="size-5 animate-spin text-muted-foreground"
        />
      </div>
    );
  if (!detail)
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            href="/prompts"
          >
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            Prompt library
          </Link>
          <h2 className="text-xl font-semibold">{detail.prompt.title}</h2>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="font-mono">Current {detail.prompt.revisionId.slice(0, 8)}</span>
            <span>{detail.prompt.revisionCount} revisions</span>
            <span>Edited {formatDate(detail.prompt.updatedAt)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-accent"
            href={`/?prompt=${promptId}`}
          >
            <MessageSquareText aria-hidden="true" className="size-4" />
            Open in chat
          </Link>
          <Button disabled={!dirty || saving} onClick={save}>
            {saving ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Save aria-hidden="true" className="size-4" />
            )}
            Save revision
          </Button>
        </div>
      </div>
      {error ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="text-sm font-medium">
            Current Markdown{" "}
            {dirty ? <span className="ml-2 text-xs text-chart-4">Unsaved</span> : null}
          </div>
          <Button onClick={() => setPreview((value) => !value)} size="sm" variant="ghost">
            {preview ? (
              <Code2 aria-hidden="true" className="size-4" />
            ) : (
              <Eye aria-hidden="true" className="size-4" />
            )}
            {preview ? "Source" : "Preview"}
          </Button>
        </div>
        {preview ? (
          <MarkdownPreview className="min-h-96 p-5 sm:p-7" markdown={draft} />
        ) : (
          <Textarea
            aria-label="Prompt Markdown"
            className="min-h-[32rem] resize-y rounded-none border-0 p-5 font-mono shadow-none focus-visible:outline-none sm:p-7"
            onChange={(event) => setDraft(event.target.value)}
            value={draft}
          />
        )}
      </section>
      <section className="mt-6 grid gap-5 lg:grid-cols-[18rem_1fr]">
        <div>
          <h3 className="mb-2 text-sm font-semibold">Revision history</h3>
          <div className="overflow-hidden rounded-xl border bg-card">
            {detail.revisions.map((revision) => (
              <RevisionButton
                active={revision.id === selectedRevisionId}
                key={revision.id}
                onClick={() => setSelectedRevisionId(revision.id)}
                revision={revision}
              />
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center gap-2">
            <GitCompareArrows aria-hidden="true" className="size-4" />
            <h3 className="text-sm font-semibold">Adjacent revision diff</h3>
          </div>
          {selectedRevision ? (
            <div>
              <div className="mb-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-full bg-secondary px-2 py-1 capitalize">
                  {selectedRevision.source}
                </span>
                <span>{selectedDate}</span>
                {selectedRevision.changeRequest ? (
                  <span>{selectedRevision.changeRequest}</span>
                ) : null}
              </div>
              <PromptDiff
                after={selectedRevision.markdown}
                before={parentRevision?.markdown ?? ""}
              />
            </div>
          ) : null}
        </div>
      </section>
      <section className="mt-6 grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">Evaluation runs</h3>
          {runs.length ? (
            <div className="divide-y overflow-hidden rounded-xl border bg-card">
              {runs.map((run) => (
                <Link
                  className="flex items-center justify-between gap-3 p-3 text-sm hover:bg-accent"
                  href={`/evaluations/${run.id}`}
                  key={run.id}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{run.targetModelId}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Revision {run.promptRevisionId.slice(0, 8)} · {run.caseCount}{" "}
                      {run.caseCount === 1 ? "case" : "cases"} ·{" "}
                      {formatDate(run.completedAt ?? run.createdAt)}
                    </span>
                  </span>
                  <span className="rounded-full bg-secondary px-2 py-1 text-[10px] capitalize">
                    {run.status}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
              No evaluation runs are attached to this prompt yet.
            </div>
          )}
        </div>
        <RevisionTrend points={trend} />
      </section>
    </div>
  );
}

function RevisionButton({
  active,
  onClick,
  revision,
}: {
  active: boolean;
  onClick(): void;
  revision: PromptRevision;
}) {
  return (
    <button
      className={cn(
        "block w-full border-b px-3 py-3 text-left text-xs last:border-0 hover:bg-accent",
        active && "bg-accent",
      )}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono font-medium">{revision.id.slice(0, 8)}</span>
        <span className="capitalize text-muted-foreground">{revision.source}</span>
      </div>
      <div className="mt-1 truncate text-muted-foreground">
        {revision.changeRequest ?? "Initial prompt"}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">{formatDate(revision.createdAt)}</div>
    </button>
  );
}

async function loadCompatibleTrend(runs: EvaluationRunSummary[]): Promise<BooleanTrendPoint[]> {
  const completed = runs.filter(({ status }) => status === "completed");
  const counts = new Map<string, number>();
  for (const run of completed) {
    counts.set(run.configurationFingerprint, (counts.get(run.configurationFingerprint) ?? 0) + 1);
  }
  const seen = new Set<string>();
  const candidates = completed.filter((run) => {
    if ((counts.get(run.configurationFingerprint) ?? 0) < 2) return false;
    if (seen.has(run.configurationFingerprint)) return false;
    seen.add(run.configurationFingerprint);
    return true;
  });
  const responses = await Promise.all(
    candidates.map(({ id }) => fetchJson<EvaluationRunResponse>(`/api/evaluations/${id}`)),
  );
  return responses.find(({ trend }) => trend.length >= 2)?.trend ?? [];
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
    throw new Error(typeof body.error === "string" ? body.error : "Prompt request failed.");
  }
  return (await response.json()) as T;
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Prompt request failed.";
}
