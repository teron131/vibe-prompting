/** Owns saved prompt listing, creation, empty and storage-error states, and prompt-oriented navigation actions. */

"use client";

import { ArrowRight, FilePlus2, LoaderCircle, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { EvaluationRunsResponse, EvaluationRunSummary } from "@/contracts/evaluations";
import type { PromptsResponse, PromptSummary } from "@/contracts/prompts";

export function PromptList() {
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [runs, setRuns] = useState<EvaluationRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, runData] = await Promise.all([
        fetchJson<PromptsResponse>("/api/prompts"),
        fetchJson<EvaluationRunsResponse>("/api/evaluations"),
      ]);
      setPrompts(data.prompts);
      setRuns(runData.runs);
    } catch (error) {
      toast.error(readError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createPrompt(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await fetchJson<PromptSummary>("/api/prompts", {
        body: JSON.stringify({ markdown, title }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      setCreating(false);
      setTitle("");
      setMarkdown("");
      await load();
      toast.success("Prompt created.");
    } catch (error) {
      toast.error(readError(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Prompt library</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Durable prompt artifacts with immutable revision history.
          </p>
        </div>
        <Button onClick={() => setCreating((value) => !value)}>
          <FilePlus2 aria-hidden="true" className="size-4" />
          New prompt
        </Button>
      </div>
      {creating ? (
        <form className="mb-5 space-y-3 rounded-xl border bg-card p-4" onSubmit={createPrompt}>
          <label className="block text-sm font-medium">
            Title
            <Input
              className="mt-1"
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Customer support assistant"
              value={title}
            />
          </label>
          <label className="block text-sm font-medium">
            Initial Markdown
            <Textarea
              className="mt-1 min-h-44 font-mono"
              onChange={(event) => setMarkdown(event.target.value)}
              placeholder="# Role\n\nYou are..."
              value={markdown}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button disabled={submitting} onClick={() => setCreating(false)} variant="ghost">
              Cancel
            </Button>
            <Button disabled={submitting || !title.trim()} type="submit">
              {submitting ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : null}
              Create prompt
            </Button>
          </div>
        </form>
      ) : null}
      {loading ? (
        <PromptSkeleton />
      ) : prompts.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <FilePlus2 aria-hidden="true" className="mx-auto size-6 text-muted-foreground" />
          <h3 className="mt-3 font-medium">No saved prompts yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Create the first prompt artifact to begin an Operator chat or evaluation.
          </p>
        </div>
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {prompts.map((prompt) => (
            <PromptRow
              key={prompt.id}
              latestRun={runs.find(({ promptId }) => promptId === prompt.id)}
              prompt={prompt}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PromptRow({
  latestRun,
  prompt,
}: {
  latestRun?: EvaluationRunSummary;
  prompt: PromptSummary;
}) {
  const updated = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(prompt.updatedAt));
  return (
    <article className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-medium">{prompt.title}</h3>
          {latestRun ? (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] capitalize text-muted-foreground">
              Eval {latestRun.status}
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="font-mono">{prompt.revisionId.slice(0, 8)}</span>
          <span>
            {prompt.revisionCount} {prompt.revisionCount === 1 ? "revision" : "revisions"}
          </span>
          <span>Edited {updated}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-accent"
          href={`/?prompt=${prompt.id}`}
        >
          <MessageSquareText aria-hidden="true" className="size-4" />
          Open in chat
        </Link>
        <Link
          className="inline-flex size-9 items-center justify-center rounded-md border hover:bg-accent"
          href={`/prompts/${prompt.id}`}
          aria-label={`Open ${prompt.title}`}
        >
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </article>
  );
}

function PromptSkeleton() {
  return (
    <div aria-label="Loading prompts" className="space-y-2">
      {[0, 1, 2].map((item) => (
        <div className="h-20 animate-pulse rounded-xl bg-secondary" key={item} />
      ))}
    </div>
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
