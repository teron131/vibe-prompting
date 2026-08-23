/** Owns the viewport-safe menu surface shared by chat composer selectors. */

"use client";

import type { ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";

import { cn } from "@/components/ui/utils";

const widthClasses = {
  content: "w-max max-w-[calc(100vw-1.5rem)]",
  wide: "w-72 max-w-[calc(100vw-1.5rem)]",
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
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const details = menu?.closest("details");
    const summary = details?.querySelector<HTMLElement>(":scope > summary");
    if (!menu || !details || !summary) return;
    const menuElement = menu;
    const detailsElement = details;
    const summaryElement = summary;

    function positionMenu() {
      if (!detailsElement.open) {
        menuElement.style.visibility = "hidden";
        return;
      }
      const trigger = summaryElement.getBoundingClientRect();
      const left = Math.max(12, trigger.left);
      menuElement.style.left = `${left}px`;
      menuElement.style.bottom = `${window.innerHeight - trigger.top + 8}px`;
      menuElement.style.maxWidth = `${Math.max(0, window.innerWidth - left - 12)}px`;
      menuElement.style.visibility = "visible";
    }

    const observer = new MutationObserver(positionMenu);
    observer.observe(detailsElement, { attributeFilter: ["open"], attributes: true });
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, { capture: true, passive: true });
    positionMenu();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, []);

  return (
    <div
      className={cn(
        "fixed z-50 rounded-xl border bg-popover text-popover-foreground shadow-xl",
        widthClasses[width],
        className,
      )}
      ref={menuRef}
      style={{ visibility: "hidden" }}
    >
      {children}
    </div>
  );
}
