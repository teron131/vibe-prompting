/** Owns the scope-filter grammar shared by results and analytics, so applied dimensions stay legible without reading every control. */

"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";

import { MultiSelect, Select } from "@/components/ui/select";
import { cn } from "@/components/ui/utils";

const filterTriggerClassName = "px-2 shadow-none hover:border-foreground/30 hover:bg-accent/40";

/** Carries its own name in the default option, so the control needs no separate label above it. */
export function FilterSelect({
  className,
  children,
  label,
  onValueChange,
  value,
}: {
  children: ReactNode;
  className?: string;
  label: string;
  onValueChange(value: string): void;
  value: string;
}) {
  return (
    <Select
      aria-label={label}
      className={cn("h-8 min-w-0 text-xs", className)}
      onValueChange={onValueChange}
      prefix={<FilterLabel>{label}</FilterLabel>}
      triggerClassName={filterTriggerClass(value.length > 0)}
      value={value}
    >
      {children}
    </Select>
  );
}

/** Presents repeated filter values with the same compact grammar while keeping the menu open for fast selection. */
export function MultiFilterSelect({
  allLabel,
  className,
  children,
  label,
  onValuesChange,
  values,
}: {
  allLabel: ReactNode;
  children: ReactNode;
  className?: string;
  label: string;
  onValuesChange(values: string[]): void;
  values: string[];
}) {
  return (
    <MultiSelect
      allLabel={allLabel}
      aria-label={label}
      className={cn("h-8 min-w-0 text-xs", className)}
      onValuesChange={onValuesChange}
      prefix={<FilterLabel>{label}</FilterLabel>}
      triggerClassName={filterTriggerClass(values.length > 0)}
      values={values}
    >
      {children}
    </MultiSelect>
  );
}

export function ClearFilters({ count, onClear }: { count: number; onClear(): void }) {
  if (count === 0) return null;
  return (
    <button
      className="h-8 shrink-0 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClear}
      type="button"
    >
      Clear {count}
    </button>
  );
}

/** Keeps rarely-changed dimensions collapsed while still reporting how many of them are applied, and reveals them on their own row so the trigger stays inline with the primary filters. */
export function MoreFilters({
  activeCount,
  children,
  contentClassName,
  hint,
}: {
  activeCount: number;
  children: ReactNode;
  contentClassName?: string;
  hint: string;
}) {
  const [open, setOpen] = useState(activeCount > 0);
  const panelId = useId();
  const hasActive = activeCount > 0;

  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);

  return (
    <>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen(!open)}
        type="button"
      >
        More filters
        {hasActive ? (
          <span className="inline-flex size-[18px] items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background">
            {activeCount}
          </span>
        ) : open ? null : (
          <span className="font-mono text-[11px]">{hint}</span>
        )}
        <ChevronDown
          aria-hidden="true"
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className={cn("order-last basis-full", contentClassName)} id={panelId}>
          {children}
        </div>
      ) : null}
    </>
  );
}

function FilterLabel({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 font-mono text-[11px] uppercase text-muted-foreground">
      {children}
    </span>
  );
}

function filterTriggerClass(active: boolean): string {
  return cn(
    filterTriggerClassName,
    active
      ? "border-foreground/40 bg-accent/50 font-medium text-foreground hover:bg-accent/70"
      : "text-muted-foreground",
  );
}
