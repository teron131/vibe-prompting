/** Defines the single compact page-bar surface used across evaluation workspaces so their navigation context and actions cannot visually drift. */

import type { ReactNode } from "react";

import { cn } from "@/components/ui/utils";

const insetClasses = {
  page: "px-4 sm:px-6 min-[840px]:px-7 xl:px-10",
  panel: "px-4 sm:px-5",
} as const;

export function EvaluationPageBar({
  children,
  className,
  inset = "page",
  sticky = false,
}: {
  children: ReactNode;
  className?: string;
  inset?: keyof typeof insetClasses;
  sticky?: boolean;
}) {
  return (
    <header
      className={cn(
        "flex h-(--header-height) min-w-0 items-center justify-between gap-4 border-b bg-background",
        insetClasses[inset],
        sticky && "sticky top-0 z-20",
        className,
      )}
      data-evaluation-page-bar=""
    >
      {children}
    </header>
  );
}
