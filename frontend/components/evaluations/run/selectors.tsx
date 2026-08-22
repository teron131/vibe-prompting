/** Owns reusable criteria-set and model selection controls shared by both evaluation run workflows. */

"use client";

import type { ReactNode } from "react";

import { ModelIdentityLabel } from "@/components/chat/model-selector";
import { CriterionTypeIcon } from "@/components/evaluations/shared/criterion-type-icon";
import { cn } from "@/components/ui/utils";
import type { ConfiguredModel } from "@/contracts/chat";
import type { CriteriaProfile } from "@/contracts/evaluations";

export function CriteriaProfilePicker({
  actions,
  className,
  onChange,
  profiles,
  selected,
}: {
  actions?: ReactNode;
  className?: string;
  onChange(value: string[]): void;
  profiles: CriteriaProfile[];
  selected: string[];
}) {
  return (
    <fieldset className={className}>
      <legend className="sr-only">Criteria sets</legend>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium">Criteria sets</span>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground">{selected.length} selected</span>
          {actions}
        </div>
      </div>
      <div className="mt-2 max-h-64 divide-y overflow-y-auto border">
        {profiles.map((profile) => {
          const active = selected.includes(profile.id);
          return (
            <label
              className={cn(
                "flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-accent",
                active && "bg-accent",
              )}
              key={profile.id}
            >
              <input
                aria-label={`Use ${profile.name}`}
                checked={active}
                className="mt-0.5 size-4 shrink-0 accent-foreground"
                onChange={() => onChange(toggleSelection(selected, profile.id))}
                type="checkbox"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-3 text-xs font-medium">
                  <span className="truncate">{profile.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {profile.criteria.length}
                  </span>
                </span>
                <span className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
                  {profile.criteria.map((criterion, index) => (
                    <span className="inline-flex items-center gap-1" key={index}>
                      <CriterionTypeIcon className="size-3" type={criterion.type} />
                      {criterion.instruction.split(" — ")[0]}
                    </span>
                  ))}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function EvaluationModelPicker({
  className,
  label,
  models,
  onChange,
  selected,
}: {
  className?: string;
  label: string;
  models: ConfiguredModel[];
  onChange(value: string[]): void;
  selected: string[];
}) {
  return (
    <fieldset className={className}>
      <legend className="sr-only">{label}</legend>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{selected.length} selected</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {models.map((model) => {
          const active = selected.includes(model.id);
          return (
            <button
              aria-pressed={active}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-foreground bg-foreground text-background"
                  : "bg-background hover:bg-accent",
              )}
              key={model.id}
              onClick={() => onChange(toggleSelection(selected, model.id))}
              type="button"
            >
              <ModelIdentityLabel labelClassName="font-medium leading-none" model={model} />
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function toggleSelection(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}
