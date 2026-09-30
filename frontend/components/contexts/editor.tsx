/** Owns context reading, editing, preview, conflict-safe immutable saves, dirty navigation guards, and revision inspection. */

"use client";

import { GitCompareArrows, History, LoaderCircle, Save } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createSkillMarkdown, readSkillMetadata, type SkillMetadata } from "vibe-prompting/skills";

import { contextRevisionAuthorLabel } from "@/components/contexts/revision-author";
import { ContextStats } from "@/components/contexts/stats";
import { ContextViewModeControl } from "@/components/contexts/view-mode-control";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/components/ui/utils";
import type {
  ContextDetail,
  ContextEditorSnapshot,
  ContextRevisionResponse,
  ContextRevisionSummary,
  ContextSearchPassage,
} from "@/contracts/contexts";
import type {
  BooleanTrendPoint,
  EvaluationRun,
  EvaluationRunResponse,
  EvaluationRunsResponse,
  EvaluationRunSummary,
} from "@/contracts/evaluations";
import { ApiRequestError, createApiRequester, createErrorReader } from "@/shared/api";
import { formatDateTime } from "@/shared/date";

const contextApi = createApiRequester({ cache: "no-store" }, "Context request failed.");
const readError = createErrorReader("Context request failed.");
const DeferredView = () => (
  <div className="grid min-h-48 place-items-center">
    <LoaderCircle aria-label="Loading view" className="size-5 animate-spin text-muted-foreground" />
  </div>
);
const MarkdownPreview = dynamic(
  () =>
    import("@/components/contexts/markdown-preview").then(({ MarkdownPreview }) => MarkdownPreview),
  { loading: DeferredView },
);
const ContextDiff = dynamic(
  () => import("@/components/contexts/diff").then(({ ContextDiff }) => ContextDiff),
  { loading: DeferredView },
);
const ContextEvaluationView = dynamic(
  () =>
    import("@/components/contexts/evaluation-view").then(
      ({ ContextEvaluationView }) => ContextEvaluationView,
    ),
  { loading: DeferredView },
);

export function ContextEditor({
  onDirtyChange,
  contextId,
  selectedPassage,
}: {
  onDirtyChange?(dirty: boolean): void;
  contextId: string;
  selectedPassage?: ContextSearchPassage;
}) {
  const [detail, setDetail] = useState<ContextDetail>();
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"edit" | "preview" | "read">("edit");
  const [view, setView] = useState<"edit" | "evaluations" | "history">("edit");
  const [selectedRevisionId, setSelectedRevisionId] = useState("");
  const [selectedRevision, setSelectedRevision] = useState<ContextRevisionResponse>();
  const [revisionLoading, setRevisionLoading] = useState(false);
  const [revisionError, setRevisionError] = useState<string>();
  const [revisionRequest, setRevisionRequest] = useState(0);
  const [saving, setSaving] = useState(false);
  const [activatingRevisionId, setActivatingRevisionId] = useState<string>();
  const [error, setError] = useState<string>();
  const [staleWrite, setStaleWrite] = useState(false);
  const [loadingLatest, setLoadingLatest] = useState(false);
  const [runs, setRuns] = useState<EvaluationRunSummary[]>([]);
  const [trend, setTrend] = useState<BooleanTrendPoint[]>([]);
  const [latestRun, setLatestRun] = useState<EvaluationRun>();
  const [latestRunLoading, setLatestRunLoading] = useState(false);
  const [latestRunError, setLatestRunError] = useState<string>();
  const [latestRunRequest, setLatestRunRequest] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dirty = Boolean(detail && draft !== detail.context.markdown);

  const loadContext = useCallback(
    async ({ preserveDraft = false } = {}) => {
      const value = await contextApi.json<ContextDetail>(`/api/contexts/${contextId}`);
      setDetail(value);
      if (!preserveDraft) setDraft(value.context.markdown);
      setSelectedRevisionId(value.context.revisionId);
      setError(undefined);
      setStaleWrite(false);
    },
    [contextId],
  );

  const loadRuns = useCallback(async () => {
    try {
      const value = await contextApi.json<EvaluationRunsResponse>(
        `/api/evaluations?contextId=${encodeURIComponent(contextId)}`,
      );
      setRuns(value.runs);
      setLatestRunError(undefined);
    } catch (cause) {
      setRuns([]);
      setLatestRunError(readError(cause));
    }
  }, [contextId]);

  useEffect(() => {
    void loadContext().catch((cause) => setError(readError(cause)));
    void loadRuns();
  }, [loadContext, loadRuns]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (
      !detail ||
      !selectedPassage ||
      selectedPassage.revisionId !== detail.context.revisionId ||
      dirty
    )
      return;
    if (view !== "edit" || mode !== "edit") {
      setView("edit");
      setMode("edit");
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = Math.min(selectedPassage.start, textarea.value.length);
      const end = Math.min(Math.max(selectedPassage.end, start), textarea.value.length);
      textarea.focus();
      textarea.setSelectionRange(start, end);
      scrollTextareaToOffset(textarea, start);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [detail, dirty, mode, selectedPassage, view]);

  useEffect(() => {
    if (!selectedRevisionId) return;
    const controller = new AbortController();
    setRevisionLoading(true);
    setRevisionError(undefined);
    void contextApi
      .json<ContextRevisionResponse>(`/api/contexts/${contextId}/revisions/${selectedRevisionId}`, {
        signal: controller.signal,
      })
      .then((value) => setSelectedRevision(value))
      .catch((cause) => {
        if (!controller.signal.aborted) setRevisionError(readError(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setRevisionLoading(false);
      });
    return () => controller.abort();
  }, [contextId, revisionRequest, selectedRevisionId]);

  const latestRunId = runs[0]?.id;
  useEffect(() => {
    if (!latestRunId) {
      setLatestRun(undefined);
      setTrend([]);
      return;
    }
    let cancelled = false;
    let polling = false;
    let timer: number | undefined;
    const intervalMs = 1500;
    setLatestRunLoading(true);
    setLatestRunError(undefined);
    const schedule = (delay = intervalMs) => {
      if (cancelled || document.hidden) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        void refresh();
      }, delay);
    };
    const refresh = async () => {
      if (polling || document.hidden) return;
      polling = true;
      const startedAt = performance.now();
      try {
        const value = await contextApi.json<EvaluationRunResponse>(
          `/api/evaluations/${latestRunId}`,
        );
        if (cancelled) return;
        setLatestRun(value.run);
        setTrend(value.trend);
        setLatestRunLoading(false);
        if (value.run.status === "queued" || value.run.status === "running") {
          schedule(Math.max(0, intervalMs - (performance.now() - startedAt)));
        }
      } catch (cause) {
        if (cancelled) return;
        setLatestRunError(readError(cause));
        setLatestRunLoading(false);
      } finally {
        polling = false;
      }
    };
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
        return;
      }
      if (polling || timer !== undefined) return;
      void refresh();
    };
    if (!document.hidden) void refresh();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [latestRunId, latestRunRequest]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    const guardLinks = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (target && !window.confirm("Discard the unsaved context draft?")) {
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
    if (!detail || !dirty || saving || staleWrite) return;
    setSaving(true);
    setError(undefined);
    try {
      await contextApi.json<ContextEditorSnapshot>(`/api/contexts/${contextId}`, {
        body: JSON.stringify({
          expectedActiveRevisionId: detail.context.activeRevisionId,
          markdown: draft,
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      await loadContext();
      window.dispatchEvent(new Event("context-saved"));
    } catch (cause) {
      let message = readError(cause);
      if (cause instanceof ApiRequestError && cause.code === "stale-write") {
        message =
          "Someone saved a newer context revision. Your draft is still open; load the latest version before saving again.";
        setStaleWrite(true);
      }
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function makeActive(revisionId: string, version: number) {
    if (
      !detail ||
      dirty ||
      saving ||
      staleWrite ||
      activatingRevisionId ||
      revisionId === detail.context.activeRevisionId
    )
      return;
    if (
      !window.confirm(
        `Make v${version} active? New chats, context search, and evaluations will use this version.`,
      )
    )
      return;
    setActivatingRevisionId(revisionId);
    setError(undefined);
    try {
      await contextApi.json<ContextEditorSnapshot>(`/api/contexts/${contextId}`, {
        body: JSON.stringify({
          action: "activate",
          expectedActiveRevisionId: detail.context.activeRevisionId,
          revisionId,
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      await loadContext();
      toast.success(`v${version} is active.`);
      window.dispatchEvent(new Event("context-saved"));
    } catch (cause) {
      let message = readError(cause);
      if (cause instanceof ApiRequestError && cause.code === "stale-write") {
        message =
          "Someone saved a newer context revision. Load the latest version before trying again.";
        setStaleWrite(true);
      }
      setError(message);
      toast.error(message);
    } finally {
      setActivatingRevisionId(undefined);
    }
  }

  async function loadLatestAfterConflict() {
    setLoadingLatest(true);
    try {
      await loadContext({ preserveDraft: dirty });
      toast.success(
        dirty ? "Latest revision loaded. Your draft is still open." : "Latest revision loaded.",
      );
    } catch (cause) {
      setError(readError(cause));
    } finally {
      setLoadingLatest(false);
    }
  }

  function saveWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.key.toLowerCase() !== "s")
      return;
    event.preventDefault();
    void save();
  }

  const selectedRevisionSummary = detail?.revisions.find(({ id }) => id === selectedRevisionId);
  let skill: SkillMetadata | undefined;
  let skillError: string | undefined;
  try {
    skill = readSkillMetadata(draft);
  } catch (cause) {
    skillError = readError(cause);
  }
  const selectedDate = selectedRevisionSummary
    ? formatDateTime(selectedRevisionSummary.createdAt)
    : "";
  const revisionVersions = new Map(
    detail?.revisions.map((revision, index, revisions) => [
      revision.id,
      revisions.length - index,
    ]) ?? [],
  );

  if (!detail && !error)
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <LoaderCircle
          aria-label="Loading context"
          className="size-5 animate-spin text-muted-foreground"
        />
      </div>
    );
  if (!detail)
    return (
      <div className="p-4">
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      </div>
    );

  return (
    <div className="w-full" onKeyDown={saveWithKeyboard}>
      <div className="mb-4">
        <h2 className="text-xl font-semibold">{detail.context.title}</h2>
        {skill ? (
          <div className="mt-3 rounded-lg border bg-card p-3 text-sm">
            <p className="font-medium">Skill · {skill.name}</p>
            <p className="mt-1 text-muted-foreground">{skill.description}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {
                "Enable Skills in Agent to use saved skills automatically. Target runs and evaluations explicitly use this revision and record the skill read in the trace."
              }
            </p>
            {dirty ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Save this skill before trying or evaluating the updated instructions.
              </p>
            ) : (
              <div className="mt-2 flex gap-4 text-xs font-medium text-primary">
                <Link className="hover:underline" href={`/?mode=target&context=${contextId}`}>
                  Try this skill →
                </Link>
                <Link className="hover:underline" href={`/evaluations/run?context=${contextId}`}>
                  Evaluate this skill →
                </Link>
              </div>
            )}
          </div>
        ) : !skillError ? (
          <Button
            className="mt-2"
            size="sm"
            variant="outline"
            onClick={() =>
              setDraft(
                createSkillMarkdown(
                  detail.context.title
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-|-$/g, "")
                    .slice(0, 64)
                    .replace(/-$/, "") || "new-skill",
                  `Use when ${detail.context.title.toLowerCase()} is needed.`,
                  draft || "Describe the steps the agent should follow.",
                ),
              )
            }
          >
            Make a skill
          </Button>
        ) : null}
        {skillError ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {skillError}
          </p>
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <button
            aria-label={view === "history" ? "Close version history" : "Open version history"}
            aria-pressed={view === "history"}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2 font-medium hover:bg-accent hover:text-foreground",
              view === "history" && "bg-accent text-foreground",
            )}
            onClick={() => setView((current) => (current === "history" ? "edit" : "history"))}
            title="Version history"
            type="button"
          >
            <History aria-hidden="true" className="size-3.5" />v{detail.context.revisionNumber} ·{" "}
            {detail.context.revisionCount} versions
          </button>
          <span className="rounded-full bg-primary px-2 py-1 font-medium text-primary-foreground">
            Active
            {detail.context.activeRevisionId === detail.context.revisionId
              ? ""
              : ` v${detail.context.activeRevisionNumber}`}
          </span>
          <span>Updated {formatDateTime(detail.context.updatedAt)}</span>
          <ContextStats markdown={draft} />
        </div>
      </div>
      {error ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <span>{error}</span>
          {staleWrite ? (
            <Button
              className="shrink-0"
              disabled={loadingLatest}
              onClick={() => void loadLatestAfterConflict()}
              size="sm"
              variant="outline"
            >
              {loadingLatest ? (
                <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
              ) : null}
              Load latest
            </Button>
          ) : null}
        </div>
      ) : null}
      <div aria-label="Context views" className="mb-5 flex border-b" role="tablist">
        <ContextViewTab
          active={view === "edit"}
          label={skill ? "SKILL.md" : "Prompt"}
          onClick={() => setView("edit")}
        />
        <ContextViewTab
          active={view === "evaluations"}
          label={`Evaluations ${runs.length}`}
          onClick={() => setView("evaluations")}
        />
      </div>
      {view === "edit" ? (
        <section className="overflow-hidden border-y bg-card/20">
          <div className="flex min-h-11 flex-wrap items-center gap-1 border-b p-2 sm:h-11 sm:flex-nowrap sm:py-0">
            <ContextViewModeControl
              className="w-full min-w-0 sm:w-auto sm:max-w-72 sm:flex-1"
              mode={mode}
              onChange={(nextMode) => setMode(nextMode === "changes" ? "read" : nextMode)}
              variant="editor"
            />
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              {!dirty && detail.context.activeRevisionId !== detail.context.revisionId ? (
                <Button
                  disabled={Boolean(activatingRevisionId) || saving || staleWrite}
                  onClick={() =>
                    void makeActive(detail.context.revisionId, detail.context.revisionNumber)
                  }
                  size="sm"
                  variant="outline"
                >
                  {activatingRevisionId === detail.context.revisionId ? (
                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                  ) : null}
                  Make active
                </Button>
              ) : null}
              {dirty ? (
                <Button disabled={saving || staleWrite} onClick={save} size="sm">
                  {saving ? (
                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                  ) : (
                    <Save aria-hidden="true" className="size-4" />
                  )}
                  Save
                </Button>
              ) : null}
            </div>
          </div>
          {mode === "preview" ? (
            <MarkdownPreview className="min-h-96 p-5 sm:p-7" markdown={draft} />
          ) : mode === "read" ? (
            <pre
              aria-label="Context source"
              className="min-h-[32rem] whitespace-pre-wrap break-words px-5 py-5 font-mono text-sm leading-6 sm:px-7 sm:py-7"
              tabIndex={0}
            >
              {draft}
            </pre>
          ) : (
            <div className="relative">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 overflow-hidden [scrollbar-gutter:stable]"
              >
                <div className="py-5 font-mono text-sm leading-6 sm:py-7">
                  {draft.split("\n").map((line, index) => (
                    <div className="grid min-h-6 grid-cols-[3rem_minmax(0,1fr)]" key={index}>
                      <span className="select-none border-r border-border/70 pr-3 text-right text-muted-foreground/55">
                        {index + 1}
                      </span>
                      <span className="invisible whitespace-pre-wrap break-words pl-4 pr-5 sm:pr-7">
                        {line}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <Textarea
                aria-label="Context Markdown"
                className="relative min-h-[max(32rem,calc(100dvh-22rem))] resize-none overflow-hidden rounded-none border-0 bg-transparent py-5 pl-16 pr-5 font-mono leading-6 shadow-none [field-sizing:content] [scrollbar-gutter:stable] focus-visible:outline-none sm:py-7 sm:pl-16 sm:pr-7"
                onChange={(event) => setDraft(event.target.value)}
                ref={textareaRef}
                value={draft}
              />
            </div>
          )}
        </section>
      ) : null}
      {view === "history" ? (
        <section className="grid gap-5 lg:grid-cols-[18rem_1fr]">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Revision History</h3>
              <span className="text-xs text-muted-foreground">
                {detail.revisions.length} versions
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border bg-card">
              {detail.revisions.map((revision, index) => (
                <RevisionButton
                  isActiveRevision={revision.id === detail.context.activeRevisionId}
                  isSelected={revision.id === selectedRevisionId}
                  key={revision.id}
                  onClick={() => {
                    setSelectedRevisionId(revision.id);
                    setSelectedRevision(undefined);
                  }}
                  revision={revision}
                  version={detail.revisions.length - index}
                />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center gap-2">
              <GitCompareArrows aria-hidden="true" className="size-4" />
              <h3 className="text-sm font-semibold">Adjacent Revision Diff</h3>
            </div>
            {revisionLoading ? (
              <div className="grid min-h-48 place-items-center rounded-xl border bg-card">
                <LoaderCircle
                  aria-label="Loading revision diff"
                  className="size-5 animate-spin text-muted-foreground"
                />
              </div>
            ) : revisionError ? (
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                <p>{revisionError}</p>
                <Button
                  className="mt-3"
                  onClick={() => setRevisionRequest((value) => value + 1)}
                  size="sm"
                  variant="outline"
                >
                  Try again
                </Button>
              </div>
            ) : selectedRevision && selectedRevisionSummary ? (
              <div>
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full bg-secondary px-2 py-1 capitalize">
                      {contextRevisionAuthorLabel(selectedRevisionSummary)}
                    </span>
                    <span>{selectedDate}</span>
                    {selectedRevisionSummary.changeRequest ? (
                      <span>{selectedRevisionSummary.changeRequest}</span>
                    ) : null}
                  </div>
                  {selectedRevisionId !== detail.context.activeRevisionId ? (
                    <Button
                      disabled={dirty || Boolean(activatingRevisionId) || saving}
                      onClick={() =>
                        void makeActive(
                          selectedRevisionId,
                          revisionVersions.get(selectedRevisionId) ?? 1,
                        )
                      }
                      size="sm"
                      variant="outline"
                    >
                      {activatingRevisionId === selectedRevisionId ? (
                        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                      ) : null}
                      Make active
                    </Button>
                  ) : null}
                </div>
                <ContextDiff
                  after={selectedRevision.revision.markdown}
                  before={selectedRevision.parentMarkdown ?? ""}
                />
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
                Select a revision to inspect its changes.
              </div>
            )}
          </div>
        </section>
      ) : null}
      {view === "evaluations" ? (
        <ContextEvaluationView
          error={latestRunError}
          latestRun={latestRun}
          loading={latestRunLoading}
          onRetry={() => {
            if (latestRunId) setLatestRunRequest((value) => value + 1);
            else void loadRuns();
          }}
          contextId={contextId}
          revisionVersions={revisionVersions}
          runs={runs}
          trend={trend}
        />
      ) : null}
    </div>
  );
}

function ContextViewTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      aria-selected={active}
      className={cn(
        "relative min-h-11 px-4 text-sm text-muted-foreground hover:text-foreground",
        active &&
          "font-medium text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-foreground",
      )}
      onClick={onClick}
      role="tab"
      type="button"
    >
      {label}
    </button>
  );
}

function RevisionButton({
  isActiveRevision,
  isSelected,
  onClick,
  revision,
  version,
}: {
  isActiveRevision: boolean;
  isSelected: boolean;
  onClick(): void;
  revision: ContextRevisionSummary;
  version: number;
}) {
  return (
    <button
      className={cn(
        "block w-full border-b px-3 py-3 text-left text-xs transition-colors last:border-0 hover:bg-accent",
        isSelected && "bg-accent",
      )}
      onClick={onClick}
      aria-pressed={isSelected}
      type="button"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="font-mono font-semibold">v{version}</span>
          {isActiveRevision ? (
            <span className="rounded-full bg-primary px-1.5 py-0.5 font-sans text-[10px] font-medium text-primary-foreground">
              Active
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {formatDateTime(revision.createdAt)}
        </span>
      </div>
      <div className="mt-1.5 truncate text-foreground">
        {revision.changeRequest ?? "Initial Context"}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>{contextRevisionAuthorLabel(revision)}</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono">{revision.id.slice(0, 7)}</span>
      </div>
    </button>
  );
}

function scrollTextareaToOffset(textarea: HTMLTextAreaElement, offset: number) {
  const line = textarea.value.slice(0, offset).split("\n").length - 1;
  const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || 20;
  textarea.scrollTop = Math.max(0, line * lineHeight - textarea.clientHeight / 3);
}
