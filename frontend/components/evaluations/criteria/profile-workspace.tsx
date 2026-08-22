/** Manages durable reusable criteria profiles while keeping each criterion's evaluator contract visible and ordered. */

"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  LoaderCircle,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { CriterionTypeIcon } from "@/components/evaluations/shared/criterion-type-icon";
import { EvaluationPageBar } from "@/components/evaluations/shared/evaluation-page-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { maximumResizablePanelWidth, ResizableDivider } from "@/components/ui/resizable-divider";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/components/ui/utils";
import type {
  CriteriaProfile,
  CriteriaProfileInput,
  CriteriaProfileResponse,
  CriteriaProfilesResponse,
  Criterion,
} from "@/contracts/evaluations";
import { createApiRequester, createErrorReader } from "@/shared/api";

const criteriaApi = createApiRequester({}, (status) => `Request failed with ${status}.`);
const readError = createErrorReader("The criteria profile request failed.");
const PROFILE_LIST_MIN_WIDTH = 288;
const PROFILE_LIST_MAX_WIDTH = 480;
const PROFILE_EDITOR_MIN_WIDTH = 400;
const PROFILE_LIST_OPEN_STORAGE_KEY = "evaluation-criteria-profile-list-open";

type Draft = CriteriaProfileInput & { id?: string };
type CriterionType = Criterion["type"];

const criterionTypeOptions = [
  { label: "Boolean", type: "boolean" },
  { label: "Categorical", type: "categorical" },
  { label: "Numeric", type: "numeric" },
  { label: "Text", type: "text" },
  { label: "Correction", type: "correction" },
] satisfies { label: string; type: CriterionType }[];

export function CriteriaProfileWorkspace() {
  const [profiles, setProfiles] = useState<CriteriaProfile[]>([]);
  const [draft, setDraft] = useState<Draft>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [profileListOpen, setProfileListOpen] = useState<boolean | null>(null);
  const [profileListWidth, setProfileListWidth] = useState<number>();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const profileListRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [draft?.id]);

  useEffect(() => {
    const storedProfileListOpen = window.localStorage.getItem(PROFILE_LIST_OPEN_STORAGE_KEY);
    setProfileListOpen(storedProfileListOpen === null ? true : storedProfileListOpen === "true");
  }, []);

  useEffect(() => {
    void criteriaApi
      .json<CriteriaProfilesResponse>("/api/evaluations/criteria-profiles")
      .then(({ profiles: loaded }) => {
        setProfiles(loaded);
        if (loaded[0]) setDraft(toDraft(loaded[0]));
      })
      .catch((error) => toast.error(readError(error)))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) return toast.error("Name this criteria set before saving it.");
    const criteria = prepareCriteria(draft.criteria);
    if (criteria.length === 0) return toast.error("Add at least one complete criterion.");
    const categoriesError = validateCategories(criteria);
    if (categoriesError) return toast.error(categoriesError);
    setSaving(true);
    try {
      const body = JSON.stringify({
        criteria,
        name: draft.name,
      });
      const result = await criteriaApi.json<CriteriaProfileResponse>(
        draft.id
          ? `/api/evaluations/criteria-profiles/${encodeURIComponent(draft.id)}`
          : "/api/evaluations/criteria-profiles",
        {
          body,
          headers: { "content-type": "application/json" },
          method: draft.id ? "PUT" : "POST",
        },
      );
      const next = draft.id
        ? profiles.map((profile) => (profile.id === result.profile.id ? result.profile : profile))
        : [...profiles, result.profile];
      setProfiles(sortProfiles(next));
      setDraft(toDraft(result.profile));
      toast.success(draft.id ? "Criteria set updated." : "Criteria set created.");
    } catch (error) {
      toast.error(readError(error));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!draft?.id) return;
    const deletingId = draft.id;
    const deletingName = draft.name;
    setDeleting(true);
    try {
      await criteriaApi.empty(
        `/api/evaluations/criteria-profiles/${encodeURIComponent(deletingId)}`,
        {
          method: "DELETE",
        },
      );
      const next = profiles.filter(({ id }) => id !== deletingId);
      setProfiles(next);
      setDraft((current) =>
        current?.id === deletingId ? (next[0] ? toDraft(next[0]) : newDraft()) : current,
      );
      toast.success(`Deleted “${deletingName}”.`);
    } catch (error) {
      toast.error(readError(error));
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  function maximumProfileListWidth() {
    return maximumResizablePanelWidth({
      contentMinWidth: PROFILE_EDITOR_MIN_WIDTH,
      maxWidth: PROFILE_LIST_MAX_WIDTH,
      minWidth: PROFILE_LIST_MIN_WIDTH,
      workspace: workspaceRef.current,
    });
  }

  function toggleProfileList() {
    setProfileListOpen((open) => {
      const next = !open;
      window.localStorage.setItem(PROFILE_LIST_OPEN_STORAGE_KEY, String(next));
      return next;
    });
  }

  return (
    <div
      className={cn(
        "mx-auto grid min-h-[calc(100dvh-var(--header-height))] w-full max-w-[1480px]",
        profileListOpen === true
          ? "@min-[620px]:grid-cols-[var(--criteria-list-width)_1px_minmax(0,1fr)] @min-[620px]:[--criteria-list-width:18rem] @min-[900px]:[--criteria-list-width:20rem] @min-[1200px]:[--criteria-list-width:22rem]"
          : "@min-[620px]:grid-cols-[minmax(0,1fr)]",
      )}
      ref={workspaceRef}
      style={
        profileListWidth === undefined
          ? undefined
          : ({ "--criteria-list-width": `${profileListWidth}px` } as CSSProperties)
      }
    >
      <aside
        className={cn(
          "border-b bg-muted/15 @min-[620px]:border-b-0",
          profileListOpen !== true && "hidden",
        )}
        id="criteria-profile-list"
        ref={profileListRef}
      >
        <div className="p-4 sm:p-5 @min-[620px]:sticky @min-[620px]:top-0 @min-[620px]:max-h-[calc(100dvh-var(--header-height))] @min-[620px]:overflow-y-auto xl:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-base font-semibold">Criteria sets</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Reusable scoring rules for human and agent runs.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                aria-controls="criteria-profile-list"
                aria-expanded="true"
                aria-label="Collapse criteria sets"
                className="@min-[620px]:hidden"
                onClick={toggleProfileList}
                size="icon"
                title="Collapse criteria sets"
                variant="ghost"
              >
                <ChevronUp aria-hidden="true" className="size-3.5" />
              </Button>
              <Button
                aria-label="New criteria set"
                disabled={deleting}
                onClick={() => setDraft(newDraft())}
                size="icon"
                variant="outline"
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </div>
          {loading ? (
            <div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" /> Loading criteria sets…
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto border-y">
              <table className="w-full table-fixed text-left">
                <caption className="sr-only">Available criteria sets</caption>
                <colgroup>
                  <col />
                  <col className="w-28" />
                  <col className="w-[4.25rem]" />
                </colgroup>
                <thead className="bg-muted/35 font-mono text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium" scope="col">
                      Set
                    </th>
                    <th className="px-2 py-2 font-medium" scope="col">
                      Types
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium" scope="col">
                      Criteria
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {profiles.map((profile) => (
                    <tr
                      className={cn(
                        "relative h-[3.875rem] transition-colors",
                        draft?.id === profile.id
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                        deleting && "opacity-50",
                      )}
                      key={profile.id}
                    >
                      <th className="px-3 py-2.5 text-left font-normal" scope="row">
                        <button
                          aria-label={`Edit criteria set ${profile.name}`}
                          aria-pressed={draft?.id === profile.id}
                          className={cn(
                            "absolute inset-0 z-0 w-full transition-colors disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                            draft?.id === profile.id ? "bg-accent" : "hover:bg-accent/60",
                          )}
                          disabled={deleting}
                          onClick={() => setDraft(toDraft(profile))}
                          type="button"
                        />
                        <span className="pointer-events-none relative z-10 block truncate text-sm font-medium">
                          {profile.name}
                        </span>
                      </th>
                      <td className="pointer-events-none relative z-10 px-2 py-2.5 font-mono text-[10px] uppercase">
                        <span className="flex flex-wrap gap-x-1.5 gap-y-1">
                          <CriterionTypeSummary criteria={profile.criteria} />
                        </span>
                      </td>
                      <td className="pointer-events-none relative z-10 whitespace-nowrap px-3 py-2.5 text-right font-mono text-[11px]">
                        {profile.criteria.length}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </aside>

      {profileListOpen === true ? (
        <ResizableDivider
          ariaLabel="Resize criteria set list"
          className="hidden @min-[620px]:block"
          defaultValueText="Default criteria set list width"
          maxSize={maximumProfileListWidth}
          minSize={PROFILE_LIST_MIN_WIDTH}
          onSizeChange={setProfileListWidth}
          panelRef={profileListRef}
          size={profileListWidth}
        />
      ) : null}

      <section className="relative min-w-0 bg-background">
        {draft ? (
          <div className="min-w-0">
            <EvaluationPageBar sticky>
              {profileListOpen !== null ? (
                <Button
                  aria-controls="criteria-profile-list"
                  aria-expanded={profileListOpen}
                  aria-label={profileListOpen ? "Collapse criteria sets" : "Expand criteria sets"}
                  className={cn(
                    "h-8 shrink-0 px-2 text-muted-foreground",
                    profileListOpen && "hidden @min-[620px]:inline-flex",
                  )}
                  onClick={toggleProfileList}
                  size="sm"
                  title={profileListOpen ? "Collapse criteria sets" : "Expand criteria sets"}
                  variant="ghost"
                >
                  Sets
                  {profileListOpen ? (
                    <ChevronLeft aria-hidden="true" className="size-3.5" />
                  ) : (
                    <>
                      <ChevronDown aria-hidden="true" className="size-3.5 @min-[620px]:hidden" />
                      <ChevronRight
                        aria-hidden="true"
                        className="hidden size-3.5 @min-[620px]:block"
                      />
                    </>
                  )}
                </Button>
              ) : null}
              <label className="sr-only" htmlFor="criteria-profile-name">
                Criteria set name
              </label>
              <Input
                className="h-8 min-w-0 max-w-lg flex-1 border-0 bg-transparent px-2 text-base font-semibold shadow-none"
                id="criteria-profile-name"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Criteria set name"
                value={draft.name}
              />
              <div className="flex shrink-0 gap-2">
                {draft.id ? (
                  <Button
                    aria-label="Duplicate criteria set"
                    className="px-2.5"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        id: undefined,
                        name: `${draft.name} copy`,
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
                    {draft.id ? "Save changes" : "Create set"}
                  </span>
                  <span className="@min-[1120px]:hidden">Save</span>
                </Button>
              </div>
            </EvaluationPageBar>

            <div className="px-4 pt-6 pb-12 sm:px-6 min-[840px]:px-7 xl:px-10">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
                <div>
                  <h2 className="text-sm font-semibold">Criteria</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Ordered rules applied by the judge.
                  </p>
                </div>
                <Button
                  disabled={draft.criteria.length >= 10}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      criteria: [...draft.criteria, criterionForType("boolean")],
                    })
                  }
                  size="sm"
                  variant="outline"
                >
                  <Plus className="size-3.5" /> Add criterion
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {draft.criteria.length}/10
                  </span>
                </Button>
              </div>

              <div className="@min-[1120px]:grid @min-[1120px]:grid-cols-[2.5rem_max-content_minmax(0,1fr)_6.5rem]">
                <div className="hidden gap-3 border-y bg-muted/30 px-3 py-2 font-mono text-[11px] uppercase text-muted-foreground @min-[1120px]:col-span-4 @min-[1120px]:grid @min-[1120px]:grid-cols-subgrid">
                  <span>No.</span>
                  <span>Type</span>
                  <span>Judge instruction</span>
                  <span>Actions</span>
                </div>
                {draft.criteria.map((criterion, index) => (
                  <CriterionEditor
                    criterion={criterion}
                    index={index}
                    key={index}
                    move={(offset) =>
                      setDraft({ ...draft, criteria: move(draft.criteria, index, offset) })
                    }
                    remove={() =>
                      setDraft({
                        ...draft,
                        criteria: draft.criteria.filter((_, itemIndex) => itemIndex !== index),
                      })
                    }
                    update={(value) =>
                      setDraft({
                        ...draft,
                        criteria: draft.criteria.map((item, itemIndex) =>
                          itemIndex === index ? value : item,
                        ),
                      })
                    }
                    total={draft.criteria.length}
                  />
                ))}
              </div>

              {draft.id ? (
                <footer className="mt-8 flex flex-wrap items-center justify-end gap-3 border-t pt-5">
                  {confirmingDelete ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Delete “{draft.name}”? Past runs keep their own score snapshots.
                      </p>
                      <Button
                        onClick={() => setConfirmingDelete(false)}
                        size="sm"
                        variant="outline"
                      >
                        Cancel
                      </Button>
                      <Button disabled={deleting} onClick={remove} size="sm" variant="destructive">
                        {deleting ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
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
                      <Trash2 className="size-3.5" /> Delete set
                    </Button>
                  )}
                </footer>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function CriterionEditor({
  criterion,
  index,
  move: moveCriterion,
  remove,
  total,
  update,
}: {
  criterion: Criterion;
  index: number;
  move(offset: -1 | 1): void;
  remove(): void;
  total: number;
  update(value: Criterion): void;
}) {
  return (
    <article className="grid gap-3 border-b px-3 py-4 @min-[1120px]:col-span-4 @min-[1120px]:grid-cols-subgrid @min-[1120px]:items-start">
      <div className="pt-2 font-mono text-[11px] text-muted-foreground">
        {String(index + 1).padStart(2, "0")}
      </div>
      <label className="block text-xs font-medium">
        <span className="mb-1.5 block @min-[1120px]:sr-only">Type</span>
        <Select
          aria-label="Select criterion type"
          className="h-9 w-44"
          onValueChange={(type) =>
            update(criterionForType(type as CriterionType, criterion.instruction))
          }
          renderIcon={(type) => (
            <CriterionTypeIcon className="text-muted-foreground" type={type as CriterionType} />
          )}
          value={criterion.type}
        >
          {criterionTypeOptions.map((option) => (
            <option key={option.type} value={option.type}>
              {option.label}
            </option>
          ))}
        </Select>
      </label>
      <div className="min-w-0">
        <label className="block text-xs font-medium">
          <span className="mb-1.5 block @min-[1120px]:sr-only">Judge instruction</span>
          <Textarea
            className="min-h-[5.5rem]"
            onChange={(event) => update({ ...criterion, instruction: event.target.value })}
            value={criterion.instruction}
          />
        </label>
        {criterion.type === "categorical" ? (
          <CategoryEditor
            categories={criterion.categories}
            onChange={(categories) => update({ ...criterion, categories })}
          />
        ) : null}
        {criterion.type === "numeric" ? (
          <div className="mt-3 grid max-w-sm grid-cols-2 gap-3">
            <NumberField
              label="Minimum"
              onChange={(min) => update({ ...criterion, min })}
              value={criterion.min}
            />
            <NumberField
              label="Maximum"
              onChange={(max) => update({ ...criterion, max })}
              value={criterion.max}
            />
          </div>
        ) : null}
      </div>
      <div className="flex justify-start gap-0.5">
        <Button
          aria-label={`Move criterion ${index + 1} up`}
          className="size-8"
          disabled={index === 0}
          onClick={() => moveCriterion(-1)}
          size="icon"
          variant="ghost"
        >
          <ArrowUp className="size-3.5" />
        </Button>
        <Button
          aria-label={`Move criterion ${index + 1} down`}
          className="size-8"
          disabled={index === total - 1}
          onClick={() => moveCriterion(1)}
          size="icon"
          variant="ghost"
        >
          <ArrowDown className="size-3.5" />
        </Button>
        <Button
          aria-label={`Remove criterion ${index + 1}`}
          className="size-8 text-muted-foreground hover:text-destructive"
          disabled={total === 1}
          onClick={remove}
          size="icon"
          variant="ghost"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </article>
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
    <div className="mt-3">
      <span className="text-xs font-medium">Categories</span>
      <div className="mt-1.5 space-y-2">
        {categories.map((category, index) => (
          <div className="flex items-center gap-2" key={index}>
            <Input
              aria-label={`Category ${index + 1}`}
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
              className="shrink-0"
              disabled={categories.length <= 2}
              onClick={() => onChange(categories.filter((_, itemIndex) => itemIndex !== index))}
              size="icon"
              variant="ghost"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        className="mt-2"
        onClick={() => onChange([...categories, ""])}
        size="sm"
        variant="outline"
      >
        <Plus className="size-3.5" /> Add category
      </Button>
    </div>
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

function newDraft(): Draft {
  return { criteria: [criterionForType("boolean")], name: "Untitled set" };
}

function toDraft(profile: CriteriaProfile): Draft {
  return {
    criteria: structuredClone(profile.criteria),
    id: profile.id,
    name: profile.name,
  };
}

function criterionForType(type: CriterionType, instruction = ""): Criterion {
  if (type === "categorical") return { categories: ["fail", "pass"], instruction, type };
  if (type === "numeric") return { instruction, max: 1, min: 0, type };
  return { instruction, type };
}

function prepareCriteria(criteria: Criterion[]): Criterion[] {
  return criteria
    .map((criterion) =>
      criterion.type === "categorical"
        ? {
            ...criterion,
            categories: criterion.categories.map((category) => category.trim()),
            instruction: criterion.instruction.trim(),
          }
        : { ...criterion, instruction: criterion.instruction.trim() },
    )
    .filter(({ instruction }) => instruction);
}

function validateCategories(criteria: Criterion[]): string | undefined {
  for (const criterion of criteria) {
    if (criterion.type !== "categorical") continue;
    const categories = criterion.categories.map((category) => category.trim());
    if (categories.length < 2 || categories.some((category) => !category)) {
      return "Each categorical criterion needs at least two non-empty categories.";
    }
    if (new Set(categories).size !== categories.length) {
      return "Categories within a criterion must be unique.";
    }
  }
}

function move(criteria: Criterion[], index: number, offset: -1 | 1): Criterion[] {
  const next = [...criteria];
  const target = index + offset;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

function CriterionTypeSummary({ criteria }: { criteria: Criterion[] }) {
  const types = [...new Set(criteria.map(({ type }) => type))];
  return types.map((type, index) => (
    <span className="contents" key={type}>
      {index > 0 ? <span>·</span> : null}
      <span className="inline-flex items-center gap-1">
        <CriterionTypeIcon className="size-3" type={type} />
        {type}
      </span>
    </span>
  ));
}

function sortProfiles(profiles: CriteriaProfile[]): CriteriaProfile[] {
  return [...profiles].sort((left, right) => left.name.localeCompare(right.name));
}
