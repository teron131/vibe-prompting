/** Shows a safe reasoning lifecycle disclosure without exposing private model reasoning. */

import { Brain, ChevronRight } from "lucide-react";

import { ResponseText } from "@/components/chat/elements/response";
import { cn } from "@/components/ui/utils";

export function Reasoning({ nested = false, summary }: { nested?: boolean; summary: string }) {
  return (
    <details className={cn("group/reasoning text-xs text-muted-foreground", !nested && "mb-3")}>
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden",
          nested ? "h-7 py-0" : "py-1",
        )}
      >
        <Brain aria-hidden="true" className="size-3.5" />
        <span>Reasoning</span>
        <ChevronRight
          aria-hidden="true"
          className="size-3 transition-transform group-open/reasoning:rotate-90"
        />
      </summary>
      <div className="ml-2 border-l border-border/70 pb-1 pl-3">
        <ResponseText className="text-xs leading-5" text={summary} />
      </div>
    </details>
  );
}
