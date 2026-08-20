/** Owns the prompt workspace navigator, creation flow, shared search, and selected-file state. */

"use client";

import { FilePlus2, LoaderCircle, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { usePromptSearch } from "@/components/prompts/use-search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/components/ui/utils";
import type { EvaluationRunsResponse, EvaluationRunSummary } from "@/contracts/evaluations";
import type {
  PromptSearchPassage,
  PromptSearchResult,
  PromptsResponse,
  PromptSummary,
} from "@/contracts/prompts";
import { createApiRequester, createErrorReader } from "@/shared/api";

const promptApi = createApiRequester({ cache: "no-store" }, "Prompt request failed.");
const readError = createErrorReader("Prompt request failed.");

export function PromptList({
  activePromptId,
  creating,
  onCreate,
  onCreatingChange,
  onPromptDeleted,
  onSelectPrompt,
}: {
  activePromptId?: string;
  creating: boolean;
  onCreate(): void;
  onCreatingChange(value: boolean): void;
  onPromptDeleted(promptId: string): void;
  onSelectPrompt(prompt: PromptSummary, passage?: PromptSearchPassage): void;
}) {
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [runs, setRuns] = useState<EvaluationRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingPromptId, setDeletingPromptId] = useState<string>();
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [query, setQuery] = useState("");

  const loadPrompts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await promptApi.json<PromptsResponse>("/api/prompts");
      setPrompts(data.prompts);
    } catch (error) {
      toast.error(readError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const data = await promptApi.json<EvaluationRunsResponse>("/api/evaluations");
      setRuns(data.runs);
    } catch {
      setRuns([]);
    }
  }, []);

  useEffect(() => {
    void loadPrompts();
    void loadRuns();
  }, [loadPrompts, loadRuns]);

  const hasQuery = Boolean(query.trim());
  const {
    error: searchError,
    loading: searchLoading,
    results: searchResults,
  } = usePromptSearch({ enabled: hasQuery, limit: 50, prompts, query });
  const visiblePrompts: Array<PromptSummary | PromptSearchResult> = hasQuery
    ? searchResults
    : prompts;

  async function createPrompt(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const prompt = await promptApi.json<PromptSummary>("/api/prompts", {
        body: JSON.stringify({ markdown, title }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      onCreatingChange(false);
      setTitle("");
      setMarkdown("");
      await loadPrompts();
      onSelectPrompt(prompt);
      toast.success("Prompt created.");
    } catch (error) {
      toast.error(readError(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function deletePrompt(prompt: PromptSummary) {
    if (
      !window.confirm(
        `Delete “${prompt.title}”? This permanently deletes every version and all linked evaluations.`,
      )
    )
      return;
    setDeletingPromptId(prompt.id);
    try {
      await promptApi.json<{ promptId: string }>(`/api/prompts/${prompt.id}`, {
        body: JSON.stringify({ expectedRevisionId: prompt.revisionId }),
        headers: { "content-type": "application/json" },
        method: "DELETE",
      });
      setPrompts((current) => current.filter(({ id }) => id !== prompt.id));
      setRuns((current) => current.filter(({ promptId }) => promptId !== prompt.id));
      onPromptDeleted(prompt.id);
    } catch (error) {
      toast.error(readError(error));
    } finally {
      setDeletingPromptId(undefined);
    }
  }

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-r bg-card/30 lg:w-80 lg:shrink-0">
      {creating ? (
        <form className="space-y-3 border-b bg-background p-4" onSubmit={createPrompt}>
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
            <Button disabled={submitting} onClick={() => onCreatingChange(false)} variant="ghost">
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
      <div className="border-b p-3">
        <div className="flex items-center gap-2">
          {prompts.length ? (
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search prompts</span>
              {searchLoading ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
                />
              ) : (
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
              )}
              <Input
                className="h-10 bg-background pl-9 pr-10"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search prompts"
                value={query}
              />
              {query ? (
                <button
                  aria-label="Clear prompt search"
                  className="absolute right-1 top-1 grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => setQuery("")}
                  type="button"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              ) : null}
            </label>
          ) : (
            <div className="flex-1" />
          )}
          <Button onClick={onCreate} size="sm">
            <FilePlus2 aria-hidden="true" className="size-3.5" />
            New
          </Button>
        </div>
        {prompts.length && searchError ? (
          <p className="mt-2 text-xs text-muted-foreground">Showing name matches.</p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <PromptSkeleton />
        ) : prompts.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <FilePlus2 aria-hidden="true" className="mx-auto size-5 text-muted-foreground" />
            <h3 className="mt-3 text-sm font-medium">No prompt files yet</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Create one to start a versioned workspace.
            </p>
          </div>
        ) : visiblePrompts.length ? (
          <div className="space-y-1">
            {visiblePrompts.map((prompt) => (
              <PromptRow
                active={prompt.id === activePromptId}
                deleting={deletingPromptId === prompt.id}
                key={prompt.id}
                latestRun={runs.find(({ promptId }) => promptId === prompt.id)}
                onDelete={() => void deletePrompt(prompt)}
                onSelect={(passage) => onSelectPrompt(prompt, passage)}
                prompt={prompt}
                query={query}
              />
            ))}
          </div>
        ) : (
          <div className="px-4 py-10 text-center">
            <Search aria-hidden="true" className="mx-auto size-5 text-muted-foreground" />
            <h3 className="mt-3 text-sm font-medium">No matching prompts</h3>
            <p className="mt-1 text-xs text-muted-foreground">Try a different name or phrase.</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function PromptRow({
  active,
  deleting,
  latestRun,
  onDelete,
  onSelect,
  prompt,
  query,
}: {
  active: boolean;
  deleting: boolean;
  latestRun?: EvaluationRunSummary;
  onDelete(): void;
  onSelect(passage?: PromptSearchPassage): void;
  prompt: PromptSummary & { passages?: PromptSearchPassage[] };
  query: string;
}) {
  const updated = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(prompt.updatedAt));
  const passages = prompt.passages ?? [];
  return (
    <div className={cn("relative overflow-hidden rounded-lg", active && "bg-accent")}>
      <button
        aria-current={active ? "page" : undefined}
        className="block min-h-16 w-full py-2.5 pl-3 pr-11 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => onSelect(passages[0])}
        type="button"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-medium">{prompt.title}</h3>
            {latestRun ? (
              <span className="shrink-0 whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-[10px] capitalize text-muted-foreground">
                Eval {latestRun.status}
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
            <span className={cn("font-medium", active && "text-foreground")}>
              v{prompt.revisionNumber}
            </span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{updated}</span>
          </div>
        </div>
      </button>
      <button
        aria-label={`Delete ${prompt.title}`}
        className="absolute right-1.5 top-2 grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        disabled={deleting}
        onClick={onDelete}
        title="Delete prompt"
        type="button"
      >
        {deleting ? (
          <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
        ) : (
          <Trash2 aria-hidden="true" className="size-3.5" />
        )}
      </button>
      {passages.length ? (
        <div className="space-y-1 border-t border-border/60 px-2 py-2">
          {passages.map((passage) => (
            <button
              aria-label={`Open matching passage in ${prompt.title}`}
              className="block w-full rounded-md px-2 py-1.5 text-left text-xs leading-4 text-muted-foreground hover:bg-background/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              key={`${passage.start}:${passage.end}`}
              onClick={() => onSelect(passage)}
              type="button"
            >
              <span className="line-clamp-3">
                <HighlightedPassage query={query} text={passage.text} />
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HighlightedPassage({ query, text }: { query: string; text: string }) {
  const terms = [
    ...new Set(
      query
        .trim()
        .split(/\s+/u)
        .filter((term) => term.length > 1),
    ),
  ];
  if (!terms.length) return text;
  const pattern = new RegExp(`(${terms.map(escapeRegularExpression).join("|")})`, "giu");
  const matches = new Set(terms.map((term) => term.toLocaleLowerCase()));
  return text.split(pattern).map((part, index) =>
    matches.has(part.toLocaleLowerCase()) ? (
      <mark className="bg-transparent font-semibold text-foreground" key={`${part}:${index}`}>
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function PromptSkeleton() {
  return (
    <div aria-label="Loading prompts" className="space-y-1">
      {[0, 1, 2].map((item) => (
        <div className="h-16 animate-pulse rounded-lg bg-secondary" key={item} />
      ))}
    </div>
  );
}
