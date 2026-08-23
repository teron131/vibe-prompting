/** Keeps evaluation task navigation visible and marks run reports as part of result inspection. */

"use client";

import { BarChart3, ListFilter, Play, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { cn } from "@/components/ui/utils";

const destinations = [
  { href: "/evaluations/run", icon: Play, label: "Run" },
  { href: "/evaluations/criteria", icon: SlidersHorizontal, label: "Criteria" },
  { href: "/evaluations/results", icon: ListFilter, label: "Results" },
  { href: "/evaluations/analytics", icon: BarChart3, label: "Analytics" },
] as const;

export function EvaluationNavigation() {
  const pathname = usePathname();
  const navigationRef = useRef<HTMLElement>(null);
  const selectedDestinationRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const navigation = navigationRef.current;
    const selectedDestination = selectedDestinationRef.current;
    if (!navigation || !selectedDestination) return;
    const revealSelectedDestination = () => {
      const navigationBounds = navigation.getBoundingClientRect();
      const destinationBounds = selectedDestination.getBoundingClientRect();
      if (destinationBounds.left < navigationBounds.left)
        navigation.scrollLeft += Math.floor(destinationBounds.left - navigationBounds.left);
      else if (destinationBounds.right > navigationBounds.right)
        navigation.scrollLeft += Math.ceil(destinationBounds.right - navigationBounds.right);
    };
    revealSelectedDestination();
    const observer = new ResizeObserver(revealSelectedDestination);
    observer.observe(navigation);
    return () => observer.disconnect();
  }, [pathname]);

  return (
    <nav
      aria-label="Evaluation workspace"
      className="ml-2 min-w-0 flex-1 overflow-x-auto bg-background sm:ml-4"
      ref={navigationRef}
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
              ref={selected ? selectedDestinationRef : undefined}
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
