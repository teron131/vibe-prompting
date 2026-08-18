/** Opens the mobile navigation drawer and controls the persistent desktop sidebar width. */

"use client";

import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/utils";

import { useWorkspaceSidebar } from "./workspace-shell";

export function SidebarToggle({ className }: { className?: string }) {
  const { desktopCollapsed, toggleDesktop, toggleMobile } = useWorkspaceSidebar();
  const desktopLabel = desktopCollapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <>
      <Button
        aria-label="Open navigation"
        className={cn("md:hidden", className)}
        onClick={toggleMobile}
        size="icon"
        title="Open navigation"
        variant="ghost"
      >
        <Menu aria-hidden="true" />
      </Button>
      <Button
        aria-label={desktopLabel}
        className={cn("hidden size-8 text-muted-foreground md:inline-flex", className)}
        onClick={toggleDesktop}
        size="icon"
        title={desktopLabel}
        variant="ghost"
      >
        {desktopCollapsed ? (
          <PanelLeftOpen aria-hidden="true" className="size-4" />
        ) : (
          <PanelLeftClose aria-hidden="true" className="size-4" />
        )}
      </Button>
    </>
  );
}
