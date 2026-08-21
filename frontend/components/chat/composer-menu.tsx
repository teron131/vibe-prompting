/** Owns the viewport-safe menu surface shared by chat composer selectors. */

import type { ReactNode } from "react";

import { cn } from "@/components/ui/utils";

const widthClasses = {
  content: "sm:w-max sm:max-w-[calc(100vw-1.5rem)]",
  wide: "sm:w-72",
} as const;

export function ComposerMenu({
  children,
  className,
  width = "content",
}: {
  children: ReactNode;
  className?: string;
  width?: keyof typeof widthClasses;
}) {
  return (
    <div
      className={cn(
        "fixed right-3 bottom-20 left-3 z-50 w-auto max-w-none rounded-xl border bg-popover text-popover-foreground shadow-xl sm:absolute sm:right-auto sm:bottom-[calc(100%+8px)] sm:left-0",
        widthClasses[width],
        className,
      )}
    >
      {children}
    </div>
  );
}
