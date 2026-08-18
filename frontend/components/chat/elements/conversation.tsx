/** Provides the bounded scrolling transcript region and its readable content measure. */

import type { HTMLAttributes, ReactNode, RefObject } from "react";

import { cn } from "@/components/ui/utils";

export function Conversation({
  children,
  className,
  containerRef,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  containerRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto", className)} ref={containerRef} {...props}>
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">{children}</div>
    </div>
  );
}
