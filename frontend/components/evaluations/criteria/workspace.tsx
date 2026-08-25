/** Coordinates the shared Criterion library and the named Criteria permutations that preserve Criterion order without owning their individual edit forms. */

"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronUp,
  Library,
  ListOrdered,
  LoaderCircle,
  Plus,
} from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { CriteriaEditor } from "@/components/evaluations/criteria/criteria-editor";
import { CriterionEditor } from "@/components/evaluations/criteria/criterion-editor";
import { CriterionTypeIcon } from "@/components/evaluations/shared/criterion-type-icon";
import { Button } from "@/components/ui/button";
import { maximumResizablePanelWidth, ResizableDivider } from "@/components/ui/resizable-divider";
import { cn } from "@/components/ui/utils";
import type {
  Criteria,
  CriteriaListResponse,
  CriterionDeletionResponse,
  CriterionLibraryResponse,
  SavedCriterion,
} from "@/contracts/evaluations";
import { createApiRequester, createErrorReader } from "@/shared/api";

const api = createApiRequester({}, (status) => `Request failed with ${status}.`);
const readError = createErrorReader("The criteria request failed.");
const LIST_MIN_WIDTH = 288;
const LIST_MAX_WIDTH = 480;
const EDITOR_MIN_WIDTH = 400;
const LIST_OPEN_STORAGE_KEY = "evaluation-criterion-list-open";

type Mode = "criteria" | "criterion";
type Library = { criteria: Criteria[]; criterion: SavedCriterion[] };

export function EvaluationCriterionWorkspace() {
  const [mode, setMode] = useState<Mode>("criteria");
  const [criterion, setCriterion] = useState<SavedCriterion[]>([]);
  const [criteria, setCriteria] = useState<Criteria[]>([]);
  const [selectedCriterionId, setSelectedCriterionId] = useState<string>();
  const [selectedCriteriaId, setSelectedCriteriaId] = useState<string>();
  const [creatingCriterion, setCreatingCriterion] = useState(false);
  const [creatingCriteria, setCreatingCriteria] = useState(false);
  const [loading, setLoading] = useState(true);
  const [listOpen, setListOpen] = useState<boolean | null>(null);
  const [listWidth, setListWidth] = useState<number>();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setListOpen(window.localStorage.getItem(LIST_OPEN_STORAGE_KEY) !== "false");
    void reload()
      .catch((error) => toast.error(readError(error)))
      .finally(() => setLoading(false));
  }, []);

  async function reload(): Promise<Library> {
    const [criterionData, criteriaData] = await Promise.all([
      api.json<CriterionLibraryResponse>("/api/evaluations/criterion"),
      api.json<CriteriaListResponse>("/api/evaluations/criteria"),
    ]);
    const library = {
      criteria: sortCriteria(criteriaData.criteria),
      criterion: sortCriterion(criterionData.criterion),
    };
    setCriterion(library.criterion);
    setCriteria(library.criteria);
    setSelectedCriterionId((current) =>
      current && library.criterion.some(({ id }) => id === current)
        ? current
        : library.criterion[0]?.id,
    );
    setSelectedCriteriaId((current) =>
      current && library.criteria.some(({ id }) => id === current)
        ? current
        : library.criteria[0]?.id,
    );
    return library;
  }

  function toggleList() {
    setListOpen((current) => {
      const next = !current;
      window.localStorage.setItem(LIST_OPEN_STORAGE_KEY, String(next));
      return next;
    });
  }

  function selectMode(next: Mode) {
    setMode(next);
    setCreatingCriterion(false);
    setCreatingCriteria(false);
  }

  function createCriterion() {
    setMode("criterion");
    setCreatingCriterion(true);
  }

  function createCriteria() {
    setMode("criteria");
    setCreatingCriteria(true);
  }

  function saveCriterion(criterion: SavedCriterion) {
    setCriterion((current) => sortCriterion(replaceById(current, criterion)));
    setCriteria((current) =>
      current.map((criteria) => ({
        ...criteria,
        criterionSequence: criteria.criterionSequence.map((candidate) =>
          candidate.id === criterion.id ? criterion : candidate,
        ),
      })),
    );
    setSelectedCriterionId(criterion.id);
    setCreatingCriterion(false);
  }

  function deleteCriterion(id: string, deletion: CriterionDeletionResponse) {
    setCriterion((current) => {
      const next = current.filter((criterion) => criterion.id !== id);
      setSelectedCriterionId(next[0]?.id);
      return next;
    });
    setCriteria(deletion.criteria);
    setSelectedCriteriaId((selectedId) =>
      selectedId && deletion.criteria.some(({ id: criteriaId }) => criteriaId === selectedId)
        ? selectedId
        : deletion.criteria[0]?.id,
    );
    setCreatingCriterion(false);
  }

  function saveCriteria(value: Criteria) {
    setCriteria((current) => sortCriteria(replaceById(current, value)));
    setSelectedCriteriaId(value.id);
    setCreatingCriteria(false);
  }

  function deleteCriteria(id: string) {
    setCriteria((current) => {
      const next = current.filter((value) => value.id !== id);
      setSelectedCriteriaId(next[0]?.id);
      return next;
    });
    setCreatingCriteria(false);
  }

  const selectedCriterion = creatingCriterion
    ? undefined
    : criterion.find(({ id }) => id === selectedCriterionId);
  const selectedCriteria = creatingCriteria
    ? undefined
    : criteria.find(({ id }) => id === selectedCriteriaId);
  const maximumListWidth = () =>
    maximumResizablePanelWidth({
      contentMinWidth: EDITOR_MIN_WIDTH,
      maxWidth: LIST_MAX_WIDTH,
      minWidth: LIST_MIN_WIDTH,
      workspace: workspaceRef.current,
    });

  return (
    <div
      className={cn(
        "mx-auto grid min-h-[calc(100dvh-var(--header-height))] w-full max-w-[1480px]",
        listOpen === true
          ? "@min-[620px]:grid-cols-[var(--criterion-list-width)_1px_minmax(0,1fr)] @min-[620px]:[--criterion-list-width:18rem] @min-[900px]:[--criterion-list-width:20rem] @min-[1200px]:[--criterion-list-width:22rem]"
          : "@min-[620px]:grid-cols-[minmax(0,1fr)]",
      )}
      ref={workspaceRef}
      style={
        listWidth === undefined
          ? undefined
          : ({ "--criterion-list-width": `${listWidth}px` } as CSSProperties)
      }
    >
      <aside
        className={cn(
          "border-b bg-muted/15 @min-[620px]:border-b-0",
          listOpen !== true && "hidden",
        )}
        id="criterion-library-list"
        ref={listRef}
      >
        <div className="p-4 sm:p-5 @min-[620px]:sticky @min-[620px]:top-0 @min-[620px]:max-h-[calc(100dvh-var(--header-height))] @min-[620px]:overflow-y-auto xl:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-base font-semibold">Criterion</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Build ordered Criteria from reusable Criterion.
              </p>
            </div>
            <Button
              aria-controls="criterion-library-list"
              aria-expanded="true"
              aria-label="Collapse Criterion library"
              className="@min-[620px]:hidden"
              onClick={toggleList}
              size="icon"
              title="Collapse Criterion library"
              variant="ghost"
            >
              <ChevronUp aria-hidden="true" className="size-3.5" />
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-2 border-b">
            <ModeButton
              active={mode === "criteria"}
              icon={ListOrdered}
              label="Criteria"
              onClick={() => selectMode("criteria")}
            />
            <ModeButton
              active={mode === "criterion"}
              icon={Library}
              label="Criterion"
              onClick={() => selectMode("criterion")}
            />
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <h2 className="text-xs font-semibold">
              {mode === "criteria" ? "Criteria" : "Criterion Library"}
            </h2>
            <Button
              aria-label={mode === "criteria" ? "New Criteria" : "New Criterion"}
              onClick={mode === "criteria" ? createCriteria : createCriterion}
              size="icon"
              variant="outline"
            >
              <Plus className="size-3.5" />
            </Button>
          </div>

          {loading ? (
            <div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" /> Loading Criterion…
            </div>
          ) : mode === "criteria" ? (
            <CriteriaList
              creating={creatingCriteria}
              criteria={criteria}
              onSelect={(id) => {
                setCreatingCriteria(false);
                setSelectedCriteriaId(id);
              }}
              selectedId={selectedCriteriaId}
            />
          ) : (
            <CriterionList
              creating={creatingCriterion}
              criterion={criterion}
              onSelect={(id) => {
                setCreatingCriterion(false);
                setSelectedCriterionId(id);
              }}
              selectedId={selectedCriterionId}
            />
          )}
        </div>
      </aside>

      {listOpen === true ? (
        <ResizableDivider
          ariaLabel="Resize Criterion library"
          className="hidden @min-[620px]:block"
          defaultValueText="Default Criterion library width"
          maxSize={maximumListWidth}
          minSize={LIST_MIN_WIDTH}
          onSizeChange={setListWidth}
          panelRef={listRef}
          size={listWidth}
        />
      ) : null}

      <section className="relative min-w-0 bg-background">
        {mode === "criteria" ? (
          <CriteriaEditor
            criteria={selectedCriteria}
            criterion={criterion}
            key={creatingCriteria ? "new-criteria" : (selectedCriteria?.id ?? "empty-criteria")}
            listOpen={listOpen}
            onDeleted={deleteCriteria}
            onReload={reload}
            onSaved={saveCriteria}
            onToggleList={toggleList}
          />
        ) : (
          <CriterionEditor
            criterion={selectedCriterion}
            key={creatingCriterion ? "new-criterion" : (selectedCriterion?.id ?? "empty-criterion")}
            listOpen={listOpen}
            onDeleted={deleteCriterion}
            onReload={reload}
            onSaved={saveCriterion}
            onToggleList={toggleList}
            criteria={criteria}
          />
        )}
      </section>
    </div>
  );
}

function ModeButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Library;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "-mb-px inline-flex h-10 items-center justify-center gap-1.5 border-b-2 border-transparent text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        active
          ? "border-foreground text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
      type="button"
    >
      <Icon className="size-3.5" /> {label}
    </button>
  );
}

function CriteriaList({
  creating,
  criteria,
  onSelect,
  selectedId,
}: {
  creating: boolean;
  criteria: Criteria[];
  onSelect(id: string): void;
  selectedId?: string;
}) {
  if (!criteria.length && !creating)
    return <EmptyList>Create the first Criteria after adding a Criterion.</EmptyList>;
  return (
    <div className="mt-3 divide-y border-y">
      {creating ? (
        <div className="min-h-14 bg-accent px-3 py-3 text-sm font-medium">Untitled Criteria</div>
      ) : null}
      {criteria.map((value) => (
        <button
          aria-pressed={!creating && selectedId === value.id}
          className={cn(
            "grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            !creating && selectedId === value.id
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          )}
          key={value.id}
          onClick={() => onSelect(value.id)}
          type="button"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{value.name}</span>
            <span className="mt-1 flex flex-wrap gap-x-1.5 font-mono text-[10px] uppercase">
              <CriterionTypes criterion={value.criterionSequence} />
            </span>
          </span>
          <span className="font-mono text-[11px]">{value.criterionSequence.length}</span>
        </button>
      ))}
    </div>
  );
}

function CriterionList({
  creating,
  criterion,
  onSelect,
  selectedId,
}: {
  creating: boolean;
  criterion: SavedCriterion[];
  onSelect(id: string): void;
  selectedId?: string;
}) {
  const [sort, setSort] = useState<{ direction: "asc" | "desc"; key: "name" | "type" }>({
    direction: "asc",
    key: "name",
  });
  if (!criterion.length && !creating)
    return <EmptyList>Create the first reusable Criterion.</EmptyList>;
  const orderedCriterion = [...criterion].sort((left, right) => {
    const comparison = left[sort.key].localeCompare(right[sort.key], undefined, {
      sensitivity: "base",
    });
    if (comparison !== 0) return sort.direction === "asc" ? comparison : -comparison;
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
  const changeSort = (key: "name" | "type") =>
    setSort((current) => ({
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
      key,
    }));
  return (
    <div className="mt-3 grid grid-cols-[minmax(0,1fr)_max-content] gap-x-3 border-y [&>*+*]:border-t">
      <div className="col-span-2 grid grid-cols-subgrid bg-muted/15 px-3 py-1 text-[10px] font-medium text-muted-foreground">
        <SortHeader
          active={sort.key === "name"}
          direction={sort.direction}
          label="Title"
          onClick={() => changeSort("name")}
        />
        <SortHeader
          active={sort.key === "type"}
          direction={sort.direction}
          label="Type"
          onClick={() => changeSort("type")}
        />
      </div>
      {creating ? (
        <div className="col-span-2 grid min-h-11 grid-cols-subgrid items-center bg-accent px-3 py-2 text-sm font-medium">
          <span className="truncate">Untitled Criterion</span>
          <span className="text-muted-foreground">—</span>
        </div>
      ) : null}
      {orderedCriterion.map((item) => (
        <button
          aria-pressed={!creating && selectedId === item.id}
          className={cn(
            "col-span-2 grid min-h-11 w-full grid-cols-subgrid items-center px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            !creating && selectedId === item.id
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          )}
          key={item.id}
          onClick={() => onSelect(item.id)}
          type="button"
        >
          <span className="min-w-0 truncate text-sm font-medium">{item.name}</span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[10px] uppercase">
            <CriterionTypeIcon className="size-3" type={item.type} /> {item.type}
          </span>
        </button>
      ))}
    </div>
  );
}

function SortHeader({
  active,
  direction,
  label,
  onClick,
}: {
  active: boolean;
  direction: "asc" | "desc";
  label: string;
  onClick(): void;
}) {
  const Icon = active ? (direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <button
      aria-label={`Sort by ${label}${active ? `, ${direction === "asc" ? "ascending" : "descending"}` : ""}`}
      className={cn(
        "inline-flex min-h-7 items-center gap-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
      type="button"
    >
      {label}
      <Icon aria-hidden="true" className={cn("size-2.5", !active && "opacity-60")} />
    </button>
  );
}

function EmptyList({ children }: { children: string }) {
  return (
    <p className="mt-6 border-y px-3 py-6 text-center text-xs leading-5 text-muted-foreground">
      {children}
    </p>
  );
}

function CriterionTypes({ criterion }: { criterion: SavedCriterion[] }) {
  return [...new Set(criterion.map(({ type }) => type))].map((type, index) => (
    <span className="contents" key={type}>
      {index > 0 ? <span>·</span> : null}
      <span className="inline-flex items-center gap-1">
        <CriterionTypeIcon className="size-3" type={type} /> {type}
      </span>
    </span>
  ));
}

function replaceById<T extends { id: string }>(values: T[], value: T): T[] {
  return values.some(({ id }) => id === value.id)
    ? values.map((candidate) => (candidate.id === value.id ? value : candidate))
    : [...values, value];
}

function sortCriterion(criterion: SavedCriterion[]) {
  return [...criterion].sort((left, right) => left.name.localeCompare(right.name));
}

function sortCriteria(criteria: Criteria[]) {
  return [...criteria].sort((left, right) => left.name.localeCompare(right.name));
}
