/** Returns feature workspaces to the app home while closing any persisted auxiliary chat panel. */

"use client";

import { House } from "lucide-react";
import Link from "next/link";
import type { MouseEvent as ReactMouseEvent } from "react";

export function WorkspaceHomeLink() {
  function returnHome(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented) return;
    const key = "vibe-prompting:workspace:new";
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const workspace = JSON.parse(raw) as Record<string, unknown>;
      window.localStorage.setItem(key, JSON.stringify({ ...workspace, panelOpen: false }));
    } catch {}
  }

  return (
    <Link
      aria-label="Home"
      className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-xs font-medium hover:bg-accent"
      href="/"
      onClick={returnHome}
    >
      <House aria-hidden="true" className="size-3.5" />
      <span className="hidden sm:inline">Home</span>
    </Link>
  );
}
