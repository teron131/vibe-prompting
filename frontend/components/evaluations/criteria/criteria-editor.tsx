/** Edits one Criteria permutation as an explicitly ordered sequence of shared Criterion IDs while keeping Criterion content read-only in the composition flow. */

"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Library,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { CriterionTypeIcon } from "@/components/evaluations/shared/criterion-type-icon";
import { EvaluationPageBar } from "@/components/evaluations/shared/evaluation-page-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/components/ui/utils";
import type { Criteria, CriteriaResponse, SavedCriterion } from "@/contracts/evaluations";
import { ApiRequestError, createApiRequester, createErrorReader } from "@/shared/api";

const api = createApiRequester({}, (status) => `Request failed with ${status}.`);
const readError = createErrorReader("The Criteria request failed.");

type Draft = { criterionIds: string[]; id?: string; name: string; version?: number };
type LibraryState = { criteria: Criteria[]; criterion: SavedCriterion[] };

export function CriteriaEditor({
  criteria,
  criterion,
  listOpen,
  onCreateCriterion,
  onDeleted,
  onReload,
  onSaved,
  onToggleList,
}: {
  criteria?: Criteria;
  criterion: SavedCriterion[];
  listOpen: boolean | null;
  onCreateCriterion(): void;
  onDeleted(id: string): void;
  onReload(): Promise<LibraryState>;
  onSaved(criteria: Criteria): void;
  onToggleList(): void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(criteria));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const criterionOrder = useMemo(
    () =>
      draft.criterionIds
        .map((id) => criterion.find((candidate) => candidate.id === id))
        .filter((candidate): candidate is SavedCriterion => Boolean(candidate)),
    [criterion, draft.criterionIds],
  );

  useEffect(() => {
    setDraft(toDraft(criteria));
    setConfirmingDelete(false);
  }, [criteria?.id]);

  async function save() {
    const name = draft.name.trim();
    if (!name) return toast.error("Name this Criteria before saving it.");
    if (!draft.criterionIds.length) return toast.error("Add at least one Criterion.");
    setSaving(true);
    try {
      const result = await api.json<CriteriaResponse>(
        draft.id
          ? `/api/evaluations/criteria/${encodeURIComponent(draft.id)}`
          : "/api/evaluations/criteria",
        {
          body: JSON.stringify({
            name,
            criterionIds: draft.criterionIds,
            ...(draft.version && { expectedVersion: draft.version }),
          }),
          headers: { "content-type": "application/json" },
          method: draft.id ? "PUT" : "POST",
        },
      );
      setDraft(toDraft(result.criteria));
      onSaved(result.criteria);
      toast.success(draft.id ? "Criteria updated." : "Criteria created.");
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "stale-write" && draft.id) {
        const library = await onReload();
        const latest = library.criteria.find(({ id }) => id === draft.id);
        if (latest) setDraft((current) => ({ ...current, version: latest.version }));
        toast.error(
          "Someone saved a newer Criteria version. Your ordered draft is still open with the latest version ready for review.",
        );
        return;
      }
      toast.error(readError(error));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const deletingId = draft.id;
    if (!deletingId || !draft.version) return;
    setDeleting(true);
    try {
      await api.empty(`/api/evaluations/criteria/${encodeURIComponent(deletingId)}`, {
        body: JSON.stringify({ expectedVersion: draft.version }),
        headers: { "content-type": "application/json" },
        method: "DELETE",
      });
      onDeleted(deletingId);
      toast.success("Criteria deleted. Historical runs are unchanged.");
    } catch (error) {
      toast.error(readError(error));
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  function addCriterion(id: string) {
    setDraft((current) => {
      if (current.criterionIds.includes(id)) return current;
      if (current.criterionIds.length >= 10) {
        toast.error("Criteria can contain at most 10 Criterion resources.");
        return current;
      }
      return { ...current, criterionIds: [...current.criterionIds, id] };
    });
  }

  function removeCriterion(id: string) {
    setDraft((current) => ({
      ...current,
      criterionIds: current.criterionIds.filter((candidate) => candidate !== id),
    }));
  }

  function moveCriterion(index: number, offset: -1 | 1) {
    setDraft((current) => ({
      ...current,
      criterionIds: move(current.criterionIds, index, offset),
    }));
  }

  return (
    <div className="min-w-0">
      <EvaluationPageBar sticky>
        {listOpen !== null ? <ListToggle listOpen={listOpen} onClick={onToggleList} /> : null}
        <label className="sr-only" htmlFor="criteria-name">
          Criteria Name
        </label>
        <div className="group/title relative min-w-0 max-w-lg flex-1">
          <Pencil
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground opacity-40 transition-opacity group-hover/title:opacity-70 group-focus-within/title:opacity-90"
          />
          <Input
            className="h-8 cursor-text rounded-sm border-0 bg-transparent pr-2 pl-7 text-sm font-medium shadow-none transition-colors hover:bg-accent/35 focus-visible:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
            id="criteria-name"
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="Criteria Name"
            value={draft.name}
          />
        </div>
        <div className="flex shrink-0 gap-2">
          {draft.id ? (
            <Button
              aria-label="Duplicate Criteria"
              className="px-2.5"
              onClick={() =>
                setDraft({
                  ...draft,
                  id: undefined,
                  name: `${draft.name} copy`,
                  version: undefined,
                })
              }
              size="sm"
              variant="outline"
            >
              <Copy className="size-3.5" />
              <span className="hidden @min-[820px]:inline">Duplicate</span>
            </Button>
          ) : null}
          <Button disabled={saving} onClick={save} size="sm">
            {saving ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            <span className="hidden @min-[1120px]:inline">
              {draft.id ? "Save changes" : "Create Criteria"}
            </span>
            <span className="@min-[1120px]:hidden">Save</span>
          </Button>
        </div>
      </EvaluationPageBar>

      <div className="grid gap-8 px-4 pt-6 pb-12 sm:px-6 min-[840px]:px-7 @min-[980px]:grid-cols-[minmax(0,1fr)_18rem] xl:px-10">
        <section className="min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3">
            <div>
              <h2 className="text-sm font-semibold">Criterion Order</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                This sequence is preserved when the evaluation runs.
              </p>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">
              {criterionOrder.length}/10
            </span>
          </div>
          {criterionOrder.length ? (
            <ol className="divide-y">
              {criterionOrder.map((item, index) => (
                <li
                  className="grid grid-cols-[2rem_minmax(0,1fr)_6.5rem] items-start gap-3 py-3"
                  key={item.id}
                >
                  <span className="pt-1 font-mono text-[11px] text-muted-foreground">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium">{item.name}</span>
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase text-muted-foreground">
                        <CriterionTypeIcon className="size-3" type={item.type} /> {item.type}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {item.instruction}
                    </p>
                  </div>
                  <div className="flex justify-end gap-0.5">
                    <Button
                      aria-label={`Move ${item.name} up`}
                      className="size-8"
                      disabled={index === 0}
                      onClick={() => moveCriterion(index, -1)}
                      size="icon"
                      variant="ghost"
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      aria-label={`Move ${item.name} down`}
                      className="size-8"
                      disabled={index === criterionOrder.length - 1}
                      onClick={() => moveCriterion(index, 1)}
                      size="icon"
                      variant="ghost"
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                    <Button
                      aria-label={`Remove ${item.name}`}
                      className="size-8 text-muted-foreground hover:text-destructive"
                      onClick={() => removeCriterion(item.id)}
                      size="icon"
                      variant="ghost"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="border-b py-10 text-center">
              <p className="text-sm font-medium">No Criterion ordered</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add reusable Criterion from the library in the order they should run.
              </p>
            </div>
          )}

          {draft.id ? (
            <footer className="mt-8 flex flex-wrap items-center justify-end gap-3 border-t pt-5">
              {confirmingDelete ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    Delete “{draft.name}”? Historical runs keep their snapshots.
                  </p>
                  <Button onClick={() => setConfirmingDelete(false)} size="sm" variant="outline">
                    Cancel
                  </Button>
                  <Button disabled={deleting} onClick={remove} size="sm" variant="destructive">
                    {deleting ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="size-3.5" />
                    )}{" "}
                    Delete
                  </Button>
                </>
              ) : (
                <Button
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirmingDelete(true)}
                  size="sm"
                  variant="ghost"
                >
                  <Trash2 className="size-3.5" /> Delete Criteria
                </Button>
              )}
            </footer>
          ) : null}
        </section>

        <aside className="h-fit border-y @min-[980px]:sticky @min-[980px]:top-[calc(var(--header-height)+1rem)]">
          <div className="flex items-center justify-between gap-3 px-3 py-3">
            <div>
              <h2 className="text-xs font-semibold">Criterion Library</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Add a Criterion to the end of the order.
              </p>
            </div>
            <Button
              aria-label="Create Criterion"
              onClick={onCreateCriterion}
              size="icon"
              variant="outline"
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
          {criterion.length ? (
            <div className="max-h-[28rem] divide-y overflow-y-auto border-t">
              {criterion.map((item) => {
                const position = draft.criterionIds.indexOf(item.id);
                const added = position >= 0;
                return (
                  <button
                    aria-label={
                      added
                        ? `${item.name} is ${position + 1} in the Criterion order`
                        : `Add ${item.name} to the Criterion order`
                    }
                    className={cn(
                      "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      added
                        ? "cursor-default bg-accent/55 text-foreground"
                        : "hover:bg-accent hover:text-foreground",
                    )}
                    disabled={added}
                    key={item.id}
                    onClick={() => addCriterion(item.id)}
                    type="button"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{item.name}</span>
                      <span className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] uppercase text-muted-foreground">
                        <CriterionTypeIcon className="size-3" type={item.type} /> {item.type}
                      </span>
                    </span>
                    {added ? (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {String(position + 1).padStart(2, "0")}
                      </span>
                    ) : (
                      <Plus className="size-3.5 text-muted-foreground" />
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <button
              className="w-full border-t px-4 py-8 text-center text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={onCreateCriterion}
              type="button"
            >
              <Library className="mx-auto mb-2 size-4" />
              Create the first Criterion
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}

function ListToggle({ listOpen, onClick }: { listOpen: boolean; onClick(): void }) {
  return (
    <Button
      aria-controls="criterion-library-list"
      aria-expanded={listOpen}
      aria-label={listOpen ? "Collapse Criterion library" : "Expand Criterion library"}
      className={cn(
        "h-8 shrink-0 px-2 text-muted-foreground",
        listOpen && "hidden @min-[620px]:inline-flex",
      )}
      onClick={onClick}
      size="sm"
      title={listOpen ? "Collapse Criterion library" : "Expand Criterion library"}
      variant="ghost"
    >
      Library
      {listOpen ? (
        <ChevronLeft className="size-3.5" />
      ) : (
        <>
          <ChevronDown className="size-3.5 @min-[620px]:hidden" />
          <ChevronRight className="hidden size-3.5 @min-[620px]:block" />
        </>
      )}
    </Button>
  );
}

function toDraft(criteria?: Criteria): Draft {
  return criteria
    ? {
        criterionIds: criteria.criterionSequence.map(({ id }) => id),
        id: criteria.id,
        name: criteria.name,
        version: criteria.version,
      }
    : { criterionIds: [], name: "Untitled Criteria" };
}

function move(values: string[], index: number, offset: -1 | 1): string[] {
  const next = [...values];
  const target = index + offset;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
