/** Keeps evaluation task navigation visible and marks run reports as part of result inspection. */

"use client";

import { BarChart3, ListFilter, Play, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/components/ui/utils";

const destinations = [
  { href: "/evaluations/run", icon: Play, label: "Run" },
  { href: "/evaluations/criteria", icon: SlidersHorizontal, label: "Criteria" },
  { href: "/evaluations/results", icon: ListFilter, label: "Results" },
  { href: "/evaluations/analytics", icon: BarChart3, label: "Analytics" },
] as const;

export function EvaluationNavigation() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Evaluation workspace"
      className="ml-2 min-w-0 flex-1 overflow-x-auto bg-background sm:ml-4"
    >
      <div className="flex min-w-max gap-1 sm:gap-5">
        {destinations.map(({ href, icon: Icon, label }) => {
          const selected = isSelected(pathname, href);
          return (
            <Link
              aria-current={selected ? "page" : undefined}
              aria-label={label}
              className={cn(
                "flex size-8 shrink-0 items-center justify-center gap-2 border-b-2 text-sm font-medium transition-colors sm:h-11 sm:w-auto",
                selected
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              href={href}
              key={href}
              title={label}
            >
              <Icon aria-hidden="true" className="size-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function isSelected(pathname: string, href: string): boolean {
  if (pathname === href || pathname.startsWith(`${href}/`)) return true;
  return href === "/evaluations/results" && /^\/evaluations\/[0-9a-f-]+$/i.test(pathname);
}
