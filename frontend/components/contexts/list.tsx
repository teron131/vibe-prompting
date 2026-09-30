/** Owns the context workspace navigator, creation flow, shared search, and selected-file state. */

"use client";

import { FilePlus2, LoaderCircle, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useContextSearch } from "@/components/contexts/use-search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/components/ui/utils";
import type {
  ContextSearchPassage,
  ContextSearchResult,
  ContextsResponse,
  ContextSummary,
} from "@/contracts/contexts";
import type { EvaluationRunsResponse, EvaluationRunSummary } from "@/contracts/evaluations";
import { createApiRequester, createErrorReader } from "@/shared/api";
import { formatDateTime } from "@/shared/date";

const contextApi = createApiRequester({ cache: "no-store" }, "Context request failed.");
const readError = createErrorReader("Context request failed.");
const SKILL_TEMPLATE =
  "---\nname: new-skill\ndescription: Describe when the agent should use this skill.\n---\n\n# Instructions\n\nDescribe the steps the agent should follow.\n";

export function ContextList({
  activeContextId,
  creating,
  onCreate,
  onCreatingChange,
  onContextDeleted,
  onSelectContext,
}: {
  activeContextId?: string;
  creating: boolean;
  onCreate(): void;
  onCreatingChange(value: boolean): void;
  onContextDeleted(contextId: string): void;
  onSelectContext(context: ContextSummary, passage?: ContextSearchPassage): void;
}) {
  const [contexts, setContexts] = useState<ContextSummary[]>([]);
  const [runs, setRuns] = useState<EvaluationRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingContextId, setDeletingContextId] = useState<string>();
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState(SKILL_TEMPLATE);
  const [kind, setKind] = useState<"prompt" | "skill">("skill");
  const [query, setQuery] = useState("");

  const loadContexts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await contextApi.json<ContextsResponse>("/api/contexts");
      setContexts(data.contexts);
    } catch (error) {
      toast.error(readError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const data = await contextApi.json<EvaluationRunsResponse>("/api/evaluations");
      setRuns(data.runs);
    } catch {
      setRuns([]);
    }
  }, []);

  useEffect(() => {
    void loadContexts();
    void loadRuns();
  }, [loadContexts, loadRuns]);

  useEffect(() => {
    const refresh = () => void loadContexts();
    window.addEventListener("context-saved", refresh);
    return () => window.removeEventListener("context-saved", refresh);
  }, [loadContexts]);

  const hasQuery = Boolean(query.trim());
  const {
    error: searchError,
    loading: searchLoading,
    results: searchResults,
  } = useContextSearch({ enabled: hasQuery, limit: 50, contexts, query });
  const visibleContexts: Array<ContextSummary | ContextSearchResult> = hasQuery
    ? searchResults
    : contexts;

  async function createContext(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const context = await contextApi.json<ContextSummary>("/api/contexts", {
        body: JSON.stringify({ markdown, title }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      onCreatingChange(false);
      setTitle("");
      setMarkdown(kind === "skill" ? SKILL_TEMPLATE : "");
      await loadContexts();
      onSelectContext(context);
      toast.success(kind === "skill" ? "Skill created." : "Context created.");
    } catch (error) {
      toast.error(readError(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteContext(context: ContextSummary) {
    if (
      !window.confirm(
        `Delete “${context.title}”? This permanently deletes every version and all linked evaluations.`,
      )
    )
      return;
    setDeletingContextId(context.id);
    try {
      await contextApi.json<{ contextId: string }>(`/api/contexts/${context.id}`, {
        body: JSON.stringify({ expectedActiveRevisionId: context.activeRevisionId }),
        headers: { "content-type": "application/json" },
        method: "DELETE",
      });
      setContexts((current) => current.filter(({ id }) => id !== context.id));
      setRuns((current) => current.filter(({ contextId }) => contextId !== context.id));
      onContextDeleted(context.id);
    } catch (error) {
      toast.error(readError(error));
    } finally {
      setDeletingContextId(undefined);
    }
  }

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-r bg-card/30 lg:w-80 lg:shrink-0">
      {creating ? (
        <form className="space-y-3 border-b bg-background p-4" onSubmit={createContext}>
          <label className="block text-sm font-medium">
            Create
            <Select
              aria-label="Document type"
              className="mt-1 w-full"
              value={kind}
              onValueChange={(value) => {
                const next = value as "prompt" | "skill";
                setKind(next);
                setMarkdown(next === "skill" ? SKILL_TEMPLATE : "");
              }}
            >
              <option value="skill">Skill</option>
              <option value="prompt">Prompt</option>
            </Select>
          </label>
          <label className="block text-sm font-medium">
            Title
            <Input
              className="mt-1"
              onChange={(event) => setTitle(event.target.value)}
              placeholder={kind === "skill" ? "Skill title" : "Markdown explainer"}
              value={title}
            />
          </label>
          <label className="block text-sm font-medium">
            {kind === "skill" ? "SKILL.md" : "Initial Markdown"}
            <Textarea
              className="mt-1 min-h-44 font-mono"
              onChange={(event) => setMarkdown(event.target.value)}
              placeholder="# Role\n\nYou are..."
              value={markdown}
            />
          </label>
          {kind === "skill" ? (
            <p className="text-xs leading-5 text-muted-foreground">
              {
                "The name and description tell the agent when to read this skill. Edit the starter, then save and evaluate it."
              }
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button disabled={submitting} onClick={() => onCreatingChange(false)} variant="ghost">
              Cancel
            </Button>
            <Button disabled={submitting || !title.trim()} type="submit">
              {submitting ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : null}
              Create {kind}
            </Button>
          </div>
        </form>
      ) : null}
      <div className="border-b p-3">
        <div className="flex items-center gap-2">
          {contexts.length ? (
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search contexts</span>
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
                placeholder="Search contexts"
                value={query}
              />
              {query ? (
                <button
                  aria-label="Clear context search"
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
        {contexts.length && searchError ? (
          <p className="mt-2 text-xs text-muted-foreground">Showing name matches.</p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <ContextSkeleton />
        ) : contexts.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <FilePlus2 aria-hidden="true" className="mx-auto size-5 text-muted-foreground" />
            <h3 className="mt-3 text-sm font-medium">No Context Files Yet</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Create one to start a versioned workspace.
            </p>
          </div>
        ) : visibleContexts.length ? (
          <div className="space-y-1">
            {visibleContexts.map((context) => (
              <ContextRow
                active={context.id === activeContextId}
                deleting={deletingContextId === context.id}
                key={context.id}
                latestRun={runs.find(({ contextId }) => contextId === context.id)}
                onDelete={() => void deleteContext(context)}
                onSelect={(passage) => onSelectContext(context, passage)}
                context={context}
                query={query}
              />
            ))}
          </div>
        ) : (
          <div className="px-4 py-10 text-center">
            <Search aria-hidden="true" className="mx-auto size-5 text-muted-foreground" />
            <h3 className="mt-3 text-sm font-medium">No Matching Contexts</h3>
            <p className="mt-1 text-xs text-muted-foreground">Try a different name or phrase.</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function ContextRow({
  active,
  deleting,
  latestRun,
  onDelete,
  onSelect,
  context,
  query,
}: {
  active: boolean;
  deleting: boolean;
  latestRun?: EvaluationRunSummary;
  onDelete(): void;
  onSelect(passage?: ContextSearchPassage): void;
  context: ContextSummary & { passages?: ContextSearchPassage[] };
  query: string;
}) {
  const updated = formatDateTime(context.updatedAt);
  const passages = context.passages ?? [];
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
            <h3 className="truncate text-sm font-medium">{context.title}</h3>
            <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
              {context.skill ? "Skill" : "Prompt"}
            </span>
            {latestRun ? (
              <span className="shrink-0 whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-[10px] capitalize text-muted-foreground">
                Eval {latestRun.status}
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
            <span className={cn("font-medium", active && "text-foreground")}>
              v{context.revisionNumber}
            </span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{updated}</span>
          </div>
        </div>
      </button>
      <button
        aria-label={`Delete ${context.title}`}
        className="absolute right-1.5 top-2 grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        disabled={deleting}
        onClick={onDelete}
        title="Delete context"
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
              aria-label={`Open matching passage in ${context.title}`}
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

function ContextSkeleton() {
  return (
    <div aria-label="Loading contexts" className="space-y-1">
      {[0, 1, 2].map((item) => (
        <div className="h-16 animate-pulse rounded-lg bg-secondary" key={item} />
      ))}
    </div>
  );
}
