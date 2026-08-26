/** Presents cursor-paginated evaluation cases as a filterable master-detail evidence workspace. */

"use client";

import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { CSSProperties, SyntheticEvent, useCallback, useEffect, useRef, useState } from "react";

import { ModelIdentityLabel } from "@/components/chat/model-selector";
import { DefaultExampleBadge } from "@/components/evaluations/shared/default-example-badge";
import { EvaluationPageBar } from "@/components/evaluations/shared/evaluation-page-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { maximumResizablePanelWidth, ResizableDivider } from "@/components/ui/resizable-divider";
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
import { ClearFilters, FilterSelect, MultiFilterSelect } from "../shared/filter-controls";
import { evaluationFilterParams, parseEvaluationFilters } from "../shared/filter-state";
import { evaluationInputPreview, EvaluationTraceViewer, evaluationTurnCount } from "./trace-viewer";

const PAGE_SIZE = 25;
const LIST_MIN_WIDTH = 224;
const LIST_MAX_WIDTH = 560;
const DETAIL_MIN_WIDTH = 320;
const CONTROLS_OPEN_STORAGE_KEY = "evaluation-results-controls-open";
const RESULT_LIST_OPEN_STORAGE_KEY = "evaluation-results-list-open";

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
  const [controlsOpen, setControlsOpen] = useState<boolean | null>(null);
  const [resultListOpen, setResultListOpen] = useState<boolean | null>(null);
  const [detailScrolled, setDetailScrolled] = useState(false);
  const [listWidth, setListWidth] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const resultListRef = useRef<HTMLElement>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const initialFilters = parseEvaluationFilters(window.location.search);
    const storedControlsOpen = window.localStorage.getItem(CONTROLS_OPEN_STORAGE_KEY);
    const storedResultListOpen = window.localStorage.getItem(RESULT_LIST_OPEN_STORAGE_KEY);
    setFilters(initialFilters);
    setDraftSearch(initialFilters.search ?? "");
    setControlsOpen(storedControlsOpen === null ? true : storedControlsOpen === "true");
    setResultListOpen(storedResultListOpen === null ? true : storedResultListOpen === "true");
    setReady(true);
  }, []);

  function toggleControls() {
    setControlsOpen((open) => {
      const next = !open;
      window.localStorage.setItem(CONTROLS_OPEN_STORAGE_KEY, String(next));
      return next;
    });
  }

  function toggleResultList() {
    setResultListOpen((open) => {
      const next = !open;
      window.localStorage.setItem(RESULT_LIST_OPEN_STORAGE_KEY, String(next));
      return next;
    });
  }

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

  function maximumListWidth() {
    return maximumResizablePanelWidth({
      contentMinWidth: DETAIL_MIN_WIDTH,
      maxWidth: LIST_MAX_WIDTH,
      minWidth: LIST_MIN_WIDTH,
      workspace: workspaceRef.current,
    });
  }

  return (
    <div className="flex min-h-[calc(100dvh-var(--header-height))] w-full min-w-0 max-w-full flex-col @min-[560px]:h-[calc(100dvh-var(--header-height))] @min-[560px]:min-h-[36rem] @min-[560px]:overflow-hidden">
      <div
        className="grid w-full min-w-0 max-w-full @min-[560px]:min-h-0 @min-[560px]:flex @min-[560px]:flex-1"
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
              Selected Case
            </button>
          </div>
        </div>

        <section
          aria-label="Evaluation result list"
          className={cn(
            "relative min-h-0 min-w-0 max-w-full bg-muted/15 @min-[560px]:flex @min-[560px]:w-[var(--results-list-width)] @min-[560px]:min-w-56 @min-[560px]:max-w-[calc(100%-20rem)] @min-[560px]:shrink-0 @min-[560px]:flex-col @min-[560px]:[--results-list-width:16rem] @min-[760px]:[--results-list-width:20rem] @min-[1200px]:[--results-list-width:23rem]",
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
          <ResultExplorerControls
            clearFilters={clearFilters}
            controlsOpen={controlsOpen}
            draftSearch={draftSearch}
            facets={facets}
            filters={filters}
            itemCount={items.length}
            setDraftSearch={setDraftSearch}
            submitSearch={submitSearch}
            toggleControls={toggleControls}
            total={total}
            updateFilter={updateFilter}
          />
          <div className="min-w-0 @min-[560px]:min-h-0 @min-[560px]:flex-1 @min-[560px]:overflow-y-auto">
            {loading ? (
              <LoadingState label="Loading evaluation results" />
            ) : error ? (
              <ErrorState message={error} retry={() => void load()} />
            ) : items.length ? (
              <>
                {search && literalMatches === 0 ? (
                  <p className="border-b bg-background/60 px-4 py-3 text-xs leading-5 text-muted-foreground">
                    Nothing contains “{search}” word for word. These cases are the closest by
                    meaning, so the text below is not highlighted.
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
                {resultFilterCount(filters)
                  ? "No cases match this query. Clear a filter or search a broader phrase."
                  : "No evaluation results yet. Run an evaluation to create persisted case evidence."}
              </div>
            )}
          </div>
        </section>

        {resultListOpen ? (
          <ResizableDivider
            ariaLabel="Resize result list"
            className="hidden @min-[560px]:block"
            defaultValueText="Default result list width"
            maxSize={maximumListWidth}
            minSize={LIST_MIN_WIDTH}
            onSizeChange={setListWidth}
            panelRef={resultListRef}
            size={listWidth}
          />
        ) : null}

        <section
          aria-label="Selected evaluation result"
          className={cn(
            "relative min-w-0 bg-background @min-[560px]:flex @min-[560px]:flex-1 @min-[560px]:flex-col @min-[560px]:overflow-hidden",
            mobilePane === "detail" ? "block" : "hidden",
          )}
        >
          <EvaluationPageBar>
            <div className="flex min-w-0 items-center gap-4">
              {resultListOpen !== null ? (
                <Button
                  aria-controls="evaluation-results-list"
                  aria-expanded={resultListOpen}
                  aria-label={resultListOpen ? "Collapse result list" : "Expand result list"}
                  className="hidden h-8 shrink-0 px-2 text-muted-foreground @min-[560px]:inline-flex"
                  onClick={toggleResultList}
                  size="sm"
                  title={resultListOpen ? "Collapse result list" : "Expand result list"}
                  variant="ghost"
                >
                  Results
                  {resultListOpen ? (
                    <ChevronLeft aria-hidden="true" className="size-3.5" />
                  ) : (
                    <ChevronRight aria-hidden="true" className="size-3.5" />
                  )}
                </Button>
              ) : null}
              <h1 className="min-w-0 truncate text-base font-semibold tracking-tight">
                {selected
                  ? `${selected.promptTitle} · v${selected.promptRevisionNumber}`
                  : "Results"}
              </h1>
            </div>
            {selected ? (
              <Link
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium hover:bg-accent"
                href={`/evaluations/${selected.runId}`}
              >
                <span className="hidden @min-[760px]:inline">Run Provenance</span>
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </Link>
            ) : null}
          </EvaluationPageBar>
          <div
            className="@min-[560px]:min-h-0 @min-[560px]:flex-1 @min-[560px]:overflow-y-auto"
            onScroll={(event) => setDetailScrolled(event.currentTarget.scrollTop > 240)}
            ref={detailScrollRef}
          >
            {selected ? (
              <>
                <p aria-live="polite" className="sr-only">
                  {selected.promptTitle} version {selected.promptRevisionNumber} selected,{" "}
                  {selected.status}.
                </p>
                <ResultDetailPane
                  item={selected}
                  search={filters.search}
                  searchField={searchField}
                />
              </>
            ) : items.length ? (
              <div className="grid min-h-72 place-items-center p-6 text-sm text-muted-foreground">
                Select a case to inspect its output and attributed score evidence.
              </div>
            ) : null}
          </div>
          {detailScrolled ? (
            <Button
              aria-label="Back to top"
              className="absolute right-[var(--page-gutter)] bottom-4 z-20 hidden size-9 bg-background/95 shadow-sm backdrop-blur-sm @min-[560px]:inline-flex"
              onClick={() => detailScrollRef.current?.scrollTo({ behavior: "smooth", top: 0 })}
              size="icon"
              title="Back to top"
              variant="outline"
            >
              <ArrowUp aria-hidden="true" className="size-4" />
            </Button>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function ResultExplorerControls({
  clearFilters,
  controlsOpen,
  draftSearch,
  facets,
  filters,
  itemCount,
  setDraftSearch,
  submitSearch,
  toggleControls,
  total,
  updateFilter,
}: {
  clearFilters(): void;
  controlsOpen: boolean | null;
  draftSearch: string;
  facets: EvaluationWorkspaceFacets;
  filters: ResultFilters;
  itemCount: number;
  setDraftSearch(value: string): void;
  submitSearch(event: SyntheticEvent<HTMLFormElement>): void;
  toggleControls(): void;
  total: number;
  updateFilter<Key extends keyof ResultFilters>(key: Key, value: ResultFilters[Key]): void;
}) {
  const activeCount = resultFilterCount(filters);

  return (
    <div className="contents">
      <EvaluationPageBar inset="panel">
        <h2 className="shrink-0 whitespace-nowrap text-sm font-semibold tracking-tight">
          Result Explorer
        </h2>
        <div className="flex min-w-0 items-center gap-1">
          <div
            className="mr-1 hidden shrink-0 whitespace-nowrap font-mono text-[10px] text-muted-foreground @min-[320px]:block"
            title={`${itemCount.toLocaleString()} loaded of ${total.toLocaleString()} cases`}
          >
            {itemCount.toLocaleString()} of {total.toLocaleString()}
          </div>
          {controlsOpen !== null ? (
            <Button
              aria-controls="result-explorer-controls"
              aria-expanded={controlsOpen}
              aria-label={controlsOpen ? "Hide search and filters" : "Show search and filters"}
              aria-pressed={controlsOpen}
              className={cn("relative size-8", controlsOpen && "bg-accent text-foreground")}
              onClick={toggleControls}
              size="icon"
              title={controlsOpen ? "Hide search and filters" : "Show search and filters"}
              variant="ghost"
            >
              <SlidersHorizontal aria-hidden="true" className="size-3.5" />
              {activeCount ? (
                <span className="absolute -top-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-foreground text-[9px] font-semibold text-background">
                  {activeCount}
                </span>
              ) : null}
            </Button>
          ) : null}
        </div>
      </EvaluationPageBar>
      {controlsOpen ? (
        <div
          className="relative z-30 min-h-0 overflow-y-auto border-b bg-background"
          id="result-explorer-controls"
        >
          <section aria-labelledby="result-search-heading" className="border-b px-4 py-3">
            <h3 className="mb-2 text-xs font-semibold" id="result-search-heading">
              Search Cases
            </h3>
            <form
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
              onSubmit={submitSearch}
            >
              <div className="relative col-span-2 min-w-0">
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
              <Select
                aria-label="Search field"
                className="h-8 min-w-0"
                onValueChange={(value) =>
                  updateFilter(
                    "searchField",
                    (value === "all" ? undefined : value) as ResultFilters["searchField"],
                  )
                }
                triggerClassName="text-xs shadow-none"
                value={filters.searchField ?? "all"}
              >
                <option value="all">All fields</option>
                <option value="input">Input</option>
                <option value="output">Output</option>
                <option value="comment">Rationale</option>
                <option value="evidence">Evidence</option>
              </Select>
              <Button size="sm" type="submit">
                Search
              </Button>
            </form>
          </section>
          <details className="group/ask border-b px-4 py-2.5">
            <summary className="flex h-8 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <Sparkles aria-hidden="true" className="size-3.5" />
              <span className="flex-1">Ask data</span>
              <ChevronDown
                aria-hidden="true"
                className="size-3.5 transition-transform group-open/ask:rotate-180"
              />
            </summary>
            <EvaluationHelper className="mt-2" />
          </details>
          <ResultFiltersPanel
            activeCount={activeCount}
            clearFilters={clearFilters}
            facets={facets}
            filters={filters}
            updateFilter={updateFilter}
          />
        </div>
      ) : null}
    </div>
  );
}

function ResultFiltersPanel({
  activeCount,
  clearFilters,
  facets,
  filters,
  updateFilter,
}: {
  activeCount: number;
  clearFilters(): void;
  facets: EvaluationWorkspaceFacets;
  filters: ResultFilters;
  updateFilter<Key extends keyof ResultFilters>(key: Key, value: ResultFilters[Key]): void;
}) {
  const hasLinkedScope = Boolean(
    filters.promptRevisionId || filters.from || filters.runId || filters.to,
  );

  return (
    <section aria-labelledby="result-scope-heading" className="px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-semibold" id="result-scope-heading">
          Filters
          {activeCount ? (
            <span className="grid size-[18px] place-items-center rounded-full bg-accent font-mono text-[9px] text-muted-foreground">
              {activeCount}
            </span>
          ) : null}
        </h3>
        <ClearFilters count={activeCount} onClear={clearFilters} />
      </div>
      <div className="space-y-2">
        <FilterSelect
          className="w-full"
          label="Prompt"
          onValueChange={(value) => updateFilter("promptId", value || undefined)}
          value={filters.promptId ?? ""}
        >
          <option value="">All prompts</option>
          {facets.prompts.map((facet) => (
            <option key={facet.id} value={facet.id}>
              {facet.label} ({facet.count})
            </option>
          ))}
        </FilterSelect>
        <MultiFilterSelect
          allLabel="All Target Models"
          className="w-full"
          label="Target Model"
          onValuesChange={(values) =>
            updateFilter("targetModels", values.length ? values : undefined)
          }
          values={filters.targetModels ?? []}
        >
          {facets.targetModels.map((facet) => (
            <option key={facet.value} value={facet.value}>
              <ModelFacetLabel count={facet.count} modelId={facet.value} />
            </option>
          ))}
        </MultiFilterSelect>
        <MultiFilterSelect
          allLabel="All Judges"
          className="w-full"
          label="Judge"
          onValuesChange={(values) =>
            updateFilter("judgeModels", values.length ? values : undefined)
          }
          values={filters.judgeModels ?? []}
        >
          {facets.judgeModels.map((facet) => (
            <option key={facet.value} value={facet.value}>
              <ModelFacetLabel count={facet.count} modelId={facet.value} />
            </option>
          ))}
        </MultiFilterSelect>
        <div className="space-y-2">
          <FilterSelect
            className="w-full"
            label="Run Status"
            onValueChange={(value) =>
              updateFilter("status", (value || undefined) as EvaluationRunStatus | undefined)
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
            className="w-full"
            label="Score Type"
            onValueChange={(value) =>
              updateFilter("dataType", (value || undefined) as EvaluationDataType | undefined)
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
        </div>
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

function resultFilterCount(filters: ResultFilters): number {
  return [
    filters.promptId,
    filters.promptRevisionId,
    filters.targetModels?.length,
    filters.judgeModels?.length,
    filters.status,
    filters.dataType,
    filters.criterion,
    filters.search,
    filters.from,
    filters.runId,
    filters.to,
  ].filter(Boolean).length;
}

function ModelFacetLabel({ count, modelId }: { count: number; modelId: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <ModelIdentityLabel modelId={modelId} />
      <span className="shrink-0 text-muted-foreground">({count})</span>
    </span>
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
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
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
          {item.isSyntheticExample ? (
            <DefaultExampleBadge className="text-[10px] tracking-wide" />
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
  const scoreTableRef = useRef<HTMLDivElement>(null);
  const [scoreTableScroll, setScoreTableScroll] = useState({ backward: false, forward: false });

  const updateScoreTableScroll = useCallback(() => {
    const container = scoreTableRef.current;
    if (!container) return;
    setScoreTableScroll({
      backward: container.scrollLeft > 1,
      forward: container.scrollLeft + container.clientWidth < container.scrollWidth - 1,
    });
  }, []);

  useEffect(() => {
    const container = scoreTableRef.current;
    if (!container) return;
    container.scrollLeft = 0;
    const frame = window.requestAnimationFrame(updateScoreTableScroll);
    const observer = new ResizeObserver(updateScoreTableScroll);
    observer.observe(container);
    if (container.firstElementChild) observer.observe(container.firstElementChild);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [item.caseId, updateScoreTableScroll]);

  function scrollScoreTable(direction: -1 | 1) {
    const container = scoreTableRef.current;
    if (!container) return;
    container.scrollBy({
      behavior: "smooth",
      left: direction * Math.max(240, container.clientWidth * 0.8),
    });
  }

  return (
    <article className="page-gutter py-4">
      <header className="border-b pb-3">
        <div className="flex min-h-8 flex-wrap items-center gap-2">
          {item.isSyntheticExample ? <DefaultExampleBadge className="text-[11px]" /> : null}
          <Status status={item.status} />
        </div>
        <dl className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
          <ModelMetadata label="Target" models={[item.targetModel]} />
          <Metadata
            label="Revision"
            value={`v${item.promptRevisionNumber} · ${item.promptRevisionId.slice(0, 8)}`}
          />
          <ModelMetadata label="Judges" models={item.judgeModels} />
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

      <section className="pt-4">
        <div className="flex items-center justify-between gap-4 pb-2">
          <h3 className="text-sm font-semibold">Attributed Score Evidence</h3>
          <div className="flex shrink-0 items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">
              {item.scores.length} score facts
            </span>
            <div
              aria-label="Scroll score evidence table"
              className="flex items-center gap-1"
              role="group"
            >
              <Button
                aria-controls="score-evidence-table"
                aria-label="Scroll score evidence left"
                className="size-7"
                disabled={!scoreTableScroll.backward}
                onClick={() => scrollScoreTable(-1)}
                size="icon"
                title="Scroll score evidence left"
                variant="outline"
              >
                <ArrowLeft aria-hidden="true" className="size-3.5" />
              </Button>
              <Button
                aria-controls="score-evidence-table"
                aria-label="Scroll score evidence right"
                className="size-7"
                disabled={!scoreTableScroll.forward}
                onClick={() => scrollScoreTable(1)}
                size="icon"
                title="Scroll score evidence right"
                variant="outline"
              >
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
        {item.scores.length ? (
          <div
            aria-label="Scrollable score evidence table"
            className="overflow-x-auto overscroll-x-contain border-y [scrollbar-gutter:stable] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            id="score-evidence-table"
            onScroll={updateScoreTableScroll}
            ref={scoreTableRef}
            role="region"
            tabIndex={0}
          >
            <table className="w-full min-w-[52rem] border-collapse text-xs">
              <caption className="sr-only">
                Persisted score facts for the selected evaluation case.
              </caption>
              <thead className="bg-muted/35 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-64 border-r px-4 py-2 text-left font-medium" scope="col">
                    Criterion
                  </th>
                  <th
                    className="w-px whitespace-nowrap border-r px-3 py-2 text-left font-medium"
                    scope="col"
                  >
                    Result
                  </th>
                  <th
                    className="w-px whitespace-nowrap border-r px-3 py-2 text-left font-medium"
                    scope="col"
                  >
                    Judge
                  </th>
                  <th className="px-4 py-2 text-left font-medium" scope="col">
                    Rationale and Evidence
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {item.scores.map((score) => (
                  <tr className="align-top" key={score.id}>
                    <th className="border-r px-4 py-2.5 text-left font-normal" scope="row">
                      <span className="font-mono text-[11px] uppercase text-muted-foreground">
                        C{score.criterionPosition + 1} · {score.dataType}
                      </span>
                      <span className="mt-1 block max-w-sm text-xs font-medium leading-5">
                        {score.criterion.name}
                      </span>
                      <span className="mt-1 block max-w-sm text-xs leading-5 text-muted-foreground">
                        {score.criterion.instruction}
                      </span>
                    </th>
                    <td className="w-px whitespace-nowrap border-r px-3 py-2.5">
                      <span
                        className={cn(
                          "font-mono text-xs font-semibold",
                          scoreColor(formatScore(score.value)),
                        )}
                      >
                        {formatScore(score.value)}
                      </span>
                    </td>
                    <td className="w-px whitespace-nowrap border-r px-3 py-2.5">
                      <ModelIdentityLabel
                        className="text-muted-foreground"
                        labelClassName="font-mono text-[11px]"
                        modelId={score.judgeModel}
                        variant="short-id"
                      />
                    </td>
                    <td className="min-w-80 px-4 py-2.5">
                      <p className="text-xs leading-5 text-foreground">
                        <HighlightedText
                          search={searchForField(search, searchField, "comment")}
                          value={score.comment}
                        />
                      </p>
                      {score.evidence.length ? (
                        <details className="group/evidence mt-1.5">
                          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                            <ChevronDown
                              aria-hidden="true"
                              className="size-3 transition-transform group-open/evidence:rotate-180"
                            />
                            {score.evidence.length} evidence{" "}
                            {score.evidence.length === 1 ? "item" : "items"}
                          </summary>
                          <ul className="mt-1 space-y-1 text-xs leading-5 text-muted-foreground">
                            {score.evidence.map((evidence) => (
                              <li
                                className="grid grid-cols-[0.25rem_minmax(0,1fr)] items-start gap-2"
                                key={evidence}
                              >
                                <span
                                  aria-hidden="true"
                                  className="mt-[0.6em] size-1 rounded-full bg-muted-foreground/70"
                                />
                                <span>
                                  <HighlightedText
                                    search={searchForField(search, searchField, "evidence")}
                                    value={evidence}
                                  />
                                </span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
    <div className="flex min-w-0 items-center gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-[11px]">{value}</dd>
    </div>
  );
}

function ModelMetadata({ label, models }: { label: string; models: string[] }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap gap-x-2 gap-y-1">
        {[...new Set(models)].map((modelId) => (
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
        (status === "queued" || status === "running") &&
          "bg-blue-500/10 text-blue-700 dark:text-blue-400",
        (status === "failed" || status === "cancelled" || status === "interrupted") &&
          "bg-destructive/10 text-destructive",
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
  judgeModels: [],
  prompts: [],
  revisions: [],
  statuses: [],
  targetModels: [],
};
