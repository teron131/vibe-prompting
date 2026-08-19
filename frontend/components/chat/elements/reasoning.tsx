/** Shows a safe reasoning lifecycle disclosure without exposing private model reasoning. */

import { Brain, ChevronRight } from "lucide-react";

import { ResponseText } from "@/components/chat/elements/response";

export function Reasoning({ summary }: { summary: string }) {
  return (
    <details className="group/reasoning mb-3 text-xs text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-1 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-3 transition-transform group-open/reasoning:rotate-90"
        />
        <Brain aria-hidden="true" className="size-3.5" />
        <span>Reasoning</span>
      </summary>
      <div className="ml-5 border-l pl-3">
        <ResponseText className="text-xs leading-5" text={summary} />
      </div>
    </details>
  );
}
