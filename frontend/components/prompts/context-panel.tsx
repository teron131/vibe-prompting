/** Provides Agent with active prompt context, pinned quotes, prompt search, and secondary artifact actions. */

"use client";

import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  FileText,
  FlaskConical,
  LoaderCircle,
  MessageCircleMore,
  Quote,
  Redo2,
  Save,
  Search,
  Undo2,
  X,
} from "lucide-react";
import Link from "next/link";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { MarkdownPreview } from "@/components/prompts/artifact";
import { PromptDiff } from "@/components/prompts/diff";
import { PromptStats } from "@/components/prompts/stats";
import { usePromptSearch } from "@/components/prompts/use-search";
import { type PromptViewMode, PromptViewModeControl } from "@/components/prompts/view-mode-control";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { PromptQuote } from "@/contracts/chat";
import type { EvaluationRunsResponse, EvaluationRunSummary } from "@/contracts/evaluations";
import type {
  PromptDetail,
  PromptEditorSnapshot,
  PromptRevision,
  PromptRevisionResponse,
  PromptSearchResult,
  PromptSummary,
} from "@/contracts/prompts";
import type { TargetRunsResponse, TargetRunSummary } from "@/contracts/target-runs";
import { createErrorReader, requestJson } from "@/shared/api";

const DEFAULT_PANEL_WIDTH = 384;
const MAX_PANEL_WIDTH = 768;
const MIN_CHAT_WIDTH = 480;
const MIN_PANEL_WIDTH = 320;
const PANEL_RESIZE_STEP = 16;
const PANEL_WIDTH_STORAGE_KEY = "vibe-prompting:prompt-panel-width";
const readError = createErrorReader("Prompt update failed.");

export function PromptContextPanel({
  activePrompt,
  highlightedQuote,
  onClose,
  onPromptUpdated,
  onQuote,
  onSelectPrompt,
  open,
  prompts,
  reviewRevision,
}: {
  activePrompt?: PromptSummary;
  highlightedQuote?: PromptQuote;
  onClose(): void;
  onPromptUpdated(prompt: PromptSummary): void;
  onQuote(quote: PromptQuote): void;
  onSelectPrompt(prompt: PromptSummary): void;
  open: boolean;
  prompts: PromptSummary[];
  reviewRevision?: { promptId: string; revisionId: string };
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const sourceRef = useRef<HTMLPreElement>(null);
  const highlightRef = useRef<HTMLElement>(null);
  const editorGutterRef = useRef<HTMLDivElement>(null);
  const resizeCleanupRef = useRef<(() => void) | undefined>(undefined);
  const [panelMaxWidth, setPanelMaxWidth] = useState(MAX_PANEL_WIDTH);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [panelView, setPanelView] = useState<"explorer" | "prompt">(
    activePrompt ? "prompt" : "explorer",
  );
  const [query, setQuery] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [editorPrompt, setEditorPrompt] = useState<PromptEditorSnapshot>();
  const [editorState, setEditorState] = useState<"error" | "idle" | "loading">("idle");
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<PromptViewMode>("edit");
  const [editError, setEditError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [historyAction, setHistoryAction] = useState<"redo" | "undo">();
  const [activating, setActivating] = useState(false);
  const [latestRun, setLatestRun] = useState<EvaluationRunSummary>();
  const [runState, setRunState] = useState<"error" | "idle" | "loading">("idle");
  const [latestTargetRun, setLatestTargetRun] = useState<TargetRunSummary>();
  const [targetRunState, setTargetRunState] = useState<"error" | "idle" | "loading">("idle");
  const [historicalRevision, setHistoricalRevision] = useState<PromptRevision>();
  const [historicalState, setHistoricalState] = useState<"error" | "idle" | "loading">("idle");
  const [dismissedHistoryKey, setDismissedHistoryKey] = useState<string>();
  const [reviewedRevision, setReviewedRevision] = useState<PromptRevisionResponse>();
  const [reviewState, setReviewState] = useState<"error" | "idle" | "loading">("idle");
  const hasSearchQuery = Boolean(query.trim());
  const {
    error: searchError,
    loading: searchLoading,
    results: searchResults,
  } = usePromptSearch({
    enabled: open && hasSearchQuery,
    limit: 10,
    prompts,
    query,
  });
  const explorerPrompts: PromptSearchResult[] = hasSearchQuery
    ? searchResults
    : prompts.map((prompt) => ({ ...prompt, passages: [] }));
  const activePromptId = activePrompt?.id;

  const historicalQuoteKey =
    activePromptId &&
    highlightedQuote?.promptId === activePromptId &&
    highlightedQuote.revisionId !== activePrompt?.revisionId
      ? `${highlightedQuote.promptId}:${highlightedQuote.revisionId}`
      : undefined;
  const reviewRevisionKey =
    activePromptId && reviewRevision?.promptId === activePromptId
      ? `${reviewRevision.promptId}:${reviewRevision.revisionId}`
      : undefined;
  const showingHistorical = Boolean(
    historicalQuoteKey && historicalQuoteKey !== dismissedHistoryKey,
  );
  const displayedRevision = showingHistorical ? historicalRevision : undefined;
  const displayedMarkdown = showingHistorical
    ? historicalRevision?.markdown
    : editorPrompt?.markdown;
  const resolvedMarkdown =
    showingHistorical && historicalState === "loading"
      ? "Loading pinned revision…"
      : showingHistorical && historicalState === "error"
        ? "Pinned revision unavailable. Return to the prompt to continue."
        : editorState === "loading"
          ? "Loading prompt…"
          : editorState === "error"
            ? "Prompt unavailable. Close and reopen this panel to retry."
            : (displayedMarkdown ?? "");
  const displayedRevisionId = displayedRevision?.id ?? editorPrompt?.revisionId;
  const displayedPrompt = editorPrompt ?? activePrompt;
  const dirty = Boolean(editorPrompt && draft !== editorPrompt.markdown);
  const changesAvailable = Boolean(editorPrompt?.canUndo);
  const compactToolbar = panelWidth < 560;
  const matchingHighlight =
    activePromptId &&
    highlightedQuote?.promptId === activePromptId &&
    highlightedQuote.revisionId === displayedRevisionId
      ? highlightedQuote
      : undefined;

  useEffect(() => {
    if (!open) return;
    setPanelView(activePrompt ? "prompt" : "explorer");
  }, [activePrompt?.id, open]);

  useEffect(() => {
    if (!open) return;
    const workspace = panelRef.current?.parentElement;
    if (!workspace) return;
    const syncPanelWidth = () => {
      const maximum = getPanelMaxWidth(workspace.getBoundingClientRect().width);
      const storedWidth = Number(window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY));
      setPanelMaxWidth(maximum);
      setPanelWidth((current) =>
        clampPanelWidth(
          Number.isFinite(storedWidth) && storedWidth > 0 ? storedWidth : current,
          maximum,
        ),
      );
    };
    syncPanelWidth();
    const observer = new ResizeObserver(syncPanelWidth);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (dirty && !window.confirm("Discard the unsaved prompt draft?")) return;
      onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [dirty, onClose, open]);

  useEffect(() => {
    setSelectedText("");
  }, [displayedRevisionId]);

  useEffect(() => {
    setEditorPrompt(undefined);
    setEditorState("idle");
    if (!open || !activePromptId) return;

    const controller = new AbortController();
    setEditorState("loading");
    void requestJson<PromptDetail>(
      `/api/prompts/${encodeURIComponent(activePromptId)}`,
      { cache: "no-store", signal: controller.signal },
      "Prompt request failed.",
    )
      .then(({ prompt }) => {
        setEditorPrompt(prompt);
        setDraft(prompt.markdown);
        setMode(
          reviewRevisionKey && prompt.canUndo ? "changes" : historicalQuoteKey ? "read" : "edit",
        );
        setEditError(undefined);
        setEditorState("idle");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setEditorState("error");
      });
    return () => controller.abort();
  }, [activePromptId, historicalQuoteKey, open, reviewRevisionKey]);

  useEffect(() => {
    setReviewedRevision(undefined);
    setReviewState("idle");
    if (!open || !activePromptId || !editorPrompt?.canUndo) return;

    const controller = new AbortController();
    setReviewState("loading");
    void requestJson<PromptRevisionResponse>(
      `/api/prompts/${encodeURIComponent(activePromptId)}/revisions/${encodeURIComponent(editorPrompt.revisionId)}`,
      { cache: "no-store", signal: controller.signal },
      "Prompt revision request failed.",
    )
      .then((revision) => {
        setReviewedRevision(revision);
        setReviewState("idle");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setReviewState("error");
      });
    return () => controller.abort();
  }, [activePromptId, editorPrompt?.canUndo, editorPrompt?.revisionId, open]);

  useEffect(() => {
    if (!activePromptId) {
      setLatestRun(undefined);
      setRunState("idle");
      return;
    }

    const controller = new AbortController();
    setLatestRun(undefined);
    setRunState("loading");
    void requestJson<EvaluationRunsResponse>(
      `/api/evaluations?promptId=${encodeURIComponent(activePromptId)}`,
      { cache: "no-store", signal: controller.signal },
      "Evaluation request failed.",
    )
      .then(({ runs }) => {
        setLatestRun(runs[0]);
        setRunState("idle");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRunState("error");
      });
    return () => controller.abort();
  }, [activePromptId]);

  useEffect(() => {
    if (!activePromptId) {
      setLatestTargetRun(undefined);
      setTargetRunState("idle");
      return;
    }
    const controller = new AbortController();
    setLatestTargetRun(undefined);
    setTargetRunState("loading");
    void requestJson<TargetRunsResponse>(
      `/api/target-runs?promptId=${encodeURIComponent(activePromptId)}`,
      { cache: "no-store", signal: controller.signal },
      "Target Run request failed.",
    )
      .then(({ runs }) => {
        setLatestTargetRun(runs[0]);
        setTargetRunState("idle");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setTargetRunState("error");
      });
    return () => controller.abort();
  }, [activePromptId]);

  useEffect(() => {
    setHistoricalRevision(undefined);
    setHistoricalState("idle");
    if (
      !historicalQuoteKey ||
      historicalQuoteKey === dismissedHistoryKey ||
      !activePromptId ||
      !highlightedQuote
    )
      return;

    const controller = new AbortController();
    setHistoricalState("loading");
    void requestJson<PromptRevisionResponse>(
      `/api/prompts/${encodeURIComponent(activePromptId)}/revisions/${encodeURIComponent(highlightedQuote.revisionId)}`,
      {
        cache: "no-store",
        signal: controller.signal,
      },
      "Prompt revision request failed.",
    )
      .then(({ revision }) => {
        setHistoricalRevision(revision);
        setHistoricalState("idle");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setHistoricalState("error");
      });
    return () => controller.abort();
  }, [activePromptId, dismissedHistoryKey, highlightedQuote, historicalQuoteKey]);

  useEffect(() => {
    if (!historicalQuoteKey) setDismissedHistoryKey(undefined);
  }, [historicalQuoteKey]);

  useEffect(() => {
    if (!open || !matchingHighlight) return;
    window.requestAnimationFrame(() =>
      highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  }, [matchingHighlight, open]);

  if (!open) return null;

  function captureSelection() {
    const selection = window.getSelection();
    const source = sourceRef.current;
    if (!selection || selection.isCollapsed || !source) {
      setSelectedText("");
      return;
    }
    if (!source.contains(selection.anchorNode) || !source.contains(selection.focusNode)) {
      setSelectedText("");
      return;
    }
    setSelectedText(selection.toString().trim());
  }

  function quoteSelection() {
    if (!displayedPrompt || !displayedRevisionId || !selectedText) return;
    onQuote({
      promptId: displayedPrompt.id,
      revisionId: displayedRevisionId,
      text: selectedText,
      title: displayedPrompt.title,
    });
    window.getSelection()?.removeAllRanges();
    setSelectedText("");
  }

  function leavePrompt() {
    if (dirty && !window.confirm("Discard the unsaved prompt draft?")) return;
    setMode("edit");
    setDraft(editorPrompt?.markdown ?? "");
    setEditError(undefined);
    setPanelView("explorer");
  }

  function closePanel() {
    if (dirty && !window.confirm("Discard the unsaved prompt draft?")) return;
    onClose();
  }

  function selectMode(nextMode: PromptViewMode) {
    if (nextMode === mode) return;
    if (nextMode === "changes" && !changesAvailable) return;
    if (nextMode === "edit" && (displayedRevision || editorState !== "idle")) return;
    if (nextMode === "read" && dirty) {
      if (!window.confirm("Discard the unsaved prompt draft?")) return;
      setDraft(editorPrompt?.markdown ?? "");
    }
    setEditError(undefined);
    setMode(nextMode);
  }

  function startPanelResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeCleanupRef.current?.();

    const startX = event.clientX;
    const startWidth = panelRef.current?.getBoundingClientRect().width ?? panelWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    let nextWidth = startWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function resize(pointerEvent: PointerEvent) {
      nextWidth = clampPanelWidth(startWidth + startX - pointerEvent.clientX, panelMaxWidth);
      setPanelWidth(nextWidth);
    }

    function finish() {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(Math.round(nextWidth)));
      resizeCleanupRef.current = undefined;
    }

    resizeCleanupRef.current = finish;
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  function resizePanelWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    let nextWidth: number | undefined;
    if (event.key === "ArrowLeft") nextWidth = panelWidth + PANEL_RESIZE_STEP;
    else if (event.key === "ArrowRight") nextWidth = panelWidth - PANEL_RESIZE_STEP;
    else if (event.key === "Home") nextWidth = MIN_PANEL_WIDTH;
    else if (event.key === "End") nextWidth = panelMaxWidth;
    if (nextWidth === undefined) return;
    event.preventDefault();
    const width = clampPanelWidth(nextWidth, panelMaxWidth);
    setPanelWidth(width);
    window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(Math.round(width)));
  }

  async function savePrompt() {
    if (!activePrompt || !editorPrompt || !dirty || saving) return;
    setSaving(true);
    setEditError(undefined);
    try {
      const prompt = await updatePrompt(activePrompt.id, {
        expectedRevisionId: editorPrompt.revisionId,
        markdown: draft,
      });
      applyPromptUpdate(prompt);
    } catch (error) {
      const message = readError(error);
      setEditError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function navigateHistory(action: "redo" | "undo") {
    if (!activePrompt || !editorPrompt || dirty || saving || historyAction) return;
    setHistoryAction(action);
    setEditError(undefined);
    try {
      const prompt = await updatePrompt(activePrompt.id, {
        action,
        expectedRevisionId: editorPrompt.revisionId,
      });
      applyPromptUpdate(prompt, mode === "changes" && !prompt.canUndo ? "edit" : mode);
    } catch (error) {
      const message = readError(error);
      setEditError(message);
      toast.error(message);
    } finally {
      setHistoryAction(undefined);
    }
  }

  async function makeActive() {
    if (
      !activePrompt ||
      !editorPrompt ||
      dirty ||
      saving ||
      historyAction ||
      activating ||
      editorPrompt.revisionId === editorPrompt.activeRevisionId
    )
      return;
    if (
      !window.confirm(
        `Make v${editorPrompt.revisionNumber} active? New chats, prompt search, and evaluations will use this version.`,
      )
    )
      return;
    setActivating(true);
    setEditError(undefined);
    try {
      const prompt = await updatePrompt(activePrompt.id, {
        action: "activate",
        expectedActiveRevisionId: editorPrompt.activeRevisionId,
        revisionId: editorPrompt.revisionId,
      });
      applyPromptUpdate(prompt, mode);
      toast.success(`v${prompt.activeRevisionNumber} is active.`);
    } catch (error) {
      const message = readError(error);
      setEditError(message);
      toast.error(message);
    } finally {
      setActivating(false);
    }
  }

  function applyPromptUpdate(prompt: PromptEditorSnapshot, nextMode: PromptViewMode = "edit") {
    setEditorPrompt(prompt);
    setDraft(prompt.markdown);
    setMode(nextMode);
    onPromptUpdated(projectActivePromptSummary(prompt));
  }

  function savePromptWithKeyboard(event: ReactKeyboardEvent<HTMLElement>) {
    if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.key.toLowerCase() !== "s")
      return;
    event.preventDefault();
    void savePrompt();
  }

  return (
    <aside
      aria-labelledby={titleId}
      className="@container relative z-auto hidden min-h-0 w-[var(--prompt-panel-width)] max-w-none shrink-0 flex-col overflow-hidden border-l bg-background shadow-none xl:flex"
      onKeyDown={savePromptWithKeyboard}
      ref={panelRef}
      style={{ "--prompt-panel-width": `${panelWidth}px` } as CSSProperties}
    >
      <div
        aria-label="Resize prompt panel"
        aria-orientation="vertical"
        aria-valuemax={panelMaxWidth}
        aria-valuemin={MIN_PANEL_WIDTH}
        aria-valuenow={Math.round(panelWidth)}
        className="group absolute inset-y-0 left-0 z-10 w-3 -translate-x-1/2 cursor-col-resize touch-none focus-visible:outline-none"
        onKeyDown={resizePanelWithKeyboard}
        onPointerDown={startPanelResize}
        role="separator"
        tabIndex={0}
        title="Drag to resize prompt panel"
      >
        <span className="absolute inset-y-0 left-1/2 w-px bg-transparent transition-colors group-hover:bg-foreground/40 group-focus-visible:bg-foreground/60" />
      </div>
      <header
        className={`flex h-11 shrink-0 items-center gap-1 px-2 ${panelView === "prompt" ? "" : "border-b"}`}
      >
        {panelView === "prompt" && activePrompt ? (
          <Button
            aria-label="Back to prompts"
            className="size-8"
            onClick={leavePrompt}
            size="icon"
            variant="ghost"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
          </Button>
        ) : (
          <FileText aria-hidden="true" className="size-4 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1 px-1">
          {panelView === "prompt" && displayedPrompt ? (
            <div className="min-w-0">
              <div className="flex min-w-0 items-baseline gap-2">
                <h2 className="truncate text-sm font-semibold" id={titleId}>
                  {displayedPrompt.title}
                </h2>
                <span className="shrink-0 text-xs text-muted-foreground">
                  v{displayedPrompt.revisionNumber}
                </span>
                <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                  Active
                  {editorPrompt && editorPrompt.activeRevisionId !== editorPrompt.revisionId
                    ? ` v${editorPrompt.activeRevisionNumber}`
                    : ""}
                </span>
              </div>
              <PromptStats className="block truncate text-[11px] leading-4" markdown={draft} />
            </div>
          ) : (
            <>
              <h2 className="truncate text-sm font-semibold" id={titleId}>
                Prompts
              </h2>
              <p className="truncate text-xs text-muted-foreground">{prompts.length} saved</p>
            </>
          )}
        </div>
        {panelView === "prompt" && activePrompt ? (
          <Link
            aria-label={`Open ${activePrompt.title} in the full prompt workspace`}
            className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={`/prompts/${activePrompt.id}`}
            title="Open full workspace"
          >
            <ArrowUpRight aria-hidden="true" className="size-4" />
          </Link>
        ) : null}
        <Button
          aria-label="Close prompts"
          className="size-8"
          onClick={closePanel}
          size="icon"
          variant="ghost"
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </header>

      {panelView === "explorer" ? (
        <div className="flex min-h-0 flex-1 flex-col p-3">
          <label className="relative block shrink-0">
            <span className="sr-only">Search saved prompts</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              className="h-9 pl-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search prompts"
              type="search"
              value={query}
            />
          </label>
          <div className="mt-3 flex items-center justify-between px-1 text-[11px] text-muted-foreground">
            <span>{hasSearchQuery ? "Matches" : "Saved prompts"}</span>
            <span>{explorerPrompts.length}</span>
          </div>
          <div aria-label="Saved prompt explorer" className="mt-1 min-h-0 flex-1 overflow-y-auto">
            {searchLoading ? (
              <p className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-muted-foreground">
                <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                Searching…
              </p>
            ) : searchError ? (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">{searchError}</p>
            ) : explorerPrompts.length ? (
              explorerPrompts.map((prompt) => {
                const active = prompt.id === activePrompt?.id;
                const passage = hasSearchQuery ? prompt.passages[0]?.text : undefined;
                return (
                  <button
                    aria-current={active ? "true" : undefined}
                    className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-accent" : ""}`}
                    key={prompt.id}
                    onClick={() => {
                      onSelectPrompt(prompt);
                      setPanelView("prompt");
                      setQuery("");
                    }}
                    type="button"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{prompt.title}</span>
                      {passage ? (
                        <span className="mt-0.5 block line-clamp-2 text-xs leading-4 text-muted-foreground">
                          {passage}
                        </span>
                      ) : (
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          v{prompt.revisionNumber} · Updated {formatDate(prompt.updatedAt)}
                        </span>
                      )}
                    </span>
                    {active ? (
                      <Check aria-label="Active prompt" className="size-4 shrink-0" />
                    ) : null}
                  </button>
                );
              })
            ) : (
              <div className="grid min-h-48 place-items-center px-4 text-center">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {hasSearchQuery ? `No prompts match “${query}”.` : "No saved prompts yet."}
                  </p>
                  {!hasSearchQuery && prompts.length === 0 ? (
                    <Link
                      className="mt-3 inline-flex text-xs font-medium underline-offset-4 hover:underline"
                      href="/prompts"
                    >
                      Create a saved prompt
                    </Link>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : activePrompt ? (
        <>
          <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-1 border-b p-2 @min-[560px]:h-10 @min-[560px]:flex-nowrap @min-[560px]:py-0">
            <PromptViewModeControl
              className={
                compactToolbar ? "w-full" : changesAvailable ? "w-[22rem]" : "w-[17.25rem]"
              }
              compact={compactToolbar}
              editDisabled={Boolean(displayedRevision) || editorState !== "idle"}
              mode={mode}
              onChange={selectMode}
              showChanges={changesAvailable}
            />
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              {!dirty ? (
                <>
                  <Button
                    aria-label="Undo last saved change"
                    className="size-8"
                    disabled={saving || Boolean(historyAction) || !editorPrompt?.canUndo}
                    onClick={() => void navigateHistory("undo")}
                    size="icon"
                    title="Undo saved revision"
                    variant="ghost"
                  >
                    {historyAction === "undo" ? (
                      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                    ) : (
                      <Undo2 aria-hidden="true" className="size-4" />
                    )}
                  </Button>
                  <Button
                    aria-label="Redo saved change"
                    className="size-8"
                    disabled={saving || Boolean(historyAction) || !editorPrompt?.canRedo}
                    onClick={() => void navigateHistory("redo")}
                    size="icon"
                    title="Redo saved revision"
                    variant="ghost"
                  >
                    {historyAction === "redo" ? (
                      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                    ) : (
                      <Redo2 aria-hidden="true" className="size-4" />
                    )}
                  </Button>
                </>
              ) : null}
              {!dirty && editorPrompt?.activeRevisionId !== editorPrompt?.revisionId ? (
                <Button
                  className="h-8 px-2.5 text-xs"
                  disabled={activating || saving || Boolean(historyAction)}
                  onClick={() => void makeActive()}
                  size="sm"
                  variant="outline"
                >
                  {activating ? (
                    <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                  ) : null}
                  Make active
                </Button>
              ) : null}
              {dirty ? (
                <Button
                  className="h-8 px-2.5 text-xs"
                  disabled={!dirty || saving}
                  onClick={() => void savePrompt()}
                  size="sm"
                >
                  {saving ? (
                    <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                  ) : (
                    <Save aria-hidden="true" className="size-3.5" />
                  )}
                  Save
                </Button>
              ) : null}
            </div>
          </div>

          {editError ? (
            <div className="shrink-0 border-b border-destructive/40 bg-destructive/5 px-4 py-2 text-xs text-destructive">
              {editError}
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col">
            {showingHistorical ? (
              <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b px-3">
                <span className="text-xs text-muted-foreground">
                  {historicalState === "loading" ? "Loading pinned revision…" : "Pinned revision"}
                </span>
                <button
                  className="text-[11px] font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    if (historicalQuoteKey) setDismissedHistoryKey(historicalQuoteKey);
                    setHistoricalRevision(undefined);
                  }}
                  type="button"
                >
                  Return to prompt
                </button>
              </div>
            ) : mode === "read" && selectedText ? (
              <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b px-3">
                <span className="truncate text-xs text-muted-foreground">
                  {selectedText.length} characters selected
                </span>
                <Button className="h-7" onClick={quoteSelection} size="sm" variant="ghost">
                  <Quote aria-hidden="true" className="size-3.5" />
                  Quote selection
                </Button>
              </div>
            ) : null}
            {mode === "changes" ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {reviewState === "loading" ? (
                  <div className="flex min-h-40 items-center justify-center gap-2 text-xs text-muted-foreground">
                    <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                    Loading revision changes…
                  </div>
                ) : reviewState === "error" || !reviewedRevision ? (
                  <div className="grid min-h-40 place-items-center text-center text-xs text-muted-foreground">
                    This revision diff is unavailable.
                  </div>
                ) : (
                  <>
                    <div className="mb-3 flex items-start justify-between gap-3 px-1">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-semibold">
                            {reviewedRevision.revision.source === "ai"
                              ? "Agent changes"
                              : "Manual changes"}
                          </p>
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                            v{editorPrompt?.revisionNumber} vs v
                            {(editorPrompt?.revisionNumber ?? 1) - 1}
                          </span>
                        </div>
                        {reviewedRevision.revision.changeRequest ? (
                          <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                            {reviewedRevision.revision.changeRequest}
                          </p>
                        ) : null}
                      </div>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        {reviewedRevision.revision.id.slice(0, 8)}
                      </span>
                    </div>
                    <PromptDiff
                      after={reviewedRevision.revision.markdown}
                      before={reviewedRevision.parentMarkdown ?? ""}
                    />
                  </>
                )}
              </div>
            ) : mode === "edit" ? (
              <div className="relative min-h-0 flex-1 overflow-hidden">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 overflow-hidden [scrollbar-gutter:stable]"
                >
                  <div className="py-4 font-mono text-xs leading-6" ref={editorGutterRef}>
                    {draft.split("\n").map((line, index) => (
                      <div className="grid min-h-6 grid-cols-[2.5rem_minmax(0,1fr)]" key={index}>
                        <span className="select-none border-r border-border/70 pr-3 text-right text-muted-foreground/55">
                          {index + 1}
                        </span>
                        <span className="invisible whitespace-pre-wrap break-words pl-4 pr-4">
                          {line}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <Textarea
                  aria-label="Edit prompt Markdown"
                  className="relative h-full min-h-full resize-none rounded-none border-0 bg-transparent py-4 pl-14 pr-4 font-mono text-xs leading-6 shadow-none [scrollbar-gutter:stable] focus-visible:outline-none"
                  onChange={(event) => setDraft(event.target.value)}
                  onScroll={(event) => {
                    if (editorGutterRef.current) {
                      editorGutterRef.current.style.transform = `translateY(-${event.currentTarget.scrollTop}px)`;
                    }
                  }}
                  value={draft}
                />
              </div>
            ) : mode === "preview" ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <MarkdownPreview
                  className="min-h-full px-4 py-4 text-sm [&_h1]:my-3! [&_h1]:text-lg! [&_h1]:leading-6! [&_h2]:my-2.5! [&_h2]:text-base! [&_h2]:leading-6! [&_h3]:my-2! [&_h3]:text-sm! [&_h3]:leading-5!"
                  markdown={showingHistorical || editorState !== "idle" ? resolvedMarkdown : draft}
                />
              </div>
            ) : (
              <div className="relative min-h-0 flex-1 overflow-y-auto">
                <pre
                  aria-label={displayedRevision ? "Pinned prompt source" : "Prompt source"}
                  className="min-h-full whitespace-pre-wrap break-words py-4 font-mono text-xs leading-6 selection:bg-primary selection:text-primary-foreground"
                  onKeyUp={captureSelection}
                  onPointerUp={captureSelection}
                  ref={sourceRef}
                  tabIndex={0}
                >
                  {renderSource(resolvedMarkdown, matchingHighlight?.text, highlightRef)}
                </pre>
              </div>
            )}
          </div>

          <footer className="shrink-0 border-t p-3">
            <div className="mb-1 flex min-h-7 items-center gap-2 px-1 text-xs">
              <MessageCircleMore
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
              {targetRunState === "loading" ? (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                  Checking Target Runs…
                </span>
              ) : targetRunState === "error" ? (
                <span className="text-muted-foreground">Target Runs unavailable</span>
              ) : latestTargetRun ? (
                <Link
                  className="min-w-0 truncate font-medium text-muted-foreground hover:text-foreground"
                  href={`/target-runs/${latestTargetRun.id}`}
                >
                  <span className="capitalize text-foreground">{latestTargetRun.latestStatus}</span>
                  {` · ${latestTargetRun.turnCount} ${latestTargetRun.turnCount === 1 ? "turn" : "turns"} · v${latestTargetRun.promptRevisionNumber}`}
                </Link>
              ) : (
                <span className="text-muted-foreground">No Target Runs yet</span>
              )}
            </div>
            <div className="mb-2 flex min-h-8 items-center gap-2 px-1 text-xs">
              <FlaskConical aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              {runState === "loading" ? (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                  Checking latest evaluation…
                </span>
              ) : runState === "error" ? (
                <span className="text-muted-foreground">Latest evaluation unavailable</span>
              ) : latestRun ? (
                <Link
                  className="min-w-0 truncate font-medium text-muted-foreground hover:text-foreground"
                  href={`/evaluations/${latestRun.id}`}
                >
                  <span className="capitalize text-foreground">{latestRun.status}</span>
                  {` · ${latestRun.caseCount} ${latestRun.caseCount === 1 ? "case" : "cases"} · `}
                  {latestRun.promptRevisionId === displayedRevisionId
                    ? `v${displayedPrompt?.revisionNumber ?? "current"}`
                    : "previous revision"}
                </Link>
              ) : (
                <span className="text-muted-foreground">No evaluations yet</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Link
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={`/prompts/${activePrompt.id}`}
              >
                <FileText aria-hidden="true" className="size-4" />
                Full workspace
              </Link>
              <Link
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={`/?mode=target&prompt=${activePrompt.id}`}
              >
                <MessageCircleMore aria-hidden="true" className="size-4" />
                Target Test
              </Link>
              <Link
                className="col-span-2 inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={`/evaluations?prompt=${activePrompt.id}`}
              >
                <FlaskConical aria-hidden="true" className="size-4" />
                Evaluate active
              </Link>
            </div>
          </footer>
        </>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center px-6 py-10 text-center text-xs text-muted-foreground">
          This prompt is no longer available.
        </div>
      )}
    </aside>
  );
}

function renderSource(
  markdown: string,
  highlightedText: string | undefined,
  highlightRef: RefObject<HTMLElement | null>,
) {
  const highlightStart = highlightedText ? markdown.indexOf(highlightedText) : -1;
  const highlightEnd = highlightStart < 0 ? -1 : highlightStart + (highlightedText?.length ?? 0);
  let lineStart = 0;

  return markdown.split("\n").map((line, index) => {
    const lineEnd = lineStart + line.length;
    const overlapStart = Math.max(lineStart, highlightStart);
    const overlapEnd = Math.min(lineEnd, highlightEnd);
    const hasHighlight = highlightStart >= 0 && overlapStart < overlapEnd;
    const before = hasHighlight ? line.slice(0, overlapStart - lineStart) : line;
    const highlighted = hasHighlight
      ? line.slice(overlapStart - lineStart, overlapEnd - lineStart)
      : "";
    const after = hasHighlight ? line.slice(overlapEnd - lineStart) : "";
    const firstHighlightedLine = hasHighlight && overlapStart === highlightStart;
    lineStart = lineEnd + 1;

    return (
      <span
        className="relative block min-h-6 pl-14 pr-4 before:absolute before:inset-y-0 before:left-0 before:w-10 before:select-none before:border-r before:border-border/70 before:pr-3 before:text-right before:text-muted-foreground/55 before:content-[attr(data-line)]"
        data-line={index + 1}
        key={index}
      >
        {before}
        {hasHighlight ? (
          <mark
            className="rounded-sm bg-accent px-0.5 text-accent-foreground ring-1 ring-foreground/20"
            ref={firstHighlightedLine ? highlightRef : undefined}
          >
            {highlighted}
          </mark>
        ) : null}
        {after}
      </span>
    );
  });
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

async function updatePrompt(
  promptId: string,
  body:
    | {
        action: "activate";
        expectedActiveRevisionId: string;
        revisionId: string;
      }
    | { action: "redo" | "undo"; expectedRevisionId: string }
    | { expectedRevisionId: string; markdown: string },
): Promise<PromptEditorSnapshot> {
  return requestJson<PromptEditorSnapshot>(
    `/api/prompts/${encodeURIComponent(promptId)}`,
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    },
    "Prompt update failed.",
  );
}

function projectActivePromptSummary(prompt: PromptEditorSnapshot): PromptSummary {
  const { markdown: _markdown, ...summary } = prompt;
  return {
    ...summary,
    revisionId: prompt.activeRevisionId,
    revisionNumber: prompt.activeRevisionNumber,
  };
}

function getPanelMaxWidth(availableWidth: number): number {
  return Math.max(
    MIN_PANEL_WIDTH,
    Math.min(MAX_PANEL_WIDTH, availableWidth * 0.6, availableWidth - MIN_CHAT_WIDTH),
  );
}

function clampPanelWidth(width: number, maximum: number): number {
  return Math.min(Math.max(width, MIN_PANEL_WIDTH), maximum);
}
