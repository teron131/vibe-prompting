/** Keeps one saved prompt and its exact revision visible beside chat while owning prompt switching, source quoting, and compact evaluation context. */

"use client";

import {
  ArrowUpRight,
  Check,
  FileText,
  FlaskConical,
  LoaderCircle,
  Quote,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import type { RefObject } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PromptQuote } from "@/contracts/chat";
import type { EvaluationRunsResponse, EvaluationRunSummary } from "@/contracts/evaluations";
import type { PromptDetail, PromptRevision, PromptSummary } from "@/contracts/prompts";
import { usePromptSearch } from "@/hooks/use-prompt-search";

export function PromptWorkspace({
  activePrompt,
  highlightedQuote,
  onClose,
  onQuote,
  onSelectPrompt,
  open,
  prompts,
}: {
  activePrompt?: PromptSummary;
  highlightedQuote?: PromptQuote;
  onClose(): void;
  onQuote(quote: PromptQuote): void;
  onSelectPrompt(prompt: PromptSummary): void;
  open: boolean;
  prompts: PromptSummary[];
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const sourceRef = useRef<HTMLPreElement>(null);
  const highlightRef = useRef<HTMLElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [latestRun, setLatestRun] = useState<EvaluationRunSummary>();
  const [runState, setRunState] = useState<"error" | "idle" | "loading">("idle");
  const [historicalRevision, setHistoricalRevision] = useState<PromptRevision>();
  const [historicalState, setHistoricalState] = useState<"error" | "idle" | "loading">("idle");
  const [dismissedHistoryKey, setDismissedHistoryKey] = useState<string>();
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

  const historicalQuoteKey =
    activePrompt &&
    highlightedQuote?.promptId === activePrompt.id &&
    highlightedQuote.revisionId !== activePrompt.revisionId
      ? `${highlightedQuote.promptId}:${highlightedQuote.revisionId}`
      : undefined;
  const displayedRevision =
    historicalQuoteKey && historicalQuoteKey !== dismissedHistoryKey
      ? historicalRevision
      : undefined;
  const displayedMarkdown = displayedRevision?.markdown ?? activePrompt?.markdown;
  const displayedRevisionId = displayedRevision?.id ?? activePrompt?.revisionId;
  const matchingHighlight =
    activePrompt &&
    highlightedQuote?.promptId === activePrompt.id &&
    highlightedQuote.revisionId === displayedRevisionId
      ? highlightedQuote
      : undefined;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    function updateMobileState() {
      setIsMobile(mediaQuery.matches);
    }
    updateMobileState();
    mediaQuery.addEventListener("change", updateMobileState);
    return () => mediaQuery.removeEventListener("change", updateMobileState);
  }, []);

  useEffect(() => {
    if (!open || !isMobile) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    window.requestAnimationFrame(() => panel?.querySelector<HTMLInputElement>("input")?.focus());

    function containFocus(event: KeyboardEvent) {
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getAttribute("aria-hidden") !== "true");
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (
        event.shiftKey &&
        (document.activeElement === first || !panel.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !panel.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", containFocus);
    return () => {
      document.removeEventListener("keydown", containFocus);
      previouslyFocused?.focus();
    };
  }, [isMobile, open]);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  useEffect(() => {
    setSelectedText("");
  }, [displayedRevisionId]);

  useEffect(() => {
    if (!activePrompt) {
      setLatestRun(undefined);
      setRunState("idle");
      return;
    }

    const controller = new AbortController();
    setLatestRun(undefined);
    setRunState("loading");
    void fetch(`/api/evaluations?promptId=${encodeURIComponent(activePrompt.id)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Evaluation request failed.");
        return (await response.json()) as EvaluationRunsResponse;
      })
      .then(({ runs }) => {
        setLatestRun(runs[0]);
        setRunState("idle");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRunState("error");
      });
    return () => controller.abort();
  }, [activePrompt]);

  useEffect(() => {
    setHistoricalRevision(undefined);
    setHistoricalState("idle");
    if (
      !historicalQuoteKey ||
      historicalQuoteKey === dismissedHistoryKey ||
      !activePrompt ||
      !highlightedQuote
    )
      return;

    const controller = new AbortController();
    setHistoricalState("loading");
    void fetch(`/api/prompts/${encodeURIComponent(activePrompt.id)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Prompt revision request failed.");
        return (await response.json()) as PromptDetail;
      })
      .then(({ revisions }) => {
        const revision = revisions.find(({ id }) => id === highlightedQuote.revisionId);
        if (!revision) throw new Error("Prompt revision was not found.");
        setHistoricalRevision(revision);
        setHistoricalState("idle");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setHistoricalState("error");
      });
    return () => controller.abort();
  }, [activePrompt, dismissedHistoryKey, highlightedQuote, historicalQuoteKey]);

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
    if (!activePrompt || !displayedRevisionId || !selectedText) return;
    onQuote({
      promptId: activePrompt.id,
      revisionId: displayedRevisionId,
      text: selectedText,
      title: activePrompt.title,
    });
    window.getSelection()?.removeAllRanges();
    setSelectedText("");
  }

  return (
    <>
      <button
        aria-hidden="true"
        className="fixed inset-0 z-40 bg-background/80 lg:hidden"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <aside
        aria-labelledby={titleId}
        aria-modal={isMobile ? true : undefined}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l bg-background shadow-2xl lg:relative lg:z-auto lg:w-[24rem] lg:max-w-none lg:shrink-0 lg:shadow-none"
        ref={panelRef}
        role={isMobile ? "dialog" : undefined}
      >
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <FileText aria-hidden="true" className="size-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold" id={titleId}>
              Prompt workspace
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {activePrompt ? activePrompt.title : "No active prompt"}
            </p>
          </div>
          <Button aria-label="Close prompt workspace" onClick={onClose} size="icon" variant="ghost">
            <X aria-hidden="true" className="size-4" />
          </Button>
        </header>

        <div className="border-b p-3">
          <label className="relative block">
            <span className="sr-only">Search saved prompts</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              className="h-9 pl-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search saved prompts"
              value={query}
            />
          </label>
          {hasSearchQuery ? (
            <div
              aria-label="Prompt search results"
              className="mt-2 max-h-48 overflow-y-auto rounded-lg border bg-card p-1"
            >
              {searchLoading ? (
                <p className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-muted-foreground">
                  <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                  Searching words and meaning…
                </p>
              ) : searchError ? (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">{searchError}</p>
              ) : searchResults.length ? (
                searchResults.map((prompt) => (
                  <button
                    aria-current={prompt.id === activePrompt?.id ? "true" : undefined}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    key={prompt.id}
                    onClick={() => {
                      onSelectPrompt(prompt);
                      setQuery("");
                    }}
                    type="button"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{prompt.title}</span>
                      <span className="mt-0.5 block line-clamp-2 text-xs leading-4 text-muted-foreground">
                        {prompt.snippet}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {prompt.revisionId.slice(0, 8)} · {prompt.revisionCount}{" "}
                        {prompt.revisionCount === 1 ? "revision" : "revisions"}
                      </span>
                    </span>
                    {prompt.id === activePrompt?.id ? (
                      <Check aria-label="Active prompt" className="size-4 shrink-0" />
                    ) : null}
                  </button>
                ))
              ) : (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  No prompts match “{query}”.
                </p>
              )}
            </div>
          ) : null}
        </div>

        {activePrompt ? (
          <>
            <section className="shrink-0 border-b px-4 py-3" aria-label="Active prompt details">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold">{activePrompt.title}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="font-mono">{displayedRevisionId?.slice(0, 8)}</span>
                    <span aria-hidden="true">·</span>
                    {displayedRevision ? (
                      <span className="font-medium text-foreground">Historical revision</span>
                    ) : (
                      <span>
                        {activePrompt.revisionCount}{" "}
                        {activePrompt.revisionCount === 1 ? "revision" : "revisions"}
                      </span>
                    )}
                    <span aria-hidden="true">·</span>
                    <span>
                      Edited {formatDate(displayedRevision?.createdAt ?? activePrompt.updatedAt)}
                    </span>
                  </div>
                  {displayedRevision ? (
                    <button
                      className="mt-2 text-xs font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => {
                        if (historicalQuoteKey) setDismissedHistoryKey(historicalQuoteKey);
                        setHistoricalRevision(undefined);
                      }}
                      type="button"
                    >
                      Back to current
                    </button>
                  ) : historicalState === "loading" ? (
                    <span className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />
                      Loading quoted revision…
                    </span>
                  ) : historicalState === "error" ? (
                    <span className="mt-2 block text-xs text-muted-foreground">
                      Quoted revision unavailable
                    </span>
                  ) : null}
                </div>
                <Link
                  aria-label={`Open full prompt details for ${activePrompt.title}`}
                  className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  href={`/prompts/${activePrompt.id}`}
                >
                  <ArrowUpRight aria-hidden="true" className="size-4" />
                </Link>
              </div>
            </section>

            <div className="relative min-h-0 flex-1 overflow-y-auto">
              <div className="sticky top-0 z-10 flex min-h-10 items-center justify-between gap-3 border-b bg-background/95 px-4 py-2 supports-[backdrop-filter]:backdrop-blur-sm">
                <span className="text-xs font-medium text-muted-foreground">Markdown source</span>
                {selectedText ? (
                  <Button className="h-7" onClick={quoteSelection} size="sm" variant="secondary">
                    <Quote aria-hidden="true" className="size-3.5" />
                    Quote selection
                  </Button>
                ) : (
                  <span className="text-[11px] text-muted-foreground">Select text to quote</span>
                )}
              </div>
              <pre
                className="min-h-full whitespace-pre-wrap break-words px-4 py-4 font-mono text-xs leading-6 selection:bg-primary selection:text-primary-foreground"
                onKeyUp={captureSelection}
                onPointerUp={captureSelection}
                ref={sourceRef}
                tabIndex={0}
              >
                {renderSource(displayedMarkdown ?? "", matchingHighlight?.text, highlightRef)}
              </pre>
            </div>

            <footer className="shrink-0 border-t p-3">
              <div className="mb-2 flex min-h-8 items-center gap-2 px-1 text-xs">
                <FlaskConical
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
                {runState === "loading" ? (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                    Checking latest evaluation…
                  </span>
                ) : runState === "error" ? (
                  <span className="text-muted-foreground">Latest evaluation unavailable</span>
                ) : latestRun ? (
                  <span className="min-w-0 truncate text-muted-foreground">
                    Latest evaluation:{" "}
                    <span className="font-medium capitalize text-foreground">
                      {latestRun.status}
                    </span>
                    {latestRun.promptRevisionId !== activePrompt.revisionId
                      ? " on a previous revision"
                      : " on this revision"}
                  </span>
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
                  Full prompt
                </Link>
                <Link
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  href={`/evaluations?prompt=${activePrompt.id}`}
                >
                  <FlaskConical aria-hidden="true" className="size-4" />
                  Evaluate
                </Link>
              </div>
            </footer>
          </>
        ) : (
          <div className="grid min-h-0 flex-1 place-items-center px-6 py-10 text-center">
            <div className="max-w-64">
              <FileText aria-hidden="true" className="mx-auto size-6 text-muted-foreground" />
              <h3 className="mt-3 text-sm font-medium">No prompt in this chat</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {
                  "Search above to keep one saved prompt visible, quote its exact revision, or start an evaluation."
                }
              </p>
              {prompts.length === 0 ? (
                <Link
                  className="mt-4 inline-flex text-xs font-medium underline-offset-4 hover:underline"
                  href="/prompts"
                >
                  Create a saved prompt
                </Link>
              ) : null}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

function renderSource(
  markdown: string,
  highlightedText: string | undefined,
  highlightRef: RefObject<HTMLElement | null>,
) {
  if (!highlightedText) return markdown;
  const index = markdown.indexOf(highlightedText);
  if (index < 0) return markdown;
  return (
    <>
      {markdown.slice(0, index)}
      <mark
        className="rounded-sm bg-accent px-0.5 text-accent-foreground ring-1 ring-foreground/20"
        ref={highlightRef}
      >
        {highlightedText}
      </mark>
      {markdown.slice(index + highlightedText.length)}
    </>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}
