/** Owns the accessible read, edit, preview, and optional changes mode control shared by prompt workspaces. */

import { BookOpen, Eye, GitCompareArrows, Pencil } from "lucide-react";

import { cn } from "@/components/ui/utils";

export type PromptViewMode = "changes" | "edit" | "preview" | "read";

const modes = [
  { icon: GitCompareArrows, label: "Changes", value: "changes" },
  { icon: BookOpen, label: "Read", value: "read" },
  { icon: Pencil, label: "Edit", value: "edit" },
  { icon: Eye, label: "Preview", value: "preview" },
] as const;
const contentModes = modes.slice(1);

export function PromptViewModeControl({
  className,
  compact = false,
  editDisabled = false,
  mode,
  onChange,
  showChanges = false,
  variant = "panel",
}: {
  className?: string;
  compact?: boolean;
  editDisabled?: boolean;
  mode: PromptViewMode;
  onChange(mode: PromptViewMode): void;
  showChanges?: boolean;
  variant?: "editor" | "panel";
}) {
  const visibleModes = showChanges ? modes : contentModes;

  return (
    <div
      aria-label="Prompt view mode"
      className={cn(
        "grid shrink-0 gap-1",
        compact ? "h-7" : "h-8",
        showChanges ? "grid-cols-4" : "grid-cols-3",
        className,
      )}
      role="group"
    >
      {visibleModes.map((option) => {
        const Icon = option.icon;
        const active = mode === option.value;
        const disabled = option.value === "edit" && editDisabled;
        return (
          <button
            aria-pressed={active}
            className={cn(
              "inline-flex min-w-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
              variant === "editor"
                ? "h-8 gap-1.5 px-2 text-xs"
                : compact
                  ? "h-7 gap-1 px-1.5 text-[11px]"
                  : "h-8 gap-2 px-3 text-xs",
              active
                ? "bg-secondary font-semibold text-secondary-foreground ring-1 ring-inset ring-border"
                : "font-medium text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            )}
            disabled={disabled}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            <Icon
              aria-hidden="true"
              className={cn(option.value === "preview" ? "size-4" : "size-3.5", "shrink-0")}
            />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
