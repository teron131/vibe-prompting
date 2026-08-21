/** Renders reasoning as the same compact disclosure row and content rail used by tool activity. */

"use client";

import { BrainCircuitIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ResponseText } from "@/components/chat/elements/response";
import { cn } from "@/components/ui/utils";

const AUTO_CLOSE_DELAY = 500;

export function Reasoning({
  nested = false,
  streaming = false,
  summary,
}: {
  nested?: boolean;
  streaming?: boolean;
  summary: string;
}) {
  const [open, setOpen] = useState(streaming);
  const wasStreaming = useRef(streaming);

  useEffect(() => {
    if (streaming) {
      wasStreaming.current = true;
      setOpen(true);
      return;
    }
    if (!wasStreaming.current) return;
    wasStreaming.current = false;
    const timer = window.setTimeout(() => setOpen(false), AUTO_CLOSE_DELAY);
    return () => window.clearTimeout(timer);
  }, [streaming]);

  return (
    <details
      className={cn(
        "group/reasoning not-prose w-full max-w-full overflow-hidden",
        !nested && "mb-2",
      )}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary
        className={cn(
          "flex w-full min-w-0 cursor-pointer list-none items-center gap-2.5 text-left transition-colors hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/60 dark:hover:text-white [&::-webkit-details-marker]:hidden",
          nested ? "h-7 py-0" : "py-2",
        )}
      >
        <span className="flex size-5 shrink-0 items-center justify-center text-zinc-500 dark:text-zinc-400">
          <BrainCircuitIcon aria-hidden="true" className="size-3.5" strokeWidth={1.7} />
        </span>
        <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">Reasoning</span>
        <ChevronRightIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-zinc-400 transition-transform duration-200 group-open/reasoning:rotate-90 group-hover/reasoning:text-zinc-700 dark:group-hover/reasoning:text-zinc-200"
        />
      </summary>
      {summary ? (
        <div className="ml-2 min-w-0 max-w-full border-l border-border/70 pl-3 pr-2 text-popover-foreground">
          <div className="max-h-72 overflow-x-hidden overflow-y-auto py-1.5 text-zinc-600 dark:text-zinc-400">
            <ResponseText
              className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400 [&>*:first-child]:mt-0! [&>*:last-child]:mb-0! [&_li]:my-0 [&_ol]:my-1 [&_p]:my-0! [&_ul]:my-1"
              compact
              text={summary}
            />
          </div>
        </div>
      ) : null}
    </details>
  );
}
