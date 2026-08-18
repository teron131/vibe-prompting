/** Renders the shared Vibe Prompting mark in the current theme without depending on the browser favicon asset. */

import { cn } from "@/components/ui/utils";

export function AppIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn("shrink-0 text-black dark:text-white", className)}
      viewBox="0 0 32 32"
    >
      <path d="M9 9h14v3H9zm0 5.5h10v3H9zm0 5.5h7v3H9z" fill="currentColor" />
      <circle cx="23" cy="22" fill="#a3e635" r="3" />
    </svg>
  );
}
