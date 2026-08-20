/** Manages durable reusable criteria profiles while keeping each criterion's evaluator contract visible and ordered. */

"use client";

import { ArrowDown, ArrowUp, Copy, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { CriterionTypeIcon } from "@/components/evaluations/criterion-type-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

type Draft = CriteriaProfileInput & { id?: string };
type CriterionType = Criterion["type"];

export function CriteriaManager() {
  const [profiles, setProfiles] = useState<CriteriaProfile[]>([]);
  const [draft, setDraft] = useState<Draft>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
    if (!draft.name.trim()) return toast.error("Name this criteria profile before saving it.");
    if (draft.criteria.length === 0) return toast.error("Add at least one criterion.");
    if (draft.criteria.length > 10)
      return toast.error("A profile can contain at most 10 criteria.");
    const categoriesError = validateCategories(draft.criteria);
    if (categoriesError) return toast.error(categoriesError);
    setSaving(true);
    try {
      const body = JSON.stringify({
        criteria: normalizeCategories(draft.criteria),
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
      toast.success(draft.id ? "Criteria profile updated." : "Criteria profile created.");
    } catch (error) {
      toast.error(readError(error));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!draft?.id) return;
    try {
      await criteriaApi.empty(
        `/api/evaluations/criteria-profiles/${encodeURIComponent(draft.id)}`,
        {
          method: "DELETE",
        },
      );
      const next = profiles.filter(({ id }) => id !== draft.id);
      setProfiles(next);
      setDraft(next[0] ? toDraft(next[0]) : newDraft());
      toast.success("Criteria profile deleted.");
    } catch (error) {
      toast.error(readError(error));
    }
  }

  return (
    <div className="mx-auto grid min-h-[calc(100vh-var(--header-height))] w-full max-w-[1480px] lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)]">
      <aside className="border-b bg-muted/25 p-4 sm:p-5 lg:border-r lg:border-b-0 xl:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold">Criteria profiles</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Reusable score recipes for human and agent runs.
            </p>
          </div>
          <Button
            aria-label="New criteria profile"
            onClick={() => setDraft(newDraft())}
            size="icon"
            variant="outline"
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
        {loading ? (
          <div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" /> Loading profiles…
          </div>
        ) : (
          <div className="mt-4 border-y">
            <div className="grid grid-cols-[minmax(0,1fr)_3rem] gap-3 px-3 py-2 font-mono text-[9px] uppercase text-muted-foreground">
              <span>Profile</span>
              <span className="text-right">Criteria</span>
            </div>
            <div className="divide-y">
              {profiles.map((profile) => (
                <button
                  className={cn(
                    "grid w-full grid-cols-[minmax(0,1fr)_3rem] items-center gap-3 px-3 py-2.5 text-left transition-colors",
                    draft?.id === profile.id
                      ? "bg-background text-foreground"
                      : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                  )}
                  key={profile.id}
                  onClick={() => setDraft(toDraft(profile))}
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{profile.name}</span>
                    <span className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap font-mono text-[10px] uppercase">
                      <CriterionTypeSummary criteria={profile.criteria} />
                    </span>
                  </span>
                  <span className="text-right font-mono text-[11px]">
                    {profile.criteria.length}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      <section className="min-w-0 bg-background px-4 py-5 sm:px-6 min-[840px]:px-7 xl:px-10 xl:py-8">
        {draft ? (
          <div className="max-w-4xl">
            <header className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0 flex-1">
                <label className="text-xs font-medium" htmlFor="criteria-profile-name">
                  Profile name
                </label>
                <Input
                  className="mt-1.5 max-w-xl text-base font-semibold"
                  id="criteria-profile-name"
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="Profile name"
                  value={draft.name}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Runs persist a snapshot, so later edits do not rewrite historical scores.
                </p>
              </div>
              <div className="flex gap-2">
                {draft.id ? (
                  <Button
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
                    <Copy className="size-3.5" /> Duplicate
                  </Button>
                ) : null}
                <Button disabled={saving} onClick={save} size="sm">
                  {saving ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <Save className="size-3.5" />
                  )}
                  {draft.id ? "Save changes" : "Create profile"}
                </Button>
              </div>
            </header>

            <div className="mt-2 divide-y">
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
            <div className="mt-4 flex items-center justify-between gap-4">
              <Button
                disabled={draft.criteria.length >= 10}
                onClick={() =>
                  setDraft({ ...draft, criteria: [...draft.criteria, criterionForType("boolean")] })
                }
                size="sm"
                variant="outline"
              >
                <Plus className="size-3.5" /> Add criterion ({draft.criteria.length}/10)
              </Button>
              {draft.id ? (
                <Button
                  className="text-destructive hover:text-destructive"
                  onClick={remove}
                  size="sm"
                  variant="ghost"
                >
                  <Trash2 className="size-3.5" /> Delete profile
                </Button>
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
    <article className="grid gap-4 px-3 py-5 transition-colors hover:bg-muted/25 sm:grid-cols-[2.5rem_minmax(0,1fr)]">
      <div className="font-mono text-[10px] text-muted-foreground">
        {String(index + 1).padStart(2, "0")}
      </div>
      <div className="min-w-0">
        <div className="grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
          <label className="block text-xs font-medium">
            Type
            <span className="relative mt-1.5 block">
              <CriterionTypeIcon
                className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground"
                type={criterion.type}
              />
              <Select
                className="pl-9"
                onChange={(event) =>
                  update(
                    criterionForType(event.target.value as CriterionType, criterion.instruction),
                  )
                }
                value={criterion.type}
              >
                <option value="boolean">Boolean</option>
                <option value="categorical">Categorical</option>
                <option value="numeric">Numeric</option>
                <option value="text">Text</option>
                <option value="correction">Correction</option>
              </Select>
            </span>
          </label>
          <label className="block text-xs font-medium">
            Judge instruction
            <Textarea
              className="mt-1.5 min-h-20"
              onChange={(event) => update({ ...criterion, instruction: event.target.value })}
              value={criterion.instruction}
            />
          </label>
        </div>
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
        <div className="mt-3 flex justify-end gap-1">
          <Button
            aria-label={`Move criterion ${index + 1} up`}
            disabled={index === 0}
            onClick={() => moveCriterion(-1)}
            size="icon"
            variant="ghost"
          >
            <ArrowUp className="size-3.5" />
          </Button>
          <Button
            aria-label={`Move criterion ${index + 1} down`}
            disabled={index === total - 1}
            onClick={() => moveCriterion(1)}
            size="icon"
            variant="ghost"
          >
            <ArrowDown className="size-3.5" />
          </Button>
          <Button
            aria-label={`Remove criterion ${index + 1}`}
            disabled={total === 1}
            onClick={remove}
            size="icon"
            variant="ghost"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
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
  return { criteria: [criterionForType("boolean")], name: "Untitled profile" };
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

function normalizeCategories(criteria: Criterion[]): Criterion[] {
  return criteria.map((criterion) =>
    criterion.type === "categorical"
      ? { ...criterion, categories: criterion.categories.map((category) => category.trim()) }
      : criterion,
  );
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
