/** Presents cursor-paginated evaluation cases as a filterable master-detail evidence workspace. */

"use client";

import { CircleAlert, ExternalLink, LoaderCircle, Search } from "lucide-react";
import Link from "next/link";
import { ReactNode, SyntheticEvent, useCallback, useEffect, useState } from "react";

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

import { EvaluationHelper } from "./evaluation-helper";
import { evaluationFilterParams, parseEvaluationFilters } from "./filter-state";
import { EvaluationMarkdownValue } from "./markdown-value";

const PAGE_SIZE = 25;

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
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();

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

  function submitSearch(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    updateFilter("search", draftSearch.trim() || undefined);
  }

  function updateFilter<Key extends keyof ResultFilters>(key: Key, value: ResultFilters[Key]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function clearFilters() {
    setDraftSearch("");
    setFilters({});
  }

  return (
    <div className="flex min-h-[calc(100vh-var(--header-height))] flex-col min-[840px]:h-[calc(100vh-var(--header-height))] min-[840px]:min-h-[36rem] min-[840px]:overflow-hidden">
      <header className="border-b bg-muted/20 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-base font-semibold tracking-tight">Result explorer</h1>
          <div className="font-mono text-[10px] uppercase text-muted-foreground">
            {total.toLocaleString()} matching cases · {items.length.toLocaleString()} loaded
          </div>
        </div>
        <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,3fr)_minmax(22rem,2fr)]">
          <form
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto]"
            onSubmit={submitSearch}
          >
            <Select
              aria-label="Search field"
              className="col-span-2 h-8 text-xs shadow-none sm:col-span-1"
              onChange={(event) =>
                updateFilter(
                  "searchField",
                  (event.target.value || undefined) as ResultFilters["searchField"],
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
            <div className="relative min-w-0 flex-1">
              <Search
                aria-hidden="true"
                className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                className="h-8 pl-9 text-xs shadow-none"
                onChange={(event) => setDraftSearch(event.target.value)}
                placeholder="Search input, output, rationale, or evidence"
                value={draftSearch}
              />
            </div>
            <Button size="sm" type="submit">
              Search
            </Button>
          </form>
          <EvaluationHelper />
        </div>
        <ResultFiltersToolbar
          clearFilters={clearFilters}
          facets={facets}
          filters={filters}
          updateFilter={updateFilter}
        />
      </header>

      <div className="grid min-[840px]:min-h-0 min-[840px]:flex-1 min-[840px]:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[23rem_minmax(0,1fr)]">
        <div className="border-b min-[840px]:hidden">
          <div className="grid grid-cols-2">
            <button
              className={cn(
                "border-b-2 py-2.5 text-xs font-medium",
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
              className={cn(
                "border-b-2 py-2.5 text-xs font-medium",
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
            "min-h-0 border-r bg-muted/15 min-[840px]:block min-[840px]:overflow-y-auto",
            mobilePane === "results" ? "block" : "hidden",
          )}
        >
          {loading ? (
            <LoadingState label="Loading evaluation results" />
          ) : error ? (
            <ErrorState message={error} retry={() => void load()} />
          ) : items.length ? (
            <>
              <div className="divide-y">
                {items.map((item) => (
                  <ResultRow
                    item={item}
                    key={item.caseId}
                    onSelect={() => {
                      setSelectedCaseId(item.caseId);
                      setMobilePane("detail");
                    }}
                    search={filters.search}
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

        <section
          aria-label="Selected evaluation result"
          className={cn(
            "min-w-0 bg-background min-[840px]:block min-[840px]:overflow-y-auto",
            mobilePane === "detail" ? "block" : "hidden",
          )}
        >
          {selected ? (
            <ResultDetailPane item={selected} search={filters.search} />
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
  return (
    <section
      aria-labelledby="result-scope-heading"
      className="relative mt-2 grid gap-2 pt-1 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-end"
    >
      <h2 className="pb-1 text-xs font-semibold" id="result-scope-heading">
        Scope
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <FilterField label="Prompt">
          <Select
            className="h-8 text-xs shadow-none"
            onChange={(event) => updateFilter("promptId", event.target.value || undefined)}
            value={filters.promptId ?? ""}
          >
            <option value="">All prompts</option>
            {facets.prompts.map((facet) => (
              <option key={facet.id} value={facet.id}>
                {facet.label} ({facet.count})
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Target model">
          <Select
            className="h-8 text-xs shadow-none"
            onChange={(event) => updateFilter("targetModelId", event.target.value || undefined)}
            value={filters.targetModelId ?? ""}
          >
            <option value="">All target models</option>
            {facets.targetModels.map((facet) => (
              <option key={facet.value} value={facet.value}>
                {facet.value} ({facet.count})
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Judge">
          <Select
            className="h-8 text-xs shadow-none"
            onChange={(event) => updateFilter("judgeModelId", event.target.value || undefined)}
            value={filters.judgeModelId ?? ""}
          >
            <option value="">All judges</option>
            {facets.judges.map((facet) => (
              <option key={facet.value} value={facet.value}>
                {facet.value} ({facet.count})
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Run status">
          <Select
            className="h-8 text-xs shadow-none"
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
          </Select>
        </FilterField>
        <FilterField label="Score type">
          <Select
            className="h-8 text-xs shadow-none"
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
          </Select>
        </FilterField>
      </div>
      {filters.criterion ? (
        <div className="col-span-full flex min-w-0 items-center gap-2 pt-1 text-xs lg:col-start-2">
          <span className="shrink-0 font-mono text-[9px] text-muted-foreground">Criterion</span>
          <span className="min-w-0 flex-1 truncate">{filters.criterion}</span>
          <button
            className="shrink-0 font-medium text-muted-foreground hover:text-foreground"
            onClick={() => updateFilter("criterion", undefined)}
            type="button"
          >
            Remove
          </button>
        </div>
      ) : null}
      <button
        className="absolute top-0 right-0 h-7 px-2 text-xs text-muted-foreground hover:text-foreground lg:static lg:h-8"
        onClick={clearFilters}
        type="button"
      >
        Clear
      </button>
    </section>
  );
}

function ResultRow({
  item,
  onSelect,
  search,
  selected,
}: {
  item: EvaluationResultItem;
  onSelect(): void;
  search?: string;
  selected: boolean;
}) {
  const marks = scoreMarks(item);
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "relative block w-full px-4 py-3 text-left transition-colors",
        selected ? "bg-accent/70" : "hover:bg-background/70",
      )}
      onClick={onSelect}
      type="button"
    >
      {selected ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-3 left-0 w-px rounded-r-full bg-foreground"
        />
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn("min-w-0 truncate text-sm", selected ? "font-semibold" : "font-medium")}
        >
          {item.promptTitle}
        </span>
        <Status status={item.status} />
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        <HighlightedText search={search} value={stringify(item.input)} />
      </p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 gap-2 font-mono text-[10px]">
          {marks.map((mark) => (
            <span className={scoreColor(mark)} key={mark}>
              {mark}
            </span>
          ))}
        </div>
        <time className="shrink-0 font-mono text-[9px] text-muted-foreground">
          {formatShortDateTime(item.createdAt)}
        </time>
      </div>
    </button>
  );
}

function ResultDetailPane({ item, search }: { item: EvaluationResultItem; search?: string }) {
  return (
    <article className="px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <header className="border-b pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">Case {item.position + 1}</h2>
              {item.isSyntheticExample ? (
                <span className="rounded-sm border bg-secondary/50 px-1.5 py-0.5 text-[9px] font-medium uppercase text-muted-foreground">
                  Synthetic
                </span>
              ) : null}
              <Status status={item.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{item.promptTitle}</p>
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
          <Metadata label="Revision" value={item.promptRevisionId.slice(0, 8)} />
          <ModelMetadata label="Judges" modelIds={item.judgeModelIds} />
          <Metadata
            label="Completed"
            value={item.completedAt ? formatDateTime(item.completedAt) : "—"}
          />
        </dl>
      </header>

      <div className="grid lg:grid-cols-2">
        <EvaluationMarkdownValue
          className="lg:pr-5"
          key={`${item.caseId}-input`}
          label="Input"
          source={<HighlightedText search={search} value={stringify(item.input)} />}
          value={item.input}
        />
        <EvaluationMarkdownValue
          className="border-t lg:border-t-0 lg:border-l lg:pl-5"
          key={`${item.caseId}-output`}
          label="Target output"
          source={<HighlightedText search={search} value={stringify(item.output)} />}
          value={item.output}
        />
      </div>

      <section className="pt-5">
        <div className="flex items-baseline justify-between gap-4 pb-3">
          <h3 className="text-sm font-semibold">Attributed score evidence</h3>
          <span className="font-mono text-[10px] text-muted-foreground">
            {item.scores.length} score facts
          </span>
        </div>
        {item.scores.length ? (
          <div className="divide-y">
            {item.scores.map((score) => (
              <div className="grid gap-4 py-4 xl:grid-cols-[14rem_minmax(0,1fr)]" key={score.id}>
                <div>
                  <div className="font-mono text-[9px] uppercase text-muted-foreground">
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
                    labelClassName="font-mono text-[10px]"
                    modelId={score.judgeModelId}
                    variant="short-id"
                  />
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    <HighlightedText search={search} value={score.comment} />
                  </p>
                  {score.evidence.length ? (
                    <ul className="mt-3 space-y-1.5 text-xs leading-relaxed">
                      {score.evidence.map((evidence) => (
                        <li className="border-l pl-3" key={evidence}>
                          <HighlightedText search={search} value={evidence} />
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

function FilterField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-[10px]">{value}</dd>
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
            labelClassName="font-mono text-[10px]"
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
        "rounded-sm px-1.5 py-0.5 text-[9px] font-medium capitalize",
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
      <mark className="bg-amber-200 px-0.5 text-amber-950" key={`${part}-${index}`}>
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
