/** Edits one reusable named Criterion and exposes where it is used so shared changes remain deliberate. */

"use client";

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { CriterionTypeIcon } from "@/components/evaluations/shared/criterion-type-icon";
import { EvaluationPageBar } from "@/components/evaluations/shared/evaluation-page-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/components/ui/utils";
import type {
  Criteria,
  Criterion,
  SavedCriterion,
  SavedCriterionResponse,
} from "@/contracts/evaluations";
import { ApiRequestError, createApiRequester, createErrorReader } from "@/shared/api";

const api = createApiRequester({}, (status) => `Request failed with ${status}.`);
const readError = createErrorReader("The Criterion request failed.");
type Draft = Criterion & { id?: string; version?: number };
type CriterionType = Criterion["type"];
type LibraryState = { criteria: Criteria[]; criterion: SavedCriterion[] };

const typeOptions = [
  { label: "Boolean", type: "boolean" },
  { label: "Categorical", type: "categorical" },
  { label: "Numeric", type: "numeric" },
  { label: "Text", type: "text" },
  { label: "Correction", type: "correction" },
] satisfies { label: string; type: CriterionType }[];

export function CriterionEditor({
  criterion,
  listOpen,
  onDeleted,
  onReload,
  onSaved,
  onToggleList,
  criteria,
}: {
  criterion?: SavedCriterion;
  listOpen: boolean | null;
  onDeleted(id: string): void;
  onReload(): Promise<LibraryState>;
  onSaved(criterion: SavedCriterion): void;
  onToggleList(): void;
  criteria: Criteria[];
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(criterion));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const usedBy = draft.id
    ? criteria.filter((value) => value.criterionSequence.some(({ id }) => id === draft.id))
    : [];

  useEffect(() => {
    setDraft(toDraft(criterion));
    setConfirmingDelete(false);
  }, [criterion?.id]);

  async function save() {
    const prepared = prepare(draft);
    if (!prepared.name) return toast.error("Name this Criterion before saving it.");
    if (!prepared.instruction) return toast.error("Add the complete judge instruction.");
    const categoriesError = validateCategories(prepared);
    if (categoriesError) return toast.error(categoriesError);
    setSaving(true);
    try {
      const result = await api.json<SavedCriterionResponse>(
        draft.id
          ? `/api/evaluations/criterion/${encodeURIComponent(draft.id)}`
          : "/api/evaluations/criterion",
        {
          body: JSON.stringify({
            ...prepared,
            ...(draft.version && { expectedVersion: draft.version }),
          }),
          headers: { "content-type": "application/json" },
          method: draft.id ? "PUT" : "POST",
        },
      );
      setDraft(toDraft(result.criterion));
      onSaved(result.criterion);
      toast.success(
        draft.id ? "Criterion updated in every Criteria permutation." : "Criterion created.",
      );
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "stale-write" && draft.id) {
        const library = await onReload();
        const latest = library.criterion.find(({ id }) => id === draft.id);
        if (latest) setDraft((current) => ({ ...current, version: latest.version }));
        toast.error(
          "Someone saved a newer version of this Criterion. Your draft is still open with the latest version ready for review.",
        );
      } else {
        toast.error(readError(error));
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!draft.id || !draft.version || usedBy.length) return;
    const deletingId = draft.id;
    setDeleting(true);
    try {
      await api.empty(`/api/evaluations/criterion/${encodeURIComponent(deletingId)}`, {
        body: JSON.stringify({ expectedVersion: draft.version }),
        headers: { "content-type": "application/json" },
        method: "DELETE",
      });
      onDeleted(deletingId);
      toast.success("Criterion deleted. Historical runs are unchanged.");
    } catch (error) {
      toast.error(readError(error));
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  function changeType(type: CriterionType) {
    setDraft(criterionForType(type, draft.name, draft.instruction, draft.id, draft.version));
  }

  return (
    <div className="min-w-0">
      <EvaluationPageBar sticky>
        {listOpen !== null ? <ListToggle listOpen={listOpen} onClick={onToggleList} /> : null}
        <label className="sr-only" htmlFor="criterion-name">
          Criterion Name
        </label>
        <div className="group/title relative min-w-0 max-w-lg flex-1">
          <Pencil
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground opacity-40 transition-opacity group-hover/title:opacity-70 group-focus-within/title:opacity-90"
          />
          <Input
            className="h-8 cursor-text rounded-sm border-0 bg-transparent pr-2 pl-7 text-sm font-medium shadow-none transition-colors hover:bg-accent/35 focus-visible:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
            id="criterion-name"
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="Criterion Name"
            value={draft.name}
          />
        </div>
        <div className="flex shrink-0 gap-2">
          {draft.id ? (
            <Button
              aria-label="Duplicate Criterion"
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
              {draft.id ? "Save changes" : "Create Criterion"}
            </span>
            <span className="@min-[1120px]:hidden">Save</span>
          </Button>
        </div>
      </EvaluationPageBar>

      <div className="px-4 pt-6 pb-12 sm:px-6 min-[840px]:px-7 xl:px-10">
        <div className="max-w-3xl">
          <section aria-labelledby="criterion-definition-heading">
            <div className="mb-3">
              <h2 className="text-sm font-semibold" id="criterion-definition-heading">
                Judge Field
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Choose the response shape and describe exactly what the judge should assess.
              </p>
            </div>
            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="space-y-5 p-4 sm:p-5">
                <label className="block w-fit text-xs font-medium">
                  Type
                  <Select
                    aria-label="Select Criterion type"
                    className="mt-1.5 w-40"
                    onValueChange={(type) => changeType(type as CriterionType)}
                    renderIcon={(type) => (
                      <CriterionTypeIcon
                        className="text-muted-foreground"
                        type={type as CriterionType}
                      />
                    )}
                    value={draft.type}
                  >
                    {typeOptions.map((option) => (
                      <option key={option.type} value={option.type}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="block text-xs font-medium">
                  Judge Instruction
                  <Textarea
                    className="mt-1.5 min-h-40 leading-6"
                    onChange={(event) => setDraft({ ...draft, instruction: event.target.value })}
                    placeholder="Describe exactly what the judge should assess."
                    value={draft.instruction}
                  />
                </label>
              </div>
              <div className="border-t bg-muted/35 px-4 py-3 sm:px-5">
                <p className="text-xs leading-5 text-muted-foreground">
                  {
                    "The agent uses both the criterion name and judge instruction to understand what to evaluate."
                  }
                </p>
              </div>
            </div>
          </section>

          {draft.type === "categorical" ? (
            <CategoryEditor
              categories={draft.categories}
              onChange={(categories) => setDraft({ ...draft, categories })}
            />
          ) : null}
          {draft.type === "numeric" ? (
            <div className="mt-8 grid max-w-md grid-cols-2 gap-4">
              <NumberField
                label="Minimum"
                onChange={(min) => setDraft({ ...draft, min })}
                value={draft.min}
              />
              <NumberField
                label="Maximum"
                onChange={(max) => setDraft({ ...draft, max })}
                value={draft.max}
              />
            </div>
          ) : null}

          <section className="mt-8 border-y py-4">
            <h2 className="text-xs font-semibold">Used by {usedBy.length} Criteria</h2>
            {usedBy.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {usedBy.map((value) => (
                  <span className="border bg-muted/30 px-2 py-1 text-xs" key={value.id}>
                    {value.name}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                This Criterion is not used by Criteria yet.
              </p>
            )}
          </section>

          {draft.id ? (
            <footer className="mt-8 flex flex-wrap items-center justify-end gap-3 border-t pt-5">
              {usedBy.length ? (
                <p className="text-xs text-muted-foreground">
                  Remove this Criterion from every Criteria permutation before deleting it.
                </p>
              ) : confirmingDelete ? (
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
                  <Trash2 className="size-3.5" /> Delete Criterion
                </Button>
              )}
            </footer>
          ) : null}
        </div>
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

function CategoryEditor({
  categories,
  onChange,
}: {
  categories: string[];
  onChange(categories: string[]): void;
}) {
  return (
    <section aria-labelledby="criterion-categories-heading" className="mt-8 max-w-2xl">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold" id="criterion-categories-heading">
            Categories
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Define at least two outcomes the judge can return.
          </p>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {categories.length} total
        </span>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        {categories.map((category, index) => (
          <div
            className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.75rem] items-center border-b last:border-b-0"
            key={index}
          >
            <span className="text-center font-mono text-[10px] text-muted-foreground">
              {String(index + 1).padStart(2, "0")}
            </span>
            <Input
              aria-label={`Category ${index + 1}`}
              className="h-11 rounded-none border-0 border-x bg-transparent px-3 shadow-none focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onChange={(event) =>
                onChange(
                  categories.map((item, itemIndex) =>
                    itemIndex === index ? event.target.value : item,
                  ),
                )
              }
              placeholder={`Category ${index + 1}`}
              value={category}
            />
            <Button
              aria-label={`Remove category ${index + 1}`}
              className="mx-auto size-8 text-muted-foreground hover:text-destructive"
              disabled={categories.length <= 2}
              onClick={() => onChange(categories.filter((_, itemIndex) => itemIndex !== index))}
              size="icon"
              variant="ghost"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        <Button
          className="h-10 w-full justify-start rounded-none px-3 text-muted-foreground hover:text-foreground"
          onClick={() => onChange([...categories, ""])}
          size="sm"
          variant="ghost"
        >
          <Plus className="size-3.5" /> Add category
        </Button>
      </div>
    </section>
  );
}

function NumberField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange(value: number): void;
  value: number;
}) {
  return (
    <label className="text-xs font-medium">
      {label}
      <Input
        className="mt-1.5"
        onChange={(event) => onChange(Number(event.target.value))}
        type="number"
        value={value}
      />
    </label>
  );
}

function toDraft(criterion?: SavedCriterion): Draft {
  if (!criterion) return criterionForType("boolean", "Untitled Criterion");
  return structuredClone(criterion);
}

function criterionForType(
  type: CriterionType,
  name: string,
  instruction = "",
  id?: string,
  version?: number,
): Draft {
  const identity = { ...(id && { id }), ...(version && { version }), name };
  if (type === "categorical")
    return { ...identity, categories: ["fail", "pass"], instruction, type };
  if (type === "numeric") return { ...identity, instruction, max: 1, min: 0, type };
  return { ...identity, instruction, type };
}

function prepare(draft: Draft): Criterion {
  const { id: _id, version: _version, ...criterion } = draft;
  if (criterion.type === "categorical") {
    return {
      ...criterion,
      categories: criterion.categories.map((category) => category.trim()),
      instruction: criterion.instruction.trim(),
      name: criterion.name.trim(),
    };
  }
  return { ...criterion, instruction: criterion.instruction.trim(), name: criterion.name.trim() };
}

function validateCategories(criterion: Criterion): string | undefined {
  if (criterion.type !== "categorical") return;
  if (criterion.categories.length < 2 || criterion.categories.some((category) => !category))
    return "A categorical Criterion needs at least two non-empty categories.";
  if (new Set(criterion.categories).size !== criterion.categories.length)
    return "Categories within a Criterion must be unique.";
}
