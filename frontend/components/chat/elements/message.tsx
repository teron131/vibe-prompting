/** Establishes distinct readable layouts for user requests and Operator outcomes. */

import type { ReactNode } from "react";

import { cn } from "@/components/ui/utils";

export function Message({
  actions,
  avatar,
  children,
  role,
}: {
  actions?: ReactNode;
  avatar?: ReactNode;
  children: ReactNode;
  role: "assistant" | "user";
}) {
  return (
    <article className="group/message mb-6 w-full">
      <div
        className={cn(
          "flex w-full items-start gap-2 md:gap-3",
          role === "user" ? "justify-end" : "justify-start",
        )}
      >
        {role === "assistant" && avatar ? (
          <div className="-mt-1 flex size-8 shrink-0 items-center justify-center">{avatar}</div>
        ) : null}
        <div
          className={cn(
            "flex flex-col gap-2 text-sm leading-6 md:gap-4",
            role === "user"
              ? "max-w-[calc(100%-2.5rem)] sm:max-w-[min(fit-content,72%)]"
              : "min-w-0 flex-1",
          )}
        >
          {children}
          {actions}
        </div>
      </div>
    </article>
  );
}
