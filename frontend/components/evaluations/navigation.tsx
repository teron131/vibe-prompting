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
      className="ml-4 min-w-0 flex-1 overflow-x-auto bg-background"
    >
      <div className="flex min-w-max gap-5">
        {destinations.map(({ href, icon: Icon, label }) => {
          const selected = isSelected(pathname, href);
          return (
            <Link
              aria-current={selected ? "page" : undefined}
              className={cn(
                "flex h-11 items-center gap-2 border-b-2 text-sm font-medium transition-colors",
                selected
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              href={href}
              key={href}
            >
              <Icon aria-hidden="true" className="size-3.5" />
              {label}
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
