/** Provides the bounded scrolling transcript region and its readable content measure. */

import { ArrowDown } from "lucide-react";
import type { HTMLAttributes, ReactNode, RefObject } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/utils";

export function Conversation({
  children,
  className,
  containerRef,
  onScrollToBottom,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  containerRef?: RefObject<HTMLDivElement | null>;
  onScrollToBottom?(): void;
}) {
  return (
    <div className="relative min-h-0 flex-1">
      <div className={cn("h-full overflow-y-auto", className)} ref={containerRef} {...props}>
        <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">{children}</div>
      </div>
      {onScrollToBottom ? (
        <Button
          aria-label="Scroll to bottom"
          className="absolute bottom-4 left-1/2 z-10 size-11 -translate-x-1/2 rounded-full border border-border shadow-sm"
          onClick={onScrollToBottom}
          size="icon"
          title="Scroll to bottom"
          variant="secondary"
        >
          <ArrowDown aria-hidden="true" className="size-5" strokeWidth={2} />
        </Button>
      ) : null}
    </div>
  );
}
