/** Marks product-owned sample evaluation data consistently across result surfaces. */

import { cn } from "@/components/ui/utils";

export function DefaultExampleBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-sm border bg-secondary/50 px-1.5 py-0.5 font-medium uppercase text-muted-foreground",
        className,
      )}
    >
      Default Example
    </span>
  );
}
