/** Owns the scope-filter grammar shared by results and analytics, so applied dimensions stay legible without reading every control. */

"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, type SelectHTMLAttributes, useEffect, useId, useState } from "react";

import { Select } from "@/components/ui/select";
import { cn } from "@/components/ui/utils";

/** Carries its own name in the default option, so the control needs no separate label above it. */
export function FilterSelect({
  className,
  label,
  value,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; value: string }) {
  return (
    <label
      className={cn(
        "flex h-8 min-w-0 items-center rounded-md border border-input bg-background px-2 transition-colors hover:border-foreground/30 hover:bg-accent/40 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
        value
          ? "border-foreground/40 bg-accent/50 font-medium text-foreground hover:bg-accent/70"
          : "text-muted-foreground",
        className,
      )}
    >
      <span className="shrink-0 font-mono text-[11px] uppercase text-muted-foreground">
        {label}
      </span>
      <Select
        aria-label={label}
        className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1.5 text-xs shadow-none focus-visible:outline-none"
        value={value}
        {...props}
      />
    </label>
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
