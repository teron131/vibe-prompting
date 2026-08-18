/** Provides the shared native select control while retaining platform keyboard behavior. */

import type { SelectHTMLAttributes } from "react";

import { cn } from "./utils";

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
