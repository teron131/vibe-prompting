/** Presents cursor-paginated evaluation cases as a filterable master-detail evidence workspace. */

"use client";

import {
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import Link from "next/link";
import { CSSProperties, SyntheticEvent, useCallback, useEffect, useRef, useState } from "react";

import { ModelIdentityLabel } from "@/components/chat/model-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/components/ui/utils";
import type {
  EvaluationDataType,
  EvaluationResultItem,
  EvaluationResultsResponse,
  EvaluationWorkspaceFacets,
  ResultFilters,
} from "@/contracts/evaluation-workspace";
import type { EvaluationRunStatus } from "@/contracts/evaluations";
import { requestJson } from "@/shared/api";
import { formatDateTime } from "@/shared/date";

import { EvaluationHelper } from "../shared/evaluation-helper";
import { ClearFilters, FilterSelect, MoreFilters } from "../shared/filter-controls";
import { evaluationFilterParams, parseEvaluationFilters } from "../shared/filter-state";
import { evaluationInputPreview, EvaluationTraceViewer, evaluationTurnCount } from "./trace-viewer";

const PAGE_SIZE = 25;
const LIST_MIN_WIDTH = 224;
const LIST_MAX_WIDTH = 560;
const DETAIL_MIN_WIDTH = 320;
const LIST_RESIZE_STEP = 24;

export function EvaluationResultsExplorer() {
  const [filters, setFilters] = useState<ResultFilters>({});
  const [draftSearch, setDraftSearch] = useState("");
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<EvaluationResultItem[]>([]);
  const [facets, setFacets] = useState<EvaluationWorkspaceFacets>(emptyFacets);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [selectedCaseId, setSelectedCaseId] = useState<string>();
  const [mobilePane, setMobilePane] = useState<"detail" | "results">("results");
  const [controlsOpen, setControlsOpen] = useState(true);
  const [resultListOpen, setResultListOpen] = useState(true);
  const [listWidth, setListWidth] = useState<number>();
  const [resizingList, setResizingList] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const resultListRef = useRef<HTMLElement>(null);
  const resizeOriginRef = useRef<
    { pointerId: number; startWidth: number; startX: number } | undefined
  >(undefined);

  useEffect(() => {
    const initialFilters = parseEvaluationFilters(window.location.search);
    setFilters(initialFilters);
    setDraftSearch(initialFilters.search ?? "");
    setReady(true);
  }, []);

  const load = useCallback(
    async (cursor?: string) => {
      const append = Boolean(cursor);
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(undefined);
      try {
        const params = evaluationFilterParams(filters);
        params.set("limit", String(PAGE_SIZE));
        if (cursor) params.set("cursor", cursor);
        const data = await requestJson<EvaluationResultsResponse>(
          `/api/evaluations/results?${params.toString()}`,
        );
        setItems((current) => (append ? [...current, ...data.items] : data.items));
        setFacets(data.facets);
        setNextCursor(data.nextCursor);
        setTotal(data.total);
        if (!append)
          setSelectedCaseId((current) =>
            data.items.some(({ caseId }) => caseId === current) ? current : data.items[0]?.caseId,
          );
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Evaluation results could not be loaded.",
        );
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [filters],
  );

  useEffect(() => {
    if (!ready) return;
    void load();
    const params = evaluationFilterParams(filters);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${params.size ? `?${params}` : ""}`,
    );
  }, [filters, load, ready]);

  const selected = items.find(({ caseId }) => caseId === selectedCaseId);
  const search = filters.search?.trim();
  const searchField = filters.searchField ?? "all";
  const literalMatches = search
    ? items.filter((item) => hasVisibleMatch(item, search, searchField)).length
    : 0;

  function submitSearch(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSearch = draftSearch.trim() || undefined;
    setFilters((current) => ({
      ...current,
      search: nextSearch,
      searchField: nextSearch ? current.searchField : undefined,
    }));
  }

  function updateFilter<Key extends keyof ResultFilters>(key: Key, value: ResultFilters[Key]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function clearFilters() {
    setDraftSearch("");
    setFilters({});
  }

  function boundedListWidth(width: number) {
    const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const maximum = Math.min(
      LIST_MAX_WIDTH,
      Math.max(LIST_MIN_WIDTH, workspaceWidth - DETAIL_MIN_WIDTH),
    );
    return Math.min(maximum, Math.max(LIST_MIN_WIDTH, width));
  }

  function resizeListBy(delta: number) {
    const currentWidth =
      resultListRef.current?.getBoundingClientRect().width ?? listWidth ?? LIST_MIN_WIDTH;
    setListWidth(boundedListWidth(currentWidth + delta));
  }

  function finishListResize(pointerId: number) {
    if (resizeOriginRef.current?.pointerId !== pointerId) return;
    resizeOriginRef.current = undefined;
    setResizingList(false);
  }

  return (
    <div
      className={cn(
        "flex min-h-[calc(100vh-var(--header-height))] flex-col @min-[560px]:h-[calc(100vh-var(--header-height))] @min-[560px]:min-h-[36rem] @min-[560px]:overflow-hidden",
        resizingList && "select-none cursor-col-resize",
      )}
    >
      <header className="border-b bg-muted/20 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-base font-semibold tracking-tight">Result explorer</h1>
          <div className="flex items-center gap-1">
            <div className="mr-1 hidden font-mono text-[11px] uppercase text-muted-foreground sm:block">
              {total.toLocaleString()} cases · {items.length.toLocaleString()} loaded
            </div>
            <Button
              aria-controls="result-explorer-controls"
              aria-expanded={controlsOpen}
              aria-label={controlsOpen ? "Hide search and filters" : "Show search and filters"}
              className="size-8"
              onClick={() => setControlsOpen((open) => !open)}
              size="icon"
              title={controlsOpen ? "Hide search and filters" : "Show search and filters"}
              variant="ghost"
            >
              <SlidersHorizontal aria-hidden="true" className="size-3.5" />
            </Button>
            <Button
              aria-controls="evaluation-results-list"
              aria-expanded={resultListOpen}
              aria-label={resultListOpen ? "Hide result list" : "Show result list"}
              className="hidden size-8 @min-[560px]:inline-flex"
              onClick={() => setResultListOpen((open) => !open)}
              size="icon"
              title={resultListOpen ? "Hide result list" : "Show result list"}
              variant="ghost"
            >
              {resultListOpen ? (
                <PanelLeftClose aria-hidden="true" className="size-3.5" />
              ) : (
                <PanelLeftOpen aria-hidden="true" className="size-3.5" />
              )}
            </Button>
          </div>
        </div>
        {controlsOpen ? (
          <div id="result-explorer-controls">
            <form
              className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap"
              onSubmit={submitSearch}
            >
              <div className="relative col-span-2 min-w-0 sm:flex-1 sm:basis-56">
                <Search
                  aria-hidden="true"
                  className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  aria-label="Search evaluation results"
                  className="h-8 pl-9 text-xs shadow-none"
                  onChange={(event) => setDraftSearch(event.target.value)}
                  placeholder="Find text in cases"
                  value={draftSearch}
                />
              </div>
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                in
                <Select
                  aria-label="Search field"
                  className="h-8 w-auto text-xs shadow-none"
                  onChange={(event) =>
                    updateFilter(
                      "searchField",
                      (event.target.value === "all"
                        ? undefined
                        : event.target.value) as ResultFilters["searchField"],
                    )
                  }
                  value={filters.searchField ?? "all"}
                >
                  <option value="all">All fields</option>
                  <option value="input">Input</option>
                  <option value="output">Output</option>
                  <option value="comment">Rationale</option>
                  <option value="evidence">Evidence</option>
                </Select>
              </label>
              <Button size="sm" type="submit">
                Search
              </Button>
            </form>
            <EvaluationHelper className="mt-2 rounded-md border bg-accent/40 p-2" />
            <ResultFiltersToolbar
              clearFilters={clearFilters}
              facets={facets}
              filters={filters}
              updateFilter={updateFilter}
            />
          </div>
        ) : null}
      </header>

      <div
        className="grid @min-[560px]:min-h-0 @min-[560px]:flex @min-[560px]:flex-1"
        ref={workspaceRef}
      >
        <div className="border-b @min-[560px]:hidden">
          <div className="grid grid-cols-2">
            <button
              aria-pressed={mobilePane === "results"}
              className={cn(
                "border-b-2 py-2.5 text-xs font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                mobilePane === "results"
                  ? "border-foreground"
                  : "border-transparent text-muted-foreground",
              )}
              onClick={() => setMobilePane("results")}
              type="button"
            >
              Results {items.length}
            </button>
            <button
              aria-pressed={mobilePane === "detail"}
              className={cn(
                "border-b-2 py-2.5 text-xs font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
                mobilePane === "detail"
                  ? "border-foreground"
                  : "border-transparent text-muted-foreground",
              )}
              disabled={!selected}
              onClick={() => setMobilePane("detail")}
              type="button"
            >
              Selected case
            </button>
          </div>
        </div>

        <section
          aria-label="Evaluation result list"
          className={cn(
            "min-h-0 bg-muted/15 @min-[560px]:block @min-[560px]:w-[var(--results-list-width)] @min-[560px]:min-w-56 @min-[560px]:max-w-[calc(100%-20rem)] @min-[560px]:shrink-0 @min-[560px]:overflow-y-auto @min-[560px]:[--results-list-width:16rem] @min-[760px]:[--results-list-width:20rem] @min-[1200px]:[--results-list-width:23rem]",
            mobilePane === "results" ? "block" : "hidden",
            !resultListOpen && "@min-[560px]:hidden",
          )}
          id="evaluation-results-list"
          ref={resultListRef}
          style={
            listWidth === undefined
              ? undefined
              : ({ "--results-list-width": `${listWidth}px` } as CSSProperties)
          }
        >
          {loading ? (
            <LoadingState label="Loading evaluation results" />
          ) : error ? (
            <ErrorState message={error} retry={() => void load()} />
          ) : items.length ? (
            <>
              {search && literalMatches === 0 ? (
                <p className="border-b bg-background/60 px-4 py-3 text-xs leading-5 text-muted-foreground">
                  Nothing contains “{search}” word for word. These cases are the closest by meaning,
                  so the text below is not highlighted.
                </p>
              ) : null}
              <div className="divide-y">
                {items.map((item) => (
                  <ResultRow
                    item={item}
                    key={item.caseId}
                    onSelect={() => {
                      setSelectedCaseId(item.caseId);
                      setMobilePane("detail");
                    }}
                    related={Boolean(
                      search && literalMatches > 0 && !hasVisibleMatch(item, search, searchField),
                    )}
                    search={searchForField(filters.search, searchField, "input")}
                    selected={item.caseId === selectedCaseId}
                  />
                ))}
              </div>
              {nextCursor ? (
                <div className="border-t p-3">
                  <Button
                    className="w-full"
                    disabled={loadingMore}
                    onClick={() => void load(nextCursor)}
                    variant="outline"
                  >
                    {loadingMore ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                    Load next {Math.min(PAGE_SIZE, total - items.length)}
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="p-6 text-sm text-muted-foreground">
              No cases match this query. Clear a filter or search a broader phrase.
            </div>
          )}
        </section>

        {resultListOpen ? (
          <div
            aria-label="Resize result list"
            aria-orientation="vertical"
            aria-valuetext={
              listWidth === undefined
                ? "Default result list width"
                : `${Math.round(listWidth)} pixels`
            }
            className="group relative z-10 hidden w-1.5 shrink-0 cursor-col-resize touch-none outline-none @min-[560px]:block"
            onDoubleClick={() => setListWidth(undefined)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                resizeListBy(-LIST_RESIZE_STEP);
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                resizeListBy(LIST_RESIZE_STEP);
              } else if (event.key === "Home") {
                event.preventDefault();
                setListWidth(LIST_MIN_WIDTH);
              } else if (event.key === "End") {
                event.preventDefault();
                setListWidth(boundedListWidth(LIST_MAX_WIDTH));
              }
            }}
            onLostPointerCapture={(event) => finishListResize(event.pointerId)}
            onPointerCancel={(event) => finishListResize(event.pointerId)}
            onPointerDown={(event) => {
              if (event.button !== 0 || !resultListRef.current) return;
              event.preventDefault();
              resizeOriginRef.current = {
                pointerId: event.pointerId,
                startWidth: resultListRef.current.getBoundingClientRect().width,
                startX: event.clientX,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
              setResizingList(true);
            }}
            onPointerMove={(event) => {
              const origin = resizeOriginRef.current;
              if (!origin || origin.pointerId !== event.pointerId) return;
              setListWidth(boundedListWidth(origin.startWidth + event.clientX - origin.startX));
            }}
            onPointerUp={(event) => {
              if (resizeOriginRef.current?.pointerId !== event.pointerId) return;
              event.currentTarget.releasePointerCapture(event.pointerId);
              finishListResize(event.pointerId);
            }}
            role="separator"
            tabIndex={0}
            title="Drag to resize. Double-click to reset."
          >
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-foreground/50 group-focus-visible:w-0.5 group-focus-visible:bg-ring" />
          </div>
        ) : null}

        <section
          aria-label="Selected evaluation result"
          className={cn(
            "min-w-0 bg-background @min-[560px]:block @min-[560px]:flex-1 @min-[560px]:overflow-y-auto",
            mobilePane === "detail" ? "block" : "hidden",
          )}
        >
          {selected ? (
            <>
              <p aria-live="polite" className="sr-only">
                {selected.promptTitle} version {selected.promptRevisionNumber} selected,{" "}
                {selected.status}.
              </p>
              <ResultDetailPane item={selected} search={filters.search} searchField={searchField} />
            </>
          ) : items.length ? (
            <div className="grid min-h-72 place-items-center p-6 text-sm text-muted-foreground">
              Select a case to inspect its output and attributed score evidence.
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function ResultFiltersToolbar({
  clearFilters,
  facets,
  filters,
  updateFilter,
}: {
  clearFilters(): void;
  facets: EvaluationWorkspaceFacets;
  filters: ResultFilters;
  updateFilter<Key extends keyof ResultFilters>(key: Key, value: ResultFilters[Key]): void;
}) {
  const hiddenActive = [filters.status, filters.dataType].filter(Boolean).length;
  const activeCount = [
    filters.promptId,
    filters.promptRevisionId,
    filters.targetModelId,
    filters.judgeModelId,
    filters.status,
    filters.dataType,
    filters.criterion,
    filters.search,
    filters.from,
    filters.runId,
    filters.to,
  ].filter(Boolean).length;
  const hasLinkedScope = Boolean(
    filters.promptRevisionId || filters.from || filters.runId || filters.to,
  );

  return (
    <section aria-labelledby="result-scope-heading" className="mt-2">
      <h2 className="sr-only" id="result-scope-heading">
        Scope
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          className="w-auto max-w-[14rem] flex-1 basis-40"
          label="Prompt"
          onChange={(event) => updateFilter("promptId", event.target.value || undefined)}
          value={filters.promptId ?? ""}
        >
          <option value="">All prompts</option>
          {facets.prompts.map((facet) => (
            <option key={facet.id} value={facet.id}>
              {facet.label} ({facet.count})
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          className="w-auto max-w-[14rem] flex-1 basis-40"
          label="Target model"
          onChange={(event) => updateFilter("targetModelId", event.target.value || undefined)}
          value={filters.targetModelId ?? ""}
        >
          <option value="">All target models</option>
          {facets.targetModels.map((facet) => (
            <option key={facet.value} value={facet.value}>
              {facet.value} ({facet.count})
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          className="w-auto max-w-[14rem] flex-1 basis-40"
          label="Judge"
          onChange={(event) => updateFilter("judgeModelId", event.target.value || undefined)}
          value={filters.judgeModelId ?? ""}
        >
          <option value="">All judges</option>
          {facets.judges.map((facet) => (
            <option key={facet.value} value={facet.value}>
              {facet.value} ({facet.count})
            </option>
          ))}
        </FilterSelect>
        <MoreFilters
          activeCount={hiddenActive}
          contentClassName="flex flex-wrap gap-2"
          hint="status · type"
        >
          <FilterSelect
            className="w-auto max-w-[14rem] flex-1 basis-40"
            label="Run status"
            onChange={(event) =>
              updateFilter(
                "status",
                (event.target.value || undefined) as EvaluationRunStatus | undefined,
              )
            }
            value={filters.status ?? ""}
          >
            <option value="">All statuses</option>
            {facets.statuses.map((facet) => (
              <option key={facet.value} value={facet.value}>
                {facet.value} ({facet.count})
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            className="w-auto max-w-[14rem] flex-1 basis-40"
            label="Score type"
            onChange={(event) =>
              updateFilter(
                "dataType",
                (event.target.value || undefined) as EvaluationDataType | undefined,
              )
            }
            value={filters.dataType ?? ""}
          >
            <option value="">All score types</option>
            {facets.dataTypes.map((facet) => (
              <option key={facet.value} value={facet.value}>
                {facet.value} ({facet.count})
              </option>
            ))}
          </FilterSelect>
        </MoreFilters>
        <ClearFilters count={activeCount} onClear={clearFilters} />
      </div>
      {filters.criterion ? (
        <div className="mt-2 flex min-w-0 items-center gap-2 rounded-md border bg-accent/50 px-2 py-1 text-xs">
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">Criterion</span>
          <span className="min-w-0 flex-1 truncate font-medium">{filters.criterion}</span>
          <button
            aria-label="Remove criterion filter"
            className="shrink-0 font-medium text-muted-foreground hover:text-foreground"
            onClick={() => updateFilter("criterion", undefined)}
            type="button"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      ) : null}
      {hasLinkedScope ? (
        <div aria-label="Linked result scope" className="mt-2 flex flex-wrap gap-2" role="group">
          {filters.promptRevisionId ? (
            <ScopeFilter
              label="Revision"
              onRemove={() => updateFilter("promptRevisionId", undefined)}
              value={filters.promptRevisionId.slice(0, 8)}
            />
          ) : null}
          {filters.from ? (
            <ScopeFilter
              label="From"
              onRemove={() => updateFilter("from", undefined)}
              value={filters.from.slice(0, 10)}
            />
          ) : null}
          {filters.to ? (
            <ScopeFilter
              label="To"
              onRemove={() => updateFilter("to", undefined)}
              value={filters.to.slice(0, 10)}
            />
          ) : null}
          {filters.runId ? (
            <ScopeFilter
              label="Run"
              onRemove={() => updateFilter("runId", undefined)}
              value={filters.runId.slice(0, 8)}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ScopeFilter({
  label,
  onRemove,
  value,
}: {
  label: string;
  onRemove(): void;
  value: string;
}) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-accent/50 px-2 text-xs">
      <span className="font-mono text-[11px] uppercase text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
      <button
        aria-label={`Remove ${label.toLocaleLowerCase()} filter`}
        className="-mr-1 inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={onRemove}
        type="button"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </span>
  );
}

function ResultRow({
  item,
  onSelect,
  related,
  search,
  selected,
}: {
  item: EvaluationResultItem;
  onSelect(): void;
  related: boolean;
  search?: string;
  selected: boolean;
}) {
  const marks = scoreMarks(item);
  const turnCount = evaluationTurnCount(item);
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "block w-full px-4 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        selected && "bg-accent hover:bg-accent",
      )}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cn("min-w-0 truncate text-sm", selected ? "font-semibold" : "font-medium")}
          >
            {item.promptTitle} · v{item.promptRevisionNumber}
          </span>
          {turnCount > 1 ? (
            <span className="shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {turnCount} turns
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {related ? (
            <span className="rounded-sm border px-1.5 py-0.5 text-[11px] text-muted-foreground">
              Related
            </span>
          ) : null}
          <Status status={item.status} />
        </span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        <HighlightedText search={search} value={evaluationInputPreview(item)} />
      </p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 gap-2 font-mono text-[11px]">
          {marks.map((mark) => (
            <span className={scoreColor(mark)} key={mark}>
              {mark}
            </span>
          ))}
        </div>
        <time className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {formatShortDateTime(item.createdAt)}
        </time>
      </div>
    </button>
  );
}

function ResultDetailPane({
  item,
  search,
  searchField,
}: {
  item: EvaluationResultItem;
  search?: string;
  searchField: NonNullable<ResultFilters["searchField"]>;
}) {
  return (
    <article className="px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <header className="border-b pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">
                {item.promptTitle} · v{item.promptRevisionNumber}
              </h2>
              {item.isSyntheticExample ? (
                <span className="rounded-sm border bg-secondary/50 px-1.5 py-0.5 text-[11px] font-medium uppercase text-muted-foreground">
                  Synthetic
                </span>
              ) : null}
              <Status status={item.status} />
            </div>
          </div>
          <Link
            className="inline-flex items-center gap-1.5 text-xs font-medium hover:underline"
            href={`/evaluations/${item.runId}`}
          >
            Run provenance
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </Link>
        </div>
        <dl className="mt-4 grid gap-x-6 gap-y-2 pt-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
          <ModelMetadata label="Target" modelIds={[item.targetModelId]} />
          <Metadata
            label="Revision"
            value={`v${item.promptRevisionNumber} · ${item.promptRevisionId.slice(0, 8)}`}
          />
          <ModelMetadata label="Judges" modelIds={item.judgeModelIds} />
          <Metadata
            label="Completed"
            value={item.completedAt ? formatDateTime(item.completedAt) : "—"}
          />
        </dl>
        {item.errorMessage ? (
          <div className="mt-4 flex items-start gap-2 border-t pt-4 text-xs leading-relaxed text-destructive">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0">{item.errorMessage}</span>
          </div>
        ) : null}
      </header>

      <EvaluationTraceViewer item={item} />

      <section className="pt-5">
        <div className="flex items-baseline justify-between gap-4 pb-3">
          <h3 className="text-sm font-semibold">Attributed score evidence</h3>
          <span className="font-mono text-[11px] text-muted-foreground">
            {item.scores.length} score facts
          </span>
        </div>
        {item.scores.length ? (
          <div className="divide-y">
            {item.scores.map((score) => (
              <div className="grid gap-4 py-4 xl:grid-cols-[14rem_minmax(0,1fr)]" key={score.id}>
                <div>
                  <div className="font-mono text-[11px] uppercase text-muted-foreground">
                    C{score.criterionPosition + 1} · {score.dataType}
                  </div>
                  <div className="mt-1 text-sm font-medium">{score.criterion.instruction}</div>
                  <div
                    className={cn(
                      "mt-2 font-mono text-xs font-semibold",
                      scoreColor(formatScore(score.value)),
                    )}
                  >
                    {formatScore(score.value)}
                  </div>
                </div>
                <div className="min-w-0">
                  <ModelIdentityLabel
                    className="text-muted-foreground"
                    labelClassName="font-mono text-[11px]"
                    modelId={score.judgeModelId}
                    variant="short-id"
                  />
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    <HighlightedText
                      search={searchForField(search, searchField, "comment")}
                      value={score.comment}
                    />
                  </p>
                  {score.evidence.length ? (
                    <ul className="mt-3 space-y-1.5 text-xs leading-relaxed">
                      {score.evidence.map((evidence) => (
                        <li className="border-l pl-3" key={evidence}>
                          <HighlightedText
                            search={searchForField(search, searchField, "evidence")}
                            value={evidence}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-5 text-sm text-muted-foreground">
            No score facts were persisted for this case.
          </p>
        )}
      </section>
    </article>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-[11px]">{value}</dd>
    </div>
  );
}

function ModelMetadata({ label, modelIds }: { label: string; modelIds: string[] }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1">
        {[...new Set(modelIds)].map((modelId) => (
          <ModelIdentityLabel
            className="max-w-full text-foreground"
            key={modelId}
            labelClassName="font-mono text-[11px]"
            modelId={modelId}
            variant="short-id"
          />
        ))}
      </dd>
    </div>
  );
}

function Status({ status }: { status: EvaluationRunStatus }) {
  return (
    <span
      className={cn(
        "rounded-sm px-1.5 py-0.5 text-[11px] font-medium capitalize",
        status === "completed" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        status === "running" && "bg-blue-500/10 text-blue-700 dark:text-blue-400",
        (status === "failed" || status === "interrupted") && "bg-destructive/10 text-destructive",
      )}
    >
      {status}
    </span>
  );
}

function HighlightedText({ search, value }: { search?: string; value: string }) {
  const query = search?.trim();
  if (!query) return value;
  const pattern = new RegExp(`(${escapeRegExp(query)})`, "gi");
  return value.split(pattern).map((part, index) =>
    part.toLocaleLowerCase() === query.toLocaleLowerCase() ? (
      <mark
        className="bg-amber-200 px-0.5 text-amber-950 dark:bg-amber-400/30 dark:text-amber-100"
        key={`${part}-${index}`}
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="grid min-h-64 place-items-center text-sm text-muted-foreground">
      <span className="flex items-center gap-2">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        {label}
      </span>
    </div>
  );
}

function ErrorState({ message, retry }: { message: string; retry(): void }) {
  return (
    <div className="p-5">
      <div className="flex items-start gap-2 text-sm text-destructive">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4" />
        <span>{message}</span>
      </div>
      <Button className="mt-4" onClick={retry} size="sm" variant="outline">
        Retry
      </Button>
    </div>
  );
}

/** Reports whether a case literally contains the query in the selected field, so semantic-only matches are never presented as keyword hits. */
function hasVisibleMatch(
  item: EvaluationResultItem,
  query: string,
  field: NonNullable<ResultFilters["searchField"]>,
): boolean {
  const needle = query.toLocaleLowerCase();
  const haystacks =
    field === "input"
      ? [stringify(item.input)]
      : field === "output"
        ? [stringify(item.output)]
        : field === "comment"
          ? item.scores.map(({ comment }) => comment)
          : field === "evidence"
            ? item.scores.flatMap(({ evidence }) => evidence)
            : [
                stringify(item.input),
                stringify(item.output),
                ...item.scores.flatMap((score) => [score.comment, ...score.evidence]),
              ];
  return haystacks.some((value) => value.toLocaleLowerCase().includes(needle));
}

function searchForField(
  search: string | undefined,
  selectedField: NonNullable<ResultFilters["searchField"]>,
  field: Exclude<NonNullable<ResultFilters["searchField"]>, "all">,
): string | undefined {
  return selectedField === "all" || selectedField === field ? search : undefined;
}

function scoreMarks(item: EvaluationResultItem): string[] {
  return [...new Set(item.scores.map(({ value }) => formatScore(value)))].slice(0, 4);
}

function formatScore(value: boolean | number | string): string {
  if (typeof value === "boolean") return value ? "PASS" : "FAIL";
  if (typeof value === "number")
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return value.toLocaleUpperCase();
}

function scoreColor(value: string): string {
  const normalized = value.toLocaleLowerCase();
  if (["pass", "good", "true"].includes(normalized))
    return "text-emerald-700 dark:text-emerald-400";
  if (["fail", "bad", "false"].includes(normalized)) return "text-destructive";
  if (["partial", "decent"].includes(normalized)) return "text-amber-700 dark:text-amber-400";
  return "text-foreground";
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "No value persisted.";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function formatShortDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const emptyFacets: EvaluationWorkspaceFacets = {
  dataTypes: [],
  judges: [],
  prompts: [],
  revisions: [],
  statuses: [],
  targetModels: [],
};
